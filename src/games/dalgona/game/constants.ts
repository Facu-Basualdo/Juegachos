/**
 * Tuning de Dalgona. Todas las distancias estan en RADIOS DE GALLETA (el caramelo
 * mide 1 de radio), asi el juego se siente igual en un celu que en un monitor.
 */

export const BEST_KEY = "dalgona:best";

// ---- Partida ----
/** Tiempo para sacar la figura, en s (en la serie eran 10 minutos). */
export const TIME_LIMIT = 75;
/** Lo que tarda la tapa en salir antes de que corra el reloj, en s. */
export const REVEAL_TIME = 1.1;
/** Puntos por cada segundo que sobra al terminar. */
export const POINTS_PER_SECOND = 3;

// ---- Tallado (ver Candy.ts) ----
/** A esta distancia de la linea (o menos) la aguja talla. */
export const TOL_CARVE = 0.045;
/**
 * Piso de esa tolerancia en px de pantalla: en un celu la galleta es chica y 0.045
 * radios quedaban en ~7 px, menos que el pulso de un dedo.
 */
export const MIN_TOL_PX = 9;
/**
 * Profundidad que talla una pasada completa por un tramo: con 0.34, tres pasadas lo
 * cortan. Tallar por LARGO recorrido (y no por tiempo encima) es lo que hace que ir
 * mas rapido termine antes: el riesgo contra la recompensa del juego.
 */
export const PASS_DEPTH = 0.34;
/** Quieto sobre la linea tambien talla, pero despacio: un tramo entero en esto, en s. */
export const CARVE_STILL_TIME = 1.2;
/** Largo de cada tramo del contorno. */
export const BIN_LEN = 0.03;
/** Paso de muestreo del contorno. */
export const SAMPLE_STEP = 0.008;

// ---- Tension ----
/** Velocidad segura de la aguja, en radios por segundo. Mas rapido, cruje. */
export const V_SAFE = 0.38;
/** Constante de tiempo del promedio de velocidad de la aguja, en s. */
export const SPEED_SMOOTH = 0.1;
/** Tension por pasada a 2x la velocidad segura (crece con el cuadrado del exceso). */
export const K_SPEED = 0.8;
/** Tension por segundo al apretar ADENTRO de la figura, por cada TOL_CARVE de distancia. */
export const K_INSIDE = 1.2;
/** Tension por segundo al apretar cerca de la linea pero del lado de afuera. */
export const K_OUTSIDE = 0.35;
/** Hasta aca (en TOL_CARVE) apretar afuera todavia toca la figura; mas lejos es el sobrante. */
export const OUTSIDE_REACH = 3;
/** Quieto en el mismo tramo mas que esto, en s, empieza a sumar tension. */
export const DWELL_GRACE = 0.35;
export const K_DWELL = 0.9;
/** Descarga de tension por segundo (el caramelo "se asienta"). */
export const STRESS_DECAY = 0.25;
/** Con tension por encima de esto aparecen las grietitas de aviso. */
export const STRESS_WARN = 0.35;

/**
 * Fragilidad por geometria (Candy.ts): un tramo angosto (el mango del paraguas) o una
 * punta (la estrella) se rompe antes. Multiplica toda la tension que recibe el tramo.
 */
export const FRAGILE_THIN = 0.9;
export const FRAGILE_TURN = 0.5;
/** Por debajo de este grosor local (radios) el tramo cuenta como angosto. */
export const THIN_BELOW = 0.2;

// ---- Lamer ----
/** Cuanto sube la humedad por segundo lamiendo (0-1). */
export const LICK_RATE = 0.8;
/** Cuanto se seca por segundo. */
export const DRY_RATE = 0.09;
/** Con la galleta empapada, la tension entra en esta fraccion menos. */
export const WET_RELIEF = 0.55;
/** Lamiendo, la tension se descarga esta cantidad de veces mas rapido. */
export const LICK_DECAY_MULT = 3;

// ---- Toque ----
/**
 * En pantallas tactiles la punta de la aguja va por ENCIMA del dedo, en px: si no,
 * el dedo tapa justo la linea que hay que seguir.
 */
export const TOUCH_OFFSET_PX = 56;

// ---- Countdown ----
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;
export const MAX_DT = 0.05;
