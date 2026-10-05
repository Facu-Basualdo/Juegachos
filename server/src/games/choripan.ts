import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";

/**
 * Chori y Pan en sala: carrera de parejas por tres salas del templo.
 *
 * Reparto (metodo aprobado, el mismo hibrido que Derrumbe):
 *
 *  - El MOVIMIENTO lo simula cada cliente (su propio heroe) y aca solo se reenvia al
 *    compañero y a quien aposto por esa pareja. Un plataformero de precision contra
 *    ~100 ms de red se siente pegajoso si se reconcilia.
 *  - Los MECANISMOS (botones, palancas, y con eso compuertas, ascensores y
 *    ventiladores) los arbitra este sim: cada cliente declara que CANALES estan
 *    pisando su heroe y las cajas que ve, y que palancas movio; el canal activo es la
 *    union. Asi las dos pantallas abren la misma compuerta al mismo tiempo.
 *  - Muertes y llegadas tambien pasan por aca: si muere cualquiera de los dos, se
 *    reinicia la sala para la pareja; si los dos estan en su puerta, pasan a la
 *    siguiente.
 *
 * El sim NO conoce la geometria de los niveles (no simula nada): solo la lista de ids,
 * DUPLICADA de `src/games/chori-y-pan/game/levels.ts` por la regla de decoupling. Si se
 * agrega o renombra un nivel, tocar los dos lados.
 */

export const LEVEL_IDS = ["atrio", "montacargas", "cajas", "ventilador", "caminos", "balanza", "torre", "relevo", "puente", "corazon"];

const LEVELS_PER_RUN = 3;
/** Tiempo para apostar (solo si hay un impar). */
const BET_MS = 12_000;
/** Congelado inicial, para que coincida con el 3/2/1/YA del cliente. */
const PREROLL_MS = 3_200;
/** Espera desde el primer join a que llegue el resto del roster antes de largar. */
const START_GRACE_MS = 8_000;
/** Tope de la carrera: el que no salio del templo queda ordenado por salas. */
const RACE_MS = 300_000;
/** Dos muertes seguidas de la misma pareja dentro de esta ventana son una sola. */
const RESET_DEBOUNCE_MS = 800;
/** Cada gema descuenta esto del tiempo final (espejo de GEM_BONUS del cliente). */
const GEM_BONUS_MS = 2_000;
const TICK_MS = 250;
const STATE_SYNC_MS = 1_000;

/** Niveles ya jugados por sala: se descartan hasta agotar la lista (rotacion). */
const usedByCode = new Map<string, string[]>();

type Role = "chori" | "pan";
type Phase = "waiting" | "bet" | "race" | "done";

interface Pair {
  id: number;
  chori: string;
  pan: string;
  /** Sala en la que va (0..LEVELS_PER_RUN). LEVELS_PER_RUN = termino. */
  level: number;
  finishedAt: number;
  deaths: number;
  gems: number;
  /** Gemas tomadas en la sala actual ("i"): si mueren, se devuelven. */
  levelGems: Set<number>;
  press: Record<Role, string>;
  levers: Map<number, { ch: string; on: boolean }>;
  door: Record<Role, boolean>;
  resetAt: number;
  channels: string;
}

