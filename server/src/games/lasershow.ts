import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { LsPhase, LsState } from "../protocol.js";

/**
 * Laser Show en sala: un escenario redondo de programa de TV y lasers que lo barren.
 *
 * El server es duenio de la SEMILLA del show y del RELOJ, y lleva el orden de
 * eliminacion. Cada laser es una funcion del tiempo que el cliente genera con la
 * semilla (`buildShow` en `src/games/laser-show/game/Lasers.ts`): no viaja ningun
 * laser por la red, y el server ni siquiera los genera — solo manda `seed` y
 * `elapsed`. El movimiento lo simula cada cliente y aca se reenvia, como en Pista
 * Loca.
 *
 * Quien decide que te toco un laser (o que te caiste del escenario) es el CLIENTE
 * (`ls:dead`): ve el laser con la misma latencia con la que recibe el reloj, asi que
 * juzgarlo aca castigaria al de peor conexion. Spoofeable, como la posicion; mismo
 * nivel de confianza que el repo ya acepta. Como red, el desconectado queda afuera a
 * los `DISCONNECT_KILL_MS`.
 *
 * Fin: queda uno en pie (con 2+ largando) -> ese juega una vuelta de honor de
 * `LAP_MS` y se corta (asi siempre suma mas que el segundo); se caen todos; o se
 * llega al tope `MATCH_MS`.
 *
 * Constantes DUPLICADAS en `src/games/laser-show/game/constants.ts` por la regla de
 * decoupling del repo: si cambia el tuning, tocar los dos lados.
 */

// ---- Reloj (espejo de constants.ts del cliente) ----
const PREROLL_MS = 3000;
const MATCH_MS = 150_000;
/** Vuelta de honor del ultimo en pie. */
const LAP_MS = 5000;
/** Radio del escenario: mas lejos que esto (y abajo) ya no hay piso. */
const STAGE_R = 8;

// ---- Empujon ----
const PUSH_RANGE = 1.8;
const PUSH_ARC = 1.2;
const PUSH_FORCE = 9;
const PUSH_LIFT = 4;
/** Enfriamiento; espejo del `PUSH_COOLDOWN_MS` del cliente, pero el que vale es este. */
const PUSH_COOLDOWN_MS = 1200;

// ---- Reglas / timing ----
const MAX_SEATS = 8;
const START_GRACE_MS = 8000;
const DISCONNECT_KILL_MS = 10_000;
const TICK_MS = 50;
const STATE_SYNC_MS = 1000;

interface Pos {
  x: number;
  y: number;
  z: number;
  r: number;
  f: number;
}

interface Seat {
  nickname: string;
  alive: boolean;
  /** Ms aguantados desde la largada (-1 mientras sigue en pie). */
  time: number;
  pos: Pos;
  killTimer: ReturnType<typeof setTimeout> | null;
  lastPush: number;
}

export class LaserShowSim implements RoomSim {
  private readonly room: GameRoom;
  private round = -1;
  private phase: LsPhase = "waiting";
  private seed = 1;
  private seats: Seat[] = [];
  private starters = 0;
  /** Ms de partida en que termina la vuelta de honor (-1 = no hay). */
  private lapEnd = -1;
  private endElapsed = 0;

  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (seat?.killTimer) {
      clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    const index = this.seats.findIndex((s) => s.nickname === nickname);
    this.room.emitTo(nickname, "ls:init", {
      seat: index,
      seats: this.seats.map((s) => s.nickname),
      // Al que vuelve de un F5 se lo devuelve donde estaba.
      spawn: seat ? { x: seat.pos.x, y: Math.max(0, seat.pos.y), z: seat.pos.z, r: seat.pos.r } : null,
      ...this.stateFields(),
    });
    this.broadcastState();

    if (this.phase !== "waiting") return;
    if (this.startTimer === null) this.startTimer = setTimeout(() => this.launch(), START_GRACE_MS);
    if (this.seats.length > 0 && this.seats.every((s) => this.room.isConnected(s.nickname))) this.launch();
  }

