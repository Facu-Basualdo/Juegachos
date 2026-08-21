import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { PtPhase, PtPlayerView, PtState } from "../protocol.js";

/**
 * Manchon en sala: captura de territorio AUTORITATIVA en el server.
 *
 * Por que autoritativa y no un relay como Neon Drift: la grilla es un estado
 * compartido en el que los ocho jugadores escriben al mismo tiempo. Con cada
 * cliente simulando lo suyo, el orden en que le llegan los mensajes decide quien
 * se quedo con cada celda, asi que dos pantallas mostrarian tableros distintos y
 * el puntaje final no seria el mismo para todos. Aca el server corre la
 * simulacion con paso FIJO y difunde la verdad; el cliente solo manda su
 * direccion y dibuja.
 *
 * El cliente manda INPUT, nunca posicion (ver protocol.ts): declarar {x, y} como
 * hace la paleta de PONG dejaria teletransportarse y pintar todo el tablero con
 * las devtools abiertas.
 *
 * Presupuesto: 8 jugadores x 20 broadcasts/s = ~160 emits/s por sala, un tercio
 * de lo que ya mueve PONG. La grilla entera (~800 celdas) viaja SOLO en el
 * `pt:init` del join/reconexion; los snapshots llevan nada mas que las celdas
 * cambiadas desde el anterior.
 *
 * Complementa Supabase igual que el resto del server: lobby / marcador / rejoin
 * siguen en la DB y aca no se escribe nada. Cada cliente reporta su puntaje
 * (celdas propias) a Supabase al terminar.
 *
 * Constantes de juego DUPLICADAS a proposito en
 * `src/games/paint-turf/game/constants.ts` por la regla de decoupling del repo:
 * si cambia el tuning, tocar los dos lados.
 */

// ---- Geometria (espejo de constants.ts del cliente) ----
const COLS = 35;
const ROWS = 23;
const CELL = 24;
const VIEW_WIDTH = COLS * CELL; // 840
const VIEW_HEIGHT = ROWS * CELL; // 552
const CELL_COUNT = COLS * ROWS;

// ---- Movimiento y pintura ----
const SPEED = 195;
/**
 * Radio del pincel: pinta toda celda cuyo centro cae adentro.
 *
 * No bajarlo: yendo en diagonal, los centros de las celdas vecinas a la
 * trayectoria caen a CELL/raiz(2) = 16.97 px de ella, o sea justo en el filo. Con
 * 17 el trazo diagonal entra y sale segun el subpixel y queda entrecortado como un
 * tablero de ajedrez; con 21 la fila de al lado entra siempre y el trazo es una
 * banda continua.
 */
const BRUSH_RADIUS = 21;
/** Radio del salpicon (el golpe con cooldown). */
const SPLAT_RADIUS = 78;
/** Radio en el que el salpicon aturde rivales (algo menor que lo que pinta). */
const SPLAT_HIT_RADIUS = 66;
const SPLAT_COOLDOWN_MS = 5000;
const STUN_MS = 1100;
/** Aturdido no pinta y se arrastra a esta fraccion de la velocidad. */
const STUN_SPEED_FACTOR = 0.4;
/** Manchon con el que arranca cada jugador, para que el tablero no largue vacio. */
const START_BLOB_RADIUS = 46;

// ---- Reglas / timing ----
const MAX_SEATS = 8;
/** Duracion de la partida, ya con todos jugando. */
const MATCH_MS = 90_000;
/** Congelado inicial, para que coincida con el countdown 3/2/1/YA del cliente. */
const PREROLL_MS = 3000;
/** Espera desde el primer join a que llegue el resto del roster antes de largar. */
const START_GRACE_MS = 8000;
/** Paso fijo de la simulacion (50 Hz). */
const TICK_MS = 20;
const STEP_DT = TICK_MS / 1000;
/**
 * Cada cuanto TIEMPO DE SIMULACION se difunde un snapshot: 40 ms, o sea 25 Hz.
 *
 * Dos detalles que parecen menores y son la diferencia entre que los rivales se
 * vean fluidos o a los tirones, porque esto es lo que consume la interpolacion del
 * cliente:
 *
 * 1. Se mide en tiempo de SIMULACION, no en despertares del timer. La primera
 *    version emitia "uno de cada dos despertares", y un despertar puede simular
 *    cero, uno o dos pasos segun cuanto se atraso el `setInterval` (en Windows la
 *    resolucion es de ~15.6 ms): el espaciado terminaba oscilando entre 25 y 100 ms.
 * 2. El chequeo va DENTRO del bucle de pasos. Afuera vuelve a heredar el jitter del
 *    timer, aunque se mida en simTime: medido asi daba 50 u 75 ms alternados.
 *
 * Ademas es multiplo exacto de TICK_MS (dos pasos), asi que el espaciado no puede
 * ser otra cosa que 40 ms. Con esa linea de tiempo pareja, el retraso de
 * interpolacion del cliente (INTERP_DELAY) cubre siempre el mismo margen.
 *
 * Presupuesto: 8 jugadores x 25/s = 200 emits/s por sala, menos de la mitad de lo
 * que ya mueve PONG (60 Hz x 8).
 */
