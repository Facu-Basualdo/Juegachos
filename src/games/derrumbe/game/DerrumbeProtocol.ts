/**
 * Contrato de transporte con el game server (namespace `/derrumbe`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay que
 * tocar los dos lados.
 */

export type DrPhase = "waiting" | "preroll" | "playing" | "lap" | "over";

export interface DrState {
  phase: DrPhase;
  /** Ms para largar ("preroll"), para el final ("lap") o para el tope ("playing"). */
  msLeft: number;
  /** Ms desde la largada (0 antes). */
  elapsed: number;
  alive: boolean[];
  /** Ms aguantados por asiento, o -1 mientras sigue vivo. */
  times: number[];
  on: boolean[];
  decay: boolean;
}

export interface DrInit extends DrState {
  seat: number;
  seats: string[];
  grid: number;
  layers: number;
  /** Tablero en hex, un bit por celda: prendido = pisada o caida. */
  doom: string;
  spawn: { x: number; y: number; z: number; r: number } | null;
}

export interface DrSnap {
  /** [asiento, x, y, z, rotY, flags, ...]; flags 1 = en el piso, 2 = moviendose. */
  p: number[];
  /** Celdas recien pisadas: caen FALL_DELAY_MS despues de llegar. */
  f: number[];
  doom?: string;
}

/** Bits de `DrSnap.p` / `dr:pos`. */
export const FLAG_GROUNDED = 1;
export const FLAG_MOVING = 2;
