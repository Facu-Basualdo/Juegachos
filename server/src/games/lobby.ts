import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { LbCrown, LbPlayer, LbPos } from "../protocol.js";

/**
 * La Isla (sala 3D) en el server: un RELAY puro, como Neon Drift. Cada cliente
 * simula su propio muñeco (nada compite en la isla: se camina, se salta y se vota
 * parandose en un portal) y el server reenvia su posicion al resto. No toca la DB:
 * los votos y el "listo" siguen siendo filas de Supabase, las escribe cada
 * cliente como en la sala comun.
 *
 * Por que el server y no el broadcast de Supabase: 8 jugadores a ~15 envios/s son
 * 120 mensajes/s, arriba del tope de ~100 por canal de Realtime (ver "Canales
 * efimeros" en el CLAUDE.md raiz).
 *
 * Recuerda la ultima posicion y el accesorio de cada uno, para que el que llega (o
 * vuelve de jugar una ronda) vea a todos al instante y no recien cuando cada uno se
 * mueva. Y el **record de la torre** (el parkour del lobby): el que lo tiene lleva la
 * corona. El record vive en `records`, afuera del sim, porque entre ronda y ronda
 * todos se van a la pagina del juego, el GameRoom se vacia y se descarta, y la corona
 * no puede morirse con el.
 *
 * Ademas contesta `lb:ping` con su hora: las plataformas, barredores y ganchos de la
 * torre son funcion de ese reloj, asi todos los ven en el mismo lugar.
 */

/** Tope de envios reenviados por jugador (el cliente manda ~15/s; esto frena abusos). */
const MIN_POS_GAP_MS = 35;
/** Una reaccion por jugador cada tanto: son carteles, no un chat. */
const EMOTE_COOLDOWN_MS = 900;
const MAX_EMOTE = 7;
const MAX_LOOK = 15;
/** La isla mide ~40 m: cualquier cosa mas lejos es basura (o alguien cayendose). */
const MAX_COORD = 250;
/**
 * La cima de la torre esta a ~23.6 m (`src/lobby3d/game/Tower.ts`); para que valga una
 * llegada, la ultima posicion declarada tiene que estar arriba de esto. Duplicado del
 * cliente: si se cambia la torre, revisarlo.
 */
const TOP_MIN_Y = 20;
/** Una subida mas rapida que esto es imposible (`MIN_CLIMB_MS` del cliente). */
const MIN_CLIMB_MS = 15_000;
const MAX_CLIMB_MS = 60 * 60_000;
/** Cuanto sobrevive el record de una sala sin que nadie lo mire. */
const RECORD_TTL_MS = 6 * 60 * 60_000;

/** Record de la torre por codigo de sala (sobrevive a que el GameRoom se vacie). */
const records = new Map<string, LbCrown & { at: number }>();

function readRecord(code: string): LbCrown | null {
  const r = records.get(code);
  if (!r) return null;
  if (Date.now() - r.at > RECORD_TTL_MS) {
    records.delete(code);
    return null;
  }
  r.at = Date.now();
  return { p: r.p, ms: r.ms };
}

function purgeRecords(): void {
  const now = Date.now();
  for (const [code, r] of records) if (now - r.at > RECORD_TTL_MS) records.delete(code);
}

export class LobbySim implements RoomSim {
  private readonly room: GameRoom;
  private readonly players = new Map<string, LbPlayer & { at: number; emoteAt: number; topAt: number }>();

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, _roster: string[], meta?: unknown): void {
    const look = clampInt(readNum(meta, "look"), 0, MAX_LOOK);
    const others: LbPlayer[] = [];
    for (const [p, st] of this.players) {
      // Sin posicion todavia no hay donde dibujarlo: llega con su primer lb:pos.
      if (p === nickname || st.at === 0) continue;
      others.push({ p, look: st.look, x: st.x, y: st.y, z: st.z, r: st.r, f: st.f });
    }
    const prev = this.players.get(nickname);
    this.players.set(nickname, {
      p: nickname,
      look,
      x: prev?.x ?? 0,
      y: prev?.y ?? 0,
      z: prev?.z ?? 0,
      r: prev?.r ?? 0,
      f: prev?.f ?? 0,
      at: 0,
      emoteAt: 0,
      topAt: 0,
    });
    this.room.emitTo(nickname, "lb:init", { players: others, crown: readRecord(this.room.code) });
    this.room.broadcast("lb:hi", { p: nickname, look });
  }

  leave(nickname: string): void {
    this.players.delete(nickname);
    this.room.broadcast("lb:bye", { p: nickname });
  }

  message(nickname: string, event: string, payload: unknown): void {
    const st = this.players.get(nickname);
    if (!st) return;
    const now = Date.now();
    switch (event) {
      case "lb:pos": {
        const pos = parsePos(payload);
        if (!pos || now - st.at < MIN_POS_GAP_MS) return;
        st.at = now;
        Object.assign(st, pos);
        // Va a toda la sala, emisor incluido; el cliente descarta el propio.
        this.room.broadcast("lb:pos", { ...pos, p: nickname } satisfies LbPos);
        return;
      }
      case "lb:emote": {
        const e = readNum(payload, "e");
        if (e === null || e < 0 || e > MAX_EMOTE || now - st.emoteAt < EMOTE_COOLDOWN_MS) return;
        st.emoteAt = now;
        this.room.broadcast("lb:emote", { p: nickname, e: Math.trunc(e) });
        return;
      }
      case "lb:ping": {
        const c = readNum(payload, "c");
        if (c === null) return;
        this.room.emitTo(nickname, "lb:pong", { c, t: Date.now() });
        return;
      }
      case "lb:top": {
        const ms = readNum(payload, "ms");
        // Mismo nivel de confianza que el resto (spoofeable); se descarta lo imposible.
        if (ms === null || ms < MIN_CLIMB_MS || ms > MAX_CLIMB_MS || st.y < TOP_MIN_Y) return;
        // Una llegada por subida: no se puede spamear el anuncio.
        if (now - st.topAt < MIN_CLIMB_MS) return;
        st.topAt = now;
        const time = Math.round(ms);
        this.room.broadcast("lb:summit", { p: nickname, ms: time });
        const rec = readRecord(this.room.code);
        if (!rec || time < rec.ms) {
          purgeRecords();
          records.set(this.room.code, { p: nickname, ms: time, at: Date.now() });
          this.room.broadcast("lb:crown", { p: nickname, ms: time });
        }
        return;
      }
    }
  }

  dispose(): void {
    // Sin timers: nada que liberar.
  }
}

function parsePos(payload: unknown): Omit<LbPos, "p"> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const x = num(p.x);
  const y = num(p.y);
  const z = num(p.z);
  const r = num(p.r);
  const f = num(p.f);
  if (x === null || y === null || z === null || r === null || f === null) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD || Math.abs(z) > MAX_COORD) return null;
  return { x, y, z, r, f: Math.trunc(f) & 3 };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readNum(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    return num((payload as Record<string, unknown>)[key]);
  }
  return null;
}

function clampInt(v: number | null, min: number, max: number): number {
  if (v === null) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function parseJoin(payload: unknown): { nickname: string; roster: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nickname = typeof p.nickname === "string" ? p.nickname.slice(0, 24) : null;
  if (!nickname) return null;
  const roster = Array.isArray(p.roster)
    ? p.roster.filter((x): x is string => typeof x === "string")
    : [];
  return { nickname, roster };
}

/** Engancha la isla en el namespace `/lobby`. */
export function registerLobby(io: Server): void {
  registerGame(io, "/lobby", "lb:join", parseJoin, (room) => new LobbySim(room));
}
