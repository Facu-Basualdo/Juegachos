import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "rhythm-tap",
  title: "Beat Fever",
  description: "Toca las notas de colores justo al cruzar la línea, encadena combos y sobrevive sin quedarte sin vida.",
  path: "/games/rhythm-tap/",
  controls: "Flechas según la figura, o tocá la columna, justo al cruzar la línea.",
  howTo: {
    intro: "Tocá las notas justo cuando cruzan la línea y encadená combos sin quedarte sin vida.",
    actions: [
      { title: "Tocar notas", icons: ["arrows", "tap"], note: "la flecha de cada figura" },
    ],
  },
  accent: "#ff3f81",
  category: "Ritmo",
  order: 40,
  added: "2026-07-03",
  mobile: true,

};
