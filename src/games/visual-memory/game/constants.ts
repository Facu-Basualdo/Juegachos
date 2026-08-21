export const START_LEVEL = 1;
export const LIVES = 3;

// Cuantas celdas se encienden y de que tamano es la grilla, segun el nivel.
export const MAX_GRID = 7;

/** Celdas a memorizar en un nivel (nivel 1 = 3). */
export function tilesFor(level: number): number {
  return level + 2;
}

/** Lado de la grilla: crece para que nunca quede demasiado llena (~<50%). */
export function gridNFor(level: number): number {
  const t = tilesFor(level);
  return Math.min(MAX_GRID, Math.max(3, Math.ceil(Math.sqrt(t * 2))));
}

export const SHOW_BASE_MS = 900;
export const SHOW_PER_TILE_MS = 120;
export const SHOW_MAX_MS = 2600;

/** Cuanto se muestra el patron encendido, segun cuantas celdas tenga. */
export function showMsFor(tiles: number): number {
  return Math.min(SHOW_BASE_MS + SHOW_PER_TILE_MS * tiles, SHOW_MAX_MS);
}

// Pausa tras completar un nivel antes de mostrar el siguiente.
export const LEVEL_HOLD_MS = 500;

export const BEST_KEY = "visual-memory:best";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP_MS = 750;
