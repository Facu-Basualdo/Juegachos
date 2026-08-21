/**
 * Contrato de transporte con el game server (namespace `/wordbomb`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay
 * que tocar los dos lados.
 */

export interface WbPlayerView {
  nickname: string;
  lives: number;
  alive: boolean;
  connected: boolean;
}

export type WbPhase = "waiting" | "playing" | "over";

export interface WbState {
  phase: WbPhase;
  turn: string | null;
  fragment: string | null;
  deadline: number | null;
  /** Ms restantes de la mecha al broadcast; se anclan a performance.now() para
   *  animar el anillo sin drift de reloj. Ver server/src/protocol.ts. */
  fuseMs: number | null;
  /** Duracion total de la mecha del turno actual (fraccion del anillo). */
  fuseTotalMs: number | null;
  players: WbPlayerView[];
  usedCount: number;
  lastAccepted: { player: string; word: string; seq: number } | null;
}

export type WbRejectReason =
  | "not-a-word"
  | "missing-fragment"
  | "already-used"
  | "not-your-turn";

/** Reaccion (cara del personaje). Espeja `WbEmoteId` de `server/src/protocol.ts` y
 *  el allowlist de `constants.ts`; NO viaja en `wb:state` (es efimera). */
export type WbEmoteId = "risa" | "sorpresa" | "enojo" | "burla" | "llanto";

export interface WbGameover {
  ranking: { nickname: string; place: number }[];
}

export interface WordBombTransport {
  onState(cb: (state: WbState) => void): void;
  onInvalid(cb: (reason: WbRejectReason) => void): void;
  onTyping(cb: (player: string, text: string) => void): void;
  onEmote(cb: (player: string, emote: WbEmoteId) => void): void;
  onGameover(cb: (result: WbGameover) => void): void;
  submit(word: string): void;
  sendTyping(text: string): void;
  sendEmote(emote: WbEmoteId): void;
  dispose(): void;
}
