/**
 * Contrato con el game server (namespace `/hotpotato`). Los tipos espejan
 * `server/src/protocol.ts`; por la regla de decoupling del repo no se comparte
 * modulo entre `src/` y `server/`, asi que si cambia el protocolo hay que tocar
 * los dos lados.
 */

export interface HpPlayerView {
  nickname: string;
  alive: boolean;
  connected: boolean;
}

/** `pause` = entre explosiones (y el preroll inicial); `burning` = la papa esta en juego. */
export type HpPhase = "waiting" | "pause" | "burning" | "over";

export interface HpState {
  phase: HpPhase;
  /** Reloj del server (epoch ms) al emitir; alimenta el offset de reloj. */
  t: number;
  holder: string | null;
  /** Quien le paso la papa al holder (no se la puede devolver, salvo en el mano a mano). */
  from: string | null;
  /** Secuencia de flechas del holder ("U" "D" "L" "R"). */
  seq: string;
  /** Contador de posesiones: sube en cada pase aceptado y en cada papa nueva. */
  n: number;
  burnStart: number | null;
  /** Tope publico de la mecha: el termometro llena contra esto. */
  fuseMaxMs: number;
  nextBurnAt: number | null;
  players: HpPlayerView[];
  lastPass: { from: string; to: string; n: number } | null;
  lastBoom: { player: string; k: number } | null;
}

export type HpRejectReason = "late" | "not-holder" | "stale" | "bad-seq" | "bad-target";

export interface HpGameover {
  ranking: { nickname: string; place: number }[];
}
