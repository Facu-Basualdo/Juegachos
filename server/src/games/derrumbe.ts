import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { DrInit, DrPhase, DrSnap, DrState } from "../protocol.js";

/**
 * Derrumbe en sala (TNT Run): el piso es AUTORITATIVO en el server, el
 * movimiento no.
 *
 * El reparto es distinto al de Manchon a proposito:
 *
 *  - El PISO es estado compartido en el que los ocho escriben a la vez (cada paso
 *    tira un bloque), asi que tiene un solo duenio: este sim. Un bloque existe o no
 *    existe para toda la sala, y el orden en que llegan los pasos no puede dejar
 *    dos pantallas con agujeros distintos.
 *  - El MOVIMIENTO lo simula cada cliente y aca solo se reenvia (como Neon Drift).
 *    Es un plataformero 3D con saltos: reconciliar la fisica vertical contra un
 *    server a ~150 ms se siente como correr en barro, y el pedido del juego (un
 *    bloque cae medio segundo despues de pisarlo) ya absorbe la latencia de los
 *    agujeros que abren los demas. La contra es que la posicion es spoofeable; es
 *    el mismo nivel de confianza que ya acepta el repo para los puntajes, y lo
 *    unico que se valida es lo que le arruinaria la partida a otro: un paso tiene
 *    que caer cerca de la ultima posicion declarada (no se pueden romper bloques
 *    a distancia).
 *
 * Cada cliente declara sus pasos (`dr:step`) y su muerte (`dr:dead`); el server
 * programa la caida de cada bloque, difunde los bloques recien pisados en el
 * snapshot (`f`) y, una vez por segundo, el tablero entero (`doom`) para que
 * cualquier desacuerdo se cure solo.
 *
 * Constantes DUPLICADAS en `src/games/derrumbe/game/constants.ts` por la regla de
 * decoupling del repo: si cambia el tuning, tocar los dos lados.
 */

// ---- Geometria (espejo de constants.ts del cliente) ----
const GRID = 25;
const LAYERS = 4;
const ARENA_RADIUS = 12.4;
/** Alto a proposito: la camara fija del cliente tiene que caber debajo del piso de arriba. */
const LAYER_GAP = 11;
const CENTER = (GRID - 1) / 2;
const CELLS_PER_LAYER = GRID * GRID;
const CELL_COUNT = CELLS_PER_LAYER * LAYERS;

// ---- Reglas / timing ----
const MAX_SEATS = 8;
/** Mecha de un bloque pisado: lo que tarda en caer. */
const FALL_DELAY_MS = 500;
/** Congelado inicial, para que coincida con el countdown 3/2/1/YA del cliente. */
const PREROLL_MS = 3000;
/** Espera desde el primer join a que llegue el resto del roster antes de largar. */
const START_GRACE_MS = 8000;
/** Vuelta de honor: cuando queda uno solo, sigue corriendo este rato antes del
 *  final. Es lo que hace que el ganador sume MAS tiempo que el ultimo en caer. */
const LAP_MS = 3000;
/** Tope duro de la partida (red de seguridad; el deterioro la termina antes). */
const MATCH_MAX_MS = 120_000;
/** A partir de aca el piso se empieza a pudrir solo, para que nadie estire la
 *  partida para siempre dando vueltas por un piso intacto. */
const DECAY_START_MS = 40_000;
/** Bloques por segundo que se pudren al arrancar el deterioro... */
const DECAY_BASE = 3;
/** ...y cuanto sube ese ritmo cada 10 s. */
const DECAY_GROWTH = 3;
/**
 * Sin volver en este tiempo, el que se desconecto cuenta como caido. Cubre un F5
 * real: la pagina carga, RoomMode arranca contra Supabase y recien ahi se vuelve a
 * conectar el socket (medido: con 6 s un headless lento ya lo daba por muerto).
 */
