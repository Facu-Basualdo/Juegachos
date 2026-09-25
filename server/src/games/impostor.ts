import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import { clueRevealsWord, isCorrectGuess, pickWord, sameClue } from "../words-impostor.js";
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
/**
 * Duracion de la votacion, que es tambien la discusion final de la mesa. Era de 30s y no
 * alcanzaba para discutir: la mitad del tiempo se iba en leer las pistas. Si votan todos
 * los presentes antes, se adelanta el cierre (`VOTE_GRACE_MS`).
 */
const VOTE_MS = 60000;
/** Tiempo del impostor descubierto para adivinar la palabra. */
const GUESS_MS = 20000;
/**
 * Gracia tras el ultimo voto antes de cerrar. Era de 1.2s y el adelanto no se notaba:
 * con 3s se alcanza a ver el conteo final (y a cambiar el voto) antes del resultado.
 */
const VOTE_GRACE_MS = 3000;
/** Cuanto se muestra el desenlace de la ronda antes de la proxima. */
const RESULT_MS = 9000;

/** Puntos que gana cada impostor cuando el equipo impostor gana la ronda. */
const IMPOSTOR_WIN_PTS = 3;
/** Puntos que gana cada inocente cuando descubren al impostor. */
const INNOCENT_WIN_PTS = 2;
/**
 * Extra para el inocente que voto a un impostor, gane o pierda su equipo. Sin esto el que
 * voto a ciegas cobraba lo mismo que el que lo descubrio, y los totales empataban mucho.
 */
const CORRECT_VOTE_BONUS = 1;

/**
 * Tope del turno (pista o adivinanza) cuando el jugador de turno se desconecta. Antes la
 * mesa esperaba los 37.5s enteros mirando "Turno de X" a alguien que ya no estaba.
 */
const ABSENT_TURN_MS = 5000;
/**
 * Minimo que recupera el jugador que vuelve (F5) en su propio turno: el recorte de
 * `ABSENT_TURN_MS` no puede dejarlo sin tiempo para escribir. No devuelve el turno entero,
 * asi recargar no sirve para ganar tiempo.
 */
const REJOIN_TURN_MS = 12000;

/** Largo maximo de una pista / adivinanza (defensa; el cliente ya acota). */
const MAX_WORD_LEN = 24;

