import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";
import { MAX_ATTEMPTS, decodeScore } from "./game/constants";
import { formatClock } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "wordle",
  title: "Wordle",
  description:
    "Adiviná la palabra de 5 letras en 6 intentos. Cada intento te dice qué letras acertaste y cuáles están en otro lugar.",
  path: "/games/wordle/",
  controls: "Escribí una palabra de 5 letras y confirmá con Enter.",
  accent: "#2f7d4f",
  category: "Puzzle",
  order: 410,
  added: "2026-07-16",
  mobile: true,

  // Sin tope la ronda no termina nunca: la partida solo se cierra cuando el
  // jugador gasta sus intentos, asi que uno quieto la colgaria para todos.
  roomTimeLimitSec: 180,
};

/**
 * El ranking se ordena por intentos (menos mejor) y el tiempo desempata entre
 * quienes usaron los mismos. Cada puntaje codifica ambos en un solo numero (ver
 * `encodeScore`). Quien no resuelve se anota con MAX_ATTEMPTS + 1, asi cae
 * detras de cualquiera que haya resuelto y se muestra como "sin resolver".
 */
export const scoring: GameScoring = {
  direction: "lower",
  format: (score) => {
    const { attempts, seconds } = decodeScore(score);
    if (attempts > MAX_ATTEMPTS) return "sin resolver";
    return `${attempts}/${MAX_ATTEMPTS} - ${formatClock(seconds * 100)}`;
  },
};
