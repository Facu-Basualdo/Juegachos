import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "ring-runner",
  title: "Ring Runner",
  description: "Un punto gira por un anillo blanco con una zona negra. Toca justo cuando el punto la cruza: cada acierto la achica y acelera el punto.",
  path: "/games/ring-runner/",
  controls: "Espacio, clic o toca cuando el punto pase por la zona negra.",
  howTo: {
    intro: "Tocá justo cuando el punto pasa por la zona negra: cada acierto la achica y lo acelera.",
    actions: [
      { title: "Tocar", icons: ["space", "click", "tap"] },
    ],
  },
  accent: "#00f3ff",
  category: "Precisión",
  order: 340,
  added: "2026-07-06",
  mobile: true,

  roomTimeLimitSec: 180,
};
