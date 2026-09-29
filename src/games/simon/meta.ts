import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "simon",
  title: "Simon",
  description: "Memoriza la secuencia de colores y repetila. Cada ronda suma un paso mas: gana quien aguanta mas lejos.",
  path: "/games/simon/",
  controls: "Clic o toque los colores repitiendo la secuencia.",
  howTo: {
    intro: "Memorizá la secuencia de colores y repetila. Cada ronda suma un paso más.",
    actions: [
      { title: "Repetir", icons: ["click", "tap"] },
    ],
  },
  accent: "#818cf8",
  category: "Reflejos",
  order: 240,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 180,
};
