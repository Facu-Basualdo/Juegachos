import {
  BALL_COUNT,
  BALL_R,
  HALF_L,
  HALF_W,
  KNUCKLES,
  KNUCKLE_R,
  simulateShot,
  type BallPos,
  type Shot,
  type ShotResult,
} from "./pool-physics.js";
import { FOOT_SPOT, makeRack, mulberry32 } from "./pool-rack.js";

/**
 * Motor de reglas de una partida de Pool: asientos, equipos, turnos, faltas, la bola 8,
 * relojes y tope de partida. Es PURO: no abre sockets, no usa timers ni `Date.now()`
 * (la hora entra como parametro `now`, en ms) y no sabe nada de bots (solo dice a quien
 * le toca y si esa persona esta en piloto automatico; quien arma el tiro del bot es la
 * capa de arriba). Lo que si hace es llamar a `simulateShot`, asi que un tiro se resuelve
 * entero adentro de `takeShot`. Reglas y numeros: src/games/poolnight/CLAUDE.md.
 */

// ---------------------------------------------------------------- constantes (valores de partida, NO medidos)

/** Reloj de cada turno. Con la blanca en mano se suma `HAND_BONUS_MS`. */
export const TURN_MS = 20_000;
export const HAND_BONUS_MS = 5_000;
/** Turnos vencidos seguidos tras los cuales el asiento pasa a piloto automatico. */
export const IDLE_TURNS_TO_BOT = 2;
/** Del `start` al primer turno: cuenta regresiva 3 / 2 / 1 / YA y la camara. */
export const START_DELAY_MS = 4_000;
/** Margen para que todos los clientes arranquen el tiro a la vez (ver `startAt`). */
export const PLAY_LEAD_MS = 150;
/** Pausa despues de que la ultima bola se queda quieta, antes de que corra el reloj. */
export const SETTLE_MS = 800;
/** Tolerancia de latencia: un tiro que llega un pelo antes de `turnStartAt` se acepta. */
const EARLY_SLACK_MS = 250;

/** Tope de partida por formato (jugadores por equipo). */
export const MATCH_CAP_MS: Record<number, number> = { 1: 360_000, 2: 480_000, 4: 600_000 };

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 8;
/** Holgura extra al apoyar la blanca, para no dejarla tocando a otra o a un nudo. */
const PLACE_MARGIN = 0.0005;

// ---------------------------------------------------------------- tipos

export type Team = 0 | 1;
export type Phase = "placing" | "aiming" | "ended";
export type FoulReason = "scratch" | "no_contact";
export type EndReason = "eight" | "early_eight" | "scratch_eight" | "cap";

export class PoolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface Seat {
  team: Team;
  /** Posicion dentro del equipo. El asiento `s` es `slot * 2 + team`. */
  slot: number;
  /** Nickname del humano, o null si el asiento es un bot de relleno. */
  nickname: string | null;
  /** El humano esta desconectado: juega un bot por el. */
  away: boolean;
  /** Dejo vencer `IDLE_TURNS_TO_BOT` turnos seguidos: juega un bot por el hasta que vuelva a tocar algo. */
  afk: boolean;
  idle: number;
}

export interface MatchOptions {
  /** Nicknames de los humanos, en orden de ingreso a la sala. */
  humans: string[];
  /** Semilla del partido: rack, equipo que rompe. */
  seed: number;
  now: number;
  // Solo para tests: mesa y equipo inicial a medida, y saltear las reglas de la rotura.
  balls?: BallPos[];
  breakTeam?: Team;
  skipBreak?: boolean;
}

/** Lo que un bot necesita saber de la mesa para decidir (no incluye relojes ni asientos). */
export interface BotView {
  balls: BallPos[];
  team: Team;
  groupsLeft: [number, number];
  /** La blanca esta en mano (rotura o falta del rival). Si ademas no esta viva, hay que ponerla. */
  cueInHand: boolean;
  breakShot: boolean;
}

export interface ShotOutcome {
  result: ShotResult;
  seat: number;
  team: Team;
  foul: FoulReason | null;
  /** Embocadas de su grupo / del grupo rival (la blanca y la 8 no cuentan aca). */
  pottedOwn: number[];
  pottedOpp: number[];
  pottedEight: boolean;
  /** La 8 cayo en la rotura y volvio al punto de pie. */
  respotEight: boolean;
  /** Sigue tirando el mismo asiento. */
  continues: boolean;
  /** A quien le toca despues (el mismo si `continues`); -1 si la partida termino. */
  nextSeat: number;
  /** La blanca esta en mano (tras falta). */
  cueInHand: boolean;
  ended: { winner: Team | null; reason: EndReason } | null;
  groupsLeft: [number, number];
  /** Hora (ms) a partir de la cual el proximo asiento puede tirar y corre su reloj. */
  nextTurnAt: number;
  /** Hora (ms) en que arranca la animacion en todos los clientes. */
  startAt: number;
}

