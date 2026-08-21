/**
 * Contrato de transporte con el game server (namespace `/wordchain`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay
 * que tocar los dos lados.
 */

export interface WcPlayerView {
  nickname: string;
  /** Sigue en pie. Con una sola vida, `false` = eliminado. */
  alive: boolean;
  connected: boolean;
  /** Eslabones que aporto (palabras aceptadas). */
  links: number;
}

export type WcPhase = "waiting" | "playing" | "over";

export interface WcState {
  phase: WcPhase;
  turn: string | null;
  /** Letra con la que tiene que empezar la palabra del jugador de turno. */
  letter: string | null;
  deadline: number | null;
  /** Ms restantes del reloj al broadcast; se anclan a performance.now() para animar
   *  el anillo sin drift de reloj. Ver server/src/protocol.ts. */
  clockMs: number | null;
  /** Duracion total del reloj del turno actual (fraccion del anillo). */
  clockTotalMs: number | null;
  players: WcPlayerView[];
  /** Largo de la cadena forjada (palabras aceptadas en la partida). */
  chainLength: number;
  lastAccepted: { player: string; word: string; seq: number } | null;
}

export type WcRejectReason = "not-a-word" | "wrong-initial" | "already-used" | "not-your-turn";

/** Reaccion (cara del personaje). Espeja `WcEmoteId` de `server/src/protocol.ts` y
 *  el allowlist de `constants.ts`; NO viaja en `wc:state` (es efimera). */
export type WcEmoteId = "risa" | "sorpresa" | "enojo" | "burla" | "llanto";

export interface WcGameover {
  ranking: { nickname: string; place: number }[];
}

export interface WordChainTransport {
  onState(cb: (state: WcState) => void): void;
  onInvalid(cb: (reason: WcRejectReason) => void): void;
  onTyping(cb: (player: string, text: string) => void): void;
  onEmote(cb: (player: string, emote: WcEmoteId) => void): void;
  onGameover(cb: (result: WcGameover) => void): void;
  submit(word: string): void;
  sendTyping(text: string): void;
  sendEmote(emote: WcEmoteId): void;
  dispose(): void;
}
