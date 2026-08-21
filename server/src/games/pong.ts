import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { PongBall, PongMatchState } from "../protocol.js";

/**
 * PONG en sala: PvP autoritativo en el server. La sala se empareja de a dos por
 * el orden del roster (jugadores 0-1, 2-3, ...); el impar juega contra la IA.
 * Cada par es un "match" independiente con su propia pelota. El server corre la
 * fisica de la pelota, las colisiones, la rampa de velocidad y el puntaje, y
 * difunde `pg:state` a ~30 fps; cada cliente solo controla su paleta (manda su Y)
 * y renderiza los snapshots con prediccion/reconciliacion local.
 *
 * Complementa Supabase (lobby / marcador / rejoin siguen en la DB): el server
 * solo maneja el estado EN-ronda en memoria y no toca la DB. Los puntajes los
 * reporta cada cliente a Supabase (sus goles) al terminar su match.
 *
 * Constantes de fisica DUPLICADAS a proposito desde el cliente
 * (`src/games/pong/game/constants.ts`) por la regla de decoupling del repo: si
 * cambia el tuning, tocar los dos lados.
 */

// ---- Geometria (espejo de constants.ts del cliente) ----
const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 480;
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 70;
const PADDLE_MARGIN = 30;
const BALL_RADIUS = 7;
// ---- Fisica ----
const BALL_SPEED_INITIAL = 350;
const BALL_SPEED_INCREMENT = 18;
const BALL_SPEED_MAX = 750;
const AI_SPEED = 310;
const AI_MARGIN = 30;
// ---- Reglas / timing del server ----
/** Gana el primero en llegar a este puntaje. Espejo del cliente
 *  (`src/games/pong/game/Game.ts`). */
const SCORE_LIMIT = 3;
const TICK_MS = 16; // ~60 fps: fisica + broadcast (mas suave y menos lag de input)
/** dt FIJO de cada paso de simulacion (s). La fisica NO se integra con el tiempo
 *  real medido entre despertares del `setInterval`: el timer de Node no es preciso
 *  (en Windows la resolucion es de ~15.6 ms, asi que un `setInterval(16)` cae a
 *  15.6 / 31.2 ms de forma despareja) y ese jitter entraba directo en la velocidad
 *  de la pelota. Con paso fijo + acumulador la simulacion es determinista y el
 *  reloj que se le manda al cliente (`simTime`) avanza en escalones exactos. */
const STEP_DT = TICK_MS / 1000;
/** Tope de tiempo real absorbido por despertar (ms). Si el proceso se cuelga o el
 *  event loop se atrasa, se descarta el excedente en vez de simular 200 pasos de
 *  golpe (la "espiral de la muerte"). */
const MAX_CATCHUP_MS = 100;
/** Maximo avance de la pelota por sub-paso de colision (px). La fisica se integra
 *  en sub-pasos de a lo sumo este tamano para que una pelota rapida NUNCA salte
 *  por encima de la paleta sin rebotar (tunneling). Menor que la ventana de
 *  colision de la paleta. */
const SUBSTEP_MAX_PX = 5;
/** La pelota queda congelada al centro este tiempo tras crear el match, para que
 *  coincida con el countdown 3/2/1/YA del cliente y nadie pierda puntos sin ver. */
const PREROLL_MS = 3000;
/** Espera desde el primer join a que se conecten los del roster antes de arrancar
 *  (los que falten quedan con la paleta manejada por la IA hasta que lleguen). */
const START_GRACE_MS = 8000;

const PADDLE_CENTER = VIEW_HEIGHT / 2 - PADDLE_HEIGHT / 2;
const PADDLE_MIN_Y = PADDLE_MARGIN;
const PADDLE_MAX_Y = VIEW_HEIGHT - PADDLE_HEIGHT - PADDLE_MARGIN;
// Paleta izquierda: x en [PADDLE_MARGIN, +WIDTH]; derecha pegada al borde opuesto.
const P1_RIGHT = PADDLE_MARGIN + PADDLE_WIDTH;
const P2_LEFT = VIEW_WIDTH - PADDLE_WIDTH - PADDLE_MARGIN;

