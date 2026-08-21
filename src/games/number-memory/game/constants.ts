export type Mode = "aleatorio" | "escalera";

// Modo aleatorio: numero nuevo al azar cada ronda, arranca en 3 digitos.
export const START_DIGITS = 3;
// Modo escalera: el mismo numero que crece; arranca con 1 digito (la semilla).
export const ESCALERA_START_DIGITS = 1;

// Metadata de cada modo para los botones de la pantalla de inicio.
export const MODES: { id: Mode; label: string; tagline: string }[] = [
  { id: "aleatorio", label: "Aleatorio", tagline: "Un número nuevo cada ronda" },
  { id: "escalera", label: "Escalera", tagline: "El mismo número, +1 dígito por ronda" },
];

// Cuanto se muestra el numero antes de esfumarse: base + un plus por digito, con
// un tope para que los numeros largos no se vuelvan un ejercicio de lectura.
export const SHOW_BASE_MS = 900;
export const SHOW_PER_DIGIT_MS = 250;
export const SHOW_MAX_MS = 4000;

// Duracion de la animacion de "esfumado" antes de abrir el ingreso.
export const VANISH_MS = 450;

// Tras un acierto, cuanto se ve el "¡Bien!" antes de subir de nivel.
export const CORRECT_HOLD_MS = 750;

/**
 * Tope para escribir el numero (fase "input"). Al vencer cuenta como error y
 * termina la partida: fallar es la unica forma de perder que tiene el juego, y un
 * reloj sin consecuencia no seria un limite. Corre contra `performance.now()`, no
 * acumulando ticks, asi irse a otra pestana no lo congela.
 */
export const ANSWER_TIME_MS = 10_000;
/** Restante (ms) desde el cual el reloj de respuesta se muestra urgente. */
export const ANSWER_URGENT_MS = 3_000;
/** Cada cuanto se refresca el reloj de respuesta. */
export const ANSWER_TICK_MS = 100;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP_MS = 750;

/** Clave de localStorage para el record de cada modo (rankings separados). */
export function bestKey(mode: Mode): string {
  return `number-memory:best:${mode}`;
}

/** Digitos con los que arranca cada modo. */
export function startDigits(mode: Mode): number {
  return mode === "escalera" ? ESCALERA_START_DIGITS : START_DIGITS;
}

/** Milisegundos que se muestra un numero de `digits` digitos. */
export function showMsFor(digits: number): number {
  return Math.min(SHOW_BASE_MS + SHOW_PER_DIGIT_MS * digits, SHOW_MAX_MS);
}
