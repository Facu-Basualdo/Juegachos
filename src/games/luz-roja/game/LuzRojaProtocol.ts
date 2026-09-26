/**
 * Contrato con el game server (namespace `/luzroja`). Espeja `server/src/protocol.ts`;
 * por la regla de decoupling no se comparte modulo entre `src/` y `server/`, asi que
 * si cambia el protocolo hay que tocar los dos lados.
 */

export type LrPhase = "waiting" | "preroll" | "playing" | "over";
export type LrLight = "green" | "red";
export type LrStatus = "run" | "out" | "fin";
export type LrSong = "steady" | "rush" | "stutter";

export interface LrState {
  phase: LrPhase;
  msLeft: number;
  elapsed: number;
  light: LrLight;
  lightSeq: number;
  lightDur: number;
  song: LrSong;
  lightLeft: number;
  status: LrStatus[];
  prog: number[];
  finT: number[];
  on: boolean[];
}

export interface LrInit extends LrState {
  seat: number;
  seats: string[];
  spawn: { x: number; z: number; r: number } | null;
}

export interface LrSnap {
  /** [asiento, x, z, rotY, moviendose, ...]. */
  p: number[];
}
