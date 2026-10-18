/**
 * Constantes del CLIENTE de Viborita. El tuning del juego (mapa, largo, giro,
 * velocidad, zoom) NO esta aca: viaja desde el server en el `vb:init` (ver
 * `server/src/games/viborita-config.ts`). Lo de aca es solo como se ve y se siente
 * la red de este lado.
 */

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
/** Segundos por etiqueta del countdown. */
export const COUNTDOWN_STEP = 0.75;

/** Tope del dt de un cuadro (s), para que un tab que vuelve no salte de golpe. */
export const MAX_DT = 0.05;

/** Cada cuanto se manda el input aunque no haya cambiado (s). Debajo del rate limit (40/s). */
export const INPUT_INTERVAL = 1 / 30;
/** Un giro grande sale antes del envio periodico, pero no mas seguido que esto (s). */
export const INPUT_MIN_GAP = 1 / 30;
/** Cuanto tiene que cambiar el angulo (rad) para contar como giro. */
export const INPUT_TURN_EPS = 0.06;

/**
 * Retraso con el que se dibuja a las demas: dos espaciados de snapshot mas un margen
 * (con uno solo, cualquier hipo de red seca el buffer). Sale de la cadencia que manda
 * el server (`snapshotHz`): a 40 Hz son 2 x 25 + 10 = 60 ms.
 */
export const INTERP_SPACINGS = 2;
export const INTERP_MARGIN_MS = 10;
/** Correccion lenta hacia arriba del offset de reloj (deriva entre relojes). */
export const CLOCK_DRIFT_RATE = 0.01;
/** Si falta un snapshot, cuanto se sigue el ultimo tramo antes de frenar (ms). */
export const EXTRAPOLATE_MS = 120;
/** Inputs propios que se guardan para reconciliar (ms). */
export const HISTORY_MS = 1000;
/** Velocidad con que se disuelve en pantalla el resto de una correccion (1/s). */
export const ERROR_FADE_RATE = 9;
/** Una correccion mas grande que esto (u) se muestra de golpe en vez de disolverse. */
export const SNAP_DIST = 200;
/** Hasta donde (u desde la cabeza) se reparte en el cuerpo el resto de una correccion. */
export const VIS_FADE_LEN = 160;
/** Suavizado del zoom de la camara (1/s). */
export const ZOOM_RATE = 2.5;
/** Una viborita ajena que no aparece en snapshots hace esto se olvida (ms). */
export const TRAIL_FORGET_MS = 1500;
