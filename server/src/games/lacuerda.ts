import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { LcPhase, LcState, LcStatus } from "../protocol.js";

/**
 * La Cuerda en sala: un puente angosto sobre el vacio y dos cuerdas gigantes que
 * giran cada vez mas rapido. Es Marea de Lava con cuerdas en el lugar de la lava, mas
 * el empujon de Pista Loca.
 *
 * El server es duenio del reloj de la partida y del resultado de cada uno, y resuelve
 * los empujones. El movimiento lo simula cada cliente y aca se reenvia, como en Marea
 * de Lava. El puente es fijo: no hay semilla.
 *
 * Cada cuerda es una funcion del tiempo (`ropeAngle`), duplicada en el cliente: no
 * viaja por la red, cada uno la calcula con el `elapsed` del estado. Quien decide que
 * te agarro (o que te caiste) es el CLIENTE (`lc:dead`): juzgarlo aca castigaria al
 * que tiene peor conexion. Como red, el server si pasa la cuerda por la ultima
 * posicion de los DESCONECTADOS: el que se quedo parado en la zona de una cuerda cae
 * solo, y el que se quedo antes de la zona queda afuera al tope de MATCH_MS.
 *
 * Constantes DUPLICADAS en `src/games/la-cuerda/game/constants.ts` por la regla de
 * decoupling del repo: si cambia el tuning, tocar los dos lados.
 */

// ---- Recorrido y cuerda (espejo de constants.ts del cliente) ----
const GOAL_Z = -52;
const ROPE_AXIS_Y = 5.55;
const ROPE_R = 5.3;
const ROPE_HAND_R = 2.2;
const ROPE_END_X = 7;
const ROPE_THICK = 0.12;
const FALL_Y = -6;
const BODY_HALF = 0.3;
const BODY_HEIGHT = 1.8;

interface Rope {
  z: number;
  w0: number;
  accel: number;
  dir: 1 | -1;
  phase: number;
}

/** Las dos cuerdas: la segunda gira al reves, mas rapida y desfasada media vuelta. */
const ROPES: readonly Rope[] = [
  { z: -20, w0: 2.2, accel: 0.025, dir: 1, phase: Math.PI },
  { z: -36, w0: 2.6, accel: 0.025, dir: -1, phase: 0 },
];

// ---- Empujon (lo de Pista Loca, mas suave: en un puente de 1.2 m cualquier envion tira) ----
/** Alcance, a la misma altura (+-1.3 m) y adelante (dentro de PUSH_ARC de hacia donde mira). */
const PUSH_RANGE = 1.6;
const PUSH_ARC = 1.2;
/** Impulso horizontal (mas fuerte de cerca) y para arriba (m/s). */
const PUSH_FORCE = 7;
const PUSH_LIFT = 3.5;
/** Enfriamiento; espejo del `PUSH_COOLDOWN_MS` del cliente, pero el que vale es este. */
const PUSH_COOLDOWN_MS = 1500;

// ---- Reglas / timing ----
const MAX_SEATS = 8;
const PREROLL_MS = 3000;
const START_GRACE_MS = 8000;
/** Tope duro: el que no cruzo para entonces queda afuera. */
const MATCH_MS = 90_000;
const END_DELAY_MS = 1500;
const TICK_MS = 50;
const STATE_SYNC_MS = 1000;

/** Angulo de la cuerda a los `t` ms de la largada (0 = abajo). */
function ropeAngle(rope: Rope, t: number): number {
  const s = t / 1000;
  const turn = s <= 0 ? rope.w0 * s : rope.w0 * s + 0.5 * rope.accel * s * s;
  return rope.phase + rope.dir * turn;
}

function ropeRadius(x: number): number {
  const u = Math.min(1, Math.abs(x) / ROPE_END_X);
  return ROPE_HAND_R + (ROPE_R - ROPE_HAND_R) * Math.sqrt(1 - u * u);
}

