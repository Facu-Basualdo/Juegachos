/**
 * Contrato de transporte con el game server (namespace `/basta`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay
 * que tocar los dos lados.
 */

export type BtCategoryId =
  | "nombre"
  | "apellido"
  | "lugar"
  | "color"
  | "comida"
  | "animal"
  | "cosa";

export type BtPhase = "waiting" | "filling" | "grace" | "voting" | "reveal" | "over";

export interface BtPlayerView {
  nickname: string;
  connected: boolean;
  filledCount: number;
  total: number;
  /** Solo en voting: ya confirmo su hoja de tachados (no se ve a quien tacho). */
  voted: boolean;
}

/** `invalid` = anulada sola por corta (una letra no es palabra); no pasa por votacion. */
export type BtCellStatus = "unique" | "repeated" | "rejected" | "empty" | "invalid";

export interface BtCell {
  player: string;
  category: BtCategoryId;
  text: string;
  status: BtCellStatus | null;
  points: number | null;
}

/** Un voto de rechazo crudo. Llega SOLO en el reveal: durante la votacion cada uno
 *  tacha a ciegas y lo unico publico es el `voted` de cada jugador. */
export interface BtVote {
  voter: string;
  target: string;
  category: BtCategoryId;
}

/** Una celda tachada en la hoja de votos que el jugador manda al confirmar. */
export interface BtReject {
  target: string;
  category: BtCategoryId;
}

export interface BtState {
  phase: BtPhase;
  letter: string | null;
  letterIndex: number;
  totalLetters: number;
  deadline: number | null;
  /** Ms restantes de la fase al broadcast; se anclan a performance.now() para animar
   *  el reloj sin drift de reloj. Ver server/src/protocol.ts. */
  clockMs: number | null;
  clockTotalMs: number | null;
  players: BtPlayerView[];
  bastaBy: string | null;
  cells: BtCell[] | null;
  /** Votos crudos, solo en reveal (null en el resto, votacion incluida). */
  votes: BtVote[] | null;
  letterScores: { player: string; points: number }[] | null;
}

export interface BtGameover {
  ranking: { nickname: string; place: number; total: number }[];
}

export interface BastaTransport {
  onState(cb: (state: BtState) => void): void;
  /** Dirigido: el server devuelve la hoja propia al (re)conectar durante el llenado. */
  onYou(cb: (answers: Partial<Record<BtCategoryId, string>>) => void): void;
  onGameover(cb: (result: BtGameover) => void): void;
  sendFill(answers: Partial<Record<BtCategoryId, string>>): void;
  sendBasta(): void;
  /** Manda la hoja de tachados COMPLETA y confirma el voto (una vez por letra). */
  sendVotes(rejects: BtReject[]): void;
  dispose(): void;
}