const DISCONNECT_KILL_MS = 10_000;
/** Radio de la huella (espejo de FOOT_RADIUS del cliente). */
const FOOT_RADIUS = 0.3;
/** Distancia maxima (en bloques) entre un paso declarado y la ultima posicion. */
const STEP_TOLERANCE = 2.5;
/** Tolerancia vertical del mismo chequeo. */
const STEP_Y_TOLERANCE = 3;
const TICK_MS = 50;
/** Cada cuanto viaja el tablero completo en el snapshot. */
const DOOM_SYNC_MS = 1000;
/** Cada cuanto se re-difunde el estado aunque no haya cambiado (reloj del HUD). */
const STATE_SYNC_MS = 1000;

/** Estado de una celda: fuera del circulo, entera, pisada (cayendo) o caida. */
const NONE = 0;
const INTACT = 1;
const TRIGGERED = 2;
const REMOVED = 3;

/** Celdas que forman parte del piso (el circulo), en el orden de los indices. */
const MASK: number[] = [];
for (let layer = 0; layer < LAYERS; layer++) {
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      if (Math.hypot(x - CENTER, z - CENTER) <= ARENA_RADIUS) {
        MASK.push(layer * CELLS_PER_LAYER + z * GRID + x);
      }
    }
  }
}

function surfaceY(layer: number): number {
  return (LAYERS - 1 - layer) * LAYER_GAP;
}

interface Pos {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Bits: 1 = en el piso, 2 = moviendose. */
  f: number;
}

interface Seat {
  nickname: string;
  alive: boolean;
  /** Ms aguantados; -1 mientras sigue vivo. */
  time: number;
  pos: Pos | null;
  killTimer: ReturnType<typeof setTimeout> | null;
}

export class DerrumbeSim implements RoomSim {
  private readonly room: GameRoom;

  /** Ronda en curso; el estado es de ESTA ronda y de ninguna otra. */
  private round = -1;
  private phase: DrPhase = "waiting";
  private seats: Seat[] = [];
  private cells = new Uint8Array(CELL_COUNT);
  private removeAt = new Float64Array(CELL_COUNT);
  /** Pisados desde el ultimo snapshot (para `DrSnap.f`). */
  private pending: number[] = [];
  /** Cuantos largaron vivos: con 2 o mas, la partida termina cuando queda uno. */
  private starters = 0;

  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private launchAt = 0;
  private lapEndAt = 0;
  private lastTick = 0;
  private lastDoom = 0;
  private lastState = 0;
  private decayAcc = 0;

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;

    // Entre rondas los clientes navegan de una pagina a la otra y no todos a la
    // vez, asi que el GameRoom puede sobrevivir con el piso de la ronda anterior
    // adentro. Una ronda mas nueva lo tira.
    if (round > this.round) {
      this.round = round;
      this.reset(roster);
    }
    if (round !== this.round) return;

    const seat = this.seatOf(nickname);
    if (seat) {
      if (seat.killTimer !== null) {
        clearTimeout(seat.killTimer);
        seat.killTimer = null;
      }
    }

    this.emitInitTo(nickname);
    this.broadcastState();

