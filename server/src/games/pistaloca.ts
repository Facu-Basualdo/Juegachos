import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { PlPhase, PlState, PlStep } from "../protocol.js";

/**
 * Pista Loca en sala (Block Party).
 *
 * El server es duenio de la PISTA y del RITMO: arma el dibujo de cada ronda, decide
 * cuanto suena la musica, que color se pide y cuanto hay para llegar, y lleva el
 * orden de eliminacion. El movimiento lo simula cada cliente y aca solo se reenvia,
 * como en Derrumbe.
 *
 * Cada ronda tiene cuatro pasos: `dance` (suena la musica, la pista completa),
 * `choose` (se corta la musica y se pide un color, con su tiempo), `drop` (cae todo
 * lo que no es de ese color) y `reset` (la pista se rearma con otro dibujo).
 *
 * Quien decide si te caiste es el CLIENTE: cada uno arranca su cuenta del `choose` y
 * hace caer su pista cuando le llega el `drop`, asi los dos mensajes llegan con la
 * misma latencia y el margen es identico para todos (juzgarlo aca castigaria al de
 * peor conexion). El cliente declara su caida (`pl:dead`). Spoofeable, como la
 * posicion; mismo nivel de confianza que el repo ya acepta.
 *
 * Constantes DUPLICADAS en `src/games/pista-loca/game/constants.ts` por la regla de
 * decoupling del repo: si cambia el tuning, tocar los dos lados.
 */

// ---- Pista (espejo de constants.ts del cliente) ----
const GRID = 24;
const CELLS = GRID * GRID;
/** Colores de lana disponibles (el cliente tiene los nombres y los valores). */
const COLOR_COUNT = 10;

// ---- Reglas / timing ----
const MAX_SEATS = 8;
const PREROLL_MS = 3000;
const START_GRACE_MS = 8000;
/** Tope de rondas: con un solo jugador (o empates largos) la partida igual termina. */
const MAX_ROUNDS = 20;
const DROP_MS = 2000;
const RESET_MS = 600;
const DISCONNECT_KILL_MS = 10_000;
/** Empujon: alcance, apertura hacia adelante (rad), fuerza, cuanto levanta y enfriamiento. */
const PUSH_RANGE = 1.9;
const PUSH_ARC = 1.2;
const PUSH_FORCE = 11;
const PUSH_LIFT = 4.5;
const PUSH_COOLDOWN_MS = 1200;
const TICK_MS = 50;
const STATE_SYNC_MS = 1000;

/** Cuanto suena la musica en la ronda `r` (1..), con un poco de azar. */
function danceMs(r: number): number {
  return Math.max(1800, 3200 - r * 90) + Math.random() * 900;
}

/** Tiempo para llegar al color: arranca holgado y se achica hasta 1.3 s. */
function chooseMs(r: number): number {
  return Math.max(1300, 5000 - (r - 1) * 330);
}

/** Cuantos colores entran en el dibujo de la ronda `r`. */
function colorsFor(r: number): number {
  return Math.min(COLOR_COUNT, 4 + r);
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
  alive: boolean;
  /** Rondas completas aguantadas (-1 mientras sigue vivo). */
  rounds: number;
  /** Ms desde la largada en que cayo (-1 vivo). */
  time: number;
  pos: Pos;
  killTimer: ReturnType<typeof setTimeout> | null;
  /** Momento (Date.now) del ultimo empujon, para el enfriamiento. */
  lastPush: number;
}

export class PistaLocaSim implements RoomSim {
  private readonly room: GameRoom;

  private roomRound = -1;
  private phase: PlPhase = "waiting";
  private step: PlStep = "dance";
  private stepEndsAt = 0;
  private stepDur = 0;
  private round = 0;
  private pattern = "";
  private color = 0;
  private seats: Seat[] = [];
  private starters = 0;

  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private launchAt = 0;
  private lastState = 0;

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;
    if (round > this.roomRound) {
      this.roomRound = round;
      this.reset(roster);
    }
    if (round !== this.roomRound) return;

    const seat = this.seatOf(nickname);
    if (seat?.killTimer) {
      clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    const index = this.seats.findIndex((s) => s.nickname === nickname);
    this.room.emitTo(nickname, "pl:init", {
      seat: index,
      seats: this.seats.map((s) => s.nickname),
      grid: GRID,
      spawn: seat ? { x: seat.pos.x, y: seat.pos.y, z: seat.pos.z, r: seat.pos.r } : null,
      ...this.stateFields(),
    });
    this.broadcastState();

    if (this.phase !== "waiting") return;
    if (this.startTimer === null) this.startTimer = setTimeout(() => this.launch(), START_GRACE_MS);
    if (this.seats.length > 0 && this.seats.every((s) => this.room.isConnected(s.nickname))) this.launch();
  }