type Side = "p1" | "p2";

class Match {
  readonly ball: PongBall = centerBall();
  p1Y = PADDLE_CENTER;
  p2Y = PADDLE_CENTER;
  p1Score = 0;
  p2Score = 0;
  over = false;
  launched = false;
  readonly launchAt: number;

  constructor(
    readonly p1: string | null,
    readonly p2: string | null,
    now: number,
  ) {
    this.launchAt = now + PREROLL_MS;
  }
}

class PongSim implements RoomSim {
  private phase: "waiting" | "playing" = "waiting";
  private roster: string[] = [];
  private matches: Match[] = [];
  private readonly seat = new Map<string, { match: Match; side: Side }>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ultimo despertar del timer (ms reales) y tiempo real pendiente de simular. */
  private lastTick = 0;
  private acc = 0;
  /** Reloj de la simulacion (ms): avanza de a TICK_MS exactos, viaja en `pg:state.t`. */
  private simTime = 0;

  constructor(private readonly room: GameRoom) {}

  join(nickname: string, roster: string[]): void {
    if (roster.length > 0) this.roster = roster;

    if (this.phase === "waiting") {
      if (this.startTimer === null) {
        this.startTimer = setTimeout(() => this.start(), START_GRACE_MS);
      }
      // Arranca apenas esten todos los del roster conectados.
      if (this.roster.length > 0 && this.roster.every((n) => this.room.isConnected(n))) {
        this.start();
      }
    } else {
      // Ya empezo (reconexion / join tardio): mandarle su estado actual.
      this.emitStateTo(nickname);
    }
  }

  leave(_nickname: string): void {
    // No se saca del match al desconectar: su paleta pasa a manejarla la IA y, si
    // vuelve (recarga de pagina), retoma el control. Solo se resuelve por puntaje.
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (event !== "pg:paddle") return;
    const y = readNumber(payload, "y");
    const seat = this.seat.get(nickname);
    if (y === null || !seat || !this.room.isConnected(nickname)) return;
    const clamped = clampPaddle(y);
    if (seat.side === "p1") seat.match.p1Y = clamped;
    else seat.match.p2Y = clamped;
  }

  dispose(): void {
    if (this.loop !== null) clearInterval(this.loop);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.loop = null;
    this.startTimer = null;
  }

  // ---------- Ciclo de partida ----------

  private start(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    // Se sientan TODOS los del roster (orden = joined_at de Supabase): asi el
    // ausente conserva su asiento (su paleta la maneja la IA) y su pareja juega
    // igual, y si vuelve retoma el control.
    const seats = this.roster;
    if (seats.length === 0) return; // sin roster todavia; se reintenta al proximo join

    const now = Date.now();
    for (let i = 0; i < seats.length; i += 2) {
      const p1 = seats[i];
      const p2 = seats[i + 1] ?? null;
      const match = new Match(p1, p2, now);
      this.matches.push(match);
      this.seat.set(p1, { match, side: "p1" });
      if (p2) this.seat.set(p2, { match, side: "p2" });
    }

    this.phase = "playing";
    this.lastTick = now;
    this.acc = 0;
    // El reloj de la simulacion arranca en la hora real: `launchAt` (preroll) esta
    // en la misma escala, y el cliente estima el offset contra su propio reloj.
    this.simTime = now;
    this.loop = setInterval(() => this.step(), TICK_MS);
  }

