export const COUNTDOWN_LABELS = ["3", "2", "1", "YA!"];
export const COUNTDOWN_STEP = 0.8; // segundos por etiqueta
export const MAX_DT = 0.1; // clamp del delta para no saltar tras un freeze

/** Largo de la palabra y cuantos intentos hay. */
export const WORD_LENGTH = 5;
export const MAX_ATTEMPTS = 6;

/**
 * Intentos que se le anotan a quien NO resuelve. Uno mas que el maximo, asi el
 * ranking ("lower") lo deja detras de cualquiera que haya resuelto, sin
 * necesidad de un caso especial en el orden.
 */
export const FAILED_ATTEMPTS = MAX_ATTEMPTS + 1;

export const BEST_KEY = "wordle_best";

/** Teclado en pantalla. La ñ entra en la fila del medio (hay 426 palabras con ñ);
 *  no hay acentos porque el diccionario esta normalizado sin ellos. */
export const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjklñ", "zxcvbnm"];

/** Reveal: cada casilla gira escalonada respecto de la anterior. */
export const REVEAL_STEP_MS = 240;
export const FLIP_MS = 420;

/** Cuanto queda visible el cartel de "no esta en la lista". */
export const TOAST_MS = 1200;

/**
 * Estado de una letra ya evaluada. `null` = casilla sin evaluar (fila en
 * edicion o todavia vacia).
 */
export type LetterState = "exact" | "present" | "absent";

/**
 * Puntaje = intentos (parte alta) + centesimas de segundo (desempate), con las
 * centesimas topeadas por debajo de BASE. Ordenado ascendente ("lower") manda
 * primero quien resolvio en menos intentos y usa el tiempo solo para desempatar
 * entre soluciones igual de eficientes.
 *
 * Es la misma idea que `encodeMovesTime` de shared/scoring-core (que usa
 * torres-de-hanoi), pero con codificacion propia porque la etiqueta es otra
 * ("4/6", no "4 mov") y decodificar pide la base, que aquel modulo no exporta.
 */
const SCORE_BASE = 1000000;

export function encodeScore(attempts: number, seconds: number): number {
  const centis = Math.min(Math.max(0, Math.round(seconds * 100)), SCORE_BASE - 1);
  return Math.max(0, Math.round(attempts)) * SCORE_BASE + centis;
}

export function decodeScore(score: number): { attempts: number; seconds: number } {
  const n = Math.max(0, Math.round(score));
  return { attempts: Math.floor(n / SCORE_BASE), seconds: (n % SCORE_BASE) / 100 };
}