  leave(nickname: string): void {
    const seat = this.seatOf(nickname);
    if (!seat || !seat.alive || this.phase === "waiting" || this.phase === "over") {
      this.broadcastState();
      return;
    }
    if (seat.killTimer) clearTimeout(seat.killTimer);
    seat.killTimer = setTimeout(() => {
      seat.killTimer = null;
      if (!this.room.isConnected(nickname)) this.kill(seat);
    }, DISCONNECT_KILL_MS);
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    const seat = this.seatOf(nickname);
    if (!seat) return;
    if (event === "ls:pos") {
      if (!seat.alive && this.phase === "playing") return;
      const x = readNumber(payload, "x");
      const y = readNumber(payload, "y");
      const z = readNumber(payload, "z");
      if (x === null || y === null || z === null) return;
      seat.pos = {
        x: clamp(x, -30, 30),
        y: clamp(y, -60, 20),
        z: clamp(z, -30, 30),
        r: readNumber(payload, "r") ?? 0,
        f: (readInt(payload, "f") ?? 0) & 7,
      };
      return;
    }
    if (this.phase !== "playing" || !seat.alive) return;
    if (event === "ls:dead") this.kill(seat);
    else if (event === "ls:push") this.push(seat, readNumber(payload, "r"));
  }

  /**
   * Empujon (el de Pista Loca): alcanza a los vivos cerca (`PUSH_RANGE`), a la misma
   * altura y adelante del que empuja. A cada uno se le manda, dirigido, el impulso a
   * aplicar (`ls:shove`): el vuelo lo simula el empujado. A todos se les avisa quien
   * empujo (`ls:pushfx`) para la animacion. Con enfriamiento del lado del server.
   */
  private push(seat: Seat, yaw: number | null): void {
    const now = Date.now();
    if (now - seat.lastPush < PUSH_COOLDOWN_MS) return;
    seat.lastPush = now;
    const facing = yaw ?? seat.pos.r;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const index = this.seats.indexOf(seat);
    this.room.broadcast("ls:pushfx", { i: index });
    for (const other of this.seats) {
      if (other === seat || !other.alive) continue;
      const dx = other.pos.x - seat.pos.x;
      const dz = other.pos.z - seat.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > PUSH_RANGE || Math.abs(other.pos.y - seat.pos.y) > 1.3) continue;
      if (dist > 0.3 && (dx * fx + dz * fz) / dist < Math.cos(PUSH_ARC)) continue;
      const nx = dist > 0.3 ? dx / dist : fx;
      const nz = dist > 0.3 ? dz / dist : fz;
      const power = PUSH_FORCE * (1 - (dist / PUSH_RANGE) * 0.35);
      this.room.emitTo(other.nickname, "ls:shove", {
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
    for (const seat of this.seats) {
      if (seat.killTimer) clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    this.loop = null;
    this.startTimer = null;
  }

  // ---------- Ciclo ----------

  private reset(roster: string[]): void {
    this.dispose();
    this.phase = "waiting";
    this.seed = 1 + Math.floor(Math.random() * 2_000_000_000);
    this.lapEnd = -1;
    this.endElapsed = 0;
    const list = roster.slice(0, MAX_SEATS);
    this.seats = list.map((nickname, i) => ({
      nickname,
      alive: true,
      time: -1,
      // Sembrada con la largada, para que nadie sea invisible durante el countdown.
      pos: { ...spawnPos(i, list.length), f: 1 },
      killTimer: null,
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
      if (!this.room.isConnected(seat.nickname)) {
        seat.alive = false;
        seat.time = 0;
      }
    }
    this.starters = this.seats.filter((s) => s.alive).length;
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
      const t = this.elapsed();
      // Red: el que cayo del escenario y no pudo avisar.
      for (const seat of this.seats) {
        if (seat.alive && seat.pos.y < -20 && Math.hypot(seat.pos.x, seat.pos.z) > STAGE_R) this.kill(seat);
      }
      if (this.phase === "playing" && (t >= MATCH_MS || (this.lapEnd >= 0 && t >= this.lapEnd))) this.finish();
    }
    if (this.phase === "over") return;
    this.broadcastSnap();
    if (now - this.lastState >= STATE_SYNC_MS) this.broadcastState();
  }

  private kill(seat: Seat): void {
    if (!seat.alive || this.phase !== "playing") return;
    seat.alive = false;
    seat.time = Math.round(this.elapsed());
    const alive = this.seats.filter((s) => s.alive).length;
    if (alive === 0) {
      this.finish();
      return;
    }
    // Queda uno solo: arranca su vuelta de honor (si no estaba ya en una).
    if (this.starters >= 2 && alive === 1 && this.lapEnd < 0) {
      this.lapEnd = Math.min(MATCH_MS, seat.time + LAP_MS);
    }
    this.broadcastState();
  }

  private finish(): void {
    if (this.phase === "over") return;
    this.endElapsed = Math.round(Math.min(MATCH_MS, this.elapsed()));
    this.phase = "over";
    for (const seat of this.seats) {
      if (seat.alive) {
        seat.alive = false;
        seat.time = this.endElapsed;
      }
      if (seat.killTimer) clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    this.broadcastState();
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  // ---------- Salida ----------

  private stateFields(): LsState {
    const now = Date.now();
    const t = this.elapsed();
    let msLeft = 0;
    if (this.phase === "preroll") msLeft = Math.max(0, this.launchAt - now);
    else if (this.phase === "playing") msLeft = Math.max(0, (this.lapEnd >= 0 ? this.lapEnd : MATCH_MS) - t);
    return {
      phase: this.phase,
      msLeft: Math.round(msLeft),
      elapsed: Math.round(t),
      seed: this.seed,
      lap: this.lapEnd >= 0,
      alive: this.seats.map((s) => s.alive),
      times: this.seats.map((s) => s.time),
      on: this.seats.map((s) => this.room.isConnected(s.nickname)),
    };
  }

  private broadcastState(): void {
    this.lastState = Date.now();
    this.room.broadcast("ls:state", this.stateFields());
  }

  private broadcastSnap(): void {
    const p: number[] = [];
    this.seats.forEach((seat, i) => {
      p.push(i, round2(seat.pos.x), round2(seat.pos.y), round2(seat.pos.z), round2(seat.pos.r), seat.pos.f);
    });
    this.room.broadcast("ls:snap", { p });
  }

  /**
   * Ms desde la largada: negativo durante la cuenta regresiva (el cliente arma su
   * reloj con eso), congelado al terminar.
   */
  private elapsed(): number {
    if (this.phase === "waiting") return -PREROLL_MS;
    if (this.phase === "over") return this.endElapsed;
    return Date.now() - this.launchAt;
  }

  private seatOf(nickname: string): Seat | undefined {
    return this.seats.find((s) => s.nickname === nickname);
  }
}

/** Largada: en ronda, a mitad de camino entre la torre del centro y el borde. */
function spawnPos(seat: number, count: number): { x: number; y: number; z: number; r: number } {
  const n = Math.max(count, 1);
  const angle = (seat / n) * Math.PI * 2 + Math.PI / 2;
  const x = Math.cos(angle) * 4.5;
  const z = Math.sin(angle) * 4.5;
  // Mirando hacia afuera, de espaldas a la torre.
  return { x: round2(x), y: 0, z: round2(z), r: round2(Math.atan2(x, z)) };
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

/** Engancha el juego en el namespace `/lasershow`. */
export function registerLaserShow(io: Server): void {
  registerGame(io, "/lasershow", "ls:join", parseJoin, (room) => new LaserShowSim(room));
}