  /**
   * Acumulador de paso fijo: se absorbe el tiempo real transcurrido y se corren
   * los pasos de STEP_DT que entren (0, 1 o varios segun cuando despierte el
   * timer). `simTime` es el reloj de la simulacion, avanza en escalones exactos y
   * es lo que viaja en `pg:state.t` para que el cliente interpole sobre una linea
   * de tiempo regular en vez de la hora de llegada del paquete.
   */
  private step(): void {
    const now = Date.now();
    this.acc += Math.min(now - this.lastTick, MAX_CATCHUP_MS);
    this.lastTick = now;

    let stepped = false;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.simTime += TICK_MS;
      for (const match of this.matches) this.stepMatch(match, STEP_DT, this.simTime);
      stepped = true;
    }

    // Sin paso nuevo no hay estado nuevo que mandar (el cliente ya lo tiene).
    if (stepped) this.broadcastAll();

    // Todos los matches terminados: detener el loop (las reconexiones reciben el
    // estado final por emitStateTo al hacer join).
    if (this.loop !== null && this.matches.every((m) => m.over)) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  private stepMatch(match: Match, dt: number, now: number): void {
    if (match.over) return;

    if (!match.launched) {
      if (now < match.launchAt) return; // congelada durante el countdown
      match.launched = true;
      launchBall(match.ball, Math.random() < 0.5);
    }

    // Paletas: humano conectado manda su Y (ya seteada en message); las demas
    // (impar sin pareja, o ausente) las mueve la IA hacia la pelota.
    if (!this.humanControls(match.p1)) match.p1Y = aiPaddle(match.p1Y, match.ball, dt);
    if (!this.humanControls(match.p2)) match.p2Y = aiPaddle(match.p2Y, match.ball, dt);
    match.p1Y = clampPaddle(match.p1Y);
    match.p2Y = clampPaddle(match.p2Y);

    // Sub-stepping: se integra la pelota en pasos chicos (<= SUBSTEP_MAX_PX) y se
    // chequea la colision en cada uno, asi una pelota rapida no atraviesa la
    // paleta. Se corta al primer gol/relanzamiento del tick.
    const dist = Math.hypot(match.ball.vx, match.ball.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / SUBSTEP_MAX_PX));
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      updateBall(match.ball, sub);
      if (this.resolveCollisions(match)) break;
    }
  }

  /** Devuelve true si hubo gol/relanzamiento o el match termino (corta el sub-step). */
  private resolveCollisions(match: Match): boolean {
    const ball = match.ball;
    const left = ball.x - BALL_RADIUS;
    const right = ball.x + BALL_RADIUS;
    const top = ball.y - BALL_RADIUS;
    const bottom = ball.y + BALL_RADIUS;

    // Rebote en la paleta izquierda (p1). Se evalua ANTES del gol para que una
    // pelota que toca la paleta rebote en vez de contar como punto.
    if (
      ball.vx < 0 &&
      left <= P1_RIGHT &&
      ball.x > PADDLE_MARGIN &&
      bottom > match.p1Y &&
      top < match.p1Y + PADDLE_HEIGHT
    ) {
      ball.x = P1_RIGHT + BALL_RADIUS;
      bouncePaddle(ball, match.p1Y);
      return false;
    }
    // Rebote en la paleta derecha (p2).
    if (
      ball.vx > 0 &&
      right >= P2_LEFT &&
      ball.x < P2_LEFT + PADDLE_WIDTH &&
      bottom > match.p2Y &&
      top < match.p2Y + PADDLE_HEIGHT
    ) {
      ball.x = P2_LEFT - BALL_RADIUS;
      bouncePaddle(ball, match.p2Y);
      return false;
    }

    // Punto: la pelota paso una paleta (no la toco). Se relanza hacia el que
    // recibio el gol.
    if (left <= 0) {
      match.p2Score += 1;
      if (this.reachedLimit(match)) return true;
      launchBall(ball, true); // sirve hacia la izquierda (p1)
      return true;
    }
    if (right >= VIEW_WIDTH) {
      match.p1Score += 1;
      if (this.reachedLimit(match)) return true;
      launchBall(ball, false); // sirve hacia la derecha (p2)
      return true;
    }

    return false;
  }

  private reachedLimit(match: Match): boolean {
    if (match.p1Score >= SCORE_LIMIT || match.p2Score >= SCORE_LIMIT) {
      match.over = true;
      return true;
    }
    return false;
  }

  // ---------- Broadcast ----------

  private humanControls(nickname: string | null): boolean {
    return nickname !== null && this.room.isConnected(nickname);
  }

  private stateFor(match: Match, side: Side): PongMatchState {
    const oppHuman =
      side === "p1" ? this.humanControls(match.p2) : this.humanControls(match.p1);
    return {
      side,
      t: this.simTime,
      phase: match.over ? "over" : match.launched ? "playing" : "countdown",
      ball: { ...match.ball },
      p1Y: match.p1Y,
      p2Y: match.p2Y,
      p1Score: match.p1Score,
      p2Score: match.p2Score,
      vsAi: !oppHuman,
    };
  }

  private broadcastAll(): void {
    for (const match of this.matches) {
      if (match.p1) this.room.emitTo(match.p1, "pg:state", this.stateFor(match, "p1"));
      if (match.p2) this.room.emitTo(match.p2, "pg:state", this.stateFor(match, "p2"));
    }
  }

  private emitStateTo(nickname: string): void {
    const seat = this.seat.get(nickname);
    if (seat) this.room.emitTo(nickname, "pg:state", this.stateFor(seat.match, seat.side));
  }
}

