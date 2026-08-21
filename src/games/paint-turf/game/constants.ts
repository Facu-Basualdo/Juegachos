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

/** Cada cuanto se le manda la direccion al server (20 Hz). */
export const INPUT_INTERVAL = 0.05;

/**
 * Retraso de la interpolacion de los rivales (ms), aplicado sobre la LINEA DE
 * TIEMPO DEL SERVER (`pt:state.t`), no sobre la hora de llegada del paquete. Por
 * eso no tiene que cubrir la latencia (esa la absorbe el offset de reloj), solo
 * el espaciado entre snapshots (50 ms a 20 Hz) mas el jitter de entrega.
 */
export const INTERP_DELAY = 80;

/** Correccion por snapshot del offset de reloj hacia arriba (fraccion del error). */
export const CLOCK_DRIFT_RATE = 0.01;

/** Cuanto se acerca por frame el pincel propio a la posicion del server (por segundo). */
export const RECONCILE_RATE = 6;

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
