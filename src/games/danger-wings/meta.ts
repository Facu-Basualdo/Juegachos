import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "danger-wings",
  title: "Danger Wings",
  description:
    "Un cuervo atrapado en una celda de hierro: aleteá para rebotar entre las paredes sin rozar las púas que asoman en cada rebote.",
  path: "/games/danger-wings/",
  controls: "Espacio, clic o toque para aletear. Rebotá en las paredes; esquivá las púas.",
  howTo: {
    intro: "Un cuervo atrapado en una celda: aleteá para rebotar entre las paredes sin tocar las púas.",
    actions: [
      { title: "Aletear", icons: ["space", "click", "tap"] },
    ],
  },
  accent: "#caa14a",
  category: "Arcade",
  order: 5,
  added: "2026-07-13",
  mobile: true,

};