/** Misma prueba que `ropeHits` del cliente: barre el arco de `from` a `to`. */
function ropeHits(rope: Rope, from: number, to: number, x: number, y: number, z: number): boolean {
  if (Math.abs(x) > ROPE_END_X) return false;
  const r = ropeRadius(x);
  // Una vuelta entera ya pasa por todos lados: con la pestaña dormida el arco puede
  // sumar miles de vueltas y no hace falta barrerlas todas.
  if (Math.abs(to - from) > Math.PI * 2) from = to - Math.sign(to - from) * Math.PI * 2;
  const span = to - from;
  const steps = Math.max(1, Math.ceil(Math.abs(span) / 0.02));
  const reach = BODY_HALF + ROPE_THICK;
  for (let i = 0; i <= steps; i++) {
    const th = from + (span * i) / steps;
    const rz = rope.z + r * Math.sin(th);
    if (Math.abs(rz - z) > reach) continue;
    const ry = ROPE_AXIS_Y - r * Math.cos(th);
    if (ry > y - ROPE_THICK && ry < y + BODY_HEIGHT + ROPE_THICK) return true;
  }
  return false;
}

function progressOf(z: number): number {
  return Math.max(0, Math.min(-GOAL_Z, -z));
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
  status: LcStatus;
  /** Mejor avance (m). */
  best: number;
  /** Ms desde la largada en que llego a la meta (-1 si no llego). */
  goalT: number;
  pos: Pos;
  lastPush: number;
}

/** Sobre el puente (no en las plataformas de salida ni de meta): donde se puede empujar. */
function onBridge(pos: Pos): boolean {
  return pos.z < 0 && pos.z > GOAL_Z;
}

