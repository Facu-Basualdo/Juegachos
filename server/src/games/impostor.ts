import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import { pickWord } from "../words-impostor.js";
import type {
  ImClue,
  ImOutcome,
  ImOutcomeKind,
  ImPhase,
  ImPlayerView,
  ImState,
  ImVoteView,
} from "../protocol.js";

/**
 * Impostor: deduccion social por palabra secreta. A todos menos al/los impostor/es se les
 * muestra en privado la misma palabra + categoria; el impostor solo ve la categoria. Por
 * turnos cada uno escribe UNA palabra-pista; todos las ven. Despues se vota quien es el
 * impostor: si el mas votado es impostor, tiene una chance de adivinar la palabra para robar
 * la ronda. Un partido son `ROUNDS_PER_MATCH` rondas; gana el de mas puntos.
 *
 * Server autoritativo como Basta: arbitra todas las fases con `setTimeout` propio (asi llega
 * a "over" aunque todos esten idle => NO declara roomTimeLimitSec) y NO usa el diccionario.
 * El rol viaja SOLO por el evento dirigido `im:you`, nunca en el broadcast `im:state`.
 */

/** Cuantas rondas dura un partido (= una ronda de sala). */
const ROUNDS_PER_MATCH = 3;
/** Cuantas vueltas de pistas por ronda (cada jugador da una pista por vuelta). */
const CLUE_LAPS = 1;
/** Espera desde el primer jugador para que se conecte el roster antes de arrancar. */
const START_GRACE_MS = 8000;
/** Cuanto se muestra el rol privado antes de arrancar las pistas. */
const REVEAL_MS = 6000;
/** Tope por turno para escribir la pista (al vencer, pista vacia y pasa al siguiente). */
const CLUE_TURN_MS = 37500;
/**
 * Pausa despues de la ultima pista, antes de abrir la votacion. Sin esto, el que escribia
 * ultimo mandaba su pista y la mesa saltaba de una a los sospechosos: nadie llegaba a leer
 * lo que habia escrito. La fase sigue siendo `clues` con `turn = null` (el cliente muestra
 * la lista completa y avisa que arranca la votacion).
 */
const CLUES_RECAP_MS = 3500;
/** Duracion de la votacion. */
const VOTE_MS = 30000;
/** Tiempo del impostor descubierto para adivinar la palabra. */
const GUESS_MS = 20000;
/** Gracia tras el ultimo voto antes de cerrar (para alcanzar a ver el resultado). */
const VOTE_GRACE_MS = 1200;
/** Cuanto se muestra el desenlace de la ronda antes de la proxima. */
const RESULT_MS = 9000;

/** Puntos que gana cada impostor cuando el equipo impostor gana la ronda. */
const IMPOSTOR_WIN_PTS = 3;
/** Puntos que gana cada inocente cuando descubren al impostor. */
const INNOCENT_WIN_PTS = 2;

/** Largo maximo de una pista / adivinanza (defensa; el cliente ya acota). */
const MAX_WORD_LEN = 24;

/** Cuantos impostores segun cuantos jueguen: 2 con 7+, si no 1 (siempre >= 1 inocente). */
function impostorCount(seats: number): number {
  return seats >= 7 ? 2 : 1;
}