    if (this.phase !== "waiting") return;
    if (this.startTimer === null) {
      this.startTimer = setTimeout(() => this.launch(), START_GRACE_MS);
    }
    // Larga apenas estan todos los del roster conectados.
    if (this.seats.length > 0 && this.seats.every((s) => this.room.isConnected(s.nickname))) {
      this.launch();
    }
  }

  leave(nickname: string): void {
    const seat = this.seatOf(nickname);
    if (!seat || !seat.alive) return;
    if (this.phase !== "preroll" && this.phase !== "playing" && this.phase !== "lap") return;
    // Se le da un rato para volver (un F5). Si no vuelve, cae con el tiempo que
    // tenia al irse: nadie mas va a declarar su caida por el.
    // Recargar no puede ser un escudo: desconectado no se declaran pasos, asi que el
    // bloque de abajo no caeria nunca y el jugador volveria a un piso intacto. Se le
    // prende la mecha a lo que tiene bajo los pies, como si se hubiera quedado quieto.
    if (seat.pos && (this.phase === "playing" || this.phase === "lap")) this.triggerUnder(seat.pos);
    const time = this.elapsed();
    if (seat.killTimer !== null) clearTimeout(seat.killTimer);
    seat.killTimer = setTimeout(() => {
      seat.killTimer = null;
      if (!this.room.isConnected(nickname)) this.kill(seat, time);
    }, DISCONNECT_KILL_MS);
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    const seat = this.seatOf(nickname);
    if (!seat) return;

    if (event === "dr:pos") {
      const x = readNumber(payload, "x");
      const y = readNumber(payload, "y");
      const z = readNumber(payload, "z");
      if (x === null || y === null || z === null) return;
      seat.pos = {
        x: clamp(x, -40, 40),
        y: clamp(y, -30, 60),
        z: clamp(z, -40, 40),
        r: readNumber(payload, "r") ?? 0,
        f: (readInt(payload, "f") ?? 0) & 3,
      };
      return;
    }

    if (event === "dr:step") {
      if (this.phase !== "playing" && this.phase !== "lap") return;
      if (!seat.alive || !seat.pos) return;
      const list =
        payload && typeof payload === "object" ? (payload as { c?: unknown }).c : null;
      if (!Array.isArray(list)) return;
      const now = Date.now();
      for (const raw of list.slice(0, 16)) {
        if (typeof raw !== "number" || !Number.isInteger(raw)) continue;
        if (raw < 0 || raw >= CELL_COUNT || this.cells[raw] !== INTACT) continue;
        if (!this.nearSeat(raw, seat.pos)) continue;
        this.trigger(raw, now);
      }
      return;
    }

    if (event === "dr:dead") {
      if (this.phase !== "playing" && this.phase !== "lap") return;
      if (seat.alive) this.kill(seat, this.elapsed());
    }
  }

  dispose(): void {
    if (this.loop !== null) clearInterval(this.loop);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    for (const seat of this.seats) {
      if (seat.killTimer !== null) clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    this.loop = null;
    this.startTimer = null;
  }

  // ---------- Ciclo de la partida ----------

  private reset(roster: string[]): void {
    this.dispose();
    this.phase = "waiting";
    const count = Math.min(roster.length, MAX_SEATS);
    this.seats = roster.slice(0, MAX_SEATS).map((nickname, i) => ({
      nickname,
      alive: true,
      time: -1,
      // Sembrada con la largada: sin esto cada uno es invisible para los demas
      // hasta que manda su primera posicion, o sea durante todo el countdown.
      pos: { ...spawnPos(i, count), f: 1 },
      killTimer: null,
    }));
    this.cells = new Uint8Array(CELL_COUNT);
    this.removeAt = new Float64Array(CELL_COUNT);
    for (const idx of MASK) this.cells[idx] = INTACT;
    this.pending = [];
    this.starters = 0;
    this.decayAcc = 0;
    this.lastTick = Date.now();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  private launch(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    // El que no llego a conectarse cuando se larga no juega: queda afuera con 0.
    // Sin esto, un jugador que nunca abrio la pagina quedaria "vivo" para siempre.
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
    const dt = Math.min(now - this.lastTick, 250);
    this.lastTick = now;

    if (this.phase === "preroll" && now >= this.launchAt) {
      this.phase = "playing";
      this.broadcastState();
    }

    if (this.phase === "playing" || this.phase === "lap") {
      for (const idx of MASK) {
        if (this.cells[idx] === TRIGGERED && this.removeAt[idx] <= now) this.cells[idx] = REMOVED;
      }
      this.decay(dt, now);

      if (this.phase === "playing" && this.elapsed() >= MATCH_MAX_MS) this.finish();
      else if (this.phase === "lap" && now >= this.lapEndAt) this.finish();
    }

    if (this.phase === "over") return;

    this.broadcastSnap(now);
    if (now - this.lastState >= STATE_SYNC_MS) this.broadcastState();
  }

  /** Deterioro: pasado DECAY_START_MS el piso se pudre solo, cada vez mas rapido. */
  private decay(dt: number, now: number): void {
    const t = this.elapsed();
    if (t < DECAY_START_MS) return;
    const rate = DECAY_BASE + (DECAY_GROWTH * (t - DECAY_START_MS)) / 10_000;
    this.decayAcc += (rate * dt) / 1000;
    while (this.decayAcc >= 1) {
      this.decayAcc -= 1;
      for (let tries = 0; tries < 30; tries++) {
        const idx = MASK[Math.floor(Math.random() * MASK.length)];
        if (this.cells[idx] !== INTACT) continue;
        this.trigger(idx, now);
        break;
      }
    }
  }

  /** Prende las celdas enteras que toca la huella en `pos` (si esta parado en un piso). */
  private triggerUnder(pos: Pos): void {
    const now = Date.now();
    for (let layer = 0; layer < LAYERS; layer++) {
      if (Math.abs(pos.y - surfaceY(layer)) > 0.05) continue;
      const minX = Math.floor(pos.x - FOOT_RADIUS + CENTER + 0.5);
      const maxX = Math.floor(pos.x + FOOT_RADIUS + CENTER + 0.5);
      const minZ = Math.floor(pos.z - FOOT_RADIUS + CENTER + 0.5);
      const maxZ = Math.floor(pos.z + FOOT_RADIUS + CENTER + 0.5);
      for (let cz = Math.max(0, minZ); cz <= Math.min(GRID - 1, maxZ); cz++) {
        for (let cx = Math.max(0, minX); cx <= Math.min(GRID - 1, maxX); cx++) {
          const wx = cx - CENTER;
          const wz = cz - CENTER;
          const px = Math.max(wx - 0.5, Math.min(pos.x, wx + 0.5));
          const pz = Math.max(wz - 0.5, Math.min(pos.z, wz + 0.5));
          if ((px - pos.x) ** 2 + (pz - pos.z) ** 2 >= FOOT_RADIUS * FOOT_RADIUS) continue;
          const idx = layer * CELLS_PER_LAYER + cz * GRID + cx;
          if (this.cells[idx] === INTACT) this.trigger(idx, now);
        }
      }
    }
  }

  private trigger(idx: number, now: number): void {
    this.cells[idx] = TRIGGERED;
    this.removeAt[idx] = now + FALL_DELAY_MS;
    this.pending.push(idx);
  }

  private kill(seat: Seat, time: number): void {
    if (!seat.alive) return;
    seat.alive = false;
    seat.time = Math.max(0, Math.round(time));
    this.broadcastState();

    const alive = this.seats.filter((s) => s.alive).length;
    if (alive === 0) {
      this.finish();
    } else if (this.phase === "playing" && this.starters >= 2 && alive <= 1) {
      this.phase = "lap";
      this.lapEndAt = Date.now() + LAP_MS;
      this.broadcastState();
    }
  }

  private finish(): void {
    if (this.phase === "over") return;
    const t = Math.round(this.elapsed());
    for (const seat of this.seats) {
      if (seat.alive) {
        seat.time = t;
        seat.alive = false;
      }
      if (seat.killTimer !== null) clearTimeout(seat.killTimer);
      seat.killTimer = null;
    }
    this.phase = "over";
    this.broadcastState();
    // Se corta el bucle, pero el room sigue vivo hasta que se vayan los sockets.
    if (this.loop !== null) clearInterval(this.loop);
    this.loop = null;
  }

  // ---------- Salida ----------

  private emitInitTo(nickname: string): void {
    const index = this.seats.findIndex((s) => s.nickname === nickname);
    const seat = index >= 0 ? this.seats[index] : null;
    const init: DrInit = {
      seat: index,
      seats: this.seats.map((s) => s.nickname),
      grid: GRID,
      layers: LAYERS,
      doom: this.encodeDoom(),
      // Al que vuelve de un F5 se lo devuelve donde estaba: recargar no puede ser
      // un teletransporte al punto de largada.
      spawn: seat?.pos ?? (index >= 0 ? spawnPos(index, this.seats.length) : null),
      ...this.stateFields(),
    };
    this.room.emitTo(nickname, "dr:init", init);
  }

  private stateFields(): DrState {
    const now = Date.now();
    return {
      phase: this.phase,
      msLeft:
        this.phase === "preroll"
          ? Math.max(0, this.launchAt - now)
          : this.phase === "lap"
            ? Math.max(0, this.lapEndAt - now)
            : this.phase === "playing"
              ? Math.max(0, MATCH_MAX_MS - this.elapsed())
              : 0,
      elapsed: Math.round(this.elapsed()),
      alive: this.seats.map((s) => s.alive),
      times: this.seats.map((s) => s.time),
      on: this.seats.map((s) => this.room.isConnected(s.nickname)),
      decay: this.elapsed() >= DECAY_START_MS,
    };
  }

  private broadcastState(): void {
    this.lastState = Date.now();
    this.room.broadcast("dr:state", this.stateFields());
  }

  private broadcastSnap(now: number): void {
    const p: number[] = [];
    this.seats.forEach((seat, i) => {
      if (!seat.pos) return;
      p.push(i, round2(seat.pos.x), round2(seat.pos.y), round2(seat.pos.z), round2(seat.pos.r), seat.pos.f);
    });
    const snap: DrSnap = { p, f: this.pending };
    this.pending = [];
    if (now - this.lastDoom >= DOOM_SYNC_MS) {
      this.lastDoom = now;
      snap.doom = this.encodeDoom();
    }
    this.room.broadcast("dr:snap", snap);
  }

  /** Tablero en hex: un bit por celda, prendido si esta pisada o ya cayo. */
  private encodeDoom(): string {
    const bytes = new Uint8Array(Math.ceil(CELL_COUNT / 8));
    for (let i = 0; i < CELL_COUNT; i++) {
      const s = this.cells[i];
      if (s === TRIGGERED || s === REMOVED) bytes[i >> 3] |= 1 << (i & 7);
    }
    return Buffer.from(bytes).toString("hex");
  }

  // ---------- Utilidades ----------

  private elapsed(): number {
    if (this.phase === "waiting" || this.phase === "preroll") return 0;
    return Math.max(0, Date.now() - this.launchAt);
  }

  private seatOf(nickname: string): Seat | undefined {
    return this.seats.find((s) => s.nickname === nickname);
  }

  /** El paso tiene que caer cerca de donde el jugador dijo que estaba. */
  private nearSeat(idx: number, pos: Pos): boolean {
    const layer = Math.floor(idx / CELLS_PER_LAYER);
    const rest = idx % CELLS_PER_LAYER;
    const cx = (rest % GRID) - CENTER;
    const cz = Math.floor(rest / GRID) - CENTER;
    if (Math.abs(pos.y - surfaceY(layer)) > STEP_Y_TOLERANCE) return false;
    return Math.hypot(pos.x - cx, pos.z - cz) <= STEP_TOLERANCE;
  }
}

/** Largada: en ronda sobre el piso de arriba, todos mirando al centro. */
function spawnPos(seat: number, count: number): { x: number; y: number; z: number; r: number } {
  const n = Math.max(count, 1);
  const angle = (seat / n) * Math.PI * 2;
  const x = Math.cos(angle) * 7;
  const z = Math.sin(angle) * 7;
  return { x: round2(x), y: surfaceY(0), z: round2(z), r: round2(Math.atan2(-x, -z)) };
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
  const roster = Array.isArray(p.roster)
    ? p.roster.filter((x): x is string => typeof x === "string")
    : [];
  return { nickname, roster };
}

/** Engancha el juego en el namespace `/derrumbe`. */
export function registerDerrumbe(io: Server): void {
  registerGame(io, "/derrumbe", "dr:join", parseJoin, (room) => new DerrumbeSim(room));
}