export class LaCuerdaSim implements RoomSim {
  private readonly room: GameRoom;
  private round = -1;
  private phase: LcPhase = "waiting";
  private seats: Seat[] = [];
  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private launchAt = 0;
  private lastState = 0;
  private lastAngles: number[] = [];

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
    this.room.emitTo(nickname, "lc:init", {
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
    // Nada: el desconectado se queda donde estaba; si esta en la zona, la cuerda lo alcanza.
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    const seat = this.seatOf(nickname);
    if (!seat) return;
    if (event === "lc:pos") {
      if (seat.status !== "run") return;
      const x = readNumber(payload, "x");
      const y = readNumber(payload, "y");
      const z = readNumber(payload, "z");
      if (x === null || y === null || z === null) return;
      seat.pos = {
        x: clamp(x, -30, 30),
        y: clamp(y, -80, 20),
        z: clamp(z, GOAL_Z - 20, 20),
        r: readNumber(payload, "r") ?? 0,
        f: (readInt(payload, "f") ?? 0) & 3,
      };
      if (this.phase === "playing") seat.best = Math.max(seat.best, progressOf(seat.pos.z));
      return;
    }
    if (this.phase !== "playing" || seat.status !== "run") return;
    if (event === "lc:push") {
      this.push(seat, readNumber(payload, "r"));
    } else if (event === "lc:dead") {
      this.kill(seat);
    } else if (event === "lc:goal") {
      // La meta se valida contra la ultima posicion declarada.
      if (seat.pos.z > GOAL_Z || seat.pos.y < -0.5) return;
      seat.status = "goal";
      seat.best = -GOAL_Z;
      seat.goalT = Math.round(this.elapsed());
      this.broadcastState();
      this.checkEnd();
    }
  }

  /**
   * Empujon (el de Pista Loca): alcanza a los que siguen en carrera, cerca
   * (`PUSH_RANGE`), a la misma altura y adelante del que empuja. A cada uno se le
   * manda, dirigido, el impulso a aplicar (`lc:shove`): el vuelo lo simula cada
   * cliente, como el resto de su movimiento. A todos se les avisa quien empujo
   * (`lc:pushfx`) para la animacion. Solo sobre el puente: en la salida, al largar,
   * todos se tirarian del borde antes de llegar al puente. Con enfriamiento del lado
   * del server (el del cliente se puede saltear desde las devtools).
   */
  private push(seat: Seat, yaw: number | null): void {
    const now = Date.now();
    if (now - seat.lastPush < PUSH_COOLDOWN_MS) return;
    seat.lastPush = now;
    const index = this.seats.indexOf(seat);
    this.room.broadcast("lc:pushfx", { i: index });
    if (!onBridge(seat.pos)) return;
    const facing = yaw ?? seat.pos.r;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    for (const other of this.seats) {
      if (other === seat || other.status !== "run" || !onBridge(other.pos)) continue;
      const dx = other.pos.x - seat.pos.x;
      const dz = other.pos.z - seat.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > PUSH_RANGE || Math.abs(other.pos.y - seat.pos.y) > 1.3) continue;
      // Adelante: el angulo entre hacia donde mira y hacia donde esta el otro.
      if (dist > 0.3 && (dx * fx + dz * fz) / dist < Math.cos(PUSH_ARC)) continue;
      const nx = dist > 0.3 ? dx / dist : fx;
      const nz = dist > 0.3 ? dz / dist : fz;
      // Mas fuerte de cerca: el que esta pegado sale disparado.
      const power = PUSH_FORCE * (1 - (dist / PUSH_RANGE) * 0.35);
      this.room.emitTo(other.nickname, "lc:shove", {
        vx: round2(nx * power),
        vz: round2(nz * power),
        vy: PUSH_LIFT,
        from: index,
      });
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
    const list = roster.slice(0, MAX_SEATS);
    this.seats = list.map((nickname, i) => ({
      nickname,
      status: "run",
      best: 0,
      goalT: -1,
      // Sembrada con la largada: sin esto cada uno es invisible durante el countdown.
      pos: { ...spawnPos(i, list.length), f: 1 },
      lastPush: 0,
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
      this.lastAngles = ROPES.map((rope) => ropeAngle(rope, 0));
      this.broadcastState();
    }
    if (this.phase === "playing") {
      const angles = ROPES.map((rope) => ropeAngle(rope, this.elapsed()));
      for (const seat of this.seats) {
        if (seat.status !== "run") continue;
        const { x, y, z } = seat.pos;
        // Red: el que cayo y no pudo avisar, y el desconectado parado en una zona.
        if (y < FALL_Y - 2) {
          this.kill(seat);
          continue;
        }
        if (this.room.isConnected(seat.nickname)) continue;
        if (ROPES.some((rope, i) => ropeHits(rope, this.lastAngles[i], angles[i], x, y, z))) this.kill(seat);
      }
      this.lastAngles = angles;
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

  private stateFields(): LcState {
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
      status: this.seats.map((s) => s.status),
      best: this.seats.map((s) => Math.round(s.best * 10) / 10),
      goalT: this.seats.map((s) => s.goalT),
      on: this.seats.map((s) => this.room.isConnected(s.nickname)),
    };
  }

  private broadcastState(): void {
    this.lastState = Date.now();
    this.room.broadcast("lc:state", this.stateFields());
  }

  private broadcastSnap(): void {
    const p: number[] = [];
    this.seats.forEach((seat, i) => {
      p.push(i, round2(seat.pos.x), round2(seat.pos.y), round2(seat.pos.z), round2(seat.pos.r), seat.pos.f);
    });
    this.room.broadcast("lc:snap", { p });
  }

  private elapsed(): number {
    if (this.phase === "waiting" || this.phase === "preroll") return 0;
    return Math.max(0, Date.now() - this.launchAt);
  }

  private seatOf(nickname: string): Seat | undefined {
    return this.seats.find((s) => s.nickname === nickname);
  }
}

/**
 * Largada: en dos carriles pegados, uno detras del otro, alineados con el puente.
 * En fila ancha los de las puntas arrancaban derecho y se caian al costado del puente
 * antes de entender que habia que ir al medio. No hay choque entre jugadores, asi que
 * encimarse no molesta.
 */
function spawnPos(seat: number, _count: number): { x: number; y: number; z: number; r: number } {
  const x = seat % 2 === 0 ? -0.3 : 0.3;
  const z = 2.2 + Math.floor(seat / 2) * 1.3;
  return { x, y: 0, z: round2(z), r: Math.PI };
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

/** Engancha el juego en el namespace `/lacuerda`. */
export function registerLaCuerda(io: Server): void {
  registerGame(io, "/lacuerda", "lc:join", parseJoin, (room) => new LaCuerdaSim(room));
}
