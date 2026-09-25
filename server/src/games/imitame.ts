import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type {
  MtEffectId,
  MtGameover,
  MtPhase,
  MtPlayerView,
  MtResult,
  MtState,
  MtWheel,
} from "../protocol.js";

/**
 * Imitame (clon simplificado de Mimic Party): suena un sonido una vez, todos lo imitan
 * a la vez con la voz, las tomas se reproducen una por una para toda la sala y una
 * ruleta reparte bonus y sabotajes para la ronda siguiente.
 *
 * El server arbitra las fases (todas con `setTimeout` propio, asi la partida llega a
 * "over" aunque todos esten idle) y hace de **relay de las tomas**: el audio lo manda
 * cada cliente y se reenvia a todos al abrir la reproduccion. El puntaje crudo lo
 * calcula cada cliente (el "jurado" corre en el navegador, como la IA local del juego
 * original): mismo nivel spoofeable que el resto de las salas. Lo que el server si
 * decide es el multiplicador de la ruleta y los totales.
 */

/** Ids de los sonidos. **Espejan `SOUNDS` de `src/games/imitame/game/sounds.ts`**. */
const SOUND_IDS = [
  "cucu",
  "perro",
  "gato",
  "vaca",
  "gallo",
  "lobo",
  "pato",
  "buho",
  "sirena",
  "alarma",
  "bocina",
  "microondas",
  "timbre",
  "moto",
  "quinta",
  "cumple",
  "suspenso",
  "risa",
  "tirolesa",
  "escala",
  "palmas",
];

/**
 * Audios de la biblioteca de la comunidad (tabla `imitame_clips` de Supabase). El server
 * no toca la DB: cada cliente lee los ids al conectar y los manda en el `mt:join`, y el
 * server sortea entre la union. Viajan como `soundId = "clip:<uuid>"` y cada cliente baja
 * el audio por su cuenta.
 */
const CLIP_PREFIX = "clip:";
/** Con audios de la comunidad disponibles, que proporcion de las rondas es uno de ellos. */
const CLIP_CHANCE = 0.5;
/** Tope de ids por join (espeja el `INDEX_LIMIT` del cliente). */
const MAX_CLIPS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Multiplicador y tipo de cada salida de la ruleta. Espeja `EFFECTS` del cliente. */
const EFFECTS: Record<MtEffectId, { mult: number; kind: "bonus" | "sabotage" | "none" }> = {
  doble: { mult: 2, kind: "bonus" },
  eco: { mult: 0.8, kind: "sabotage" },
  mas: { mult: 1.5, kind: "bonus" },
  saturado: { mult: 0.8, kind: "sabotage" },
  salvado: { mult: 1, kind: "none" },
  helio: { mult: 0.8, kind: "sabotage" },
  cortado: { mult: 0.7, kind: "sabotage" },
  pedo: { mult: 0.5, kind: "sabotage" },
};
const EFFECT_IDS = Object.keys(EFFECTS) as MtEffectId[];

/** Rondas (sonidos) por partido = una ronda de sala. */
const ROUNDS_PER_MATCH = 4;
/** Espera desde el primer jugador para que se conecte el roster antes de arrancar. */
const START_GRACE_MS = 8000;
/*
 * Ritmo. Todo va con aire a proposito: el chiste es escuchar la toma del otro y reirse,
 * y con los tiempos apretados de la primera version no daba para nada.
 */
/** Cartel "Ronda N: el gato" (y el efecto que te dejo la ruleta). Mesa abierta. */
const INTRO_MS = 5000;
/** Suena la referencia (3s como mucho) y queda un respiro antes del 3/2/1. */
const LISTEN_MS = 5000;
/** "3 / 2 / 1" antes de grabar. **Espeja `READY_STEP_MS` x3 del cliente.** */
const READY_MS = 3000;
/** Ventana de grabacion. **Espeja `RECORD_MS` del cliente.** */
const RECORD_MS = 4500;
/** Tope para que lleguen las tomas despues de grabar (cierra antes si llegaron todas). */
const UPLOAD_MAX_MS = 6000;
/** Antes de cada toma: el micro vuela a la cara del que le toca. **Espeja el cliente.** */
const PRE_SLOT_MS = 1500;
/** Despues de que suena una toma: el jurado va llenando las barras y suma los puntos. */
const REVEAL_MS = 5500;
/** Turno de alguien que no grabo nada. */
const NO_TAKE_SLOT_MS = 2500;
/** Resumen de la ronda: cuanto sumo cada uno y la tabla. */
const SUMMARY_MS = 7000;
/** La ruleta gira ~4.2s en el cliente; el resto es para leer el resultado. */
const WHEEL_MS = 8000;
/** Tope de un mensaje de senalizacion del chat de voz (una SDP ronda 2-6 KB). */
const RTC_MAX_BYTES = 20000;
/** Tope de una toma (mu-law = 1 byte por muestra; ~7s a 11 kHz). Espeja el cliente. */
const MAX_TAKE_BYTES = 80000;

