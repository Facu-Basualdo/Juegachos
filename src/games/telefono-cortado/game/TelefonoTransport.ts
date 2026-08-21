/**
 * Tipos del protocolo `tc:*` y contrato del transporte. **Espejan**
 * `server/src/protocol.ts` a mano: por la regla de decoupling del repo no se comparte
 * modulo entre `src/` y `server/`, asi que si cambia el protocolo hay que tocar los dos
 * lados (y redeployar el server).
 */

export type TcPhase = "waiting" | "writing" | "drawing" | "guessing" | "reveal" | "over";

/** Vista publica de un jugador (nunca revela su frase, su dibujo ni su pista). */
export interface TcPlayerView {
  nickname: string;
  connected: boolean;
  /** Ya entrego lo que pedia la fase actual. */
  done: boolean;
  total: number;
}

/** Snapshot que el server difunde en cada cambio. Sin contenido secreto. */
export interface TcState {
  phase: TcPhase;
  deadline: number | null;
  /** Ms restantes de la fase al broadcast; el cliente los ancla a performance.now(). */
  clockMs: number | null;
  clockTotalMs: number | null;
  players: TcPlayerView[];
  totalChains: number | null;
}

/** Lo que le toca al jugador en la fase actual. Dirigido (no viaja en `tc:state`). */
export interface TcYou {
  phase: TcPhase;
  /** Frase ajena que te toca dibujar (solo en drawing). */
  phrase: string | null;
  /** Dibujo ajeno que te toca adivinar, dataURL (solo en guessing). */
  drawing: string | null;
  /** Pista tipo ahorcado: letras reveladas tal cual, ocultas "_", espacios " ". */
  hint: string | null;
  /** Lo ya entregado en esta fase, para repintarlo tras un F5. */
  submitted: string | null;
  solved: boolean;
}

/** Una cadena completa, revelada al final. Llega de a una. */
export interface TcChainView {
  index: number;
  total: number;
  author: string;
  phrase: string;
  /** True si la frase la puso el server porque el autor no llego a escribirla. */
  filled: boolean;
  artist: string | null;
  drawing: string | null;
  guesser: string | null;
  guess: string | null;
  solved: boolean;
}

export interface TcGameover {
  ranking: { nickname: string; place: number; total: number }[];
}

/** Contrato del transporte (hoy solo `SocketTransport`). */
export interface TelefonoTransport {
  connect(): Promise<void>;
  onState(cb: (s: TcState) => void): void;
  onYou(cb: (you: TcYou) => void): void;
  onChain(cb: (chain: TcChainView) => void): void;
  onGameover(cb: (r: TcGameover) => void): void;
  sendPhrase(text: string): void;
  sendDrawing(image: string): void;
  sendGuess(text: string): void;
  dispose(): void;
}
