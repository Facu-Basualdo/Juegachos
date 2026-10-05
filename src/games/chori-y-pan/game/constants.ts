/** Tuning de Chori y Pan. Unidades: tiles (1 = una celda de la grilla) y segundos. */

export const BEST_KEY = "chori-y-pan:best";

// ---------- Grilla ----------

/** Cada nivel entra en una sola pantalla, como el original: 40 x 24 celdas. */
export const COLS = 40;
export const ROWS = 24;

// ---------- Personajes ----------

/** Caja de colision (igual para los dos: lo justo es lo justo). */
export const CHAR_W = 0.78;
export const CHAR_H = 1.3;

/** Gravedad y salto: apice ~3.1 celdas (v^2 / 2g). */
export const GRAVITY = 58;
export const JUMP_V = 19;
/** Al soltar el salto subiendo, la velocidad se recorta: salto de altura variable. */
export const JUMP_CUT = 0.45;
export const MAX_FALL = 26;

export const RUN_SPEED = 8.4;
export const ACC_GROUND = 90;
export const ACC_AIR = 55;
export const FRICTION = 85;

/** Se puede saltar un instante despues de salir de un borde. */
export const COYOTE = 0.09;
/** Un salto apretado justo antes de tocar el piso se guarda y sale al aterrizar. */
export const JUMP_BUFFER = 0.12;
/** Escalon que se sube solo al caminar (el borde de una rampa, una pileta). */
export const STEP_UP = 0.56;

// ---------- Mundo ----------

/** Paso fijo de la simulacion. */
export const STEP = 1 / 120;
export const MAX_DT = 0.05;

/** Cajas: un poco mas chicas que una celda para que entren en los huecos. */
export const BOX_SIZE = 0.96;
/** Empujando una caja se camina mas lento. */
export const PUSH_SPEED = 0.55;

/** Compuertas y ascensores (celdas por segundo / fraccion por segundo). */
export const GATE_SPEED = 2.2;
export const LIFT_SPEED = 3;

/** Ventilador: empuje hacia arriba y tope de velocidad subiendo. */
export const FAN_ACC = 120;
export const FAN_MAX_UP = 9;

/** Piletas: el piso de la celda esta a media altura y el liquido a 0.25 de arriba. */
export const POOL_FLOOR = 0.5;
export const POOL_SURFACE = 0.28;

/** Cada gema descuenta segundos del tiempo final. */
export const GEM_BONUS = 2;

// ---------- Ritmo ----------

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"] as const;
export const COUNTDOWN_STEP = 0.75;
/** Pausa con la animacion de muerte antes de reiniciar el nivel. */
export const DEATH_TIME = 1.1;
/** Pausa con el festejo al terminar un nivel. */
export const CLEAR_TIME = 1.6;
/** Niveles por carrera. */
export const LEVELS_PER_RUN = 3;
