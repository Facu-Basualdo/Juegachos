import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "color-memory",
  title: "Memoria de Color",
  description:
    "Un color aparece unos segundos y desaparece. Recreálo de memoria con matiz, saturación y brillo. Tres rondas, un promedio de aciertos.",
  path: "/games/color-memory/",
  accent: "#a855f7",
  category: "Precisión",
  order: 340,
  added: "2026-07-07",
  mobile: true,

  roomTimeLimitSec: 120,
};

export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n.toFixed(1)}%`,
};
