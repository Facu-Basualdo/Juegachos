import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "flappy-bird",
  title: "Flappy Bird",
  description: "Aletea para mantener al pájaro en el aire y cruza la mayor cantidad de tubos sin chocar.",
  path: "/games/flappy-bird/",
  controls: "Espacio, clic o toque para aletear.",
  howTo: {
    intro: "Aleteá para mantener al pájaro en el aire y pasá la mayor cantidad de tubos.",
    actions: [
      { title: "Aletear", icons: ["space", "click", "tap"] },
    ],
  },
  accent: "#4ec0e6",
  category: "Arcade",
  order: 20,
  added: "2026-07-03",
  mobile: true,

};
