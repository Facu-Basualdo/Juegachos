/**
 * Contrato de transporte con el game server (namespace `/viborita`). Los tipos espejan
 * `server/src/protocol.ts`; por la regla de decoupling del repo no se comparte modulo
 * entre `src/` y `server/`, asi que si cambia el protocolo hay que tocar los dos lados.
 *
 * El server es AUTORITATIVO: el cliente manda solo su input (hacia donde apunta y si
 * acelera), nunca posicion ni largo. Los cuerpos no viajan en cada snapshot: viajan
 * las cabezas y el cliente arma cada cuerpo con la estela (ver `Trail.ts`).
 */

export type VbArenaKind = "public" | "room";
export type VbPhase = "playing" | "over";

/** Lo que el cliente necesita para predecir y dibujar. Sale de `viborita-config.ts`. */
export interface VbClientConfig {
  kind: VbArenaKind;
  mapRadius: number;
  tickHz: number;
  snapshotHz: number;
  startMass: number;
  rBase: number;
  rK: number;
  lenBase: number;
  lenK: number;
  speed: number;
  boostSpeed: number;
  turnBase: number;
  turnMassK: number;
  boostMinMass: number;
  viewBase: number;
  viewExp: number;
  spectatorView: number;
  winMass: number;
  respawn: boolean;
  nameMaxLen: number;
}

/** `[id, nombre, color, bot (0|1)]`. */
export type VbPlayerInfo = [number, string, number, number];

/**
 * `[n, t, angulo, turbo, vista]`: numero de secuencia, reloj del cliente (ms), angulo
 * hacia donde quiere ir la cabeza (rad, el server limita cuanto gira por segundo),
 * turbo (0 | 1; el server lo ignora si no alcanza la masa) y el instante del server
 * (ms de simulacion) que el cliente estaba dibujando de las demas, o -1 si todavia no
 * sabe. Con eso el server juzga los choques de esta cabeza como los veia el jugador
 * (compensacion de lag, acotada a `lagComp.maxRewindMs`).
 */
export type VbInput = [number, number, number, number, number];

export type VbJoin =
  | { mode: "public"; aspect: number; tk?: string }
  | { mode: "room"; aspect: number; code: string; round: number; nickname: string };

export interface VbInit {
  cfg: VbClientConfig;
  /** Id de jugador propio en esta arena (es tambien el id de su viborita). */
  me: number;
  /** Token para recuperar el jugador si se corta la conexion (arena publica). */
  tk: string;
  players: VbPlayerInfo[];
  /** Ya tiene viborita viva (reconexion a mitad de vida). */
  alive: boolean;
  /** Puede aparecer (en sala, false si ya uso su unica vida: un F5 no da otra). */
  canSpawn: boolean;
  phase: VbPhase;
}

export interface VbSnap {
  /** Reloj de la simulacion (ms). */
  t: number;
  /**
   * Viboritas visibles, planas: `[id, x, y, angulo x1000, masa x10, turbo]` por
   * viborita (x, y redondeados a 0.1).
   */
  s: number[];
  /**
   * Cuerpos enteros de las viboritas que este cliente todavia no tenia:
   * `[id, cantidad, x0, y0, x1, y1, ...]` repetido, de la cabeza a la cola, con
   * separacion fija. Con eso siembra la estela; despues le alcanza con las cabezas.
   */
  k?: number[];
  /** Comida que entra a la vista: `[id, x, y, color, masa x10]` por bocado. */
  pa?: number[];
  /** Ids de comida que sale de la vista (comida o lejos). */
  pd?: number[];
  /** Ultimo input propio aplicado y cuantos ms de el ya rigen al tomar el snapshot. */
  n: number;
  a: number;
  /** Centro de la camara del espectador (sin viborita viva). */
  cx?: number;
  cy?: number;
}

export interface VbTop {
  /** Top 10: `[id, masa]`. */
  top: [number, number][];
  /** Puesto propio (1 = primero), 0 sin viborita viva. */
  rank: number;
  /** Jugadores con viborita viva. */
  alive: number;
}

export interface VbDead {
  /** Masa (largo) maxima de la vida. */
  peak: number;
  /** Nombre de contra quien choco, o null (borde / inactividad). */
  by: string | null;
  /** Duracion de la vida (ms). */
  ms: number;
  reason: "crash" | "wall" | "afk";
}

/** Cliente -> Server. */
export interface VbClientToServer {
  "vb:join": (msg: VbJoin) => void;
  "vb:spawn": (msg: { name: string }) => void;
  "vb:in": (msg: VbInput) => void;
  "vb:view": (msg: { aspect: number }) => void;
}

/** Server -> Cliente. */
export interface VbServerToClient {
  "vb:init": (msg: VbInit) => void;
  "vb:snap": (msg: VbSnap) => void;
  "vb:players": (msg: { add?: VbPlayerInfo[]; del?: number[] }) => void;
  "vb:top": (msg: VbTop) => void;
  "vb:spawned": (msg: { mass: number }) => void;
  "vb:dead": (msg: VbDead) => void;
  /** Sala: alguien llego a la meta. La arena se congela. */
  "vb:over": (msg: { winner: string; mass: number }) => void;
}