  leave(nickname: string): void {
    const seat = this.seatOf(nickname);
    if (!seat || !seat.alive || this.phase === "waiting" || this.phase === "over") return;
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
    if (event === "pl:pos") {
      const x = readNumber(payload, "x");
      const y = readNumber(payload, "y");
      const z = readNumber(payload, "z");
      if (x === null || y === null || z === null) return;
      seat.pos = {
        x: clamp(x, -30, 30),
        y: clamp(y, -40, 20),
        z: clamp(z, -30, 30),
        r: readNumber(payload, "r") ?? 0,
        f: (readInt(payload, "f") ?? 0) & 3,
      };
      return;
    }
    if (event === "pl:dead" && this.phase === "playing" && seat.alive) this.kill(seat);
    if (event === "pl:push" && this.phase === "playing" && seat.alive) this.push(seat, readNumber(payload, "r"));
  }

  /**
   * Empujon: alcanza a los que estan cerca (`PUSH_RANGE`) y adelante del que empuja
   * (dentro de `PUSH_ARC` de hacia donde mira), a la misma altura. A cada uno se le
   * manda, dirigido, el impulso a aplicar (`pl:shove`): el movimiento lo simula cada
   * cliente, asi que el empujado es el que sale volando en su pantalla. A todos se les
   * avisa quien empujo (`pl:pushfx`) para la animacion. Con enfriamiento del lado del
   * server: el cliente no puede ametrallar empujones.
   */
  private push(seat: Seat, yaw: number | null): void {
    const now = Date.now();
    if (now - seat.lastPush < PUSH_COOLDOWN_MS) return;
    seat.lastPush = now;
    const facing = yaw ?? seat.pos.r;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const index = this.seats.indexOf(seat);
    this.room.broadcast("pl:pushfx", { i: index });
    for (const other of this.seats) {
      if (other === seat || !other.alive) continue;
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
      this.room.emitTo(other.nickname, "pl:shove", {
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
    const list = roster.slice(0, MAX_SEATS);
    this.seats = list.map((nickname, i) => ({
      nickname,
      alive: true,
      rounds: -1,
      time: -1,
      // Sembrada con la largada, para que nadie sea invisible durante el countdown.
      pos: { ...spawnPos(i, list.length), f: 1 },
      killTimer: null,
      lastPush: 0,
    }));
    this.round = 0;
    this.step = "dance";
    this.pattern = makePattern(1);
    this.color = 0;
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
        seat.rounds = 0;
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
      this.startRound(now);
    }
    if (this.phase === "playing" && now >= this.stepEndsAt) this.nextStep(now);
    if (this.phase === "over") return;
    this.broadcastSnap();
    if (now - this.lastState >= STATE_SYNC_MS) this.broadcastState();
  }

  /** El dibujo ya esta armado: el de la ronda 1 en `reset()`, los demas en el paso "reset". */
  private startRound(now: number): void {
    this.round++;
    this.setStep("dance", danceMs(this.round), now);
  }

  private nextStep(now: number): void {
    if (this.step === "dance") {
      this.color = pickColor(this.pattern);
      this.setStep("choose", chooseMs(this.round), now);
    } else if (this.step === "choose") {
      this.setStep("drop", DROP_MS, now);
    } else if (this.step === "drop") {
      // Fin de la ronda: los que siguen en pie la sumaron.
      const alive = this.seats.filter((s) => s.alive).length;
      if (alive === 0 || (this.starters >= 2 && alive <= 1) || this.round >= MAX_ROUNDS) {
        this.finish();
        return;
      }
      this.pattern = makePattern(this.round + 1);
      this.setStep("reset", RESET_MS, now);
    } else {
      this.startRound(now);
    }
  }

  private setStep(step: PlStep, dur: number, now: number): void {
    this.step = step;
    this.stepDur = Math.round(dur);
    this.stepEndsAt = now + dur;
    this.broadcastState();
  }

  /** Cae: cuenta las rondas COMPLETAS que aguanto (la actual no). */
  private kill(seat: Seat): void {
    if (!seat.alive) return;
    seat.alive = false;
    seat.rounds = Math.max(0, this.round - 1);
    seat.time = Math.round(this.elapsed());
    this.broadcastState();
    if (this.seats.every((s) => !s.alive)) this.finish();
  }

  private finish(): void {
    if (this.phase === "over") return;
    this.phase = "over";
    for (const seat of this.seats) {
      if (seat.alive) {
        seat.alive = false;
        seat.rounds = this.round;
        seat.time = Math.round(this.elapsed());
      }
      if (seat.killTimer) clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    this.broadcastState();
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  // ---------- Salida ----------

  private stateFields(): PlState {
    const now = Date.now();
    return {
      phase: this.phase,
      msLeft: this.phase === "preroll" ? Math.max(0, this.launchAt - now) : 0,
      round: this.round,
      step: this.step,
      stepDur: this.stepDur,
      stepLeft: Math.max(0, Math.round(this.stepEndsAt - now)),
      color: this.color,
      pattern: this.pattern,
      alive: this.seats.map((s) => s.alive),
      rounds: this.seats.map((s) => s.rounds),
      times: this.seats.map((s) => s.time),
      on: this.seats.map((s) => this.room.isConnected(s.nickname)),
    };
  }

  private broadcastState(): void {
    this.lastState = Date.now();
    this.room.broadcast("pl:state", this.stateFields());
  }

  private broadcastSnap(): void {
    const p: number[] = [];
    this.seats.forEach((seat, i) => {
      p.push(i, round2(seat.pos.x), round2(seat.pos.y), round2(seat.pos.z), round2(seat.pos.r), seat.pos.f);
    });
    this.room.broadcast("pl:snap", { p });
  }

  private elapsed(): number {
    if (this.phase === "waiting" || this.phase === "preroll") return 0;
    return Math.max(0, Date.now() - this.launchAt);
  }

  private seatOf(nickname: string): Seat | undefined {
    return this.seats.find((s) => s.nickname === nickname);
  }
}

// ---------- Dibujos de la pista ----------

/**
 * Un dibujo por ronda, como string de GRID*GRID digitos (un color por celda). Cuatro
 * estilos que se van poniendo mas finos con las rondas: manchas grandes (Voronoi),
 * franjas, anillos y, al final, un mosaico chico. Mas colores y manchas mas chicas =
 * menos lugares donde pararse y mas lejos.
 */
function makePattern(round: number): string {
  const n = colorsFor(round);
  // Los colores de la ronda, sacados al azar de la paleta.
  const palette = shuffle([...Array(COLOR_COUNT).keys()]).slice(0, n);
  const cells = new Array<number>(CELLS);
  const style = round <= 2 ? 0 : Math.floor(Math.random() * (round >= 8 ? 4 : 3));
  const c = (GRID - 1) / 2;

  if (style === 0) {
    // Manchas: cada celda toma el color de la semilla mas cercana.
    const seeds = Math.min(60, 8 + round * 3);
    const pts = Array.from({ length: seeds }, (_, i) => ({
      x: Math.random() * GRID,
      z: Math.random() * GRID,
      col: palette[i % n],
    }));
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        let best = pts[0];
        let bd = Infinity;
        for (const p of pts) {
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        cells[z * GRID + x] = best.col;
      }
    }
  } else if (style === 1) {
    // Franjas diagonales de ancho decreciente.
    const w = Math.max(1, 4 - Math.floor(round / 5));
    const flip = Math.random() < 0.5;
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const k = Math.floor((flip ? x + z : x - z + GRID) / w);
        cells[z * GRID + x] = palette[k % n];
      }
    }
  } else if (style === 2) {
    // Anillos alrededor de un centro corrido.
    const ox = c + (Math.random() - 0.5) * 8;
    const oz = c + (Math.random() - 0.5) * 8;
    const w = Math.max(1.2, 3 - round * 0.1);
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const k = Math.floor(Math.hypot(x - ox, z - oz) / w);
        cells[z * GRID + x] = palette[k % n];
      }
    }
  } else {
    // Mosaico chico: cuadraditos de 2x2 al azar. El mas dificil.
    for (let z = 0; z < GRID; z += 2) {
      for (let x = 0; x < GRID; x += 2) {
        const col = palette[Math.floor(Math.random() * n)];
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) cells[(z + dz) * GRID + x + dx] = col;
      }
    }
  }
  return cells.join("");
}

/** Un color que este en la pista con al menos un 3% de celdas (si no, hay donde pararse igual). */
function pickColor(pattern: string): number {
  const counts = new Array<number>(COLOR_COUNT).fill(0);
  for (let i = 0; i < pattern.length; i++) counts[pattern.charCodeAt(i) - 48]++;
  const options = counts.map((n, col) => ({ n, col })).filter((o) => o.n >= CELLS * 0.03);
  const list = options.length > 0 ? options : counts.map((n, col) => ({ n, col })).filter((o) => o.n > 0);
  return list[Math.floor(Math.random() * list.length)].col;
}

function spawnPos(seat: number, count: number): { x: number; y: number; z: number; r: number } {
  const n = Math.max(count, 1);
  const angle = (seat / n) * Math.PI * 2;
  const x = Math.cos(angle) * 6;
  const z = Math.sin(angle) * 6;
  return { x: round2(x), y: 0, z: round2(z), r: round2(Math.atan2(-x, -z)) };
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
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

/** Engancha el juego en el namespace `/pistaloca`. */
export function registerPistaLoca(io: Server): void {
  registerGame(io, "/pistaloca", "pl:join", parseJoin, (room) => new PistaLocaSim(room));
}
