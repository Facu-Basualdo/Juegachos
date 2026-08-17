import type { GameEntry } from "../../games";
import { type GameScoring, formatMovesTime } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "tower-of-hanoi",
  title: "Torres de Hanoi",
  description: "Mové la torre de discos a la última varilla en la menor cantidad de movimientos.",
  path: "/games/tower-of-hanoi/",
  controls: "Clic o toque para elegir el disco y la varilla de destino.",
  accent: "#f5a623",
  category: "Puzzle",
  order: 280,
  added: "2026-07-04",
  mobile: true,

  roomTimeLimitSec: 180,
};

export const scoring: GameScoring = {
  // El ranking se ordena por movimientos (menos mejor) y el tiempo desempata.
  // Cada puntaje codifica ambos en un solo numero (ver encodeMovesTime):
  // movimientos manda el orden y el tiempo se muestra al lado.
  direction: "lower",
  variants: ["3", "4", "5", "6", "7"],
  variantLabel: (v) => `${v} discos`,
  format: formatMovesTime,
};
