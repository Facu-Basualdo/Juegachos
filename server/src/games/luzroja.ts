import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { LrLight, LrPhase, LrState, LrStatus } from "../protocol.js";

/**
 * Luz Roja, Luz Verde en sala.
 *
 * El server es duenio del SEMAFORO (cuando canta la muñeca, cuanto dura cada luz,
 * cuando amaga), del reloj de la partida y del resultado de cada jugador (llego /
 * eliminado y con cuanto avance). El movimiento lo simula cada cliente y aca solo se
 * reenvia, como en Derrumbe.
 *
 * Quien juzga si te moviste en rojo es el CLIENTE, a proposito: el rojo le llega a
 * cada uno con su latencia, y juzgarlo en el server castigaria al que tiene peor
 * conexion (se moveria "en rojo" en el server mientras en su pantalla todavia era
 * verde). Cada cliente cuenta su margen desde que VE el rojo y declara su propia
 * eliminacion (`lr:out`). Es spoofeable, igual que la posicion; el nivel de
 * confianza es el mismo que el repo ya acepta para los puntajes. Lo que si se valida
 * aca es la llegada: `lr:fin` solo vale si la ultima posicion declarada ya cruzo la
 * linea.
 *
 * La duracion de cada verde viaja en el estado, y el cliente reparte la cancion en
 * ese tiempo: el ritmo de la cancion ES el aviso de cuanto queda. Lo dificil sale de
 * que el ritmo cambia en cada verde (rapido / medio / lento) y de los amagues.
 *
 * Constantes DUPLICADAS en `src/games/luz-roja/game/constants.ts` por la regla de
 * decoupling del repo: si cambia el tuning, tocar los dos lados.
 */

// ---- Cancha (espejo de constants.ts del cliente) ----
const START_Z = 30;
const FINISH_Z = -30;
const HALF_WIDTH = 14;

// ---- Reglas / timing ----
const MAX_SEATS = 8;
const PREROLL_MS = 3000;
const START_GRACE_MS = 8000;
/** Tiempo para cruzar. Al vencer, el que no llego queda eliminado. */
const MATCH_MS = 45_000;
/** Pausa entre que se resuelve el ultimo jugador y el cartel final. */
const END_DELAY_MS = 1500;
/** Sin volver en este tiempo, el que se desconecto queda eliminado donde estaba. */
const DISCONNECT_KILL_MS = 10_000;
const TICK_MS = 50;
const STATE_SYNC_MS = 1000;

/** Primer verde: largo y conocido, para que nadie quede eliminado en el primer segundo. */
const FIRST_GREEN_MS = 3500;
/** Perfiles de verde: rapido, medio y lento (ms), con su probabilidad. */
const GREEN_PROFILES: { min: number; max: number; weight: number }[] = [
  { min: 1100, max: 1900, weight: 0.35 },
  { min: 2200, max: 3300, weight: 0.4 },
  { min: 3600, max: 5000, weight: 0.25 },
];
const RED_MIN_MS = 1600;
const RED_MAX_MS = 3200;
/** Probabilidad de que un verde (de 2 s o mas) traiga un amague de la muñeca. */
const TEASE_CHANCE = 0.25;

interface Pos {
  x: number;
  z: number;
  r: number;
  m: number;
}

interface Seat {
  nickname: string;
  status: LrStatus;
  /** Avance hacia la meta, 0-100. */
  prog: number;
  /** Ms desde la largada en que cruzo (-1 si no cruzo). */
  finT: number;
  pos: Pos;
  killTimer: ReturnType<typeof setTimeout> | null;
}

export class LuzRojaSim implements RoomSim {
  private readonly room: GameRoom;

  private round = -1;
  private phase: LrPhase = "waiting";
  private seats: Seat[] = [];

  private light: LrLight = "red";
  private lightSeq = 0;
  private lightEndsAt = 0;
  private lightDur = 0;
  private teaseAt = 0;

  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private launchAt = 0;
  private lastState = 0;

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;
    // Entre rondas el GameRoom puede sobrevivir con la partida anterior adentro.
    if (round > this.round) {
      this.round = round;
      this.reset(roster);
    }
    if (round !== this.round) return;

    const seat = this.seatOf(nickname);
    if (seat?.killTimer) {
      clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }

