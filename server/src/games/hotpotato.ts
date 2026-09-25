import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { HpGameover, HpPlayerView, HpRejectReason, HpState } from "../protocol.js";

/**
 * Papa Caliente: la papa pasa de mano en mano y explota a un tiempo SECRETO; el
 * que la tiene en ese instante queda afuera. Gana el ultimo en pie.
 *
 * Para pasarla hay que completar una secuencia corta de flechas. El cliente la
 * resuelve solo (cada tecla responde en el mismo cuadro, sin red) y manda un unico
 * `hp:pass` al terminar, con `at` = la hora del server que el veia en ese momento.
 *
 * Latencia, que es lo que hace o rompe este juego:
 *  - La mecha vive SOLO aca y nunca viaja en `hp:state` (no se puede espiar).
 *  - Un pase cuenta en su `at`, acotado a `[llegada - LAG_COMP_MS, llegada]`: el
 *    que completo antes de la explosion *segun lo que el veia* se salva aunque su
 *    mensaje llegue despues. El tope impide inventarse un lag enorme.
 *  - Por eso la explosion se resuelve `LAG_COMP_MS` despues de vencer la mecha:
 *    los pases que ya venian viajando todavia pueden entrar. Como la mecha es
 *    secreta, ese margen no lo percibe nadie.
 *  - La confianza es la misma spoofeable que el resto del repo (el cliente declara
 *    su `at` y su nickname); el tope acota cuanto se puede ganar mintiendo.
 */

/** Espera desde el primer jugador para que se conecten los del roster. */
const START_GRACE_MS = 8000;
/** Pausa antes de la primera papa: cubre el countdown 3/2/1/YA del cliente. */
const PREROLL_MS = 3000;
/** Pausa entre una explosion y la papa siguiente. */
const EXPLODE_PAUSE_MS = 3000;
/** Rango de la mecha secreta de cada papa. */
const FUSE_MIN_MS = 9000;
const FUSE_MAX_MS = 20000;
/**
 * Compensacion maxima de latencia (y gracia tras vencer la mecha). Se compara
 * contra la IDA Y VUELTA entera, no contra la mitad: `at` es la hora del server
 * que el cliente veia (atrasada una bajada) y el pase tarda una subida en llegar,
 * asi que `llegada - at` = RTT. 250 cubre una conexion movil tipica; por encima,
 * el jugador pierde `RTT - 250` ms. La gracia no se percibe (la mecha es secreta).
 */
const LAG_COMP_MS = 250;
/** Secuencia: arranca en SEQ_BASE flechas y suma una cada SEQ_STEP pases de la
 *  misma papa, hasta SEQ_MAX (la papa "se calienta"). */
const SEQ_BASE = 4;
const SEQ_STEP = 5;
const SEQ_MAX = 7;
/** Un holder desconectado la suelta sola pasado este tiempo (asi carga con un
 *  riesgo parecido al de un jugador lento, en vez de trabar la papa). */
const ABSENT_PASS_MS = 2500;

const ARROWS = "UDLR";

interface Player {
  nickname: string;
  alive: boolean;
}

class HotPotatoSim implements RoomSim {
  private readonly room: GameRoom;
  /** Ronda de la sala: el estado es de ESTA ronda (la sala puede repetir el juego
   *  y el GameRoom sobrevivir entre una pagina y la siguiente). */
  private round = -1;
  private readonly roundByPlayer = new Map<string, number>();

  private phase: HpState["phase"] = "waiting";
  private roster: string[] = [];
  private players: Player[] = [];
  private holder: string | null = null;
  private from: string | null = null;
  private seq = "";
  private n = 0;
  private burnPasses = 0;
  private burnStart: number | null = null;
  private nextBurnAt: number | null = null;
  /** Hora de la explosion (privada: nunca sale del server). */
  private explodeAt: number | null = null;
  /** Desde cuando (hora efectiva) tiene la papa el holder: un pase no puede ser anterior. */
  private heldSince = 0;
  private lastPass: HpState["lastPass"] = null;
  private lastBoom: HpState["lastBoom"] = null;
  private boomCount = 0;
  private readonly eliminationOrder: string[] = [];
  /** Ultimo eliminado, para darle la papa siguiente a su vecino. */
  private lastOut: string | null = null;

  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private burnTimer: ReturnType<typeof setTimeout> | null = null;
  private fuseTimer: ReturnType<typeof setTimeout> | null = null;
  private absentTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;
    this.roundByPlayer.set(nickname, round);
    if (round > this.round) {
      this.reset();
      this.round = round;
    }
    if (round !== this.round) return;
    if (roster.length > 0) this.roster = roster;

    if (this.phase === "waiting") {
      if (this.startTimer === null) {
        this.startTimer = setTimeout(() => this.start(), START_GRACE_MS);
      }
      if (this.roster.length > 0 && this.roster.every((p) => this.room.isConnected(p))) {
        this.start();
      }
    }
    // Volvio el holder (F5): deja de correr su suelta automatica.
    if (nickname === this.holder) this.clearAbsent();

