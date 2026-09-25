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
 * (fases + deadlines) y computa el puntaje. Todas las fases corren con `setTimeout`
 * propio, asi que la partida llega a "over" sola aunque todos esten idle.
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
const GUESS_MS = 60000;
/** El reveal escala con la cantidad de cadenas, con tope (hay que mirar los dibujos). */
const REVEAL_BASE_MS = 8000;
const REVEAL_PER_CHAIN_MS = 4000;
const REVEAL_MAX_MS = 40000;
/** Cada cuanto se revela una letra de la pista tipo ahorcado. */
const HINT_EVERY_MS = 10000;
/** Cuantas letras quedan siempre tapadas (si no, la pista regala la frase). */
const HINT_KEEP_HIDDEN = 3;
/**
 * Con menos jugadores que esto no hay fase de escritura: con dos, el unico que puede
 * adivinar una frase es el que la escribio (el otro la dibujo), asi que las frases
 * salen del banco del server y nadie las conoce salvo el que las dibuja.
 */
const MIN_PLAYERS_TO_WRITE = 3;

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
/** Puntos para el autor de la frase cuando su cadena llego entera (premia frases dibujables). */
const POINTS_AUTHOR = 50;

/**
 * Banco de frases: rellena al que no escribio la suya y abastece las partidas de 1-2
 * jugadores. Concretas y dibujables, en el registro de la sala.
 */
const PHRASE_BANK = [
  "Un gato tocando el piano",
  "Un astronauta comiendo pizza",
  "Un dinosaurio en monopatín",
  "Una vaca abducida por aliens",
  "Un pulpo manejando un colectivo",
  "Un robot paseando al perro",
  "Una tortuga con cohetes",
  "Un pingüino tomando mate",
  "Un perro en bicicleta",
  "Una jirafa con bufanda",
  "Un tiburón en la pileta",
  "Un fantasma haciendo un asado",
  "Un elefante en un ascensor",
  "Una bruja en moto",
  "Un pirata jugando al fútbol",
  "Un mono comiendo una banana",
  "Un caracol ganando una carrera",
  "Un oso durmiendo en una hamaca",
  "Un pájaro con anteojos",
  "Una sirena en el desierto",
  "Un vampiro yendo al dentista",
  "Un hombre de nieve en la playa",
  "Un cocodrilo con corbata",
  "Una araña tejiendo un pulóver",
  "Un rey sin corona",
  "Un superhéroe lavando los platos",
  "Una gallina en paracaídas",
  "Un chancho en el barro",
  "Un zombie haciendo gimnasia",
  "Un sapo con corona",
  "Un león peinándose",
  "Un payaso llorando",
  "Una nube lloviendo pizza",
  "Un volcán en erupción",
  "Un auto volador",
  "Un árbol con ojos",
  "Un caballo en un sillón",
  "Un conejo saliendo de una galera",
  "Una ballena en una pecera",
  "Un castillo de arena",
  "Un cohete llegando a la luna",
  "Un ratón comiendo queso",
  "Un mago sacando una paloma",
  "Un gaucho arriba de un caballo",
  "Una empanada gigante",
  "Un colectivo lleno de gente",
  "Un dragón soplando velitas",
  "Un semáforo enojado",
  "Una hormiga levantando una casa",
  "Un buzo encontrando un tesoro",
  "Un ninja en un supermercado",
  "Un cowboy montando un toro",
  "Una abuela haciendo skate",
  "Un bebé manejando un camión",
  "Un perro con paraguas",
  "Una pizza con piernas",
  "Un sol con anteojos de sol",
  "Un loro hablando por teléfono",
  "Un pez fuera del agua",
  "Un avión de papel",
  "Un helado derritiéndose",
  "Un tren en las nubes",
  "Un cactus abrazando a alguien",
  "Un gato arriba de un techo",
  "Un chef persiguiendo una gallina",
  "Un esqueleto bailando",
  "Un arco iris con lluvia",
  "Un faro en una tormenta",
  "Una tortuga ninja",
  "Un unicornio en el subte",
  "Un policía comiendo una dona",
  "Un tenista sin raqueta",
  "Un inodoro con alas",
  "Un murciélago colgado de una lámpara",
  "Un camello en la nieve",
  "Un hipopótamo en tutú",
  "Una calabaza con cara",
  "Un pingüino en la playa",
  "Un globo terráqueo con curitas",
  "Un auto lavándose solo",
];