// ---------- Fisica (espejo de Ball.ts / Ai.ts del cliente) ----------

function centerBall(): PongBall {
  return { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2, vx: 0, vy: 0, speed: BALL_SPEED_INITIAL, hits: 0 };
}

function launchBall(ball: PongBall, towardLeft: boolean): void {
  ball.x = VIEW_WIDTH / 2;
  ball.y = VIEW_HEIGHT / 2 + (Math.random() - 0.5) * 120;
  ball.speed = BALL_SPEED_INITIAL;
  ball.hits = 0;
  const angle = (Math.random() - 0.5) * Math.PI * 0.6;
  const dir = towardLeft ? -1 : 1;
  ball.vx = Math.cos(angle) * ball.speed * dir;
  ball.vy = Math.sin(angle) * ball.speed;
}

function updateBall(ball: PongBall, dt: number): void {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (ball.y - BALL_RADIUS <= 0) {
    ball.y = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y + BALL_RADIUS >= VIEW_HEIGHT) {
    ball.y = VIEW_HEIGHT - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy);
  }
}

function bouncePaddle(ball: PongBall, paddleY: number): void {
  const relY = (ball.y - paddleY) / PADDLE_HEIGHT;
  const angle = (relY - 0.5) * Math.PI * 0.7;
  const dir = ball.vx > 0 ? -1 : 1;
  ball.vx = Math.cos(angle) * ball.speed * dir;
  ball.vy = Math.sin(angle) * ball.speed;
  ball.hits += 1;
  // Rampa de velocidad, reorientando vx/vy al nuevo modulo conservando el angulo.
  ball.speed = Math.min(ball.speed + BALL_SPEED_INCREMENT, BALL_SPEED_MAX);
  const a = Math.atan2(ball.vy, ball.vx);
  ball.vx = Math.cos(a) * ball.speed;
  ball.vy = Math.sin(a) * ball.speed;
}

function aiPaddle(y: number, ball: PongBall, dt: number): number {
  const target = ball.y - PADDLE_HEIGHT / 2;
  const diff = target - y;
  if (Math.abs(diff) > AI_MARGIN) y += Math.sign(diff) * AI_SPEED * dt;
  return y;
}

function clampPaddle(y: number): number {
  if (!Number.isFinite(y)) return PADDLE_CENTER;
  return Math.max(PADDLE_MIN_Y, Math.min(PADDLE_MAX_Y, y));
}

function readNumber(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
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

/** Engancha el juego en el namespace `/pong`. */
export function registerPong(io: Server): void {
  registerGame(io, "/pong", "pg:join", parseJoin, (room) => new PongSim(room));
}
