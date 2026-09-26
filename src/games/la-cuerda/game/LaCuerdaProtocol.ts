/**
 * Contrato con el game server (namespace `/lacuerda`). Espeja `server/src/protocol.ts`;
 * por la regla de decoupling no se comparte modulo entre `src/` y `server/`, asi que si
 * cambia el protocolo hay que tocar los dos lados.
 */

export type LcPhase = "waiting" | "preroll" | "playing" | "over";
/** Cruzando, eliminado (cuerda o caida), o llego a la meta. */
export type LcStatus = "run" | "dead" | "goal";

export interface LcState {
  phase: LcPhase;
  msLeft: number;
  /** Ms desde la largada: la cuerda sale de aca. */
  elapsed: number;
  status: LcStatus[];
  /** Mejor avance por asiento (m). */
  best: number[];
  /** Ms en que cada asiento llego a la meta (-1 si no llego). */
  goalT: number[];
  on: boolean[];
}

export interface LcInit extends LcState {
  seat: number;
  seats: string[];
  spawn: { x: number; y: number; z: number; r: number } | null;
}

export interface LcSnap {
  /** [asiento, x, y, z, rotY, flags, ...]; flags 1 = en el piso, 2 = moviendose. */
  p: number[];
}

/** Te empujaron: el impulso a aplicar (lo calcula el server) y quien fue. */
export interface LcShove {
  vx: number;
  vz: number;
  vy: number;
  from: number;
}

export const FLAG_GROUNDED = 1;
export const FLAG_MOVING = 2;
