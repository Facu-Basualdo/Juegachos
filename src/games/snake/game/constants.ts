export const GRID_COLS = 14;
export const GRID_ROWS = 14;
export const CELL = 24;

export const VIEW_WIDTH = GRID_COLS * CELL;
export const VIEW_HEIGHT = GRID_ROWS * CELL;

export const START_LENGTH = 4;

// Segundos por paso (movimiento de una celda). Baja con cada comida hasta el minimo.
export const STEP_INITIAL = 0.14;
export const STEP_MIN = 0.06;
export const STEP_DECREMENT = 0.004;

export const MAX_DT = 0.05;

// Latencia de giro: fraccion del paso ya recorrida a partir de la cual un giro adelanta
// el paso en vez de esperar al proximo borde. Ver "Giro sin espera" en CLAUDE.md.
export const TURN_EARLY_FRACTION = 0.5;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75;

export const BEST_KEY = "snake:best";

// Damero de fondo (estilo clasico), serpiente azul y manzana roja.
export const COLOR_BG_LIGHT = "#aad751";
export const COLOR_BG_DARK = "#a2d149";
export const COLOR_SNAKE = "#4a5fd6";
export const COLOR_APPLE = "#e8402a";