interface Take {
  rate: number;
  audio: Buffer | null;
  raw: number;
  attacks: number;
  rhythm: number;
  melody: number;
}

const clamp01 = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class ImitameSim implements RoomSim {
  private phase: MtPhase = "waiting";
  private roster: string[] = [];
  private seats: string[] = [];
  private round = 0;
  private soundId: string | null = null;
  private readonly usedSounds = new Set<string>();
  /** ids de la biblioteca que anunciaron los clientes (union). */
  private readonly clips = new Set<string>();
  private readonly totals = new Map<string, number>();
  /** Efectos que pesan sobre la ronda actual (salieron en la ruleta anterior). */
  private effects = new Map<string, MtEffectId>();
  private pendingEffects = new Map<string, MtEffectId>();
  private takes = new Map<string, Take>();
  private results = new Map<string, MtResult>();
  private playOrder: string[] = [];
  private playIndex = 0;
  private wheel: MtWheel | null = null;

  private deadline: number | null = null;
  private phaseTotalMs = 0;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly room: GameRoom;

  constructor(room: GameRoom) {
    this.room = room;
  }

  // ---------- Ciclo de vida ----------

  join(nickname: string, roster: string[], meta?: unknown): void {
    if (roster.length > 0) this.roster = roster;
    const clips = meta && typeof meta === "object" ? (meta as { clips?: unknown }).clips : null;
    if (Array.isArray(clips)) {
      for (const id of clips.slice(0, MAX_CLIPS)) {
        if (typeof id === "string" && UUID_RE.test(id)) this.clips.add(id);
      }
    }
    if (this.phase === "waiting") {
      if (this.startTimer === null) this.startTimer = setTimeout(() => this.start(), START_GRACE_MS);
      if (this.roster.length > 0 && this.roster.every((n) => this.room.isConnected(n))) this.start();
    }
    this.broadcastState();
    // Reconecta en plena reproduccion: necesita las tomas para escucharlas.
    if (this.phase === "playback" || this.phase === "summary" || this.phase === "wheel") this.sendTakes(nickname);
    if (this.phase === "over") this.room.emitTo(nickname, "mt:gameover", this.gameoverPayload());
  }

  leave(_nickname: string): void {
    if (this.phase !== "over") this.broadcastState();
    // El que se fue puede ser justo la toma que faltaba.
    this.maybeCloseUpload();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (!this.seats.includes(nickname)) return;
    if (event === "mt:take") this.onTake(nickname, payload);
    else if (event === "mt:rtc") this.onRtc(nickname, payload);
  }

  /**
   * Senalizacion del chat de voz (WebRTC): el server solo la reenvia al destinatario, con
   * el remitente estampado (nadie se hace pasar por otro). No mira el contenido.
   */
  private onRtc(from: string, payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const p = payload as { to?: unknown; data?: unknown };
    if (typeof p.to !== "string" || !this.seats.includes(p.to) || p.to === from) return;
    const size = JSON.stringify(p.data ?? null).length;
    if (size > RTC_MAX_BYTES) return;
    this.room.emitTo(p.to, "mt:rtc", { from, data: p.data });
  }

  dispose(): void {
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
  }

  // ---------- Tomas ----------

  private onTake(nickname: string, payload: unknown): void {
    if (this.phase !== "record" && this.phase !== "upload") return;
    if (this.takes.has(nickname)) return; // una sola toma por ronda
    if (!payload || typeof payload !== "object") return;
    const p = payload as Record<string, unknown>;
    if (p.round !== this.round) return; // toma de otra ronda (llego tardisimo)

    let audio: Buffer | null = null;
    if (Buffer.isBuffer(p.audio)) audio = p.audio;
    else if (p.audio instanceof ArrayBuffer) audio = Buffer.from(p.audio);
    const rate = typeof p.rate === "number" ? p.rate : 0;
    if (audio && (audio.length === 0 || audio.length > MAX_TAKE_BYTES || rate < 3000 || rate > 48000)) audio = null;

    const raw = typeof p.raw === "number" && Number.isFinite(p.raw) ? Math.round(Math.max(0, Math.min(100, p.raw))) : 0;
    this.takes.set(nickname, {
      rate,
      audio,
      raw: audio ? raw : 0,
      attacks: clamp01(p.attacks),
      rhythm: clamp01(p.rhythm),
      melody: clamp01(p.melody),
    });
    this.broadcastState();
    this.maybeCloseUpload();
  }

  private maybeCloseUpload(): void {
    if (this.phase !== "upload") return;
    const present = this.seats.filter((n) => this.room.isConnected(n));
    if (present.length === 0) return;
    if (present.every((n) => this.takes.has(n))) this.toPlayback();
  }

  private sendTakes(nickname: string | null): void {
    for (const [nick, take] of this.takes) {
      if (!take.audio) continue;
      const msg = { round: this.round, nickname: nick, rate: take.rate, audio: take.audio };
      if (nickname) this.room.emitTo(nickname, "mt:take", msg);
      else this.room.broadcast("mt:take", msg);
    }
  }

  // ---------- Fases ----------

  private start(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.seats = this.roster.filter((n) => this.room.isConnected(n));
    if (this.seats.length === 0) return;
    for (const n of this.seats) this.totals.set(n, 0);
    this.round = 0;
    this.startRound();
  }

  private startRound(): void {
    this.takes = new Map();
    this.results = new Map();
    this.playOrder = [];
    this.playIndex = 0;
    this.wheel = null;
    this.effects = this.pendingEffects;
    this.pendingEffects = new Map();
    this.soundId = this.pickSound();
    this.usedSounds.add(this.soundId);
    this.enter("intro", INTRO_MS, () => this.enter("listen", LISTEN_MS, () => this.toReady()));
  }

  private toReady(): void {
    this.enter("ready", READY_MS, () => this.enter("record", RECORD_MS, () => this.toUpload()));
  }

  private toUpload(): void {
    this.enter("upload", UPLOAD_MAX_MS, () => this.toPlayback());
    this.maybeCloseUpload();
  }

  private toPlayback(): void {
    if (this.phase !== "upload") return;
    for (const nick of this.seats) {
      const take = this.takes.get(nick);
      const effect = this.effects.get(nick) ?? null;
      const mult = effect ? EFFECTS[effect].mult : 1;
      const raw = take?.raw ?? 0;
      this.results.set(nick, {
        nickname: nick,
        hasTake: !!take?.audio,
        raw,
        mult,
        points: Math.round(raw * mult),
        attacks: take?.attacks ?? 0,
        rhythm: take?.rhythm ?? 0,
        melody: take?.melody ?? 0,
      });
    }
    this.playOrder = shuffle(this.seats);
    this.playIndex = 0;
    this.sendTakes(null);
    this.playSlot();
  }

  private playSlot(): void {
    const nick = this.playOrder[this.playIndex];
    const take = this.takes.get(nick);
    let ms = NO_TAKE_SLOT_MS;
    if (take?.audio) {
      const effect = this.effects.get(nick);
      let dur = (take.audio.length / take.rate) * 1000;
      if (effect === "helio") dur /= 1.5;
      ms = PRE_SLOT_MS + Math.min(4500, dur) + REVEAL_MS;
    }
    this.enter("playback", ms, () => this.nextSlot());
  }

  private nextSlot(): void {
    const nick = this.playOrder[this.playIndex];
    const res = this.results.get(nick);
    if (res) this.totals.set(nick, (this.totals.get(nick) ?? 0) + res.points);
    this.playIndex += 1;
    if (this.playIndex < this.playOrder.length) {
      this.playSlot();
      return;
    }
    this.enter("summary", SUMMARY_MS, () => {
      if (this.round + 1 >= ROUNDS_PER_MATCH) this.finish();
      else this.spinWheel();
    });
  }

  /**
   * La ruleta favorece al que viene atras: los bonus caen en la mitad de abajo de la
   * tabla y los sabotajes en la de arriba. Es lo que mantiene la partida abierta.
   */
  private spinWheel(): void {
    const outcome = EFFECT_IDS[Math.floor(Math.random() * EFFECT_IDS.length)];
    const ranked = [...this.seats].sort((a, b) => (this.totals.get(b) ?? 0) - (this.totals.get(a) ?? 0));
    const half = Math.max(1, Math.ceil(ranked.length / 2));
    const kind = EFFECTS[outcome].kind;
    const pool = kind === "bonus" ? ranked.slice(-half) : kind === "sabotage" ? ranked.slice(0, half) : ranked;
    const target = pool[Math.floor(Math.random() * pool.length)];
    this.wheel = { outcome, target, jitter: Math.random() };
    if (kind !== "none") this.pendingEffects.set(target, outcome);
    this.enter("wheel", WHEEL_MS, () => {
      this.round += 1;
      this.startRound();
    });
  }

  private finish(): void {
    this.phase = "over";
    this.deadline = null;
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    this.broadcastState();
    this.room.broadcast("mt:gameover", this.gameoverPayload());
  }

  private enter(phase: MtPhase, ms: number, next: () => void): void {
    this.phase = phase;
    this.phaseTotalMs = ms;
    this.deadline = Date.now() + ms;
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(next, ms);
    this.broadcastState();
  }

  private pickSound(): string {
    const community = [...this.clips].map((id) => CLIP_PREFIX + id);
    const useClip = community.length > 0 && Math.random() < CLIP_CHANCE;
    const ids = useClip ? community : SOUND_IDS;
    const pool = ids.filter((id) => !this.usedSounds.has(id));
    const from = pool.length > 0 ? pool : ids;
    return from[Math.floor(Math.random() * from.length)];
  }

  // ---------- Estado ----------

  private playerViews(): MtPlayerView[] {
    return this.seats.map((nickname) => ({
      nickname,
      connected: this.room.isConnected(nickname),
      total: this.totals.get(nickname) ?? 0,
      submitted: this.takes.has(nickname),
      effect: this.effects.get(nickname) ?? null,
    }));
  }

  private visibleResults(): MtResult[] | null {
    if (this.phase === "playback") {
      return this.playOrder
        .slice(0, this.playIndex + 1)
        .map((n) => this.results.get(n))
        .filter((r): r is MtResult => !!r);
    }
    if (this.phase === "summary" || this.phase === "wheel" || this.phase === "over") return [...this.results.values()];
    return null;
  }

  private broadcastState(): void {
    const hasClock = this.deadline !== null && this.phase !== "waiting" && this.phase !== "over";
    const state: MtState = {
      phase: this.phase,
      round: this.round,
      totalRounds: ROUNDS_PER_MATCH,
      soundId: this.soundId,
      clockMs: hasClock ? Math.max(0, this.deadline! - Date.now()) : null,
      clockTotalMs: hasClock ? this.phaseTotalMs : null,
      players: this.playerViews(),
      playOrder: this.phase === "playback" ? this.playOrder : null,
      playIndex: this.playIndex,
      results: this.visibleResults(),
      wheel: this.phase === "wheel" ? this.wheel : null,
    };
    this.room.broadcast("mt:state", state);
  }

  private gameoverPayload(): MtGameover {
    const ranked = [...this.seats].sort((a, b) => (this.totals.get(b) ?? 0) - (this.totals.get(a) ?? 0));
    return {
      ranking: ranked.map((nickname, i) => ({ nickname, place: i + 1, total: this.totals.get(nickname) ?? 0 })),
    };
  }
}

/** Engancha el juego en el namespace `/imitame`. */
export function registerImitame(io: Server): void {
  registerGame(io, "/imitame", "mt:join", parseJoin, (room) => new ImitameSim(room));
}

function parseJoin(payload: unknown): { nickname: string; roster: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nickname = typeof p.nickname === "string" ? p.nickname : null;
  if (!nickname) return null;
  const roster = Array.isArray(p.roster) ? p.roster.filter((x): x is string => typeof x === "string") : [];
  return { nickname, roster };
}