/** Articulos que no hace falta acertar: "perro en bicicleta" vale por "Un perro en bicicleta". */
const ARTICLES = new Set(["un", "una", "unos", "unas", "el", "la", "los", "las"]);

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
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Forma compacta para comparar: normalizada, sin articulos y sin espacios. */
function compact(input: string): string {
  const words = normalize(input).split(" ").filter((w) => w !== "");
  const kept = words.filter((w) => !ARTICLES.has(w));
  // Una frase hecha solo de articulos ("la") no puede quedar vacia.
  return (kept.length > 0 ? kept : words).join("");
}

/** Distancia de edicion (Levenshtein) entre dos cadenas cortas. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Juzga una adivinanza. La comparacion exacta era injugable: una frase libre de 30
 * letras no se acierta caracter por caracter, y "perro en bicicleta" fallaba contra
 * "Un perro en bicicleta". Se ignoran articulos, espacios y acentos, y se toleran
 * errores de tipeo en proporcion al largo. "close" avisa que se esta cerca.
 */
function judgeGuess(guess: string, phrase: string): "hit" | "close" | "miss" {
  const g = compact(guess);
  const p = compact(phrase);
  if (g === "" || p === "") return "miss";
  const d = editDistance(g, p);
  const len = p.length;
  const tolerance = len <= 4 ? 0 : len <= 9 ? 1 : len <= 16 ? 2 : 3;
  if (d <= tolerance) return "hit";
  if (d <= Math.max(3, Math.ceil(len * 0.3))) return "close";
  return "miss";
}