// ---------------------------------------------------------------- helpers de reglas

/** Equipo dueño de la bola: 1-7 lisas (equipo 0), 9-15 rayadas (equipo 1), la 8 de nadie. */
export function groupOf(id: number): Team | -1 {
  if (id >= 1 && id <= 7) return 0;
  if (id >= 9 && id <= 15) return 1;
  return -1;
}

/** Jugadores por equipo para esa cantidad de humanos: 1v1, 2v2 o 4v4. */
export function formatFor(humans: number): 1 | 2 | 4 {
  if (humans <= 2) return 1;
  if (humans <= 4) return 2;
  return 4;
}

/** Si la bola `id` puede apoyarse en (x, z): dentro de las bandas, sin tocar otra bola ni un nudo. */
export function spotIsFree(balls: BallPos[], id: number, x: number, z: number): boolean {
  if (!(Math.abs(x) <= HALF_L - BALL_R && Math.abs(z) <= HALF_W - BALL_R)) return false;
  for (let i = 0; i < BALL_COUNT; i++) {
    if (i === id || !balls[i].alive) continue;
    if (Math.hypot(balls[i].x - x, balls[i].z - z) < 2 * BALL_R + PLACE_MARGIN) return false;
  }
  for (let k = 0; k < KNUCKLES.length; k += 2) {
    if (Math.hypot(KNUCKLES[k] - x, KNUCKLES[k + 1] - z) < BALL_R + KNUCKLE_R + PLACE_MARGIN) return false;
  }
  return true;
}

// ---------------------------------------------------------------- la partida

export class PoolMatch {
  readonly perTeam: 1 | 2 | 4;
  readonly seats: Seat[] = [];
  readonly balls: BallPos[];
  phase: Phase = "placing";
  /** Asiento al que le toca actuar (poner la blanca o tirar). */
  shooter: number;
  /** El jugador puede mover la blanca (rotura o falta del rival). */
  cueInHand = true;
  /** Hora (ms) en que puede empezar a actuar el tirador actual. */
  turnStartAt: number;
  /** Hora (ms) en que vence su turno. */
  deadline: number;
  readonly capAt: number;
  winner: Team | null = null;
  endReason: EndReason | null = null;
  turnNo = 0;

  private breakShot: boolean;
  /** Proximo tirador de cada equipo (su `slot`). */
  private readonly ptr: [number, number] = [0, 0];

  constructor(opts: MatchOptions) {
    const n = opts.humans.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new PoolError("bad_player_count");
    this.perTeam = formatFor(n);

    // Los humanos ocupan los asientos 0..n-1 (se alternan A, B, A, B...: el humano k va al
    // equipo k % 2) y los bots rellenan el resto. El orden de turnos A1, B1, A2, B2... es
    // simplemente el orden de asiento.
    for (let s = 0; s < this.perTeam * 2; s++) {
      this.seats.push({
        team: (s % 2) as Team,
        slot: Math.floor(s / 2),
        nickname: s < n ? opts.humans[s] : null,
        away: false,
        afk: false,
        idle: 0,
      });
    }

    const rnd = mulberry32(opts.seed ^ 0x9e3779b9);
    const breakTeam: Team = opts.breakTeam ?? (rnd() < 0.5 ? 0 : 1);
    this.balls = (opts.balls ?? makeRack(opts.seed)).map((b) => ({ ...b }));
    this.breakShot = !opts.skipBreak;
    // La rotura sale SIEMPRE de la posicion inicial (el punto de cabeza): la blanca no esta en mano
    // y `placeCue` la rechaza. Solo se puede apuntar y tirar.
    this.cueInHand = false;
    this.phase = "aiming";
    this.shooter = breakTeam; // slot 0 del equipo que rompe
    this.turnStartAt = opts.now + START_DELAY_MS;
    this.deadline = this.turnStartAt + TURN_MS + (this.cueInHand ? HAND_BONUS_MS : 0);
    this.capAt = this.turnStartAt + MATCH_CAP_MS[this.perTeam];
  }

  // ------------------------------------------------------------ consultas

