/**
 * Contrato de transporte con el game server (namespace `/paintturf`). Los tipos
 * espejan `server/src/protocol.ts`; por la regla de decoupling del repo no se
 * comparte modulo entre `src/` y `server/`, asi que si cambia el protocolo hay
 * que tocar los dos lados.
 */

/** Vista publica de un pincel dentro de la partida. */
export interface PtPlayerView {
  /** Asiento: identifica color y puntaje. */
  i: number;
  x: number;
  y: number;
  /** Ms de aturdimiento que le quedan (0 = normal). Aturdido no pinta y va lento. */
  st: number;
  /** Ms que le faltan para volver a tener el salpicon listo (0 = listo). */
  cd: number;
  /** Conectado al server ahora mismo. */
  on: boolean;
}

export type PtPhase = "waiting" | "preroll" | "playing" | "over";

/** Estado inicial: geometria, asientos y la grilla COMPLETA (join / reconexion). */
export interface PtInit {
  /** Asiento propio, o -1 si no se esta jugando (espectador / fuera del roster). */
  seat: number;
  seats: string[];
  cols: number;
  rows: number;
  cell: number;
  /** Un caracter por celda, fila por fila: "." vacia, "0".."7" el asiento duenio. */
  grid: string;
}

/** Snapshot periodico de la simulacion (20 Hz). */
export interface PtState {
  /** Reloj de la SIMULACION del server (ms), en pasos fijos: la linea de tiempo
   *  sobre la que se interpola (ver `pushSnap` en Game.ts). */
  t: number;
  phase: PtPhase;
  /** Ms que faltan para que termine la partida (o para largar, en "preroll"). */
  msLeft: number;
  players: PtPlayerView[];
  /** Celdas pintadas desde el snapshot anterior, aplanadas: [indice, asiento, ...]. */
  c: number[];
  scores: number[];
}

export interface PtSplat {
  i: number;
  x: number;
  y: number;
}
