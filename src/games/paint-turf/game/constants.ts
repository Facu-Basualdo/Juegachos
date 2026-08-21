/**
 * Constantes de Manchon.
 *
 * Las de geometria, movimiento y tiempo estan DUPLICADAS a proposito en
 * `server/src/games/paintturf.ts` por la regla de decoupling del repo (no se
 * comparte modulo entre `src/` y `server/`). El server es el autoritativo: estas
 * copias existen para que el cliente pueda predecir su propio pincel y dibujar la
 * grilla en la misma escala. Si cambia el tuning, tocar los dos lados.
 */

// ---- Geometria ----
export const COLS = 35;
export const ROWS = 23;
export const CELL = 24;
export const VIEW_WIDTH = COLS * CELL; // 840
export const VIEW_HEIGHT = ROWS * CELL; // 552
export const CELL_COUNT = COLS * ROWS;

// ---- Movimiento y pintura (espejo del server) ----
export const SPEED = 195;
export const BRUSH_RADIUS = 21;
export const SPLAT_RADIUS = 78;
export const SPLAT_COOLDOWN_MS = 5000;
export const STUN_SPEED_FACTOR = 0.4;

// ---- Tiempos (espejo del server) ----
export const MATCH_MS = 90_000;

export const MAX_DT = 0.05;

/**
 * Cada cuanto se le manda la direccion al server (30 Hz).
 *
 * Es la mitad del retraso con que el server se entera de un cambio de direccion,
 * asi que se paga directo en la sensacion del control. 8 jugadores x 30/s = 240
 * mensajes/s entrantes por sala, que para el server no es nada (el tope de ~100/s
 * es del broadcast de Supabase, no del game server).
 */
export const INPUT_INTERVAL = 0.033;

/**
 * Retraso de la interpolacion de los rivales (ms), aplicado sobre la LINEA DE
 * TIEMPO DEL SERVER (`pt:state.t`), no sobre la hora de llegada del paquete. Por
 * eso no tiene que cubrir la latencia (esa la absorbe el offset de reloj), solo
 * el espaciado entre snapshots (40 ms a 25 Hz) mas el jitter de entrega.
 *
 * Son ~3 espaciados a proposito. Con los 80 ms de antes el margen era de menos de
 * dos snapshots y cualquier hipo de red dejaba el buffer seco: ahi el rival se
 * congelaba en su ultima posicion y pegaba un salto al llegar el siguiente. Ese
 * era el "se mueven a los tirones", y la otra mitad la ponia el server, que
 * espaciaba los snapshots de forma despareja (ver `BROADCAST_MS` en el sim).
 */
export const INTERP_DELAY = 110;

/** Correccion por snapshot del offset de reloj hacia arriba (fraccion del error). */
export const CLOCK_DRIFT_RATE = 0.01;

/**
 * Cuanto se le permite a un rival seguir de largo cuando falta el proximo snapshot
 * (ms). Cubre un par de snapshots perdidos sin dejar que un corte de red mande al
 * pincel a cualquier lado.
 */
export const EXTRAPOLATE_MS = 120;

/**
 * Cuanto se guardan los inputs propios ya enviados (ms) a la espera de que el
 * server los acuse. Es una red de seguridad para que la lista no crezca sin fin si
 * el acuse no llega nunca (server viejo, input perdido); en condiciones normales la
 * poda la hace el propio acuse. Tiene que cubrir de sobra la peor latencia.
 */
export const HISTORY_MS = 1000;

/** Velocidad (1/s) a la que se disuelve en pantalla una correccion de posicion.
 *  La correccion se aplica entera y de una a la posicion logica; esto solo evita
 *  que el ojo vea el salto. */
export const ERROR_FADE_RATE = 9;

/** Salto (px) que delata un evento discreto: no se interpola a traves de el. */
export const SNAP_DIST = 160;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75;

// ---- Paleta (ver DESIGN.md: "Tempera sobre papel") ----
export const PAPER = "#f4ead8";
export const INK = "#1a1714";

/**
 * Un color de tempera por asiento. Elegidos para distinguirse entre si tambien
 * sobre el crema del papel y en un manchon chico: nada de dos azules vecinos.
 */
export const SEAT_COLORS = [
  "#e0523f", // bermellon
  "#2f7ea8", // azul ultramar
  "#e8b03a", // ocre
  "#4f8a52", // verde savia
  "#8e5aa8", // violeta
  "#c96a2b", // naranja quemado
  "#37507f", // aniil
  "#b8455f", // frambuesa
];

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}