export class ChoriPanSim implements RoomSim {
  private readonly room: GameRoom;
  private round = -1;
  private phase: Phase = "waiting";
  private roster: string[] = [];
  private pairs: Pair[] = [];
  private bettors: string[] = [];
  private bets = new Map<string, number>();
  private levels: string[] = [];
  private betEnd = 0;
  private raceStart = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private lastState = 0;

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;
    if (round > this.round) {
      this.round = round;
      this.reset(roster);
    }
    if (round !== this.round) return;
    this.emitInit(nickname);
    if (this.phase !== "waiting") return;
    if (this.startTimer === null) this.startTimer = setTimeout(() => this.setup(), START_GRACE_MS);
    if (this.roster.length > 0 && this.roster.every((n) => this.room.isConnected(n))) this.setup();
  }

  leave(_nickname: string): void {
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (event === "cp:bet") {
      if (this.phase !== "bet" || !this.bettors.includes(nickname)) return;
      const id = readInt(payload, "pair");
      if (id === null || !this.pairs.some((p) => p.id === id)) return;
      this.bets.set(nickname, id);
      this.broadcastState();
      return;
    }
    if (this.phase !== "race" || Date.now() < this.raceStart) return;
    const found = this.pairOf(nickname);
    if (!found) return;
    const { pair, role } = found;
    if (pair.level >= LEVELS_PER_RUN) return;
    const lv = readInt(payload, "lv");
    if (lv !== pair.level) return;
    const roles: Role[] = pair.chori === pair.pan ? ["chori", "pan"] : [role];

    if (event === "cp:pos") {
      // Reenvio: al compañero y a los que miran esta pareja.
      const p = payload as Record<string, unknown>;
      const out = { n: nickname, r: readStr(p, "r") ?? role, lv, x: num(p.x), y: num(p.y), vx: num(p.vx), vy: num(p.vy), f: num(p.f), g: num(p.g), a: num(p.a) };
      this.toPair(pair, "cp:peer", out, nickname);
      return;
    }
    if (event === "cp:press") {
      const r = (readStr(payload, "r") as Role | null) ?? role;
      if (!roles.includes(r)) return;
      pair.press[r] = (readStr(payload, "ch") ?? "").replace(/[^a-e]/g, "").slice(0, 5);
      this.recompute(pair);
      return;
    }
    if (event === "cp:lever") {
      const i = readInt(payload, "i");
      const ch = readStr(payload, "ch");
      const on = readInt(payload, "on");
      if (i === null || i < 0 || i > 15 || !ch || !/^[a-e]$/.test(ch) || on === null) return;
      pair.levers.set(i, { ch, on: on === 1 });
      this.recompute(pair, true);
      return;
    }
    if (event === "cp:box") {
      const p = payload as Record<string, unknown>;
      this.toPair(pair, "cp:box", { lv, i: num(p.i), x: num(p.x), y: num(p.y) }, nickname);
      return;
    }
    if (event === "cp:gem") {
      const i = readInt(payload, "i");
      if (i === null || i < 0 || i > 31 || pair.levelGems.has(i)) return;
      pair.levelGems.add(i);
      pair.gems++;
      this.toPair(pair, "cp:gem", { lv, i });
      return;
    }
    if (event === "cp:die") {
      const now = Date.now();
      if (now - pair.resetAt < RESET_DEBOUNCE_MS) return;
      pair.resetAt = now;
      pair.deaths++;
      pair.gems -= pair.levelGems.size;
      this.clearLevel(pair);
      this.toPair(pair, "cp:reset", { lv: pair.level, who: readStr(payload, "r") ?? role, cause: readStr(payload, "cause") ?? "" });
      this.broadcastState();
      return;
    }
    if (event === "cp:door") {
      const r = (readStr(payload, "r") as Role | null) ?? role;
      if (!roles.includes(r)) return;
      pair.door[r] = readInt(payload, "in") === 1;
      if (pair.door.chori && pair.door.pan) {
        pair.level++;
        this.clearLevel(pair);
        pair.levelGems = new Set();
        if (pair.level >= LEVELS_PER_RUN) pair.finishedAt = Date.now();
        this.toPair(pair, "cp:level", { lv: pair.level });
        this.broadcastState();
        if (this.pairs.every((p) => p.level >= LEVELS_PER_RUN)) this.finish();
      }
    }
  }

  dispose(): void {
    if (this.loop !== null) clearInterval(this.loop);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.loop = null;
    this.startTimer = null;
  }

  // ---------- Ciclo ----------

  private reset(roster: string[]): void {
    this.dispose();
    this.phase = "waiting";
    this.roster = roster.slice(0, 8);
    this.pairs = [];
    this.bettors = [];
    this.bets = new Map();
    this.levels = [];
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  private setup(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    const rand = mulberry32(hashSeed(`${this.room.code}:${this.round}`));
    const people = this.roster.filter((n) => this.room.isConnected(n));
    const list = people.length ? people : [...this.roster];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    this.pairs = [];
    if (list.length === 1) {
      // Solo en la sala: maneja a los dos (como en local).
      this.pairs.push(newPair(0, list[0], list[0]));
    } else {
      for (let i = 0; i + 1 < list.length; i += 2) this.pairs.push(newPair(this.pairs.length, list[i], list[i + 1]));
      if (list.length % 2 === 1) this.bettors = [list[list.length - 1]];
    }
    this.levels = this.pickLevels(rand);
    if (this.bettors.length) {
      this.phase = "bet";
      this.betEnd = Date.now() + BET_MS;
    } else this.startRace();
    for (const n of this.roster) this.emitInit(n);
    this.broadcastState();
  }

  private pickLevels(rand: () => number): string[] {
    const code = this.room.code;
    let used = usedByCode.get(code) ?? [];
    let pool = LEVEL_IDS.filter((id) => !used.includes(id));
    if (pool.length < LEVELS_PER_RUN) {
      used = [];
      pool = [...LEVEL_IDS];
    }
    const out: string[] = [];
    while (out.length < LEVELS_PER_RUN && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    usedByCode.set(code, [...used, ...out]);
    return out;
  }

  private startRace(): void {
    for (const b of this.bettors) {
      if (!this.bets.has(b) && this.pairs.length) this.bets.set(b, this.pairs[Math.floor(Math.random() * this.pairs.length)].id);
    }
    this.phase = "race";
    this.raceStart = Date.now() + PREROLL_MS;
    for (const n of this.roster) this.emitInit(n);
    this.broadcastState();
  }

  private finish(): void {
    if (this.phase === "done") return;
    this.phase = "done";
    this.broadcastState();
  }

  private tick(): void {
    const now = Date.now();
    if (this.phase === "bet" && now >= this.betEnd) this.startRace();
    if (this.phase === "race" && now >= this.raceStart + RACE_MS) this.finish();
    if (now - this.lastState >= STATE_SYNC_MS) this.broadcastState();
  }

  // ---------- Mecanismos ----------

  private clearLevel(pair: Pair): void {
    pair.press = { chori: "", pan: "" };
    pair.levers = new Map();
    pair.door = { chori: false, pan: false };
    pair.channels = "";
  }

  private recompute(pair: Pair, force = false): void {
    const set = new Set<string>([...pair.press.chori, ...pair.press.pan]);
    for (const l of pair.levers.values()) if (l.on) set.add(l.ch);
    const channels = [...set].sort().join("");
    if (!force && channels === pair.channels) return;
    pair.channels = channels;
    const levers = [...pair.levers.entries()].map(([i, l]) => [i, l.on ? 1 : 0]);
    this.toPair(pair, "cp:mech", { lv: pair.level, ch: channels, levers });
  }

  // ---------- Envios ----------

  private pairOf(nickname: string): { pair: Pair; role: Role } | null {
    for (const p of this.pairs) {
      if (p.chori === nickname) return { pair: p, role: "chori" };
      if (p.pan === nickname) return { pair: p, role: "pan" };
    }
    return null;
  }

  /** A los dos de la pareja (menos `except`) y a los que apostaron por ella. */
  private toPair(pair: Pair, event: string, payload: unknown, except?: string): void {
    const to = new Set<string>([pair.chori, pair.pan]);
    for (const [b, id] of this.bets) if (id === pair.id) to.add(b);
    if (except && pair.chori !== pair.pan) to.delete(except);
    for (const n of to) this.room.emitTo(n, event, { pair: pair.id, ...(payload as object) });
  }

  private emitInit(nickname: string): void {
    const found = this.pairOf(nickname);
    const role = found ? (found.pair.chori === found.pair.pan ? "both" : found.role) : this.bettors.includes(nickname) ? "bettor" : "none";
    this.room.emitTo(nickname, "cp:you", { role, pair: found ? found.pair.id : -1, round: this.round });
    this.room.emitTo(nickname, "cp:state", this.state());
    // Si vuelve a mitad de sala (F5), los mecanismos actuales de su pareja.
    const watch = found ? found.pair : this.pairs.find((p) => p.id === this.bets.get(nickname));
    if (watch && this.phase === "race") {
      const levers = [...watch.levers.entries()].map(([i, l]) => [i, l.on ? 1 : 0]);
      this.room.emitTo(nickname, "cp:mech", { pair: watch.id, lv: watch.level, ch: watch.channels, levers });
    }
  }

  private state(): unknown {
    const now = Date.now();
    return {
      phase: this.phase,
      round: this.round,
      t: now,
      levels: this.levels,
      betEnd: this.betEnd,
      raceStart: this.raceStart,
      raceEnd: this.raceStart + RACE_MS,
      bettors: this.bettors,
      bets: Object.fromEntries(this.bets),
      pairs: this.pairs.map((p) => ({
        id: p.id,
        chori: p.chori,
        pan: p.pan,
        level: p.level,
        time: p.finishedAt ? Math.max(0, p.finishedAt - this.raceStart - p.gems * GEM_BONUS_MS) : -1,
        deaths: p.deaths,
        gems: p.gems,
        on: this.room.isConnected(p.chori) && this.room.isConnected(p.pan),
      })),
    };
  }

  private broadcastState(): void {
    this.lastState = Date.now();
    this.room.broadcast("cp:state", this.state());
  }
}

function newPair(id: number, chori: string, pan: string): Pair {
  return {
    id,
    chori,
    pan,
    level: 0,
    finishedAt: 0,
    deaths: 0,
    gems: 0,
    levelGems: new Set(),
    press: { chori: "", pan: "" },
    levers: new Map(),
    door: { chori: false, pan: false },
    resetAt: 0,
    channels: "",
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
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

function readStr(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "string") return v.slice(0, 16);
  }
  return null;
}

function parseJoin(payload: unknown): { nickname: string; roster: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nickname = typeof p.nickname === "string" ? p.nickname : null;
  if (!nickname) return null;
  const roster = Array.isArray(p.roster) ? p.roster.filter((x): x is string => typeof x === "string") : [];
  return { nickname, roster };
}

/** Engancha el juego en el namespace `/choripan`. */
export function registerChoriPan(io: Server): void {
  registerGame(io, "/choripan", "cp:join", parseJoin, (room) => new ChoriPanSim(room));
}
