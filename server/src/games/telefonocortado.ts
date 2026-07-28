import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type {
  TcChainView,
  TcGameover,
  TcPhase,
  TcPlayerView,
  TcState,
  TcYou,
} from "../protocol.js";

/**
 * Telefono Cortado: telefono descompuesto con dibujos. Cada jugador escribe una frase
 * secreta; despues le llega la frase de OTRO y la dibuja; despues le llega el dibujo de
 * un TERCERO y tiene que adivinar la frase original. Al final se revela cada cadena
 * completa (frase -> dibujo -> adivinanza).
 *
 * Como Basta e Impostor, el server NO consulta el diccionario: solo arbitra el flujo
 * (fases + deadlines) y computa el puntaje. El deadline de ronda de Supabase existe como
 * corte duro, pero el server arbitra todas sus fases con `setTimeout`, asi que la partida
 * llega a "over" sola aunque todos esten idle.
 *
 * Lo que le toca a cada jugador viaja por el evento DIRIGIDO `tc:you`, nunca en el
 * broadcast `tc:state`: la frase a adivinar en el state se leeria desde las devtools.
 */

/** Espera desde el primer jugador para que se conecten los del roster antes de arrancar. */
const START_GRACE_MS = 8000;
/** Tope de la fase de escribir la frase propia. */
const WRITE_MS = 40000;
/** Tope de la fase de dibujo (la mas larga: dibujar lleva tiempo). */
const DRAW_MS = 100000;
/** Tope de la fase de adivinanza. */
const GUESS_MS = 50000;
/** El reveal escala con la cantidad de cadenas, con tope (hay que mirar los dibujos). */
const REVEAL_BASE_MS = 6000;
const REVEAL_PER_CHAIN_MS = 3000;
const REVEAL_MAX_MS = 30000;
/** Cada cuanto se revela una letra de la pista tipo ahorcado. */
const HINT_EVERY_MS = 12000;
/** Cuantas letras quedan siempre tapadas (si no, la pista regala la frase). */
const HINT_KEEP_HIDDEN = 2;

/** Largos maximos (defensa; el cliente ya acota). */
const MAX_PHRASE_LEN = 60;
const MAX_GUESS_LEN = 60;
/**
 * Tope del dataURL de un dibujo. El cliente exporta JPEG reducido (~30-60KB); esto
 * corta un payload absurdo antes de que lo retransmitamos a toda la sala.
 */
const MAX_IMAGE_CHARS = 400000;

/** Puntos por acertar la frase, mas un bonus por lo que quede de reloj. */
const POINTS_GUESS = 100;
const POINTS_SPEED_MAX = 50;
/** Puntos para el dibujante cuando SU dibujo fue adivinado (premia dibujar claro). */
const POINTS_ARTIST = 100;

/** Frases de relleno para el que no escribio la suya a tiempo. */
const FALLBACK_PHRASES = [
  "Un gato tocando el piano",
  "Un astronauta comiendo pizza",
  "Un dinosaurio en monopatin",
  "Una vaca abducida por aliens",
  "Un pulpo manejando un colectivo",
  "Un robot paseando al perro",
  "Una tortuga con cohetes",
  "Un pinguino tomando mate",
];

