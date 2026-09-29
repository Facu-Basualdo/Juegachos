import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "mini-frogger",
  title: "Cruce Mortal",
  description: "Cruza calles transitadas y ríos saltando sobre troncos flotantes en el momento justo.",
  path: "/games/mini-frogger/",
  controls: "Flechas o WASD, o tocá el borde de la pantalla, para saltar en cada dirección.",
  howTo: {
    intro: "Cruzá calles llenas de autos y ríos saltando sobre los troncos en el momento justo.",
    actions: [
      { title: "Saltar", icons: ["arrows", "wasd", "tap-sides"], note: "hacia donde querés ir" },
    ],
  },
  accent: "#39ff14",
  category: "Arcade",
  order: 100,
  added: "2026-07-03",
  mobile: true,

};
