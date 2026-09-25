import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { MlPhase, MlState, MlStatus } from "../protocol.js";

/**
 * Marea de Lava en sala: una pared de plataformas que se trepa mientras la lava
 * sube cada vez mas rapido.
 *
 * El server es duenio de la SEMILLA (la torre la genera cada cliente con ella, asi
 * que es identica en todas las pantallas sin mandar ni una plataforma), del reloj de
 * la lava y del resultado de cada uno. El movimiento lo simula cada cliente y aca se
 * reenvia, como en Derrumbe.
 *
 * La lava es una funcion del tiempo (`lavaY`), duplicada en el cliente: no viaja
 * por la red, cada uno la calcula con el `elapsed` del estado. Quien decide que la
 * tocaste es el CLIENTE (`ml:dead`), con la misma logica que Derrumbe; como red, el
 * server elimina a quien quede mas de LAVA_MARGIN por debajo de la lava (un
 * desconectado se queda quieto y la lava lo alcanza sola, sin timers aparte).
 *
 * Constantes DUPLICADAS en `src/games/marea-lava/game/constants.ts` por la regla de
 * decoupling del repo: si cambia el tuning, tocar los dos lados.
 */

// ---- Torre y lava (espejo de constants.ts del cliente) ----
/** Altura de la cima. */
const TOP_Y = 80;
const LAVA_START_Y = -6;
/** Velocidad inicial de la lava (m/s) y cuanto acelera (m/s^2). */
const LAVA_V0 = 0.5;
const LAVA_ACCEL = 0.012;

// ---- Reglas / timing ----
const MAX_SEATS = 8;
const PREROLL_MS = 3000;
const START_GRACE_MS = 8000;
/** Tope duro: a esta altura de la partida la lava ya paso la cima igual. */
const MATCH_MS = 120_000;
const END_DELAY_MS = 1500;
/** El server elimina a quien quede este tanto por debajo de la lava (red de seguridad). */
const LAVA_MARGIN = 2;
const TICK_MS = 50;
const STATE_SYNC_MS = 1000;

/** Altura de la lava a los `t` ms de la largada. */
function lavaY(t: number): number {
  const s = Math.max(0, t) / 1000;
  return LAVA_START_Y + LAVA_V0 * s + 0.5 * LAVA_ACCEL * s * s;
}

interface Pos {
  x: number;
  y: number;
  z: number;
  r: number;
  f: number;
}

interface Seat {
  nickname: string;
  status: MlStatus;
  /** Mejor altura alcanzada. */
  best: number;
  /** Ms desde la largada en que llego a la cima (-1 si no llego). */
  topT: number;
  pos: Pos;
}

