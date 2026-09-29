import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "neon-sawblades",
  title: "Neon Sawblades",
  description: "Corré y saltá sobre las sierras que caen para destruirlas, juntá las monedas y estirá el reloj lo máximo que puedas.",
  path: "/games/neon-sawblades/",
  controls: "Flechas para moverte y espacio para saltar (doble salto).",
  howTo: {
    intro: "Saltá sobre las sierras que caen para romperlas y juntá monedas para estirar el reloj.",
    actions: [
      { title: "Movimiento", icons: ["arrows-lr", "tap"], note: "en el celu, con los botones" },
      { title: "Saltar", icons: ["space", "tap"], note: "tiene doble salto" },
    ],
  },
  accent: "#ff2d78",
  category: "Arcade",
  order: 270,
  added: "2026-07-04",
  mobile: true,

};