/**
 * Normaliza para comparar la adivinanza contra la palabra secreta: minuscula, saca acentos,
 * conserva la ñ, colapsa espacios. Copiada a proposito (Impostor no depende del diccionario).
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

/** Recorta y limita una pista/adivinanza cruda del cliente (se muestra tal cual). */
function cleanWord(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim().slice(0, MAX_WORD_LEN);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class ImpostorSim implements RoomSim {
  private phase: ImPhase = "waiting";
  private roster: string[] = [];
  /** Jugadores del partido, fijados al arrancar. */
  private seats: string[] = [];
  private readonly totals = new Map<string, number>();

  private roundIndex = 0;
  private category: string | null = null;
  private word: string | null = null;
  private readonly usedWords = new Set<string>();
  private impostors = new Set<string>();

  /** Orden de turnos de la ronda (barajado) y puntero al turno actual. */
  private turnOrder: string[] = [];
  private turnPos = 0;
  private clues: ImClue[] = [];

  /** Voto de cada jugador de la ronda (voter -> target). */
  private votes = new Map<string, string>();
  private accused: string | null = null;
  private guessText: string | null = null;
  private outcome: ImOutcome | null = null;

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
    if (this.phase === "over") {
      this.room.emitTo(nickname, "im:gameover", this.gameoverPayload());
    } else if (this.phase !== "waiting" && this.seats.includes(nickname)) {
      // F5 en plena ronda: le devolvemos su rol privado (no viaja en im:state).
      this.sendRole(nickname);
    }
  }

  leave(_nickname: string): void {
    // No elimina al desconectar: si vuelve se reengancha. Solo refresca las luces.
    if (this.phase !== "over") this.broadcastState();
  }

  message(nickname: string, event: string, payload: unknown): void {
    if (!this.seats.includes(nickname)) return; // espectadores / ajenos no tocan el estado
    if (event === "im:clue") this.onClue(nickname, payload);
    else if (event === "im:vote") this.onVote(nickname, payload);
    else if (event === "im:guess") this.onGuess(nickname, payload);
  }

  dispose(): void {
    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    if (this.startTimer !== null) clearTimeout(this.startTimer);
  }

  // ---------- Mensajes ----------

  private onClue(nickname: string, payload: unknown): void {
    if (this.phase !== "clues") return;
    if (this.currentTurn() !== nickname) return;
    const word = cleanWord((payload as { word?: unknown })?.word);
    if (word === "") return; // pista vacia solo la mete el timeout
    this.clues.push({ player: nickname, word });
    this.advanceTurn();
  }

  private onVote(voter: string, payload: unknown): void {
    if (this.phase !== "voting") return;
    const target = String((payload as { target?: unknown })?.target ?? "");
    if (target === voter || !this.seats.includes(target)) return; // no te votas a vos mismo
    if (this.votes.get(voter) === target) this.votes.delete(voter); // toggle = destildar
    else this.votes.set(voter, target);
    // Adelanta el cierre si ya votaron todos los presentes (gracia corta para ver el ultimo).
    if (this.everyPresentVoted()) {
      this.deadline = Math.min(this.deadline ?? Date.now(), Date.now() + VOTE_GRACE_MS);
      this.armTimer(() => this.closeVoting());
    }
    this.broadcastState();
  }

  private onGuess(nickname: string, payload: unknown): void {
    if (this.phase !== "guess") return;
    if (nickname !== this.accused) return; // solo el impostor acusado adivina
    const guess = cleanWord((payload as { word?: unknown })?.word);
    if (guess === "") return;
    this.guessText = guess;
    this.toResult();
  }

  // ---------- Fases ----------

  private start(): void {
    if (this.phase !== "waiting") return;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.seats = this.roster.filter((n) => this.room.isConnected(n));
    if (this.seats.length < 2) return; // se reintenta al proximo join (min 2 para tener rol)
    for (const n of this.seats) this.totals.set(n, 0);
    this.roundIndex = 0;
    this.startRound();
  }

  private startRound(): void {
    const picked = pickWord(this.usedWords);
    this.category = picked.category;
    this.word = picked.word;
    this.usedWords.add(picked.word);

    // Reparte roles: impostores al azar entre los seats.
    this.impostors = new Set(shuffle(this.seats).slice(0, impostorCount(this.seats.length)));
    this.turnOrder = shuffle(this.seats);
    this.turnPos = 0;
    this.clues = [];
    this.votes = new Map();
    this.accused = null;
    this.guessText = null;
    this.outcome = null;

    this.phase = "reveal";
    this.setPhaseClock(REVEAL_MS);
    this.armTimer(() => this.toClues());
    for (const n of this.seats) this.sendRole(n);
    this.broadcastState();
  }

  private toClues(): void {
    if (this.phase !== "reveal") return;
    this.phase = "clues";
    this.startTurn();
  }

  private startTurn(): void {
    // Saltea turnos de jugadores desconectados (dejan pista vacia).
    while (this.turnPos < this.turnOrder.length * CLUE_LAPS) {
      const player = this.currentTurn();
      if (player && this.room.isConnected(player)) break;
      if (player) this.clues.push({ player, word: "" });
      this.turnPos += 1;
    }
    if (this.turnPos >= this.turnOrder.length * CLUE_LAPS) {
      this.endClues();
      return;
    }
    this.setPhaseClock(CLUE_TURN_MS);
    this.armTimer(() => this.onTurnTimeout());
    this.broadcastState();
  }

  private onTurnTimeout(): void {
    if (this.phase !== "clues") return;
    const player = this.currentTurn();
    if (player) this.clues.push({ player, word: "" }); // pista vacia por timeout
    this.advanceTurn();
  }

  private advanceTurn(): void {
    this.turnPos += 1;
    if (this.turnPos >= this.turnOrder.length * CLUE_LAPS) this.endClues();
    else this.startTurn();
  }

  /** Ultima pista dada: se queda en `clues` sin turno unos segundos para que se lea. */
  private endClues(): void {
    this.setPhaseClock(CLUES_RECAP_MS);
    this.armTimer(() => this.toVoting());
    this.broadcastState();
  }

  private toVoting(): void {
    if (this.phase !== "clues") return;
    this.phase = "voting";
    this.setPhaseClock(VOTE_MS);
    this.armTimer(() => this.closeVoting());
    this.broadcastState();
  }

  private closeVoting(): void {
    if (this.phase !== "voting") return;
    this.accused = this.mostVoted();
    if (this.accused && this.impostors.has(this.accused)) {
      this.toGuess(); // descubrieron a un impostor: chance de adivinar
    } else {
      this.resolve("impostor-survived"); // impostor zafo (o empate / voto errado)
    }
  }

  private toGuess(): void {
    this.phase = "guess";
    this.setPhaseClock(GUESS_MS);
    this.armTimer(() => this.toResult());
    this.broadcastState();
  }

  private toResult(): void {
    if (this.phase === "result" || this.phase === "over") return;
    const correct =
      this.guessText !== null &&
      this.word !== null &&
      normalize(this.guessText) === normalize(this.word);
    this.resolve(correct ? "impostor-guessed" : "impostor-caught");
  }

  /** Computa el desenlace, suma puntos y pasa a `result`. */
  private resolve(kind: ImOutcomeKind): void {
    const impostorsWin = kind === "impostor-survived" || kind === "impostor-guessed";
    const roundPts = new Map<string, number>();
    for (const n of this.seats) roundPts.set(n, 0);
    if (impostorsWin) {
      for (const n of this.impostors) roundPts.set(n, IMPOSTOR_WIN_PTS);
    } else {
      for (const n of this.seats) {
        if (!this.impostors.has(n)) roundPts.set(n, INNOCENT_WIN_PTS);
      }
    }
    for (const [n, pts] of roundPts) this.totals.set(n, (this.totals.get(n) ?? 0) + pts);

    this.outcome = {
      kind,
      guess: this.guessText,
      scores: this.seats.map((player) => ({ player, points: roundPts.get(player) ?? 0 })),
      winners: impostorsWin ? "impostores" : "inocentes",
    };
    this.phase = "result";
    this.setPhaseClock(RESULT_MS);
    this.armTimer(() => this.nextRoundOrFinish());
    this.broadcastState();
  }

  private nextRoundOrFinish(): void {
    this.roundIndex += 1;
    if (this.roundIndex >= ROUNDS_PER_MATCH) this.finish();
    else this.startRound();
  }

  private finish(): void {
    this.phase = "over";
    this.category = null;
    this.word = null;
    this.deadline = null;
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    this.broadcastState();
    this.room.broadcast("im:gameover", this.gameoverPayload());
  }

  // ---------- Helpers ----------

  private sendRole(nickname: string): void {
    const impostor = this.impostors.has(nickname);
    this.room.emitTo(nickname, "im:you", {
      round: this.roundIndex + 1,
      impostor,
      word: impostor ? null : this.word,
      category: this.category ?? "",
      mates: impostor ? [...this.impostors].filter((n) => n !== nickname) : [],
    });
  }

  private currentTurn(): string | null {
    if (this.turnOrder.length === 0) return null;
    // Agotados los turnos ya no hay de quien sea el turno: es la pausa de lectura
    // (`endClues`). Sin este corte el modulo daria la vuelta y volveria a marcar al primero.
    if (this.turnPos >= this.turnOrder.length * CLUE_LAPS) return null;
    return this.turnOrder[this.turnPos % this.turnOrder.length];
  }

  /** El mas votado, o null si empate o sin votos. */
  private mostVoted(): string | null {
    const tally = new Map<string, number>();
    for (const target of this.votes.values()) {
      tally.set(target, (tally.get(target) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    let tie = false;
    for (const [player, n] of tally) {
      if (n > bestN) {
        best = player;
        bestN = n;
        tie = false;
      } else if (n === bestN) {
        tie = true;
      }
    }
    return tie || bestN === 0 ? null : best;
  }

  private everyPresentVoted(): boolean {
    const present = this.seats.filter((n) => this.room.isConnected(n));
    return present.length > 0 && present.every((n) => this.votes.has(n));
  }

  private remaining(): number {
    return this.deadline !== null ? Math.max(0, this.deadline - Date.now()) : 0;
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

  private playerViews(): ImPlayerView[] {
    const cluedSet = new Set(this.clues.map((c) => c.player));
    return this.seats.map((nickname) => ({
      nickname,
      connected: this.room.isConnected(nickname),
      total: this.totals.get(nickname) ?? 0,
      clued: cluedSet.has(nickname),
      voted: this.votes.has(nickname),
    }));
  }

  private votesFor(phase: ImPhase): ImVoteView[] | null {
    if (phase !== "voting" && phase !== "result" && phase !== "guess") return null;
    const out: ImVoteView[] = [];
    for (const [voter, target] of this.votes) out.push({ voter, target });
    return out;
  }

  private broadcastState(): void {
    const hasClock = this.deadline !== null && this.phase !== "waiting" && this.phase !== "over";
    const clockMs = hasClock ? this.remaining() : null;
    const state: ImState = {
      phase: this.phase,
      round: this.roundIndex + 1,
      totalRounds: ROUNDS_PER_MATCH,
      category: this.category,
      deadline: hasClock ? this.deadline : null,
      clockMs,
      clockTotalMs: hasClock ? this.phaseTotalMs : null,
      players: this.playerViews(),
      turn: this.phase === "clues" ? this.currentTurn() : null,
      clues: this.clues,
      votes: this.votesFor(this.phase),
      impostors: this.phase === "result" ? [...this.impostors] : null,
      word: this.phase === "result" ? this.word : null,
      accused: this.phase === "guess" || this.phase === "result" ? this.accused : null,
      outcome: this.phase === "result" ? this.outcome : null,
    };
    this.room.broadcast("im:state", state);
  }

  private gameoverPayload() {
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

/** Engancha el juego en el namespace `/impostor`. */
export function registerImpostor(io: Server): void {
  registerGame(io, "/impostor", "im:join", parseJoin, (room) => new ImpostorSim(room));
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
