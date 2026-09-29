import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "city-bloxx",
  title: "Skyline",
  description: "Suelta cada piso desde la grúa en el momento justo y levanta el rascacielos más alto sin que el edificio pierda el equilibrio.",
  path: "/games/city-bloxx/",
  controls: "Espacio, clic o toque para soltar cada piso en el momento justo.",
  howTo: {
    intro: "Soltá cada piso desde la grúa en el momento justo y levantá el edificio más alto sin que se caiga.",
    actions: [
      { title: "Soltar", icons: ["space", "click", "tap"] },
    ],
  },
  accent: "#d9843f",
  category: "Precisión",
  order: 70,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 180,
};
