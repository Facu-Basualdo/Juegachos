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
 * Retraso con el que se dibuja a las demas: un espaciado de snapshot mas lo que llegan
 * tarde los paquetes (el percentil 95 del jitter medido, ver `Timeline.jitter`) mas un
 * margen. Es el "network buffer" adaptativo de los shooters: con buena conexion baja
 * solo (a 40 Hz y sin jitter, 25 + 10 = 35 ms) y con una conexion irregular sube hasta
 * dejar de trabarse, en vez de ser un numero fijo pensado para el peor caso.
 */
export const INTERP_MARGIN_MS = 10;
/** Retraso al conectar, antes de tener mediciones: dos espaciados de snapshot + margen. */
export const INTERP_START_SPACINGS = 2;
/** Techo del retraso adaptativo (ms). */
export const INTERP_MAX_MS = 250;
/**
 * Cuanto puede cambiar el retraso por segundo (ms/s). Sube rapido (si el jitter crece,
 * cada cuadro de demora es un tiron) y baja despacio (bajar de golpe adelanta el reloj
 * de las demas y se ve como un acelerón).
 */
export const INTERP_RISE_RATE = 120;
export const INTERP_FALL_RATE = 15;
/**
 * Comida que la cabeza propia ya toco: se oculta al instante (prediccion cosmetica) y
 * vuelve a aparecer si el server no confirma que se la comio en este tiempo (ms).
 */
export const PREDICT_EAT_TIMEOUT_MS = 600;
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
