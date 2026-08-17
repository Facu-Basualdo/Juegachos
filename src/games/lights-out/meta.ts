import type { GameEntry } from "../../games";
import { type GameScoring, formatTimeMoves } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "lights-out",
  title: "Lights Out",
  description: "Apaga todas las luces: cada toque invierte una celda y sus vecinas.",
  path: "/games/lights-out/",
  controls: "Clic o toque en una celda para invertirla junto a sus vecinas.",
  accent: "#ffd23f",
  category: "Puzzle",
  order: 290,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 90,
};

export const scoring: GameScoring = {
  // El ranking se ordena por tiempo (menor mejor). Cada puntaje codifica el
  // tiempo y los movimientos en un solo numero (ver encodeTimeMoves): el
  // tiempo manda el orden y los movimientos desempatan / se muestran al lado.
  direction: "lower",
  variants: ["3", "4", "5"],
  variantLabel: (v) => `${v}x${v}`,
  format: formatTimeMoves,
};
