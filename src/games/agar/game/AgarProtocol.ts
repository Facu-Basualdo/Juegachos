/**
 * Contrato de transporte con el game server (namespace `/agar`). Los tipos espejan
 * `server/src/protocol.ts`; por la regla de decoupling del repo no se comparte modulo
 * entre `src/` y `server/`, asi que si cambia el protocolo hay que tocar los dos lados.
 *
 * El server es AUTORITATIVO: el cliente manda solo su input (hacia donde va y con que
 * intensidad), nunca posicion ni masa. Los mensajes frecuentes son arrays planos.
 */

export type AgArenaKind = "public" | "room";
export type AgPhase = "playing" | "over";

/** Lo que el cliente necesita para predecir y dibujar. Sale de `agar-config.ts`. */
export interface AgClientConfig {
  kind: AgArenaKind;
  mapSize: number;
  tickHz: number;
  snapshotHz: number;
  startMass: number;
  radiusK: number;
  speedBase: number;
  speedExp: number;
  pelletRadius: number;
  viewBase: number;
  viewExp: number;
  spectatorView: number;
  winMass: number;
  respawn: boolean;
  nameMaxLen: number;
}

/** `[id, nombre, color, bot (0|1)]`. */
export type AgPlayerInfo = [number, string, number, number];

/**
 * `[n, t, dx, dy, act]`: numero de secuencia, reloj del cliente (ms), vector de
 * movimiento con modulo <= 1 (el server lo recorta) y acciones como bitmask
 * (1 = dividir, 2 = expulsar masa; reservadas, hoy se ignoran).
 */
export type AgInput = [number, number, number, number, number];

export type AgJoin =
  | { mode: "public"; aspect: number; tk?: string }
  | { mode: "room"; aspect: number; code: string; round: number; nickname: string };

export interface AgInit {
  cfg: AgClientConfig;
  /** Id de jugador propio en esta arena. */
  me: number;
  /** Token para recuperar el jugador si se corta la conexion (arena publica). */
  tk: string;
  players: AgPlayerInfo[];
  /** Ya tiene celula viva (reconexion a mitad de vida). */
  alive: boolean;
  /** Puede aparecer (en sala, false si ya uso su unica vida: un F5 no da otra). */
  canSpawn: boolean;
  phase: AgPhase;
}

export interface AgSnap {
  /** Reloj de la simulacion (ms). */
  t: number;
  /** Celulas visibles, planas: `[id, dueno, x, y, masa]` por celula. */
  c: number[];
  /** Comida que entra a la vista: `[id, x, y, color]` por pellet. */
  pa?: number[];
  /** Ids de comida que sale de la vista (comida o lejos). */
  pd?: number[];
  /** Ultimo input propio aplicado y cuantos ms de el ya rigen al tomar el snapshot. */
  n: number;
  a: number;
  /** Centro de la camara del espectador (sin celula viva). */
  cx?: number;
  cy?: number;
}

export interface AgTop {
  /** Top 10: `[id, masa]`. */
  top: [number, number][];
  /** Puesto propio (1 = primero), 0 sin celula viva. */
  rank: number;
  /** Jugadores con celula viva. */
  alive: number;
}

export interface AgDead {
  /** Masa maxima de la vida. */
  peak: number;
  /** Nombre de quien se la comio, o null (inactividad). */
  by: string | null;
  /** Duracion de la vida (ms). */
  ms: number;
  reason: "eaten" | "afk";
}

/** Cliente -> Server. */
export interface AgClientToServer {
  "ag:join": (msg: AgJoin) => void;
  "ag:spawn": (msg: { name: string }) => void;
  "ag:in": (msg: AgInput) => void;
  "ag:view": (msg: { aspect: number }) => void;
}

/** Server -> Cliente. */
export interface AgServerToClient {
  "ag:init": (msg: AgInit) => void;
  "ag:snap": (msg: AgSnap) => void;
  "ag:players": (msg: { add?: AgPlayerInfo[]; del?: number[] }) => void;
  "ag:top": (msg: AgTop) => void;
  "ag:spawned": (msg: { mass: number }) => void;
  "ag:dead": (msg: AgDead) => void;
  /** Sala: alguien llego a la meta. La arena se congela. */
  "ag:over": (msg: { winner: string; mass: number }) => void;
}