export class MareaLavaSim implements RoomSim {
  private readonly room: GameRoom;
  private round = -1;
  private phase: MlPhase = "waiting";
  private seats: Seat[] = [];
  private seed = 0;
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
    if (round > this.round) {
      this.round = round;
      this.reset(roster);
    }
    if (round !== this.round) return;
    const seat = this.seatOf(nickname);
    const index = this.seats.findIndex((s) => s.nickname === nickname);
    this.room.emitTo(nickname, "ml:init", {
      seat: index,
      seats: this.seats.map((s) => s.nickname),
      // Al que vuelve de un F5 se lo devuelve donde estaba.
      spawn: seat ? { x: seat.pos.x, y: seat.pos.y, z: seat.pos.z, r: seat.pos.r } : null,
      ...this.stateFields(),
    });
    this.broadcastState();
    if (this.phase !== "waiting") return;
    if (this.startTimer === null) this.startTimer = setTimeout(() => this.launch(), START_GRACE_MS);
    if (this.seats.length > 0 && this.seats.every((s) => this.room.isConnected(s.nickname))) this.launch();
  }

  leave(_nickname: string): void {
    // Nada: el desconectado se queda donde estaba y la lava lo alcanza sola.
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    const seat = this.seatOf(nickname);
    if (!seat) return;
    if (event === "ml:pos") {
      if (seat.status !== "run") return;
      const x = readNumber(payload, "x");
      const y = readNumber(payload, "y");
      const z = readNumber(payload, "z");
      if (x === null || y === null || z === null) return;
      seat.pos = {
        x: clamp(x, -20, 20),
        y: clamp(y, LAVA_START_Y - 10, TOP_Y + 4),
        z: clamp(z, -10, 10),
        r: readNumber(payload, "r") ?? 0,
        f: (readInt(payload, "f") ?? 0) & 3,
      };
      if (this.phase === "playing") seat.best = Math.max(seat.best, Math.min(seat.pos.y, TOP_Y));
      return;
    }
    if (this.phase !== "playing" || seat.status !== "run") return;
    if (event === "ml:dead") {
      this.kill(seat);
    } else if (event === "ml:top") {
      // La cima se valida contra la ultima posicion declarada.
      if (seat.pos.y < TOP_Y - 0.5) return;
      seat.status = "top";
      seat.best = TOP_Y;
      seat.topT = Math.round(this.elapsed());
      this.broadcastState();
      this.checkEnd();
    }
  }

  dispose(): void {
    if (this.loop) clearInterval(this.loop);
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.loop = null;
    this.startTimer = null;
    this.endTimer = null;
  }

  // ---------- Ciclo ----------

  private reset(roster: string[]): void {
    this.dispose();
    this.phase = "waiting";
    this.seed = Math.floor(Math.random() * 2 ** 31);
    const list = roster.slice(0, MAX_SEATS);
    this.seats = list.map((nickname, i) => ({
      nickname,
      status: "run",
      best: 0,
      topT: -1,
      // Sembrada con la largada: sin esto cada uno es invisible durante el countdown.
      pos: { ...spawnPos(i, list.length), f: 1 },
    }));
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  private launch(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    for (const seat of this.seats) {
      if (!this.room.isConnected(seat.nickname)) seat.status = "dead";
    }
    this.phase = "preroll";
    this.launchAt = Date.now() + PREROLL_MS;
    this.broadcastState();
  }

  private tick(): void {
    const now = Date.now();
    if (this.phase === "preroll" && now >= this.launchAt) {
      this.phase = "playing";
      this.broadcastState();
    }
    if (this.phase === "playing") {
      const lava = lavaY(this.elapsed());
      for (const seat of this.seats) {
        if (seat.status === "run" && seat.pos.y < lava - LAVA_MARGIN) this.kill(seat);
      }
      if (this.elapsed() >= MATCH_MS) this.finish();
    }
    if (this.phase === "over") return;
    this.broadcastSnap();
    if (now - this.lastState >= STATE_SYNC_MS) this.broadcastState();
  }

  private kill(seat: Seat): void {
    if (seat.status !== "run") return;
    seat.status = "dead";
    this.broadcastState();
    this.checkEnd();
  }

  private checkEnd(): void {
    if (this.phase !== "playing" || this.endTimer) return;
    if (this.seats.some((s) => s.status === "run")) return;
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      this.finish();
    }, END_DELAY_MS);
  }

  private finish(): void {
    if (this.phase === "over") return;
    this.phase = "over";
    for (const seat of this.seats) if (seat.status === "run") seat.status = "dead";
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    this.broadcastState();
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  // ---------- Salida ----------

  private stateFields(): MlState {
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
      seed: this.seed,
      status: this.seats.map((s) => s.status),
      best: this.seats.map((s) => Math.round(s.best * 10) / 10),
      topT: this.seats.map((s) => s.topT),
      on: this.seats.map((s) => this.room.isConnected(s.nickname)),
    };
  }

  private broadcastState(): void {
    this.lastState = Date.now();
    this.room.broadcast("ml:state", this.stateFields());
  }

  private broadcastSnap(): void {
    const p: number[] = [];
    this.seats.forEach((seat, i) => {
      p.push(i, round2(seat.pos.x), round2(seat.pos.y), round2(seat.pos.z), round2(seat.pos.r), seat.pos.f);
    });
    this.room.broadcast("ml:snap", { p });
  }

  private elapsed(): number {
    if (this.phase === "waiting" || this.phase === "preroll") return 0;
    return Math.max(0, Date.now() - this.launchAt);
  }

  private seatOf(nickname: string): Seat | undefined {
    return this.seats.find((s) => s.nickname === nickname);
  }
}

/** Largada: en fila sobre el piso de abajo, mirando a la pared. */
function spawnPos(seat: number, count: number): { x: number; y: number; z: number; r: number } {
  const n = Math.max(count, 1);
  const span = Math.min(14, n * 2.2);
  const x = n === 1 ? 0 : -span / 2 + (span * seat) / (n - 1);
  // En el pasillo del frente: ninguna plataforma llega hasta aca (ver Tower.clampDepth).
  return { x: round2(x), y: 0, z: 3.1, r: Math.PI };
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

/** Engancha el juego en el namespace `/marealava`. */
export function registerMareaLava(io: Server): void {
  registerGame(io, "/marealava", "ml:join", parseJoin, (room) => new MareaLavaSim(room));
}