  seatOf(nickname: string): number {
    return this.seats.findIndex((s) => s.nickname === nickname);
  }

  /** Cuantas bolas de su grupo le quedan en la mesa a cada equipo. */
  groupsLeft(): [number, number] {
    const left: [number, number] = [0, 0];
    for (let i = 1; i < BALL_COUNT; i++) {
      const g = groupOf(i);
      if (g !== -1 && this.balls[i].alive) left[g]++;
    }
    return left;
  }

  /** Un asiento juega "solo" si es un bot de relleno, esta desconectado o dejo vencer turnos. */
  isAutopilot(seat: number): boolean {
    const s = this.seats[seat];
    return s.nickname === null || s.away || s.afk;
  }

  /** Foto de la mesa para el bot del asiento `seat` (copia: el bot puede tocarla sin romper nada). */
  botView(seat: number): BotView {
    return {
      balls: this.balls.map((b) => ({ ...b })),
      team: this.seats[seat].team,
      groupsLeft: this.groupsLeft(),
      cueInHand: this.cueInHand,
      breakShot: this.breakShot,
    };
  }

  /** Puesto de cada equipo para el ranking de la sala: ganador 1, perdedor 2, empate 1 y 1. */
  placeOf(team: Team): 1 | 2 {
    return this.winner === null || this.winner === team ? 1 : 2;
  }

  // ------------------------------------------------------------ acciones

  /** Pone la blanca (rotura o blanca en mano). Se puede llamar varias veces para reacomodar. */
  placeCue(seat: number, x: number, z: number, now: number, byBot = false): void {
    this.assertCanAct(seat, now);
    if (!this.cueInHand) throw new PoolError("not_in_hand");
    if (!spotIsFree(this.balls, 0, x, z)) throw new PoolError("bad_spot");
    this.balls[0].x = x;
    this.balls[0].z = z;
    this.balls[0].alive = true;
    this.touch(seat, byBot);
  }

  /** Resuelve un tiro entero y devuelve que paso. Lanza `PoolError` si no corresponde. */
  takeShot(seat: number, shot: Shot, now: number, byBot = false): ShotOutcome {
    this.assertCanAct(seat, now);
    if (!this.balls[0].alive) throw new PoolError("cue_not_placed");
    if (![shot.angle, shot.power, shot.offsetX, shot.offsetY].every(Number.isFinite)) throw new PoolError("bad_shot");
    this.touch(seat, byBot);

    const team = this.seats[seat].team;
    const leftBefore = this.groupsLeft()[team];
    const wasBreak = this.breakShot;
    const result = simulateShot(this.balls, shot);
    for (let i = 0; i < BALL_COUNT; i++) {
      this.balls[i].x = result.final[i].x;
      this.balls[i].z = result.final[i].z;
      this.balls[i].alive = result.final[i].alive;
    }
    this.breakShot = false;
    this.cueInHand = false;

    const cueIn = result.pocketed.includes(0);
    const foul: FoulReason | null = cueIn ? "scratch" : result.firstContact < 0 ? "no_contact" : null;
    const potted = result.pocketed.filter((id) => id !== 0 && id !== 8);
    const pottedOwn = potted.filter((id) => groupOf(id) === team);
    const pottedOpp = potted.filter((id) => groupOf(id) !== team);
    const eight = result.pocketed.includes(8);

    let ended: ShotOutcome["ended"] = null;
    let respotEight = false;
    if (eight) {
      if (wasBreak) {
        respotEight = true;
        this.respotEight();
      } else if (leftBefore === 0 && !cueIn) {
        ended = { winner: team, reason: "eight" };
      } else {
        ended = { winner: (1 - team) as Team, reason: cueIn ? "scratch_eight" : "early_eight" };
      }
    }

    const continues = ended === null && foul === null && pottedOwn.length > 0;
    const startAt = now + PLAY_LEAD_MS;
    const nextTurnAt = startAt + Math.ceil(result.duration * 1000) + SETTLE_MS;

    let nextSeat = -1;
    if (ended) {
      this.finish(ended.winner, ended.reason);
    } else {
      if (!continues) {
        this.ptr[team] = (this.ptr[team] + 1) % this.perTeam;
        nextSeat = this.ptr[1 - team] * 2 + (1 - team);
      } else {
        nextSeat = seat;
      }
      this.shooter = nextSeat;
      this.cueInHand = foul !== null;
      this.phase = this.cueInHand ? "placing" : "aiming";
      this.turnNo++;
      this.turnStartAt = nextTurnAt;
      this.deadline = nextTurnAt + TURN_MS + (this.cueInHand ? HAND_BONUS_MS : 0);
    }

    return {
      result,
      seat,
      team,
      foul,
      pottedOwn,
      pottedOpp,
      pottedEight: eight && !respotEight,
      respotEight,
      continues,
      nextSeat,
      cueInHand: this.cueInHand,
      ended,
      groupsLeft: this.groupsLeft(),
      nextTurnAt,
      startAt,
    };
  }