    this.broadcastState();
    if (this.phase === "over") this.room.emitTo(nickname, "hp:gameover", this.gameoverPayload());
  }

  leave(nickname: string): void {
    this.roundByPlayer.delete(nickname);
    if (this.phase === "over") return;
    if (nickname === this.holder && this.phase === "burning") this.armAbsent();
    this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (event === "hp:ping") {
      // Sondeo de reloj: se contesta aunque la ronda no coincida (es solo la hora).
      const c = readNum(payload, "c");
      if (c !== null) this.room.emitTo(nickname, "hp:pong", { c, t: Date.now() });
      return;
    }
    if ((this.roundByPlayer.get(nickname) ?? -1) !== this.round) return;
    if (event === "hp:pass") this.onPass(nickname, payload);
  }

  dispose(): void {
    this.clearTimers();
  }

  // ---------- Ciclo de partida ----------

  private reset(): void {
    this.clearTimers();
    this.phase = "waiting";
    this.players = [];
    this.holder = null;
    this.from = null;
    this.seq = "";
    this.n = 0;
    this.burnPasses = 0;
    this.burnStart = null;
    this.nextBurnAt = null;
    this.explodeAt = null;
    this.lastPass = null;
    this.lastBoom = null;
    this.boomCount = 0;
    this.eliminationOrder.length = 0;
    this.lastOut = null;
  }

  private start(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    // Asientos = los del roster conectados, en el orden del roster (joined_at): todos
    // los clientes dibujan el mismo circulo. Los que falten miran.
    const seats = this.roster.filter((p) => this.room.isConnected(p));
    if (seats.length === 0) return;
    this.players = seats.map((nickname) => ({ nickname, alive: true }));
    if (this.players.length < 2) {
      // Uno solo: no hay a quien pasarle, gana de una.
      this.finish();
      return;
    }
    this.schedulePause(PREROLL_MS);
  }

  private schedulePause(ms: number): void {
    this.phase = "pause";
    this.holder = null;
    this.from = null;
    this.seq = "";
    this.burnStart = null;
    this.explodeAt = null;
    this.nextBurnAt = Date.now() + ms;
    this.burnTimer = setTimeout(() => this.beginBurn(), ms);
    this.broadcastState();
  }

  private beginBurn(): void {
    this.burnTimer = null;
    if (this.phase !== "pause") return;
    const now = Date.now();
    this.phase = "burning";
    this.holder = this.firstHolder();
    this.from = null;
    this.n += 1;
    this.burnPasses = 0;
    this.seq = makeSeq(SEQ_BASE);
    this.burnStart = now;
    this.nextBurnAt = null;
    this.heldSince = now;
    this.explodeAt = now + FUSE_MIN_MS + Math.random() * (FUSE_MAX_MS - FUSE_MIN_MS);
    this.fuseTimer = setTimeout(() => this.onFuse(), this.explodeAt - now);
    if (this.holder && !this.room.isConnected(this.holder)) this.armAbsent();
    this.broadcastState();
  }

  /** Primera papa: al azar. Despues: al vecino (sentido horario) del que exploto. */
  private firstHolder(): string {
    const alive = this.players.filter((p) => p.alive);
    if (this.lastOut) {
      const idx = this.players.findIndex((p) => p.nickname === this.lastOut);
      for (let i = 1; i <= this.players.length; i++) {
        const p = this.players[(idx + i) % this.players.length];
        if (p.alive) return p.nickname;
      }
    }
    return alive[Math.floor(Math.random() * alive.length)].nickname;
  }

  /** Vencio la mecha: se espera LAG_COMP_MS a los pases que ya venian viajando. */
  private onFuse(): void {
    this.fuseTimer = setTimeout(() => this.explode(), LAG_COMP_MS);
  }

  private explode(): void {
    this.fuseTimer = null;
    if (this.phase !== "burning" || !this.holder) return;
    this.clearAbsent();
    const out = this.players.find((p) => p.nickname === this.holder);
    if (out) out.alive = false;
    this.eliminationOrder.push(this.holder);
    this.lastOut = this.holder;
    this.boomCount += 1;
    this.lastBoom = { player: this.holder, k: this.boomCount };
    if (this.players.filter((p) => p.alive).length <= 1) {
      this.finish();
      return;
    }
    this.schedulePause(EXPLODE_PAUSE_MS);
  }

  private onPass(nickname: string, payload: unknown): void {
    const n = readInt(payload, "n");
    const to = readString(payload, "to");
    const keys = readString(payload, "keys");
    const at = readNum(payload, "at");
    if (n === null || to === null || keys === null || at === null) return;

    const reject = (reason: HpRejectReason) => this.room.emitTo(nickname, "hp:reject", { n, reason });
    if (this.phase !== "burning" || this.explodeAt === null) return reject("late");
    if (nickname !== this.holder) return reject("not-holder");
    if (n !== this.n) return reject("stale");
    if (keys !== this.seq) return reject("bad-seq");
    if (!this.validTargets().includes(to)) return reject("bad-target");

    // Hora efectiva: la que declara el cliente, acotada a lo que la red permite
    // (no antes de LAG_COMP_MS atras, no en el futuro, no antes de haberla recibido).
    const now = Date.now();
    const effective = Math.max(this.heldSince, Math.min(now, Math.max(at, now - LAG_COMP_MS)));
    if (effective >= this.explodeAt) return reject("late");
    this.passTo(to, effective);
  }

  private passTo(to: string, effective: number): void {
    if (!this.holder) return;
    this.clearAbsent();
    const from = this.holder;
    this.from = from;
    this.holder = to;
    this.heldSince = effective;
    this.n += 1;
    this.burnPasses += 1;
    this.seq = makeSeq(Math.min(SEQ_MAX, SEQ_BASE + Math.floor(this.burnPasses / SEQ_STEP)));
    this.lastPass = { from, to, n: this.n };
    if (!this.room.isConnected(to)) this.armAbsent();
    this.broadcastState();
  }

  /** A quien se le puede pasar: vivos, no uno mismo, y no devolversela al que te la
   *  paso (salvo en el mano a mano, donde no queda otro). */
  private validTargets(): string[] {
    const alive = this.players.filter((p) => p.alive && p.nickname !== this.holder).map((p) => p.nickname);
    if (alive.length <= 1) return alive;
    return alive.filter((p) => p !== this.from);
  }

  /** Destino por defecto: el primero valido en sentido horario. Espeja
   *  `defaultTarget` del cliente. */
  private defaultTarget(): string | null {
    const valid = new Set(this.validTargets());
    const idx = this.players.findIndex((p) => p.nickname === this.holder);
    for (let i = 1; i <= this.players.length; i++) {
      const p = this.players[(idx + i) % this.players.length];
      if (valid.has(p.nickname)) return p.nickname;
    }
    return null;
  }

  private armAbsent(): void {
    this.clearAbsent();
    this.absentTimer = setTimeout(() => {
      this.absentTimer = null;
      if (this.phase !== "burning" || !this.holder || this.room.isConnected(this.holder)) return;
      const to = this.defaultTarget();
      if (to && this.explodeAt !== null && Date.now() < this.explodeAt) this.passTo(to, Date.now());
    }, ABSENT_PASS_MS);
  }

  private clearAbsent(): void {
    if (this.absentTimer !== null) clearTimeout(this.absentTimer);
    this.absentTimer = null;
  }

  private finish(): void {
    this.clearTimers();
    this.phase = "over";
    this.holder = null;
    this.from = null;
    this.seq = "";
    this.burnStart = null;
    this.nextBurnAt = null;
    this.explodeAt = null;
    this.broadcastState();
    this.room.broadcast("hp:gameover", this.gameoverPayload());
  }

  private clearTimers(): void {
    for (const t of [this.startTimer, this.burnTimer, this.fuseTimer]) if (t !== null) clearTimeout(t);
    this.startTimer = null;
    this.burnTimer = null;
    this.fuseTimer = null;
    this.clearAbsent();
  }

  // ---------- Vistas ----------

  private broadcastState(): void {
    const players: HpPlayerView[] = this.players.map((p) => ({
      nickname: p.nickname,
      alive: p.alive,
      connected: this.room.isConnected(p.nickname),
    }));
    const state: HpState = {
      phase: this.phase,
      t: Date.now(),
      holder: this.holder,
      from: this.from,
      seq: this.seq,
      n: this.n,
      burnStart: this.burnStart,
      fuseMaxMs: FUSE_MAX_MS,
      nextBurnAt: this.nextBurnAt,
      players,
      lastPass: this.lastPass,
      lastBoom: this.lastBoom,
    };
    this.room.broadcast("hp:state", state);
  }

  private gameoverPayload(): HpGameover {
    const survivors = this.players.filter((p) => p.alive).map((p) => p.nickname);
    const order = [...survivors, ...[...this.eliminationOrder].reverse()];
    return { ranking: order.map((nickname, i) => ({ nickname, place: i + 1 })) };
  }
}

function makeSeq(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ARROWS[Math.floor(Math.random() * ARROWS.length)];
  return s;
}

function readNum(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function readInt(payload: unknown, key: string): number | null {
  const v = readNum(payload, key);
  return v === null ? null : Math.trunc(v);
}

function readString(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
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

/** Engancha el juego en el namespace `/hotpotato`. */
export function registerHotPotato(io: Server): void {
  registerGame(io, "/hotpotato", "hp:join", parseJoin, (room) => new HotPotatoSim(room));
}
