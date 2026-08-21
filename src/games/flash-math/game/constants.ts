export const BEST_KEY = "flash-math:best";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75; // seconds per countdown label
export const MAX_DT = 0.1; // cap delta time on tab blur

// --- Ritmo de aparicion de los numeros (fase "showing") ---
export const GAP_MS = 280; // pausa en blanco entre numero y numero
export const FIRST_DELAY_MS = 700; // pausa (con el cartel "Ronda N") antes del 1er numero
export const FEEDBACK_MS = 750; // duracion del cartel "correcto" entre rondas

// --- Fase "input": tope para escribir la respuesta ---
/**
 * Al vencer se envia lo que haya tipeado. No se descarta: el puntaje es por
 * cercania al resultado, asi que una respuesta a medias todavia vale algo (y
 * vacia ya valia 0). El reloj corre contra `performance.now()`, no acumulando
 * `dt`, para que irse a otra pestana no lo congele.
 */
export const ANSWER_TIME_MS = 10_000;
/** Restante (ms) desde el cual el reloj de respuesta se muestra urgente. */
export const ANSWER_URGENT_MS = 3_000;

// --- Modo sala: una sola ronda, config fija y deterministica por semilla ---
export const ROOM_COUNT = 5;
export const ROOM_SHOW_MS = 850;
export const ROOM_MAX_VAL = 12;
/** Puntaje por cercania en sala: max(0, 1000 - error * penalty). Exacto = 1000. */
export const ROOM_PENALTY = 25;

export interface RoundConfig {
  /** Cuantos numeros aparecen en la ronda. */
  count: number;
  /** Cuanto tiempo (ms) queda visible cada numero. */
  showMs: number;
  /** Magnitud maxima de cada numero. */
  maxVal: number;
}

/** Dificultad del modo solitario: mas numeros, mas rapido y mas grandes por ronda. */
export function soloRoundConfig(round: number): RoundConfig {
  const count = Math.min(10, 3 + Math.floor((round - 1) / 2)); // 3,3,4,4,5,5,...,10
  const showMs = Math.max(430, 1000 - (round - 1) * 55);
  const maxVal = Math.min(30, 9 + (round - 1) * 2);
  return { count, showMs, maxVal };
}

/** Puntos que otorga completar una ronda del modo solitario. */
export function roundPoints(config: RoundConfig): number {
  return 50 + config.count * 10;
}

export interface Sequence {
  /** Terminos con signo; el primero siempre positivo. */
  terms: number[];
  /** Resultado correcto (siempre >= 0: las restas nunca hunden el total). */
  total: number;
}

/**
 * Arma la secuencia de sumas y restas. El total nunca baja de 0 (si una resta lo
 * hundiria, se fuerza suma), asi la respuesta es siempre un entero no negativo y
 * el teclado no necesita signo. `rng` es inyectable: Math.random en solitario,
 * un PRNG sembrado en sala para que todos vean la misma secuencia.
 */
export function buildSequence(config: RoundConfig, rng: () => number): Sequence {
  const terms: number[] = [];
  const first = 1 + Math.floor(rng() * config.maxVal);
  let total = first;
  terms.push(first);
  for (let i = 1; i < config.count; i++) {
    const mag = 1 + Math.floor(rng() * config.maxVal);
    const sign = total - mag < 0 ? 1 : rng() < 0.5 ? -1 : 1;
    terms.push(sign * mag);
    total += sign * mag;
  }
  return { terms, total };
}

/** PRNG deterministico y compacto (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de un string a semilla de 32 bits. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