  // ------------------------------------------------------------ relojes y presencia

  /** El tirador dejo vencer el turno. */
  timedOut(now: number): boolean {
    return this.phase !== "ended" && now >= this.deadline;
  }

  /**
   * Registra un turno vencido. Quien llama tiene que hacer jugar a un bot por ese asiento
   * ENSEGUIDA, siempre (el reloj se renueva aca solo como red por si no lo hace). `afk`
   * dice si, con este vencimiento, el asiento paso a piloto automatico: tras
   * `IDLE_TURNS_TO_BOT` seguidos juega un bot en todos sus turnos hasta que el humano
   * vuelva a tocar algo.
   */
  handleTimeout(now: number): { seat: number; afk: boolean } {
    if (!this.timedOut(now)) throw new PoolError("not_timed_out");
    const s = this.seats[this.shooter];
    s.idle++;
    if (s.nickname !== null && s.idle >= IDLE_TURNS_TO_BOT) s.afk = true;
    this.deadline = now + TURN_MS;
    return { seat: this.shooter, afk: s.afk };
  }

  setAway(seat: number, away: boolean): void {
    const s = this.seats[seat];
    if (s.nickname === null) return;
    s.away = away;
    if (!away) s.idle = 0;
  }

  capReached(now: number): boolean {
    return this.phase !== "ended" && now >= this.capAt;
  }

  /** Corta la partida por tiempo: gana quien tenga menos bolas de su grupo en la mesa; igual = empate. */
  endByCap(): { winner: Team | null; reason: EndReason } {
    if (this.phase === "ended") throw new PoolError("already_ended");
    const [a, b] = this.groupsLeft();
    const winner: Team | null = a === b ? null : a < b ? 0 : 1;
    this.finish(winner, "cap");
    return { winner, reason: "cap" };
  }

  // ------------------------------------------------------------ foto para los clientes

  snapshot() {
    return {
      perTeam: this.perTeam,
      phase: this.phase,
      seats: this.seats.map((s, i) => ({
        team: s.team,
        slot: s.slot,
        nickname: s.nickname,
        bot: this.isAutopilot(i),
      })),
      balls: this.balls.map((b) => ({ x: b.x, z: b.z, alive: b.alive })),
      shooter: this.shooter,
      cueInHand: this.cueInHand,
      breakShot: this.breakShot,
      groupsLeft: this.groupsLeft(),
      turnStartAt: this.turnStartAt,
      deadline: this.deadline,
      capAt: this.capAt,
      winner: this.winner,
      endReason: this.endReason,
    };
  }

  // ------------------------------------------------------------ internos

  private assertCanAct(seat: number, now: number): void {
    if (this.phase === "ended") throw new PoolError("ended");
    if (seat !== this.shooter) throw new PoolError("not_your_turn");
    if (now < this.turnStartAt - EARLY_SLACK_MS) throw new PoolError("too_early");
  }

  /** Una accion de un humano lo saca de piloto automatico por AFK; una de un bot no. */
  private touch(seat: number, byBot: boolean): void {
    if (byBot) return;
    const s = this.seats[seat];
    s.idle = 0;
    s.afk = false;
  }

  private finish(winner: Team | null, reason: EndReason): void {
    this.phase = "ended";
    this.winner = winner;
    this.endReason = reason;
    this.shooter = -1;
  }

  /** La 8 que cayo en la rotura vuelve al punto de pie (o al primer hueco libre hacia atras). */
  private respotEight(): void {
    const step = 2 * BALL_R + 0.001;
    for (let k = 0; k < 20; k++) {
      for (const dir of [1, -1]) {
        const x = FOOT_SPOT.x + dir * k * step;
        if (spotIsFree(this.balls, 8, x, FOOT_SPOT.z)) {
          this.balls[8] = { x, z: FOOT_SPOT.z, alive: true };
          return;
        }
      }
    }
    this.balls[8] = { x: FOOT_SPOT.x, z: FOOT_SPOT.z, alive: true };
  }
}