/**
 * Normaliza para comparar la adivinanza con la frase: minuscula, saca acentos de
 * vocales y dieresis, conserva la ñ, colapsa espacios y descarta el resto. Copiada a
 * proposito (no se importa `dictionary.ts`: este juego no depende del diccionario).
 */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[́̈]/g, "")
    .normalize("NFC")
    .replace(/[^a-z0-9ñ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

interface Chain {
  /** Quien escribio la frase. */
  owner: string;
  phrase: string;
  /** True si la frase la puso el server porque el jugador no llego. */
  filled: boolean;
  artist: string | null;
  drawing: string | null;
  guesser: string | null;
  guess: string | null;
  solved: boolean;
  /** Indices de letras ya reveladas en la pista. */
  revealed: Set<number>;
}

class TelefonoCortadoSim implements RoomSim {
  private phase: TcPhase = "waiting";
  private roster: string[] = [];
  /** Jugadores de la partida, en el orden del roster (fijado al arrancar). */
  private seats: string[] = [];
  /** Una cadena por jugador: `chains[i].owner === seats[i]`. */
  private chains: Chain[] = [];
  private readonly totals = new Map<string, number>();

  private deadline: number | null = null;
  private phaseTotalMs = 0;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly room: GameRoom) {}

  // ---------- Ciclo de vida ----------

  join(nickname: string, roster: string[]): void {
    if (roster.length > 0) this.roster = roster;

    if (this.phase === "waiting") {
      if (this.startTimer === null) {
        this.startTimer = setTimeout(() => this.start(), START_GRACE_MS);
      }
      if (this.roster.length > 0 && this.roster.every((n) => this.room.isConnected(n))) {
        this.start();
      }
    }

    this.broadcastState();
    // Reconexion (F5): le devolvemos su tarea y, si ya termino, el resultado.
    this.sendYou(nickname);
    if (this.phase === "reveal" || this.phase === "over") {
      for (const view of this.chainViews()) this.room.emitTo(nickname, "tc:chain", view);
    }
    if (this.phase === "over") this.room.emitTo(nickname, "tc:gameover", this.gameoverPayload());
  }

  leave(_nickname: string): void {
    // No elimina al desconectar: si vuelve (recarga) se reengancha y recupera su tarea.
    // Solo refresca las luces de "conectado" y destraba la fase si el que faltaba se fue.
    if (this.phase === "over") return;
    this.broadcastState();
    this.maybeAdvance();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (!this.seats.includes(nickname)) return; // espectadores / ajenos no tocan el estado
    if (event === "tc:phrase") this.onPhrase(nickname, payload);
    else if (event === "tc:draw") this.onDraw(nickname, payload);
    else if (event === "tc:guess") this.onGuess(nickname, payload);
  }

  dispose(): void {
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.stopHints();
  }

  // ---------- Mensajes ----------

  private onPhrase(nickname: string, payload: unknown): void {
    if (this.phase !== "writing") return;
    const text = cleanText(
      payload && typeof payload === "object" ? (payload as { text?: unknown }).text : "",
      MAX_PHRASE_LEN,
    );
    if (text === "") return;
    const chain = this.chainOwnedBy(nickname);
    if (!chain) return;
    chain.phrase = text;
    chain.filled = false;
    this.broadcastState();
    this.maybeAdvance();
  }

  private onDraw(nickname: string, payload: unknown): void {
    if (this.phase !== "drawing") return;
    const raw =
      payload && typeof payload === "object" ? (payload as { image?: unknown }).image : null;
    if (typeof raw !== "string") return;
    if (!raw.startsWith("data:image/") || raw.length > MAX_IMAGE_CHARS) return;
    const chain = this.chains.find((c) => c.artist === nickname);
    if (!chain) return;
    chain.drawing = raw;
    this.broadcastState();
    this.maybeAdvance();
  }

  private onGuess(nickname: string, payload: unknown): void {
    if (this.phase !== "guessing") return;
    const text = cleanText(
      payload && typeof payload === "object" ? (payload as { text?: unknown }).text : "",
      MAX_GUESS_LEN,
    );
    if (text === "") return;
    const chain = this.chains.find((c) => c.guesser === nickname);
    if (!chain || chain.solved) return;

    chain.guess = text;
    if (normalize(text) !== normalize(chain.phrase)) {
      // Fallo: no penaliza, solo se le va el reloj. Se le reenvia su vista (el
      // ultimo intento) para que el cliente no tenga que adivinar el estado.
      this.sendYou(nickname);
      return;
    }

    chain.solved = true;
    const left = this.deadline !== null ? Math.max(0, this.deadline - Date.now()) : 0;
    const speed = this.phaseTotalMs > 0 ? Math.round((left / this.phaseTotalMs) * POINTS_SPEED_MAX) : 0;
    this.addPoints(nickname, POINTS_GUESS + speed);
    // El dibujante cobra por haber sido entendido.
    if (chain.artist) this.addPoints(chain.artist, POINTS_ARTIST);

    this.sendYou(nickname);
    this.broadcastState();
    this.maybeAdvance();
  }

  // ---------- Fases ----------

  private start(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.seats = this.roster.filter((n) => this.room.isConnected(n));
    if (this.seats.length === 0) return; // se reintenta al proximo join
    for (const n of this.seats) this.totals.set(n, 0);
    this.chains = this.seats.map((owner) => ({
      owner,
      phrase: "",
      filled: false,
      artist: null,
      drawing: null,
      guesser: null,
      guess: null,
      solved: false,
      revealed: new Set<number>(),
    }));
    this.toWriting();
  }

  private toWriting(): void {
    this.phase = "writing";
    this.setPhaseClock(WRITE_MS);
    this.armTimer(() => this.toDrawing());
    this.broadcastState();
    this.sendYouAll();
  }

  private toDrawing(): void {
    if (this.phase !== "writing") return;
    // Al que no escribio le ponemos una frase del banco: su cadena se juega igual.
    const pool = [...FALLBACK_PHRASES];
    for (const chain of this.chains) {
      if (chain.phrase !== "") continue;
      const i = pool.length > 0 ? Math.floor(Math.random() * pool.length) : -1;
      chain.phrase = i >= 0 ? pool.splice(i, 1)[0] : FALLBACK_PHRASES[0];
      chain.filled = true;
    }
    // Rotacion: el jugador `i` dibuja la frase del jugador anterior.
    const n = this.seats.length;
    for (let i = 0; i < n; i++) {
      this.chains[(i - 1 + n) % n].artist = this.seats[i];
    }

    this.phase = "drawing";
    this.setPhaseClock(DRAW_MS);
    this.armTimer(() => this.toGuessing());
    this.broadcastState();
    this.sendYouAll();
  }

  private toGuessing(): void {
    if (this.phase !== "drawing") return;
    this.assignGuessers();
    if (this.chains.every((c) => c.guesser === null)) {
      // Nadie llego a dibujar nada: no hay nada que adivinar.
      this.toReveal();
      return;
    }

    this.phase = "guessing";
    this.setPhaseClock(GUESS_MS);
    this.armTimer(() => this.toReveal());
    this.startHints();
    this.broadcastState();
    this.sendYouAll();
  }

  private toReveal(): void {
    if (this.phase !== "drawing" && this.phase !== "guessing") return;
    this.stopHints();
    this.phase = "reveal";
    const ms = Math.min(
      REVEAL_MAX_MS,
      REVEAL_BASE_MS + REVEAL_PER_CHAIN_MS * this.chains.length,
    );
    this.setPhaseClock(ms);
    this.armTimer(() => this.finish());
    this.broadcastState();
    // De a una: juntar todos los dibujos en un mensaje se acerca al tope de socket.io.
    for (const view of this.chainViews()) this.room.broadcast("tc:chain", view);
  }

  private finish(): void {
    this.phase = "over";
    this.deadline = null;
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    this.stopHints();
    this.broadcastState();
    this.room.broadcast("tc:gameover", this.gameoverPayload());
  }

  /**
   * Cierra la fase antes del deadline si ya entregaron todos los que siguen
   * conectados (no se espera a los ausentes, igual que el resto de las salas).
   */
  private maybeAdvance(): void {
    const live = this.seats.filter((n) => this.room.isConnected(n));
    if (live.length === 0) return; // sala vacia: que corte el deadline
    if (!live.every((n) => this.isDone(n))) return;

    if (this.phase === "writing") this.toDrawing();
    else if (this.phase === "drawing") this.toGuessing();
    else if (this.phase === "guessing") this.toReveal();
  }

  /** Ya entrego lo que pide la fase actual. */
  private isDone(nickname: string): boolean {
    if (this.phase === "writing") return this.chainOwnedBy(nickname)?.phrase !== "";
    if (this.phase === "drawing") {
      const chain = this.chains.find((c) => c.artist === nickname);
      return !chain || chain.drawing !== null;
    }
    if (this.phase === "guessing") {
      const chain = this.chains.find((c) => c.guesser === nickname);
      return !chain || chain.solved;
    }
    return false;
  }

  /**
   * Le asigna a cada jugador una cadena para adivinar, entre las que tienen dibujo.
   * Preferencia: la de dos asientos atras, que con 3+ jugadores no es ni su propia
   * frase ni su propio dibujo. Si esa no sirve (nadie la dibujo, ya esta tomada,
   * salas de 1-2), se gira hasta encontrar una libre.
   */
  private assignGuessers(): void {
    const n = this.seats.length;
    if (n === 0) return;
    const shift = n >= 3 ? 2 : 1;
    const taken = new Set<number>();

    for (let i = 0; i < n; i++) {
      const seat = this.seats[i];
      let picked = -1;
      for (let k = 0; k < n; k++) {
        const idx = (((i - shift - k) % n) + n) % n;
        const chain = this.chains[idx];
        if (taken.has(idx) || chain.drawing === null) continue;
        if (chain.owner === seat || chain.artist === seat) continue;
        picked = idx;
        break;
      }
      if (picked < 0) {
        // Fallback para salas chicas: cualquiera dibujada y libre, aunque sea propia.
        picked = this.chains.findIndex((c, idx) => !taken.has(idx) && c.drawing !== null);
      }
      if (picked < 0) continue;
      taken.add(picked);
      this.chains[picked].guesser = seat;
    }
  }

  // ---------- Pista tipo ahorcado ----------

  private startHints(): void {
    this.stopHints();
    this.hintTimer = setInterval(() => this.revealLetters(), HINT_EVERY_MS);
  }

  private stopHints(): void {
    if (this.hintTimer !== null) {
      clearInterval(this.hintTimer);
      this.hintTimer = null;
    }
  }

  /** Revela una letra al azar de cada cadena sin resolver, dejando algunas tapadas. */
  private revealLetters(): void {
    if (this.phase !== "guessing") return;
    for (const chain of this.chains) {
      if (chain.guesser === null || chain.solved) continue;
      const hidden: number[] = [];
      for (let i = 0; i < chain.phrase.length; i++) {
        if (chain.phrase[i] !== " " && !chain.revealed.has(i)) hidden.push(i);
      }
      if (hidden.length <= HINT_KEEP_HIDDEN) continue;
      chain.revealed.add(hidden[Math.floor(Math.random() * hidden.length)]);
      this.sendYou(chain.guesser);
    }
  }

  /** Frase con las letras no reveladas como "_" (los espacios se conservan). */
  private renderHint(chain: Chain): string {
    let out = "";
    for (let i = 0; i < chain.phrase.length; i++) {
      const ch = chain.phrase[i];
      if (ch === " ") out += " ";
      else out += chain.revealed.has(i) ? ch.toUpperCase() : "_";
    }
    return out;
  }

  // ---------- Envio ----------

  private sendYouAll(): void {
    for (const seat of this.seats) this.sendYou(seat);
  }

  private sendYou(nickname: string): void {
    if (!this.seats.includes(nickname)) return;
    const you: TcYou = {
      phase: this.phase,
      phrase: null,
      drawing: null,
      hint: null,
      submitted: null,
      solved: false,
    };

    if (this.phase === "writing") {
      const mine = this.chainOwnedBy(nickname);
      you.submitted = mine && mine.phrase !== "" ? mine.phrase : null;
    } else if (this.phase === "drawing") {
      const chain = this.chains.find((c) => c.artist === nickname);
      if (chain) {
        you.phrase = chain.phrase;
        you.submitted = chain.drawing;
      }
    } else if (this.phase === "guessing") {
      const chain = this.chains.find((c) => c.guesser === nickname);
      if (chain) {
        you.drawing = chain.drawing;
        you.hint = this.renderHint(chain);
        you.submitted = chain.guess;
        you.solved = chain.solved;
      }
    }

    this.room.emitTo(nickname, "tc:you", you);
  }

  private chainViews(): TcChainView[] {
    return this.chains.map((chain, index) => ({
      index,
      total: this.chains.length,
      author: chain.owner,
      phrase: chain.phrase,
      filled: chain.filled,
      artist: chain.artist,
      drawing: chain.drawing,
      guesser: chain.guesser,
      guess: chain.guess,
      solved: chain.solved,
    }));
  }

  // ---------- Helpers ----------

  private chainOwnedBy(nickname: string): Chain | undefined {
    return this.chains.find((c) => c.owner === nickname);
  }

  private addPoints(nickname: string, points: number): void {
    this.totals.set(nickname, (this.totals.get(nickname) ?? 0) + points);
  }

  private setPhaseClock(ms: number): void {
    this.phaseTotalMs = ms;
    this.deadline = Date.now() + ms;
  }

  private armTimer(fn: () => void): void {
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    const ms = this.deadline !== null ? this.deadline - Date.now() : 0;
    this.phaseTimer = setTimeout(fn, Math.max(0, ms));
  }

  private playerViews(): TcPlayerView[] {
    return this.seats.map((nickname) => ({
      nickname,
      connected: this.room.isConnected(nickname),
      done: this.isDone(nickname),
      total: this.totals.get(nickname) ?? 0,
    }));
  }

  private broadcastState(): void {
    const hasClock = this.deadline !== null && this.phase !== "waiting" && this.phase !== "over";
    const state: TcState = {
      phase: this.phase,
      deadline: hasClock ? this.deadline : null,
      clockMs: hasClock ? Math.max(0, this.deadline! - Date.now()) : null,
      clockTotalMs: hasClock ? this.phaseTotalMs : null,
      players: this.playerViews(),
      totalChains: this.phase === "reveal" || this.phase === "over" ? this.chains.length : null,
    };
    this.room.broadcast("tc:state", state);
  }

  private gameoverPayload(): TcGameover {
    const ranked = [...this.seats].sort(
      (a, b) => (this.totals.get(b) ?? 0) - (this.totals.get(a) ?? 0),
    );
    return {
      ranking: ranked.map((nickname, i) => ({
        nickname,
        place: i + 1,
        total: this.totals.get(nickname) ?? 0,
      })),
    };
  }
}

/** Engancha el juego en el namespace `/telefonocortado`. */
export function registerTelefonoCortado(io: Server): void {
  registerGame(io, "/telefonocortado", "tc:join", parseJoin, (room) => new TelefonoCortadoSim(room));
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