const BROADCAST_MS = 40;
/**
 * Tope de tiempo real absorbido por despertar. Si el event loop se atrasa se
 * descarta el excedente en vez de simular cien pasos de golpe.
 */
const MAX_CATCHUP_MS = 150;

class Brush {
  x = 0;
  y = 0;
  dx = 0;
  dy = 0;
  /** Ms de aturdimiento restantes. */
  stun = 0;
  /** Ms restantes del cooldown del salpicon. */
  cooldown = 0;
  /** Salpicon pedido por el cliente, pendiente de resolverse en el proximo paso. */
  wantsSplat = false;
  /** Numero del ultimo `pt:input` aplicado, que vuelve en el snapshot para que el
   *  cliente sepa hasta donde lo escucho el server (ver `reconcile` del cliente). */
  lastSeq = 0;

  constructor(readonly seat: number) {}
}

export class PaintTurfSim implements RoomSim {
  private readonly room: GameRoom;

  /** Ronda en curso; el estado es de ESTA ronda y de ninguna otra. */
  private round = -1;
  private phase: PtPhase = "waiting";
  /** Nicknames por asiento (el indice es el asiento y decide el color). */
  private seats: string[] = [];
  private readonly brushes = new Map<string, Brush>();
  /** Duenio de cada celda (-1 sin pintar). */
  private grid = new Int8Array(0);
  private scores: number[] = [];
  /** Celdas cambiadas desde el ultimo snapshot (indice -> asiento). */
  private readonly dirty = new Map<number, number>();

  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTick = 0;
  private acc = 0;
  /** Reloj de la simulacion (ms): avanza de a TICK_MS exactos y viaja en `pt:state.t`. */
  private simTime = 0;
  /** simTime del ultimo snapshot difundido. */
  private lastBroadcast = 0;
  /** Momento (en simTime) en que largan los pinceles y en que termina la partida. */
  private launchAt = 0;
  private endAt = 0;

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;

    // Entre rondas la sala no se vacia (los clientes navegan de una pagina a la
    // siguiente y no todos a la vez), asi que el GameRoom puede sobrevivir con el
    // tablero de la ronda anterior adentro. Una ronda mas nueva lo tira.
    if (round > this.round) {
      this.round = round;
      this.reset(roster);
    }
    if (round !== this.round) return;

    // Al que llega tarde o vuelve de un F5 se le manda el tablero completo: sin
    // esto se quedaria con la grilla en blanco hasta que alguien la repinte.
    this.emitInitTo(nickname);