/** Letras que la pista tapa (la puntuacion y los espacios se muestran tal cual). */
function isHideable(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function readText(payload: unknown, key: string, maxLen: number): string {
  if (!payload || typeof payload !== "object") return "";
  return cleanText((payload as Record<string, unknown>)[key], maxLen);
}

function readInt(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

interface Chain {
  /** Asiento al que pertenece la cadena (quien escribio la frase, salvo `filled`). */
  owner: string;
  phrase: string;
  /** True si la frase la puso el server (el jugador no llego, o no hubo fase de escritura). */
  filled: boolean;
  artist: string | null;
  drawing: string | null;
  guesser: string | null;
  guess: string | null;
  attempts: number;
  close: boolean;
  solved: boolean;
  /** Indices de letras ya reveladas en la pista. */
  revealed: Set<number>;
}

class TelefonoCortadoSim implements RoomSim {
  /** Ronda de la sala; el estado es de ESTA ronda y de ninguna otra. */
  private round = -1;
  private phase: TcPhase = "waiting";
  private roster: string[] = [];
  /** Jugadores de la partida, en el orden del roster (fijado al arrancar). */
  private seats: string[] = [];
  /** Una cadena por jugador: `chains[i].owner === seats[i]`. */
  private chains: Chain[] = [];
  private readonly totals = new Map<string, number>();
  /** Frases del banco que ya salieron en el partido (no se repiten). */
  private readonly usedPhrases = new Set<string>();
  /**
   * Quienes se anunciaron en ESTA ronda. `room.isConnected` no alcanza: la pagina de
   * la ronda anterior de un jugador puede seguir abierta (mirando los resultados) con
   * su socket en el mismo GameRoom, y contarlo como presente largaba la partida nueva
   * sin esperarlo.
   */
  private readonly joined = new Set<string>();

  private deadline: number | null = null;
  private phaseTotalMs = 0;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly room: GameRoom) {}

  // ---------- Ciclo de vida ----------

  join(nickname: string, roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;
    // Entre rondas la sala no siempre se vacia (los clientes navegan de una pagina a
    // la siguiente y no todos a la vez), asi que el GameRoom puede sobrevivir con la
    // partida anterior adentro, ya en "over". Si la sala vuelve a votar este juego,
    // sin esto el que entra recibiria el gameover viejo y reportaria ese puntaje.
    if (round > this.round) {
      this.round = round;
      this.reset();
    }
    if (round !== this.round) return; // pagina de una ronda vieja

    this.joined.add(nickname);
    if (roster.length > 0) this.roster = roster;

    if (this.phase === "waiting") {
      if (this.startTimer === null) {
        this.startTimer = setTimeout(() => this.start(), START_GRACE_MS);
      }
      if (this.roster.length > 0 && this.roster.every((n) => this.isLive(n))) {
        this.start();
      }
    } else if (this.phase === "writing" && !this.seats.includes(nickname) && this.roster.includes(nickname)) {
      // Llego tarde (su pagina tardo en pasar a "playing") pero todavia se escribe:
      // entra con su cadena. La rotacion se calcula recien al pasar a dibujo.
      this.addSeat(nickname);
    }

    // Reconexion (F5): le devolvemos su tarea y, si ya termino, el resultado.
    this.sendYou(nickname);
    this.broadcastState();
    if (this.phase === "reveal" || this.phase === "over") {
      for (const view of this.chainViews()) this.room.emitTo(nickname, "tc:chain", view);
    }
    if (this.phase === "over") this.room.emitTo(nickname, "tc:gameover", this.gameoverPayload());
  }

  leave(nickname: string): void {
    // No elimina al desconectar: si vuelve (recarga) se reengancha y recupera su tarea.
    // Solo refresca las luces de "conectado" y destraba la fase si el que faltaba se fue.
    this.joined.delete(nickname);
    if (this.phase === "over" || this.phase === "waiting") return;
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
    this.clearTimers();
  }

  private reset(): void {
    this.clearTimers();
    this.phase = "waiting";
    this.seats = [];
    this.chains = [];
    this.totals.clear();
    this.usedPhrases.clear();
    this.joined.clear();
    this.deadline = null;
    this.phaseTotalMs = 0;
  }

  private clearTimers(): void {
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.phaseTimer = null;
    this.startTimer = null;
    this.stopHints();
  }

  // ---------- Mensajes ----------

  private onPhrase(nickname: string, payload: unknown): void {
    if (this.phase !== "writing") return;
    const text = readText(payload, "text", MAX_PHRASE_LEN);
    // Una frase sin ninguna letra no se puede dibujar ni adivinar.
    if (compact(text) === "") return;
    const chain = this.chainOwnedBy(nickname);
    if (!chain) return;
    chain.phrase = text;
    chain.filled = false;
    this.sendYou(nickname);
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
    this.sendYou(nickname);
    this.broadcastState();
    this.maybeAdvance();
  }

  private onGuess(nickname: string, payload: unknown): void {
    if (this.phase !== "guessing") return;
    const text = readText(payload, "text", MAX_GUESS_LEN);
    if (text === "") return;
    const chain = this.chains.find((c) => c.guesser === nickname);
    if (!chain || chain.solved) return;

    chain.guess = text;
    chain.attempts += 1;
    const verdict = judgeGuess(text, chain.phrase);
    if (verdict !== "hit") {
      // Fallo: no penaliza, solo se le va el reloj. Se le reenvia su vista (con
      // `attempts` y `close`) para que el cliente no tenga que adivinar el estado.
      chain.close = verdict === "close";
      this.sendYou(nickname);
      return;
    }

    chain.solved = true;
    chain.close = false;
    const left = this.deadline !== null ? Math.max(0, this.deadline - Date.now()) : 0;
    const speed = this.phaseTotalMs > 0 ? Math.round((left / this.phaseTotalMs) * POINTS_SPEED_MAX) : 0;
    this.addPoints(nickname, POINTS_GUESS + speed);
    // El dibujante cobra por haber sido entendido, y el autor por haber escrito algo
    // que se pudo dibujar (no si la frase la puso el server).
    if (chain.artist) this.addPoints(chain.artist, POINTS_ARTIST);
    if (!chain.filled) this.addPoints(chain.owner, POINTS_AUTHOR);

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
    const seats = this.roster.filter((n) => this.isLive(n));
    if (seats.length === 0) return; // se reintenta al proximo join
    for (const n of seats) this.addSeat(n);

    if (this.seats.length >= MIN_PLAYERS_TO_WRITE) this.toWriting();
    else this.toDrawing();
  }

  private addSeat(nickname: string): void {
    this.seats.push(nickname);
    this.totals.set(nickname, 0);
    this.chains.push({
      owner: nickname,
      phrase: "",
      filled: false,
      artist: null,
      drawing: null,
      guesser: null,
      guess: null,
      attempts: 0,
      close: false,
      solved: false,
      revealed: new Set<number>(),
    });
  }

  private toWriting(): void {
    this.phase = "writing";
    this.setPhaseClock(WRITE_MS);
    this.armTimer(() => this.toDrawing());
    this.announce();
  }

  private toDrawing(): void {
    if (this.phase !== "waiting" && this.phase !== "writing") return;
    const wrote = this.phase === "writing";
    // Al que no escribio (o a todos, si no hubo fase de escritura) le ponemos una
    // frase del banco: su cadena se juega igual.
    for (const chain of this.chains) {
      if (chain.phrase !== "") continue;
      chain.phrase = this.pickBankPhrase();
      chain.filled = true;
    }
    const n = this.seats.length;
    for (let i = 0; i < n; i++) {
      // Con escritura, el jugador `i` dibuja la frase del anterior. Sin escritura la
      // frase es del banco y nadie la conoce: cada uno dibuja la de su propia cadena.
      const idx = wrote ? (i - 1 + n) % n : i;
      this.chains[idx].artist = this.seats[i];
    }

    this.phase = "drawing";
    this.setPhaseClock(DRAW_MS);
    this.armTimer(() => this.toGuessing());
    this.announce();
  }

  private toGuessing(): void {
    if (this.phase !== "drawing") return;
    this.assignGuessers();
    if (this.chains.every((c) => c.guesser === null)) {
      // Nadie llego a dibujar nada (o no hay a quien darle un dibujo): al reveal.
      this.toReveal();
      return;
    }

    this.phase = "guessing";
    this.setPhaseClock(GUESS_MS);
    this.armTimer(() => this.toReveal());
    this.startHints();
    this.announce();
  }

  private toReveal(): void {
    if (this.phase !== "drawing" && this.phase !== "guessing") return;
    this.stopHints();
    this.phase = "reveal";
    const ms = Math.min(REVEAL_MAX_MS, REVEAL_BASE_MS + REVEAL_PER_CHAIN_MS * this.chains.length);
    this.setPhaseClock(ms);
    this.armTimer(() => this.finish());
    this.broadcastState();
    // De a una: juntar todos los dibujos en un mensaje se acerca al tope de socket.io.
    for (const view of this.chainViews()) this.room.broadcast("tc:chain", view);
  }

  private finish(): void {
    this.phase = "over";
    this.deadline = null;
    this.clearTimers();
    this.broadcastState();
    this.room.broadcast("tc:gameover", this.gameoverPayload());
  }

  /**
   * Anuncia una fase nueva. La tarea (`tc:you`) sale ANTES que el `tc:state`: al
   * reves, el cliente pinta la fase nueva con la tarea de la anterior (p.ej. la frase
   * que acaba de escribir como si fuera el dibujo "ya enviado") hasta que llega la suya.
   */
  private announce(): void {
    this.sendYouAll();
    this.broadcastState();
  }

  /**
   * Cierra la fase antes del deadline si ya entregaron todos los que siguen
   * conectados (no se espera a los ausentes, igual que el resto de las salas).
   */
  private maybeAdvance(): void {
    const live = this.seats.filter((n) => this.isLive(n));
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

  /** Quien ya conoce la frase de la cadena y por lo tanto no puede adivinarla. */
  private knowsPhrase(nickname: string, chain: Chain): boolean {
    return chain.artist === nickname || (chain.owner === nickname && !chain.filled);
  }

  /**
   * Le asigna a cada jugador una cadena para adivinar, entre las que tienen dibujo y
   * cuya frase no conoce (ni la escribio ni la dibujo). Preferencia: la de dos
   * asientos atras con escritura (con 3+ jugadores no es ni su frase ni su dibujo) o
   * la del siguiente sin ella (con 2, la del otro). Si esa no sirve (nadie la dibujo,
   * ya esta tomada) se gira hasta encontrar una libre; si no hay, le toca mirar.
   *
   * No hay fallback a "cualquiera libre": antes existia para salas chicas y con dos
   * jugadores le daba a cada uno SU PROPIA frase para adivinar.
   */
  private assignGuessers(): void {
    const n = this.seats.length;
    if (n === 0) return;
    const wrote = this.chains.some((c) => !c.filled);
    const shift = wrote ? 2 : 1;
    const taken = new Set<number>();

    for (let i = 0; i < n; i++) {
      const seat = this.seats[i];
      for (let k = 0; k < n; k++) {
        const idx = (((i - shift - k) % n) + n) % n;
        const chain = this.chains[idx];
        if (taken.has(idx) || chain.drawing === null || this.knowsPhrase(seat, chain)) continue;
        taken.add(idx);
        chain.guesser = seat;
        break;
      }
    }
  }

  private pickBankPhrase(): string {
    let pool = PHRASE_BANK.filter((p) => !this.usedPhrases.has(p));
    if (pool.length === 0) pool = PHRASE_BANK;
    const phrase = pool[Math.floor(Math.random() * pool.length)];
    this.usedPhrases.add(phrase);
    return phrase;
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
        if (isHideable(chain.phrase[i]) && !chain.revealed.has(i)) hidden.push(i);
      }
      if (hidden.length <= HINT_KEEP_HIDDEN) continue;
      chain.revealed.add(hidden[Math.floor(Math.random() * hidden.length)]);
      this.sendYou(chain.guesser);
    }
  }

  /** Frase con las letras no reveladas como "_" (espacios y puntuacion se conservan). */
  private renderHint(chain: Chain): string {
    let out = "";
    for (let i = 0; i < chain.phrase.length; i++) {
      const ch = chain.phrase[i];
      if (!isHideable(ch)) out += ch;
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
      attempts: 0,
      close: false,
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
        you.attempts = chain.attempts;
        you.close = chain.close;
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

  /** Conectado Y anunciado en esta ronda (ver `joined`). */
  private isLive(nickname: string): boolean {
    return this.joined.has(nickname) && this.room.isConnected(nickname);
  }

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
      connected: this.isLive(nickname),
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

  /** Ranking por puntaje con empates compartidos (1, 1, 3): el orden de asiento no desempata. */
  private gameoverPayload(): TcGameover {
    const ranked = [...this.seats].sort(
      (a, b) => (this.totals.get(b) ?? 0) - (this.totals.get(a) ?? 0),
    );
    let place = 0;
    let prevTotal: number | null = null;
    return {
      ranking: ranked.map((nickname, i) => {
        const total = this.totals.get(nickname) ?? 0;
        if (total !== prevTotal) {
          place = i + 1;
          prevTotal = total;
        }
        return { nickname, place, total };
      }),
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
