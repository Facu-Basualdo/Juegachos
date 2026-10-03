/**
 * Contrato con el game server (namespace `/lasershow`). Espeja `server/src/protocol.ts`;
 * por la regla de decoupling no se comparte modulo entre `src/` y `server/`, asi que si
 * cambia el protocolo hay que tocar los dos lados.
 */

export type LsPhase = "waiting" | "preroll" | "playing" | "over";

export interface LsState {
  phase: LsPhase;
  /** Ms para largar ("preroll") o para el final ("playing": tope o vuelta de honor). */
  msLeft: number;
  /** Ms desde la largada (negativo en la cuenta regresiva): los lasers salen de aca. */
  elapsed: number;
  seed: number;
  /** Queda uno solo y esta en su vuelta de honor. */
  lap: boolean;
  alive: boolean[];
  /** Ms aguantados por asiento (-1 mientras sigue en pie). */
  times: number[];
  on: boolean[];
}

export interface LsInit extends LsState {
  seat: number;
  seats: string[];
  spawn: { x: number; y: number; z: number; r: number } | null;
}

export interface LsSnap {
  /** [asiento, x, y, z, rotY, flags, ...]; flags 1 = en el piso, 2 = moviendose, 4 = agachado. */
  p: number[];
}

/** Dirigido: te empujaron. Impulso a aplicar en m/s; `from` = asiento del que empujo. */
export interface LsShove {
  vx: number;
  vz: number;
  vy: number;
  from: number;
}
