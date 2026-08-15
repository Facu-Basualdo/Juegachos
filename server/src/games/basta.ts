import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type {
  BtCategoryId,
  BtCell,
  BtGameover,
  BtPhase,
  BtPlayerView,
  BtState,
  BtVote,
} from "../protocol.js";

/**
 * Basta / Tutti Frutti: se sortea una LETRA y cada jugador llena 7 categorias con
 * palabras que empiecen con ella. El primero que completa las 7 grita BASTA y corta
 * a los demas (gracia corta). Despues las respuestas se validan por VOTACION: cada
 * jugador puede tachar como invalidas las ajenas y la mayoria las tumba. Un partido
 * son `LETTERS_PER_MATCH` letras; gana el de mas puntos.
 *
 * A diferencia de Bomba/Cadena, el server NO consulta el diccionario: solo arbitra el
 * flujo (fases + deadlines), guarda las respuestas y computa el puntaje. El deadline de
 * ronda de Supabase existe como corte duro, pero el server arbitra todas sus fases con
 * `setTimeout`, asi que la partida llega a "over" sola aunque todos esten idle.
 */

/** Ids de las 7 categorias (deben coincidir con `CATEGORIES` del cliente). */
const CATEGORIES: BtCategoryId[] = [
  "nombre",
  "apellido",
  "lugar",
  "color",
  "comida",
  "animal",
  "cosa",
];

/** Letras que se sortean como reto. Se dejan afuera las tramposas (K W X Y Z Ñ Q). */
const LETTERS = "ABCDEFGHIJLMNOPRSTUV".split("");

/** Cuantas letras dura un partido (= una ronda de sala). */
const LETTERS_PER_MATCH = 3;
/** Espera desde el primer jugador para que se conecten los del roster antes de arrancar. */
const START_GRACE_MS = 8000;
/** Tope de la fase de llenado si NADIE grita BASTA (corta igual y va a votacion). */
const FILL_MAX_MS = 120000;
/** Al gritar BASTA, cuanto tienen los demas para cerrar su hoja. */
const BASTA_GRACE_MS = 5000;
/**
 * Tope de la fase de votacion. Es solo un tope: la votacion se cierra apenas
 * confirmaron todos los jugadores conectados. Es mas largo que cuando cada tachado
 * contaba solo (25s) porque ahora hay que revisar la grilla entera y ademas apretar
 * "Listo": el que no confirma a tiempo pierde TODOS sus tachados.
 */
const VOTE_MS = 35000;
/** Cuanto se muestra el desglose de puntaje antes de la proxima letra. */
const REVEAL_MS = 8000;
/** Bonus para el que grita BASTA (dejado en 0; subir para premiar cortar). */
const BASTA_BONUS = 0;
/** Largo maximo de una respuesta (defensa; el cliente ya acota). */
const MAX_ANSWER_LEN = 40;

const POINTS_UNIQUE = 100;
const POINTS_REPEATED = 50;

