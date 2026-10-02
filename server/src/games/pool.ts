import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { BiEvent, BiPhase, BiPlay, BiRejectReason, BiSegment, BiState } from "../protocol.js";
import { PoolError, PoolMatch, formatFor, type ShotOutcome } from "./pool-match.js";
import { chooseBotAction, type BotAction, type BotLevel } from "./pool-bot.js";
import { mulberry32 } from "./pool-rack.js";
import type { Shot, ShotEventKind } from "./pool-physics.js";

/**
 * Pool en sala: la capa de red de `PoolMatch` (reglas) y `simulateShot` (fisica). El
 * server es el arbitro de TODO: las bolas, los turnos, las faltas y la 8. El cliente solo
 * manda su intencion (poner la blanca, tirar, apuntar) y recibe el desenlace; no hay
 * nada que adulterar porque el server vuelve a simular cualquier tiro.
 *
 * Este archivo solo pega las piezas: sockets, un tick de 100 ms que maneja los relojes y
 * los bots, y el armado de los mensajes. Las reglas viven en pool-match.ts, la fisica en
 * pool-physics.ts y el bot en pool-bot.ts. Detalle y decisiones: src/games/poolnight/CLAUDE.md.
 *
 * Un tiro viaja en UN mensaje (`bi:play`): los tramos de movimiento analiticos de las bolas
 * que se movieron + los eventos + el estado posterior. No hay flujo de posiciones, asi que
 * el trafico esta lejisimos del tope de cualquier canal.
 */

const MAX_SEATS = 8;
/** Espera maxima a que se conecten todos antes de largar igual (los ausentes juegan por bot). */
const START_GRACE_MS = 8000;
const TICK_MS = 100;
/** Separacion minima entre dos `bi:aim` reenviados del mismo jugador. */
const AIM_MIN_MS = 70;
/** Fallos seguidos de un bot antes de la jugada de emergencia. */
const BOT_FAIL_LIMIT = 3;

interface BotPlan {
  seat: number;
  /** `PoolMatch.turnNo` cuando se armo: si cambia, el plan quedo viejo. */
  turnNo: number;
  action: BotAction;
  startedAt: number;
  fireAt: number;
  /** La blanca ya se apoyo (se hace a ~30% del "pensar", asi no se teletransporta al tirar). */
  placed: boolean;
}

const EVENT_CODE: Record<ShotEventKind, number> = { cue: 0, ball: 1, cushion: 2, pocket: 3 };

export class PoolSim implements RoomSim {
  private readonly room: GameRoom;
  private round = -1;
  private phase: BiPhase = "waiting";
  private roster: string[] = [];
  private match: PoolMatch | null = null;
  private shots = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private botPlan: BotPlan | null = null;
  private botFails = 0;
  private readonly lastAimAt = new Map<string, number>();
  private readonly rnd = mulberry32((Date.now() ^ 0x5bd1e995) >>> 0);

  constructor(room: GameRoom) {
    this.room = room;
  }

  // ------------------------------------------------------------ RoomSim

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;
    // El estado es de ESTA ronda: una mas nueva lo descarta, una vieja no se mezcla.
    if (round > this.round) {
      this.round = round;
      this.reset(roster);
    }
    if (round !== this.round) return;

    const seat = this.roster.indexOf(nickname);
    if (this.match && seat >= 0) this.match.setAway(seat, false);
    this.room.emitTo(nickname, "bi:init", { seat, state: this.stateOf() });
    this.broadcastState();