    if (this.phase !== "waiting") return;
    if (this.startTimer === null) {
      this.startTimer = setTimeout(() => this.launch(), START_GRACE_MS);
    }
    // Larga apenas estan todos los del roster conectados.
    if (this.seats.length > 0 && this.seats.every((n) => this.room.isConnected(n))) {
      this.launch();
    }
  }

  leave(_nickname: string): void {
    // El pincel NO se saca: su territorio sigue contando y, si vuelve (una recarga
    // de pagina), retoma el control donde lo dejo. Quieto no pinta, que ya es
    // penalizacion suficiente.
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (event !== "pt:input") return;
    const brush = this.brushes.get(nickname);
    if (!brush || this.phase !== "playing") return;

    const dx = readNumber(payload, "dx") ?? 0;
    const dy = readNumber(payload, "dy") ?? 0;
    // Se normaliza aca: el cliente no decide su velocidad, solo hacia donde va.
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      brush.dx = dx / len;
      brush.dy = dy / len;
    } else {
      brush.dx = 0;
      brush.dy = 0;
    }

    if (payload && typeof payload === "object" && (payload as { s?: unknown }).s === true) {
      brush.wantsSplat = true;
    }

    const seq = readInt(payload, "n");
    // Solo hacia adelante: un mensaje que llega fuera de orden no puede hacer que el
    // cliente reconcilie contra un input que ya quedo viejo.
    if (seq !== null && seq > brush.lastSeq) brush.lastSeq = seq;
  }

  dispose(): void {
    if (this.loop !== null) clearInterval(this.loop);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.loop = null;
    this.startTimer = null;
  }

  // ---------- Ciclo de la partida ----------

  /** Arma una partida nueva: asientos, tablero limpio y manchon inicial de cada uno. */
  private reset(roster: string[]): void {
    this.dispose();

    this.seats = roster.slice(0, MAX_SEATS);
    this.phase = "waiting";
    this.grid = new Int8Array(CELL_COUNT).fill(-1);
    this.scores = this.seats.map(() => 0);
    this.dirty.clear();
    this.brushes.clear();
    this.simTime = 0;
    this.lastBroadcast = 0;
    this.acc = 0;

    // Repartidos en un ovalo alrededor del centro: todos a la misma distancia del
    // medio, asi ninguna posicion inicial es mejor que otra.
    const n = Math.max(this.seats.length, 1);
    this.seats.forEach((nickname, seat) => {
      const angle = (seat / n) * Math.PI * 2 - Math.PI / 2;
      const brush = new Brush(seat);
      brush.x = VIEW_WIDTH / 2 + Math.cos(angle) * VIEW_WIDTH * 0.33;
      brush.y = VIEW_HEIGHT / 2 + Math.sin(angle) * VIEW_HEIGHT * 0.33;
      this.brushes.set(nickname, brush);
      this.paint(brush.x, brush.y, START_BLOB_RADIUS, seat);
    });
    // El manchon inicial ya viaja en la grilla del `pt:init`; nadie necesita
    // recibirlo tambien como delta.
    this.dirty.clear();

    this.lastTick = Date.now();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  /** Cierra la espera y arranca el congelado previo (el countdown del cliente). */
  private launch(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.phase = "preroll";
    this.launchAt = this.simTime + PREROLL_MS;
    this.lastBroadcast = this.simTime;
    this.broadcastState();
  }

  private tick(): void {
    const now = Date.now();
    this.acc = Math.min(this.acc + (now - this.lastTick), MAX_CATCHUP_MS);
    this.lastTick = now;

    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.simTime += TICK_MS;
      this.step();
      // Adentro del bucle: es lo que hace que el espaciado sea exactamente
      // BROADCAST_MS y no lo que haya durado el despertar del timer.
      if (this.simTime - this.lastBroadcast >= BROADCAST_MS) {
        this.lastBroadcast = this.simTime;
        this.broadcastState();
      }
    }
  }

  private step(): void {
    if (this.phase === "preroll") {
      if (this.simTime >= this.launchAt) {
        this.phase = "playing";
        this.endAt = this.simTime + MATCH_MS;
      }
      return;
    }
    if (this.phase !== "playing") return;

    for (const brush of this.brushes.values()) {
      this.stepBrush(brush);
    }

    if (this.simTime >= this.endAt) {
      this.phase = "over";
      this.lastBroadcast = this.simTime;
      this.broadcastState();
      // Se corta la simulacion, pero el room sigue vivo hasta que se vayan los
      // sockets: el cliente todavia muestra el tablero final.
      if (this.loop !== null) clearInterval(this.loop);
      this.loop = null;
    }
  }

  private stepBrush(brush: Brush): void {
    if (brush.cooldown > 0) brush.cooldown = Math.max(0, brush.cooldown - TICK_MS);

    const stunned = brush.stun > 0;
    if (stunned) brush.stun = Math.max(0, brush.stun - TICK_MS);

    const speed = SPEED * (stunned ? STUN_SPEED_FACTOR : 1);
    brush.x = clamp(brush.x + brush.dx * speed * STEP_DT, 0, VIEW_WIDTH);
    brush.y = clamp(brush.y + brush.dy * speed * STEP_DT, 0, VIEW_HEIGHT);

    // Aturdido no pinta: es lo que hace que valga la pena perseguir a alguien.
    if (!stunned) this.paint(brush.x, brush.y, BRUSH_RADIUS, brush.seat);

    if (!brush.wantsSplat) return;
    brush.wantsSplat = false;
    if (stunned || brush.cooldown > 0) return;
    this.splat(brush);
  }

  private splat(brush: Brush): void {
    brush.cooldown = SPLAT_COOLDOWN_MS;
    this.paint(brush.x, brush.y, SPLAT_RADIUS, brush.seat);
    for (const other of this.brushes.values()) {
      if (other === brush) continue;
      if (Math.hypot(other.x - brush.x, other.y - brush.y) <= SPLAT_HIT_RADIUS) {
        other.stun = STUN_MS;
      }
    }
    this.room.broadcast("pt:splat", {
      i: brush.seat,
      x: Math.round(brush.x),
      y: Math.round(brush.y),
    });
  }

  /** Pinta del color de `seat` toda celda cuyo centro cae dentro del radio. */
  private paint(cx: number, cy: number, radius: number, seat: number): void {
    const minCol = Math.max(0, Math.floor((cx - radius) / CELL));
    const maxCol = Math.min(COLS - 1, Math.floor((cx + radius) / CELL));
    const minRow = Math.max(0, Math.floor((cy - radius) / CELL));
    const maxRow = Math.min(ROWS - 1, Math.floor((cy + radius) / CELL));
    const r2 = radius * radius;

    for (let row = minRow; row <= maxRow; row++) {
      const dy = (row + 0.5) * CELL - cy;
      for (let col = minCol; col <= maxCol; col++) {
        const dx = (col + 0.5) * CELL - cx;
        if (dx * dx + dy * dy > r2) continue;
        const idx = row * COLS + col;
        const prev = this.grid[idx];
        if (prev === seat) continue;
        if (prev >= 0) this.scores[prev]--;
        this.grid[idx] = seat;
        this.scores[seat]++;
        this.dirty.set(idx, seat);
      }
    }
  }

  // ---------- Salida ----------

  private emitInitTo(nickname: string): void {
    this.room.emitTo(nickname, "pt:init", {
      seat: this.seats.indexOf(nickname),
      seats: this.seats,
      cols: COLS,
      rows: ROWS,
      cell: CELL,
      grid: encodeGrid(this.grid),
    });
  }

  private broadcastState(): void {
    const players: PtPlayerView[] = [];
    for (const [nickname, brush] of this.brushes) {
      players.push({
        i: brush.seat,
        // Redondeado: dos snapshots identicos comparan iguales y el payload es la mitad.
        x: Math.round(brush.x),
        y: Math.round(brush.y),
        st: Math.round(brush.stun),
        cd: Math.round(brush.cooldown),
        on: this.room.isConnected(nickname),
        n: brush.lastSeq,
      });
    }

    const c: number[] = [];
    for (const [idx, seat] of this.dirty) {
      c.push(idx, seat);
    }
    this.dirty.clear();

    const state: PtState = {
      t: this.simTime,
      phase: this.phase,
      msLeft:
        this.phase === "preroll"
          ? Math.max(0, this.launchAt - this.simTime)
          : this.phase === "playing"
            ? Math.max(0, this.endAt - this.simTime)
            : 0,
      players,
      c,
      scores: this.scores,
    };
    this.room.broadcast("pt:state", state);
  }
}

/** Grilla a string: un caracter por celda ("." vacia, "0".."7" el asiento). */
function encodeGrid(grid: Int8Array): string {
  let out = "";
  for (let i = 0; i < grid.length; i++) {
    const owner = grid[i];
    out += owner < 0 ? "." : String(owner);
  }
  return out;
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

/** Roster + nickname del mensaje de join. */
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

/** Engancha el juego en el namespace `/paintturf`. */
export function registerPaintTurf(io: Server): void {
  registerGame(io, "/paintturf", "pt:join", parseJoin, (room) => new PaintTurfSim(room));
}