/** Cuantos impostores segun cuantos jueguen: 2 con 7+, si no 1 (siempre >= 1 inocente). */
function impostorCount(seats: number): number {
  return seats >= 7 ? 2 : 1;
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
  /** Cuantas veces fue impostor cada jugador en el partido (reparto parejo del rol). */
  private readonly impostorTimes = new Map<string, number>();

  /** Orden de turnos de la ronda (barajado) y puntero al turno actual. */
  private turnOrder: string[] = [];
  private turnPos = 0;
  private clues: ImClue[] = [];

  /** Voto de cada jugador de la ronda (voter -> target). */
  private votes = new Map<string, string>();
  private accused: string | null = null;
  private guessText: string | null = null;
  private outcome: ImOutcome | null = null;

  /** Ya se le devolvio tiempo al de turno por reconectar (ver `REJOIN_TURN_MS`). */
  private rejoinGranted = false;

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

    if (this.isOnTheClock(nickname) && !this.rejoinGranted && this.remaining() < REJOIN_TURN_MS) {
      // Volvio en su turno despues del recorte de `leave`: que alcance a escribir. Una
      // sola vez por turno, o recargar en loop estiraria el turno para siempre.
      this.rejoinGranted = true;
      this.setPhaseClock(REJOIN_TURN_MS);
      this.armTimer(() => this.onTurnClockOut());
    }

    this.broadcastState();
    if (this.phase === "over") {
      this.room.emitTo(nickname, "im:gameover", this.gameoverPayload());
    } else if (this.phase !== "waiting" && this.seats.includes(nickname)) {
      // F5 en plena ronda: le devolvemos su rol privado (no viaja en im:state).
      this.sendRole(nickname);
    }
  }

  leave(nickname: string): void {
    // No elimina al desconectar: si vuelve se reengancha. Solo refresca las luces.
    // Pero si el que faltaba votar se fue, ya votaron todos los presentes: se adelanta.
    if (this.phase === "voting") this.maybeHurryVote();
    // Si era su turno (pista o adivinanza), la mesa no le espera el reloj entero.
    if (this.isOnTheClock(nickname) && this.remaining() > ABSENT_TURN_MS) {
      this.setPhaseClock(ABSENT_TURN_MS);
      this.armTimer(() => this.onTurnClockOut());
    }
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
    const reason = this.clueProblem(nickname, word);
    if (reason !== null) {
      // Rechazo dirigido: el turno sigue siendo suyo y el cliente le rehabilita el campo.
      this.room.emitTo(nickname, "im:reject", { reason });
      return;
    }
    this.clues.push({ player: nickname, word });
    this.advanceTurn();
  }

  /**
   * Por que no vale la pista, o null si vale.
   * - Repetida: copiar la pista de otro es la salida gratis del impostor (y de un inocente
   *   que no tiene ganas de pensar). Se rechaza con el nombre de quien ya la dio.
   * - Canta la palabra: un inocente que escribe la secreta le regala la ronda al impostor.
   *   Solo se chequea a los inocentes: rechazarsela al impostor le avisaria que la acerto.
   */
  private clueProblem(nickname: string, word: string): string | null {
    const dup = this.clues.find((c) => sameClue(c.word, word));
    if (dup) return `Esa pista ya la dio ${dup.player}. Pensa otra.`;
    if (!this.impostors.has(nickname) && this.word !== null && clueRevealsWord(word, this.word)) {
      return "Esa pista canta la palabra secreta. Pensa otra.";
    }
    return null;
  }

  private onVote(voter: string, payload: unknown): void {
    if (this.phase !== "voting") return;
    const target = String((payload as { target?: unknown })?.target ?? "");
    if (target === voter || !this.seats.includes(target)) return; // no te votas a vos mismo
    if (this.votes.get(voter) === target) this.votes.delete(voter); // toggle = destildar
    else this.votes.set(voter, target);
    this.maybeHurryVote();
    this.broadcastState();
  }

  /**
   * Adelanta el cierre si ya votaron todos los presentes (con una gracia corta para ver
   * el conteo). El reloj visible se reinicia a esa gracia, asi la barra lo muestra.
   */
  private maybeHurryVote(): void {
    if (this.phase !== "voting" || !this.everyPresentVoted()) return;
    if (this.deadline !== null && this.deadline - Date.now() <= VOTE_GRACE_MS) return;
    this.setPhaseClock(VOTE_GRACE_MS);
    this.armTimer(() => this.closeVoting());
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
    for (const n of this.seats) {
      this.totals.set(n, 0);
      this.impostorTimes.set(n, 0);
    }
    this.roundIndex = 0;
    this.startRound();
  }

  private startRound(): void {
    const picked = pickWord(this.usedWords, this.category);
    this.category = picked.category;
    this.word = picked.word;
    this.usedWords.add(picked.word);

    this.impostors = this.pickImpostors();
    for (const n of this.impostors) this.impostorTimes.set(n, (this.impostorTimes.get(n) ?? 0) + 1);
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
    this.rejoinGranted = false;
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
    this.rejoinGranted = false;
    // Si el acusado ya no esta, no tiene sentido esperarle los 20s de adivinanza.
    const accusedHere = this.accused !== null && this.room.isConnected(this.accused);
    this.setPhaseClock(accusedHere ? GUESS_MS : ABSENT_TURN_MS);
    this.armTimer(() => this.toResult());
    this.broadcastState();
  }

  private toResult(): void {
    if (this.phase === "result" || this.phase === "over") return;
    const correct =
      this.guessText !== null && this.word !== null && isCorrectGuess(this.guessText, this.word);
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
    // Ojo clinico: el inocente que voto a un impostor suma aparte, gane o pierda su equipo.
    const votedRight = new Set<string>();
    for (const [voter, target] of this.votes) {
      if (!this.impostors.has(voter) && this.impostors.has(target)) votedRight.add(voter);
    }
    for (const n of votedRight) roundPts.set(n, (roundPts.get(n) ?? 0) + CORRECT_VOTE_BONUS);
    for (const [n, pts] of roundPts) this.totals.set(n, (this.totals.get(n) ?? 0) + pts);

    this.outcome = {
      kind,
      guess: this.guessText,
      scores: this.seats.map((player) => ({
        player,
        points: roundPts.get(player) ?? 0,
        votedRight: votedRight.has(player),
      })),
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

  /**
   * Impostores de la ronda: sale entre los que MENOS veces lo fueron (desempate al azar).
   * Al azar puro, en un partido de 3 rondas uno podia ser impostor dos veces y otro
   * ninguna, y como el impostor que gana suma mas, el reparto decidia el partido.
   */
  private pickImpostors(): Set<string> {
    const times = (n: string) => this.impostorTimes.get(n) ?? 0;
    const order = shuffle(this.seats).sort((a, b) => times(a) - times(b));
    return new Set(order.slice(0, impostorCount(this.seats.length)));
  }

  /** Es `nickname` el que tiene el reloj de la fase (pista de su turno o adivinanza)? */
  private isOnTheClock(nickname: string): boolean {
    if (this.phase === "clues") return this.currentTurn() === nickname;
    if (this.phase === "guess") return this.accused === nickname;
    return false;
  }

  /** Vencio el reloj del jugador de turno (con o sin el recorte por desconexion). */
  private onTurnClockOut(): void {
    if (this.phase === "clues") this.onTurnTimeout();
    else if (this.phase === "guess") this.toResult();
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
    const total = (n: string) => this.totals.get(n) ?? 0;
    const ranked = [...this.seats].sort((a, b) => total(b) - total(a));
    // Puestos compartidos en el empate (1, 1, 3): con el puesto por indice, dos jugadores
    // con el mismo total se llevaban distinto puntaje de sala segun el orden del roster.
    return {
      ranking: ranked.map((nickname) => ({
        nickname,
        place: 1 + ranked.filter((n) => total(n) > total(nickname)).length,
        total: total(nickname),
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
