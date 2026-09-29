import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "blind-time",
  title: "Crono Ciego",
  description: "Detén el cronómetro a ciegas lo más cerca posible del tiempo objetivo asignado.",
  path: "/games/blind-time/",
  controls: "ENTER o clic para arrancar, y de nuevo para frenar el cronómetro a ciegas.",
  howTo: {
    intro: "Frená el cronómetro a ciegas lo más cerca posible del tiempo que te piden.",
    actions: [
      { title: "Arrancar y frenar", icons: ["enter", "click", "tap"] },
    ],
  },
  accent: "#ffdd53",
  category: "Precisión",
  order: 200,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 60,
};

export const scoring: GameScoring = {
  direction: "lower",
  format: (n) => `${Math.round(n)} ms`,
};
