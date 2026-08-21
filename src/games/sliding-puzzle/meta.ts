import type { GameEntry } from "../../games";
import { type GameScoring, formatTimeMoves } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "sliding-puzzle",
  title: "Numerix",
  description: "Ordena los numeros deslizando filas o columnas completas hacia el espacio vacio.",
  path: "/games/sliding-puzzle/",
  controls: "Flechas, clic o deslizá para mover la fila o columna hacia el hueco.",
  accent: "#0ff8ff",
  category: "Puzzle",
  order: 80,
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
