import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "stack-tower",
  title: "Torre Infinita",
  description: "Suelta cada bloque en el momento justo para apilar la torre más alta sin que se te escape.",
  path: "/games/stack-tower/",
  controls: "Espacio, clic o toque para soltar cada bloque.",
  howTo: {
    intro: "Soltá cada bloque en el momento justo para apilar la torre más alta.",
    actions: [
      { title: "Soltar", icons: ["space", "click", "tap"] },
    ],
  },
  accent: "#5ce1a6",
  category: "Precisión",
  order: 30,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 180,
};