    if (this.phase !== "waiting" || this.roster.length === 0) return;
    if (this.startTimer === null) this.startTimer = setTimeout(() => this.launch(), START_GRACE_MS);
    if (this.roster.every((n) => this.room.isConnected(n))) this.launch();
  }

  leave(nickname: string): void {
    this.lastAimAt.delete(nickname);
    const seat = this.roster.indexOf(nickname);
    if (this.match && seat >= 0) this.match.setAway(seat, true);
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (event === "bi:ping") {
      this.room.emitTo(nickname, "bi:pong", { c: readNumber(payload, "c") ?? 0, t: Date.now() });
      return;
    }
    const seat = this.roster.indexOf(nickname);
    if (seat < 0) return; // espectador: solo mira
    if (!this.match || this.phase !== "playing") {
      if (event === "bi:shot" || event === "bi:place") this.reject(nickname, "not_playing");
      return;
    }
    if (event === "bi:aim") this.onAim(nickname, seat, payload);
    else if (event === "bi:place") this.onPlace(nickname, seat, payload);
    else if (event === "bi:shot") this.onShot(nickname, seat, payload);
  }

  dispose(): void {
    if (this.loop) clearInterval(this.loop);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.loop = null;
    this.startTimer = null;
    this.botPlan = null;
  }

  // ------------------------------------------------------------ ciclo

  private reset(roster: string[]): void {
    this.dispose();
    this.phase = "waiting";
    this.roster = roster.slice(0, MAX_SEATS);
    this.match = null;
    this.shots = 0;
    this.botFails = 0;
    this.lastAimAt.clear();
  }

  private launch(): void {
    if (this.phase !== "waiting" || this.roster.length === 0) return;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.match = new PoolMatch({
      humans: this.roster,
      seed: Math.floor(Math.random() * 0x7fffffff),
      now: Date.now(),
    });
    // Los que no llegaron a conectarse juegan por bot (y lo reclaman al conectar).
    this.roster.forEach((n, i) => {
      if (!this.room.isConnected(n)) this.match?.setAway(i, true);
    });
    this.phase = "playing";
    this.loop = setInterval(() => this.tick(), TICK_MS);
    this.broadcastState();
  }

  private finish(): void {
    this.phase = "over";
    this.botPlan = null;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  /** Relojes y bots. Todo lo que depende de que pase el tiempo cuelga de aca. */
  private tick(): void {
    const match = this.match;
    if (!match || this.phase !== "playing") return;
    const now = Date.now();

    if (match.capReached(now)) {
      match.endByCap();
      this.finish();
      this.broadcastState();
      return;
    }

    if (this.botPlan) {
      this.runPlan(this.botPlan, now);
      return;
    }

    if (now < match.turnStartAt) return;
    const seat = match.shooter;
    if (seat < 0) return;
    if (match.isAutopilot(seat)) {
      // El bot de relleno juega "parejo"; el que cubre a un humano ausente, "flojo".
      this.planBot(seat, match.seats[seat].nickname === null ? "parejo" : "flojo", now);
    } else if (match.timedOut(now)) {
      match.handleTimeout(now);
      this.planBot(seat, "flojo", now);
      // El cambio de asiento a AFK (si lo hubo) se avisa en el proximo estado.
      this.broadcastState();
    }
  }

  // ------------------------------------------------------------ bots

  private planBot(seat: number, level: BotLevel, now: number): void {
    const match = this.match;
    if (!match) return;
    const action = chooseBotAction(match.botView(seat), level, this.rnd);
    this.botPlan = { seat, turnNo: match.turnNo, action, startedAt: now, fireAt: now + action.thinkMs, placed: false };
  }

  private runPlan(plan: BotPlan, now: number): void {
    const match = this.match;
    if (!match) return;
    // Plan viejo: el turno cambio (un humano volvio y tiro, o se corto la partida).
    if (match.shooter !== plan.seat || match.turnNo !== plan.turnNo) {
      this.botPlan = null;
      return;
    }
    const think = Math.max(1, plan.fireAt - plan.startedAt);
    const t = Math.min(1, (now - plan.startedAt) / think);

    try {
      // La blanca se apoya a ~30% del "pensar", para que se vea acomodarla y no teletransportarse.
      if (!plan.placed && plan.action.place && t >= 0.3) {
        plan.placed = true;
        match.placeCue(plan.seat, plan.action.place.x, plan.action.place.z, now, true);
        this.room.broadcast("bi:cue", { x: round5(plan.action.place.x), z: round5(plan.action.place.z) });
      }
      if (now < plan.fireAt) {
        // Apuntado visible: barre desde `startAngle` hasta el tiro, y carga potencia al final.
        if (plan.action.thinkMs > 300) {
          const ease = 1 - (1 - t) * (1 - t);
          const a = plan.action.startAngle + (plan.action.shot.angle - plan.action.startAngle) * ease;
          const p = t < 0.5 ? 0 : plan.action.shot.power * ((t - 0.5) / 0.5);
          this.room.broadcast("bi:aim", { s: plan.seat, a: round4(a), p: round3(p) });
        }
        return;
      }
      if (!plan.placed && plan.action.place) {
        match.placeCue(plan.seat, plan.action.place.x, plan.action.place.z, now, true);
        this.room.broadcast("bi:cue", { x: round5(plan.action.place.x), z: round5(plan.action.place.z) });
      }
      this.botPlan = null;
      this.publishShot(match.takeShot(plan.seat, plan.action.shot, now, true));
      this.botFails = 0;
    } catch (e) {
      this.botPlan = null;
      this.botFails++;
      console.warn(`[pool] el bot fallo (${this.botFails}/${BOT_FAIL_LIMIT}): ${e instanceof PoolError ? e.code : String(e)}`);
      if (this.botFails >= BOT_FAIL_LIMIT) this.emergency(plan.seat, now);
    }
  }

  /** Red de seguridad: si un bot no logra jugar, una jugada simple para que la mesa no se cuelgue. */
  private emergency(seat: number, now: number): void {
    const match = this.match;
    if (!match) return;
    this.botFails = 0;
    try {
      if (!match.balls[0].alive || match.cueInHand) {
        for (let k = 0; k < 400; k++) {
          const x = -1.1 + (k % 20) * 0.11;
          const z = -0.5 + Math.floor(k / 20) * 0.05;
          try {
            match.placeCue(seat, x, z, now, true);
            break;
          } catch {
            /* sigue buscando un lugar libre */
          }
        }
      }
      this.publishShot(match.takeShot(seat, { angle: 0, power: 0.3, offsetX: 0, offsetY: 0 }, now, true));
    } catch (e) {
      console.error("[pool] jugada de emergencia fallida; se corta la partida:", e);
      if (match.phase !== "ended") match.endByCap();
      this.finish();
      this.broadcastState();
    }
  }

  // ------------------------------------------------------------ acciones de los humanos

  private onAim(nickname: string, seat: number, payload: unknown): void {
    const match = this.match;
    if (!match || match.shooter !== seat) return;
    const a = readNumber(payload, "a");
    const p = readNumber(payload, "p");
    if (a === null || p === null) return;
    const now = Date.now();
    if (now - (this.lastAimAt.get(nickname) ?? 0) < AIM_MIN_MS) return;
    this.lastAimAt.set(nickname, now);
    this.room.broadcast("bi:aim", { s: seat, a: round4(a), p: round3(clamp(p, 0, 1)) });
  }

  private onPlace(nickname: string, seat: number, payload: unknown): void {
    const match = this.match;
    if (!match) return;
    const x = readNumber(payload, "x");
    const z = readNumber(payload, "z");
    if (x === null || z === null) return this.reject(nickname, "bad_spot");
    try {
      match.placeCue(seat, x, z, Date.now(), false);
      this.cancelPlanOf(seat);
      this.room.broadcast("bi:cue", { x: round5(x), z: round5(z) });
    } catch (e) {
      this.rejectError(nickname, e);
    }
  }

  private onShot(nickname: string, seat: number, payload: unknown): void {
    const match = this.match;
    if (!match) return;
    const a = readNumber(payload, "a");
    const p = readNumber(payload, "p");
    if (a === null || p === null) return this.reject(nickname, "bad_shot");
    const shot: Shot = {
      angle: a,
      power: clamp(p, 0, 1),
      offsetX: clamp(readNumber(payload, "ox") ?? 0, -1, 1),
      offsetY: clamp(readNumber(payload, "oy") ?? 0, -1, 1),
    };
    const now = Date.now();
    try {
      // Si la blanca esta en mano, la posicion viaja con el tiro: asi no hay carrera con el ultimo `bi:place`.
      const x = readNumber(payload, "x");
      const z = readNumber(payload, "z");
      if (match.cueInHand && x !== null && z !== null) match.placeCue(seat, x, z, now, false);
      this.cancelPlanOf(seat);
      this.publishShot(match.takeShot(seat, shot, now, false));
    } catch (e) {
      this.rejectError(nickname, e);
    }
  }

  /** Un humano que vuelve a actuar le saca el turno al bot que lo estaba cubriendo. */
  private cancelPlanOf(seat: number): void {
    if (this.botPlan?.seat === seat) this.botPlan = null;
  }

  // ------------------------------------------------------------ salida

  private publishShot(outcome: ShotOutcome): void {
    const match = this.match;
    if (!match) return;
    this.shots++;
    if (match.phase === "ended") this.finish();
    const r = outcome.result;
    const play: BiPlay = {
      id: this.shots,
      seat: outcome.seat,
      startAt: outcome.startAt,
      dur: round3(r.duration),
      segs: r.segments.map(
        (s): BiSegment => [s.b, round4(s.t), round5(s.x), round5(s.z), round4(s.vx), round4(s.vz), round2(s.wx), round2(s.wy), round2(s.wz), s.ph],
      ),
      ev: r.events.map((e): BiEvent => [round4(e.t), EVENT_CODE[e.kind], e.a, e.b, round3(e.speed), round4(e.x), round4(e.z)]),
      foul: outcome.foul,
      own: outcome.pottedOwn,
      opp: outcome.pottedOpp,
      eight: outcome.pottedEight,
      respot: outcome.respotEight,
      continues: outcome.continues,
      next: outcome.nextSeat,
      hand: outcome.cueInHand,
      ended: outcome.ended,
      nextTurnAt: outcome.nextTurnAt,
      state: this.stateOf(),
    };
    this.room.broadcast("bi:play", play);
  }

  private stateOf(): BiState {
    const now = Date.now();
    const m = this.match;
    if (!m) {
      return {
        phase: this.phase,
        perTeam: formatFor(Math.max(1, this.roster.length)),
        seats: this.roster.map((n, i) => ({ team: (i % 2) as 0 | 1, nickname: n, bot: false, on: this.room.isConnected(n) })),
        balls: [],
        shooter: -1,
        cueInHand: false,
        breakShot: false,
        groupsLeft: [7, 7],
        turnStartAt: 0,
        deadline: 0,
        capAt: 0,
        now,
        shots: 0,
        winner: null,
        endReason: null,
        places: null,
      };
    }
    const snap = m.snapshot();
    const balls: number[] = [];
    for (const b of snap.balls) balls.push(round5(b.x), round5(b.z), b.alive ? 1 : 0);
    return {
      phase: this.phase,
      perTeam: snap.perTeam,
      seats: snap.seats.map((s) => ({
        team: s.team,
        nickname: s.nickname,
        bot: s.bot,
        on: s.nickname !== null && this.room.isConnected(s.nickname),
      })),
      balls,
      shooter: snap.shooter,
      cueInHand: snap.cueInHand,
      breakShot: snap.breakShot,
      groupsLeft: snap.groupsLeft,
      turnStartAt: snap.turnStartAt,
      deadline: snap.deadline,
      capAt: snap.capAt,
      now,
      shots: this.shots,
      winner: snap.winner,
      endReason: snap.endReason,
      places: m.phase === "ended" ? [m.placeOf(0), m.placeOf(1)] : null,
    };
  }

  private broadcastState(): void {
    this.room.broadcast("bi:state", this.stateOf());
  }

  private reject(nickname: string, why: BiRejectReason): void {
    this.room.emitTo(nickname, "bi:reject", { why });
  }

  private rejectError(nickname: string, e: unknown): void {
    if (e instanceof PoolError) this.reject(nickname, e.code as BiRejectReason);
    else {
      console.error("[pool] error inesperado:", e);
      this.reject(nickname, "bad_shot");
    }
  }
}

// ------------------------------------------------------------ helpers

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
function round5(v: number): number {
  return Math.round(v * 100000) / 100000;
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

/** Engancha el juego en el namespace `/poolnight`. */
export function registerPool(io: Server): void {
  registerGame(io, "/poolnight", "bi:join", parseJoin, (room) => new PoolSim(room));
}
