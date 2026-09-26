/**
 * Contrato con el game server (namespace `/pistaloca`). Espeja `server/src/protocol.ts`;
 * por la regla de decoupling no se comparte modulo entre `src/` y `server/`, asi que si
 * cambia el protocolo hay que tocar los dos lados.
 */

export type PlPhase = "waiting" | "preroll" | "playing" | "over";
export type PlStep = "dance" | "choose" | "drop" | "reset";

export interface PlState {
  phase: PlPhase;
  msLeft: number;
  round: number;
  step: PlStep;
  stepDur: number;
  stepLeft: number;
  color: number;
  /** Un digito (color) por celda, fila por fila. */
  pattern: string;
  alive: boolean[];
  rounds: number[];
  times: number[];
  on: boolean[];
}

export interface PlInit extends PlState {
  seat: number;
  seats: string[];
  grid: number;
  spawn: { x: number; y: number; z: number; r: number } | null;
}

export interface PlSnap {
  /** [asiento, x, y, z, rotY, flags, ...]; flags 1 = en el piso, 2 = moviendose. */
  p: number[];
}

export const FLAG_GROUNDED = 1;
export const FLAG_MOVING = 2;

/** Dirigido: te empujaron. Impulso a aplicar en m/s; `from` = asiento del que empujo. */
export interface PlShove {
  vx: number;
  vz: number;
  vy: number;
  from: number;
}