    const index = this.seats.findIndex((s) => s.nickname === nickname);
    this.room.emitTo(nickname, "lr:init", {
      seat: index,
      seats: this.seats.map((s) => s.nickname),
      // Al que vuelve de un F5 se lo devuelve donde estaba.
      spawn: seat ? { x: seat.pos.x, z: seat.pos.z, r: seat.pos.r } : null,
      ...this.stateFields(),
    });
    this.broadcastState();

    if (this.phase !== "waiting") return;
    if (this.startTimer === null) this.startTimer = setTimeout(() => this.launch(), START_GRACE_MS);
    if (this.seats.length > 0 && this.seats.every((s) => this.room.isConnected(s.nickname))) this.launch();
  }

  leave(nickname: string): void {
    const seat = this.seatOf(nickname);
    if (!seat || seat.status !== "run") return;
    if (this.phase !== "preroll" && this.phase !== "playing") return;
    if (seat.killTimer) clearTimeout(seat.killTimer);
    seat.killTimer = setTimeout(() => {
      seat.killTimer = null;
      if (!this.room.isConnected(nickname)) this.eliminate(seat);
    }, DISCONNECT_KILL_MS);
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    const seat = this.seatOf(nickname);
    if (!seat) return;

    if (event === "lr:pos") {
      if (seat.status !== "run") return;
      const x = readNumber(payload, "x");
      const z = readNumber(payload, "z");
      if (x === null || z === null) return;
      seat.pos = {
        x: clamp(x, -HALF_WIDTH - 1, HALF_WIDTH + 1),
        z: clamp(z, FINISH_Z - 6, START_Z + 4),
        r: readNumber(payload, "r") ?? 0,
        m: (readInt(payload, "m") ?? 0) & 1,
      };
      return;
    }

    if (this.phase !== "playing" || seat.status !== "run") return;

    if (event === "lr:out") {
      this.eliminate(seat);
    } else if (event === "lr:fin") {
      // La llegada se valida: la ultima posicion declarada tiene que haber cruzado.
      if (seat.pos.z > FINISH_Z + 1) return;
      seat.status = "fin";
      seat.prog = 100;
      seat.finT = Math.round(this.elapsed());
      this.broadcastState();
      this.checkEnd();
    }
  }

  dispose(): void {
    if (this.loop) clearInterval(this.loop);
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    for (const seat of this.seats) {
      if (seat.killTimer) clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    this.loop = null;
    this.startTimer = null;
    this.endTimer = null;
  }

  // ---------- Ciclo ----------

  private reset(roster: string[]): void {
    this.dispose();
    this.phase = "waiting";
    const list = roster.slice(0, MAX_SEATS);
    this.seats = list.map((nickname, i) => ({
      nickname,
      status: "run",
      prog: 0,
      finT: -1,
      // Sembrada con la largada: sin esto cada uno es invisible para los demas
      // hasta su primer `lr:pos` (todo el countdown).
      pos: { ...spawnPos(i, list.length), m: 0 },
      killTimer: null,
    }));
    this.light = "red";
    this.lightSeq = 0;
    this.lightDur = 0;
    this.lightEndsAt = 0;
    this.teaseAt = 0;
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  private launch(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    // El que no llego a conectarse al largar no juega: queda afuera con 0.
    for (const seat of this.seats) {
      if (!this.room.isConnected(seat.nickname)) seat.status = "out";
    }
    this.phase = "preroll";
    this.launchAt = Date.now() + PREROLL_MS;
    this.broadcastState();
  }

  private tick(): void {
    const now = Date.now();

    if (this.phase === "preroll" && now >= this.launchAt) {
      this.phase = "playing";
      this.setLight("green", FIRST_GREEN_MS, now);
    }

    if (this.phase === "playing") {
      if (this.teaseAt > 0 && now >= this.teaseAt) {
        this.teaseAt = 0;
        this.room.broadcast("lr:tease", { n: this.lightSeq });
      }
      if (now >= this.lightEndsAt) {
        if (this.light === "green") this.setLight("red", randRange(RED_MIN_MS, RED_MAX_MS), now);
        else this.setLight("green", pickGreen(), now);
      }
      if (this.elapsed() >= MATCH_MS) this.timeUp();
    }

    if (this.phase === "over") return;
    this.broadcastSnap();
    if (now - this.lastState >= STATE_SYNC_MS) this.broadcastState();
  }

  private setLight(light: LrLight, dur: number, now: number): void {
    this.light = light;
    this.lightSeq++;
    this.lightDur = Math.round(dur);
    this.lightEndsAt = now + dur;
    this.teaseAt = 0;
    if (light === "green" && this.lightSeq > 1 && dur >= 2000 && Math.random() < TEASE_CHANCE) {
      this.teaseAt = now + dur * randRange(0.35, 0.65);
    }
    this.broadcastState();
  }

  /** Se acabo el tiempo: el que no cruzo queda eliminado donde esta. */
  private timeUp(): void {
    for (const seat of this.seats) {
      if (seat.status === "run") {
        seat.status = "out";
        seat.prog = progressOf(seat.pos.z);
      }
    }
    this.finish();
  }

  private eliminate(seat: Seat): void {
    if (seat.status !== "run") return;
    seat.status = "out";
    seat.prog = progressOf(seat.pos.z);
    this.broadcastState();
    this.checkEnd();
  }

  private checkEnd(): void {
    if (this.phase !== "playing" || this.endTimer) return;
    if (this.seats.some((s) => s.status === "run")) return;
    // Un respiro para que se vea la ultima caida (o la ultima llegada).
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      this.finish();
    }, END_DELAY_MS);
  }

  private finish(): void {
    if (this.phase === "over") return;
    this.phase = "over";
    for (const seat of this.seats) {
      if (seat.killTimer) clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    this.broadcastState();
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  // ---------- Salida ----------

  private stateFields(): LrState {
    const now = Date.now();
    return {
      phase: this.phase,
      msLeft:
        this.phase === "preroll"
          ? Math.max(0, this.launchAt - now)
          : this.phase === "playing"
            ? Math.max(0, MATCH_MS - this.elapsed())
            : 0,
      elapsed: Math.round(this.elapsed()),
      light: this.light,
      lightSeq: this.lightSeq,
      lightDur: this.lightDur,
      lightLeft: Math.max(0, Math.round(this.lightEndsAt - now)),
      status: this.seats.map((s) => s.status),
      prog: this.seats.map((s) => Math.round(s.prog * 10) / 10),
      finT: this.seats.map((s) => s.finT),
      on: this.seats.map((s) => this.room.isConnected(s.nickname)),
    };
  }

  private broadcastState(): void {
    this.lastState = Date.now();
    this.room.broadcast("lr:state", this.stateFields());
  }

  private broadcastSnap(): void {
    const p: number[] = [];
    this.seats.forEach((seat, i) => {
      p.push(i, round2(seat.pos.x), round2(seat.pos.z), round2(seat.pos.r), seat.pos.m);
    });
    this.room.broadcast("lr:snap", { p });
  }

  private elapsed(): number {
    if (this.phase === "waiting" || this.phase === "preroll") return 0;
    return Math.max(0, Date.now() - this.launchAt);
  }

  private seatOf(nickname: string): Seat | undefined {
    return this.seats.find((s) => s.nickname === nickname);
  }
}

/** Largada: en fila sobre la linea de salida, mirando a la muñeca. */
function spawnPos(seat: number, count: number): { x: number; z: number; r: number } {
  const n = Math.max(count, 1);
  const span = Math.min(HALF_WIDTH * 1.6, n * 3);
  const x = n === 1 ? 0 : -span / 2 + (span * seat) / (n - 1);
  return { x: round2(x), z: START_Z + 1.5, r: Math.PI };
}

function progressOf(z: number): number {
  return clamp(((START_Z - z) / (START_Z - FINISH_Z)) * 100, 0, 99.9);
}

function pickGreen(): number {
  let roll = Math.random();
  for (const p of GREEN_PROFILES) {
    if (roll < p.weight) return randRange(p.min, p.max);
    roll -= p.weight;
  }
  const last = GREEN_PROFILES[GREEN_PROFILES.length - 1];
  return randRange(last.min, last.max);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function readNumber(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function readInt(payload: unknown, key: string): number | null {
  const v = readNumber(payload, key);
  return v === null ? null : Math.trunc(v);
}

function parseJoin(payload: unknown): { nickname: string; roster: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nickname = typeof p.nickname === "string" ? p.nickname : null;
  if (!nickname) return null;
  const roster = Array.isArray(p.roster) ? p.roster.filter((x): x is string => typeof x === "string") : [];
  return { nickname, roster };
}

/** Engancha el juego en el namespace `/luzroja`. */
export function registerLuzRoja(io: Server): void {
  registerGame(io, "/luzroja", "lr:join", parseJoin, (room) => new LuzRojaSim(room));
}
