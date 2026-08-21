import { WORD_LENGTH, type LetterState } from "./constants";
import { SOLUTIONS } from "./solutions";
import { VALID_GUESSES } from "./words";

/**
 * Logica pura del juego: normalizar lo tipeado, evaluar un intento y elegir la
 * palabra. Sin DOM ni estado, para poder razonarla (y testearla) aparte.
 */

/**
 * Deja el texto en el alfabeto del diccionario: minusculas, sin acentos, ñ
 * conservada. Los teclados reales meten acentos (y un celular puede mandar
 * mayusculas solas), asi que "AVIÓN" y "avion" tienen que ser el mismo intento.
 */
export function normalize(text: string): string {
  // La ñ se aparta partiendo el texto por ella: descomponer (NFD) la volveria
  // "n" + tilde, el barrido de diacriticos se comeria la tilde y "año" acabaria
  // en "ano", que es otra palabra del diccionario. El resto de los acentos si
  // se van, y todo lo que no sea a-z queda afuera.
  return text
    .toLowerCase()
    .split("ñ")
    .map((part) =>
      part
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z]/g, ""),
    )
    .join("ñ");
}

/** Una palabra que el jugador puede tipear (no toda es sorteable como solucion). */
export function isValidGuess(word: string): boolean {
  return VALID_GUESSES.has(word);
}

/**
 * Colorea un intento contra la solucion, con el manejo clasico de repetidas: una
 * letra solo se marca "present" mientras quede cupo de esa letra sin consumir por
 * las exactas. Sin esto, "cocos" contra "corte" pintaria las dos "c" de amarillo
 * cuando la solucion tiene una sola.
 */
export function evaluateGuess(guess: string, solution: string): LetterState[] {
  const states: LetterState[] = new Array(WORD_LENGTH).fill("absent");

  // Cupo por letra de la solucion, descontando las que ya casan en su posicion.
  const remaining = new Map<string, number>();
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === solution[i]) {
      states[i] = "exact";
    } else {
      remaining.set(solution[i], (remaining.get(solution[i]) ?? 0) + 1);
    }
  }

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (states[i] === "exact") continue;
    const left = remaining.get(guess[i]) ?? 0;
    if (left > 0) {
      states[i] = "present";
      remaining.set(guess[i], left - 1);
    }
  }

  return states;
}

/**
 * Mejor estado conocido de cada letra segun los intentos ya hechos, para pintar
 * el teclado. Se deriva de los intentos en vez de acumularse en una tabla, asi
 * un F5 (que restaura solo los intentos) reconstruye el teclado solo.
 */
export function keyboardStates(
  guesses: readonly string[],
  solution: string,
): Map<string, LetterState> {
  const rank: Record<LetterState, number> = { absent: 0, present: 1, exact: 2 };
  const best = new Map<string, LetterState>();

  for (const guess of guesses) {
    const states = evaluateGuess(guess, solution);
    for (let i = 0; i < WORD_LENGTH; i++) {
      const prev = best.get(guess[i]);
      if (!prev || rank[states[i]] > rank[prev]) best.set(guess[i], states[i]);
    }
  }
  return best;
}

/** Solucion al azar (modo solo). */
export function randomSolution(): string {
  return SOLUTIONS[Math.floor(Math.random() * SOLUTIONS.length)];
}

/**
 * Solucion de una ronda de sala. Se DERIVA de la sala y la ronda en vez de
 * sortearse: sin server que arbitre, es lo que hace que todos los jugadores
 * reciban la misma palabra sin ponerse de acuerdo por la red (y que un F5
 * reconstruya la misma, ver `roomRun` y la regla de no guardar lo que se puede
 * derivar).
 */
export function solutionFor(code: string, round: number): string {
  return SOLUTIONS[hash(`${code}:${round}`) % SOLUTIONS.length];
}

/** FNV-1a de 32 bits: barato y con buena dispersion para sortear el indice. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
