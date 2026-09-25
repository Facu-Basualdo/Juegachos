/**
 * Contrato con el game server (namespace `/marealava`). Espeja `server/src/protocol.ts`;
 * por la regla de decoupling no se comparte modulo entre `src/` y `server/`, asi que si
 * cambia el protocolo hay que tocar los dos lados.
 */

export type MlPhase = "waiting" | "preroll" | "playing" | "over";
export type MlStatus = "run" | "dead" | "top";

export interface MlState {
  phase: MlPhase;
  msLeft: number;
  elapsed: number;
  seed: number;
  status: MlStatus[];
  best: number[];
  topT: number[];
  on: boolean[];
}

export interface MlInit extends MlState {
  seat: number;
  seats: string[];
  spawn: { x: number; y: number; z: number; r: number } | null;
}

export interface MlSnap {
  /** [asiento, x, y, z, rotY, flags, ...]; flags 1 = en el piso, 2 = moviendose. */
  p: number[];
}

export const FLAG_GROUNDED = 1;
export const FLAG_MOVING = 2;
