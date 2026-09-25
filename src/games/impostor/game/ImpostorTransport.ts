/**
 * Contrato de transporte con el game server (namespace `/impostor`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay que
 * tocar los dos lados.
 */

export type ImPhase =
  | "waiting"
  | "reveal"
  | "clues"
  | "voting"
  | "guess"
  | "result"
  | "over";

export interface ImPlayerView {
  nickname: string;
  connected: boolean;
  total: number;
  clued: boolean;
  voted: boolean;
}

export interface ImClue {
  player: string;
  word: string;
}

export interface ImVoteView {
  voter: string;
  target: string;
}

export type ImOutcomeKind = "impostor-survived" | "impostor-guessed" | "impostor-caught";

export interface ImOutcome {
  kind: ImOutcomeKind;
  guess: string | null;
  /** `votedRight`: inocente que voto a un impostor (su bonus ya esta en `points`). */
  scores: { player: string; points: number; votedRight: boolean }[];
  winners: "impostores" | "inocentes";
}

export interface ImState {
  phase: ImPhase;
  round: number;
  totalRounds: number;
  category: string | null;
  deadline: number | null;
  /** Ms restantes de la fase al broadcast; se anclan a performance.now() para animar
   *  el reloj sin drift. Ver server/src/protocol.ts. */
  clockMs: number | null;
  clockTotalMs: number | null;
  players: ImPlayerView[];
  turn: string | null;
  clues: ImClue[];
  votes: ImVoteView[] | null;
  impostors: string[] | null;
  word: string | null;
  accused: string | null;
  outcome: ImOutcome | null;
}

export interface ImYou {
  round: number;
  impostor: boolean;
  word: string | null;
  category: string;
  mates: string[];
}

export interface ImGameover {
  /** `place` compartido en los empates (1, 1, 3). */
  ranking: { nickname: string; place: number; total: number }[];
}

/** La pista no se acepto (repetida o canta la palabra); el turno sigue siendo tuyo. */
export interface ImReject {
  reason: string;
}

export interface ImpostorTransport {
  onState(cb: (state: ImState) => void): void;
  /** Dirigido: el rol privado del jugador (palabra o impostor). No viaja en im:state. */
  onYou(cb: (you: ImYou) => void): void;
  onGameover(cb: (result: ImGameover) => void): void;
  /** Dirigido: la pista propia fue rechazada. */
  onReject(cb: (msg: ImReject) => void): void;
  sendClue(word: string): void;
  sendVote(target: string): void;
  sendGuess(word: string): void;
  dispose(): void;
}