/**
 * Normaliza para comparar unicidad: minuscula, saca acentos de vocales y dieresis,
 * conserva la ñ, colapsa espacios y descarta lo que no sea [a-zñ ]. Copiada a
 * proposito (no se importa `dictionary.ts`: Basta no depende del diccionario).
 */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[́̈]/g, "")
    .normalize("NFC")
    .replace(/[^a-zñ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recorta y limita una respuesta cruda del cliente (no la normaliza: se muestra tal cual). */
function cleanAnswer(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_LEN);
}

type Answers = Partial<Record<BtCategoryId, string>>;

class BastaSim implements RoomSim {
  private phase: BtPhase = "waiting";
  private roster: string[] = [];
  /** Jugadores de la partida, en el orden del roster (fijado al arrancar). */
  private seats: string[] = [];
  private letterIndex = 0;
  private letter: string | null = null;
  private readonly usedLetters = new Set<string>();
  /** Respuestas por jugador de la letra actual (se resetea por letra). */
  private answers = new Map<string, Answers>();
  /** Votos de rechazo de la letra actual: clave `${target}|${category}` -> set de votantes. */
  private votes = new Map<string, Set<string>>();
  /** Quienes ya confirmaron su hoja de tachados en la letra actual (se resetea por letra). */
  private submittedVotes = new Set<string>();
  private bastaBy: string | null = null;
  private readonly totals = new Map<string, number>();
  /** Desglose puntuado de la letra actual (se arma en el reveal). */
  private revealCells: BtCell[] | null = null;
  private letterScores: { player: string; points: number }[] | null = null;

  private deadline: number | null = null;
  private phaseTotalMs = 0;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.phase === "over") this.room.emitTo(nickname, "bt:gameover", this.gameoverPayload());
    // F5 durante el llenado: le devolvemos su hoja (el state en filling no revela texto).
    if ((this.phase === "filling" || this.phase === "grace") && this.answers.has(nickname)) {
      this.room.emitTo(nickname, "bt:you", { answers: this.answers.get(nickname) ?? {} });
    }
  }

  leave(_nickname: string): void {
    // No elimina al desconectar: si vuelve (recarga) se reengancha y recupera su hoja
    // del server. Solo refresca las luces de "conectado".
    if (this.phase !== "over") this.broadcastState();
    // El que se fue puede ser justo el que faltaba votar: sin esto la fase espera el
    // tope entero por alguien que ya no esta.
    this.maybeCloseVoting();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (!this.seats.includes(nickname)) return; // espectadores / ajenos no tocan el estado
    if (event === "bt:fill") this.onFill(nickname, payload);
    else if (event === "bt:basta") this.onBasta(nickname);
    else if (event === "bt:vote") this.onVote(nickname, payload);
  }

  dispose(): void {
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
  }

  // ---------- Mensajes ----------

  private onFill(nickname: string, payload: unknown): void {
    if (this.phase !== "filling" && this.phase !== "grace") return;
    const raw =
      payload && typeof payload === "object" && "answers" in payload
        ? (payload as { answers: unknown }).answers
        : null;
    if (!raw || typeof raw !== "object") return;
    const cleaned: Answers = {};
    for (const cat of CATEGORIES) {
      cleaned[cat] = cleanAnswer((raw as Record<string, unknown>)[cat]);
    }
    const before = this.filledCount(nickname);
    this.answers.set(nickname, cleaned);
    // Solo se re-difunde si cambio el conteo de alguien (evita spam de broadcasts).
    if (this.filledCount(nickname) !== before) this.broadcastState();
  }

  private onBasta(nickname: string): void {
    if (this.phase !== "filling") return;
    if (this.filledCount(nickname) < CATEGORIES.length) return; // exige las 7 llenas
    this.bastaBy = nickname;
    this.phase = "grace";
    this.setPhaseClock(BASTA_GRACE_MS);
    this.armTimer(() => this.toVoting());
    this.broadcastState();
  }

  /**
   * Hoja de tachados completa del votante, mandada al confirmar. Se acepta UNA vez
   * por letra (los reenvios se ignoran: ya quedo registrado y no se puede recular),
   * y al entrarla se chequea si con esta ya votaron todos los conectados para cerrar
   * la votacion sin esperar el tope.
   */
  private onVote(voter: string, payload: unknown): void {
    if (this.phase !== "voting") return;
    if (this.submittedVotes.has(voter)) return;
    const raw =
      payload && typeof payload === "object" && "rejects" in payload
        ? (payload as { rejects: unknown }).rejects
        : null;
    if (!Array.isArray(raw)) return;

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const target = typeof entry.target === "string" ? entry.target : "";
      const category = entry.category as BtCategoryId;
      if (!category || !CATEGORIES.includes(category)) continue;
      if (target === voter || !this.seats.includes(target)) continue; // no te votas a vos mismo
      const key = `${target}|${category}`;
      let set = this.votes.get(key);
      if (!set) {
        set = new Set();
        this.votes.set(key, set);
      }
      set.add(voter);
    }

    this.submittedVotes.add(voter);
    this.broadcastState();
    this.maybeCloseVoting();
  }

  /**
   * Cierra la votacion apenas confirmaron todos los jugadores CONECTADOS (a los
   * ausentes no se los espera: si no, un desconectado clava la fase hasta el tope).
   */
  private maybeCloseVoting(): void {
    if (this.phase !== "voting") return;
    const present = this.seats.filter((n) => this.room.isConnected(n));
    if (present.length === 0) return; // sin nadie a quien esperar, corta el tope
    if (present.every((n) => this.submittedVotes.has(n))) this.toReveal();
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
    this.letterIndex = 0;
    this.startLetter();
  }

  private startLetter(): void {
    this.answers = new Map();
    this.votes = new Map();
    this.submittedVotes.clear();
    this.bastaBy = null;
    this.revealCells = null;
    this.letterScores = null;
    this.letter = this.pickLetter();
    this.usedLetters.add(this.letter);
    this.phase = "filling";
    this.setPhaseClock(FILL_MAX_MS);
    this.armTimer(() => this.toVoting());
    this.broadcastState();
  }

  private toVoting(): void {
    if (this.phase !== "filling" && this.phase !== "grace") return;
    this.phase = "voting";
    this.setPhaseClock(VOTE_MS);
    this.armTimer(() => this.toReveal());
    this.broadcastState();
  }

  private toReveal(): void {
    if (this.phase !== "voting") return;
    this.scoreLetter();
    this.phase = "reveal";
    this.setPhaseClock(REVEAL_MS);
    this.armTimer(() => this.nextLetterOrFinish());
    this.broadcastState();
  }

  private nextLetterOrFinish(): void {
    this.letterIndex += 1;
    if (this.letterIndex >= LETTERS_PER_MATCH) this.finish();
    else this.startLetter();
  }

  private finish(): void {
    this.phase = "over";
    this.letter = null;
    this.deadline = null;
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    this.broadcastState();
    this.room.broadcast("bt:gameover", this.gameoverPayload());
  }

  // ---------- Puntaje ----------

  /**
   * Computa el puntaje de la letra actual y lo suma a los totales. Por categoria:
   * las respuestas no vacias y NO tumbadas por votacion se agrupan por texto
   * normalizado — unica = 100, repetida (2+ jugadores) = 50; vacia o tumbada = 0.
   */
  private scoreLetter(): void {
    const cells: BtCell[] = [];
    const letterPts = new Map<string, number>();
    for (const n of this.seats) letterPts.set(n, 0);

    for (const cat of CATEGORIES) {
      // Agrupa las respuestas validas (no vacias, no tumbadas) por su forma normalizada.
      const groups = new Map<string, string[]>(); // normalized -> jugadores
      const status = new Map<string, "unique" | "repeated" | "rejected" | "empty">();
      for (const player of this.seats) {
        const text = this.answers.get(player)?.[cat] ?? "";
        if (text.trim() === "") {
          status.set(player, "empty");
          continue;
        }
        if (this.isRejected(player, cat)) {
          status.set(player, "rejected");
          continue;
        }
        const norm = normalize(text);
        const arr = groups.get(norm) ?? [];
        arr.push(player);
        groups.set(norm, arr);
      }
      for (const players of groups.values()) {
        const repeated = players.length > 1;
        for (const player of players) status.set(player, repeated ? "repeated" : "unique");
      }
      for (const player of this.seats) {
        const st = status.get(player) ?? "empty";
        const points = st === "unique" ? POINTS_UNIQUE : st === "repeated" ? POINTS_REPEATED : 0;
        letterPts.set(player, (letterPts.get(player) ?? 0) + points);
        cells.push({
          player,
          category: cat,
          text: this.answers.get(player)?.[cat] ?? "",
          status: st,
          points,
        });
      }
    }

    // Bonus por gritar BASTA (0 por defecto).
    if (this.bastaBy && BASTA_BONUS > 0) {
      letterPts.set(this.bastaBy, (letterPts.get(this.bastaBy) ?? 0) + BASTA_BONUS);
    }

    for (const [player, pts] of letterPts) {
      this.totals.set(player, (this.totals.get(player) ?? 0) + pts);
    }
    this.revealCells = cells;
    this.letterScores = this.seats.map((player) => ({ player, points: letterPts.get(player) ?? 0 }));
  }

  /** Una respuesta se tumba si mas de la mitad de los demas jugadores la tacho (empate = no). */
  private isRejected(player: string, cat: BtCategoryId): boolean {
    const rejects = this.votes.get(`${player}|${cat}`)?.size ?? 0;
    const eligible = this.seats.length - 1; // todos menos el dueño
    return eligible > 0 && rejects * 2 > eligible;
  }

  // ---------- Helpers ----------

  private pickLetter(): string {
    const pool = LETTERS.filter((l) => !this.usedLetters.has(l));
    const from = pool.length > 0 ? pool : LETTERS;
    return from[Math.floor(Math.random() * from.length)];
  }

  private filledCount(nickname: string): number {
    const a = this.answers.get(nickname);
    if (!a) return 0;
    return CATEGORIES.reduce((n, cat) => n + ((a[cat] ?? "").trim() !== "" ? 1 : 0), 0);
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

  private playerViews(): BtPlayerView[] {
    return this.seats.map((nickname) => ({
      nickname,
      connected: this.room.isConnected(nickname),
      filledCount: this.filledCount(nickname),
      total: this.totals.get(nickname) ?? 0,
      voted: this.submittedVotes.has(nickname),
    }));
  }

  /** Celdas reveladas para voting (sin status/points) o reveal (con). */
  private cellsFor(phase: BtPhase): BtCell[] | null {
    if (phase === "reveal") return this.revealCells;
    if (phase !== "voting") return null;
    const cells: BtCell[] = [];
    for (const cat of CATEGORIES) {
      for (const player of this.seats) {
        cells.push({
          player,
          category: cat,
          text: this.answers.get(player)?.[cat] ?? "",
          status: null,
          points: null,
        });
      }
    }
    return cells;
  }

  /**
   * Los votos se difunden recien en el REVEAL. Durante la votacion se guardan pero no
   * se muestran: cada uno tacha a ciegas y lo unico publico es el `voted` de la vista
   * de jugador (asi el conteo ajeno no arrastra a la mesa).
   */
  private votesFor(phase: BtPhase): BtVote[] | null {
    if (phase !== "reveal") return null;
    const out: BtVote[] = [];
    for (const [key, voters] of this.votes) {
      const [target, category] = key.split("|") as [string, BtCategoryId];
      for (const voter of voters) out.push({ voter, target, category });
    }
    return out;
  }

  private broadcastState(): void {
    const clockMs = this.deadline !== null ? Math.max(0, this.deadline - Date.now()) : null;
    const hasClock = this.deadline !== null && this.phase !== "waiting" && this.phase !== "over";
    const state: BtState = {
      phase: this.phase,
      letter: this.letter,
      letterIndex: this.letterIndex,
      totalLetters: LETTERS_PER_MATCH,
      deadline: hasClock ? this.deadline : null,
      clockMs: hasClock ? clockMs : null,
      clockTotalMs: hasClock ? this.phaseTotalMs : null,
      players: this.playerViews(),
      bastaBy: this.bastaBy,
      cells: this.cellsFor(this.phase),
      votes: this.votesFor(this.phase),
      letterScores: this.phase === "reveal" ? this.letterScores : null,
    };
    this.room.broadcast("bt:state", state);
  }

  private gameoverPayload(): BtGameover {
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

/** Engancha el juego en el namespace `/basta`. */
export function registerBasta(io: Server): void {
  registerGame(io, "/basta", "bt:join", parseJoin, (room) => new BastaSim(room));
}

/** Roster + nickname del mensaje de join. */
function parseJoin(payload: unknown): { nickname: string; roster: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nickname = typeof p.nickname === "string" ? p.nickname : null;
  if (!nickname) return null;
  const roster = Array.isArray(p.roster) ? p.roster.filter((x): x is string => typeof x === "string") : [];
  return { nickname, roster };
}
