import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "dunk-shot",
  title: "Dunk Shot",
  description: "Estira, apunta y encesta la pelota en el aro siguiente encadenando canastas perfectas.",
  path: "/games/dunk-shot/",
  controls: "Arrastrá para estirar, apuntá y soltá para encestar.",
  howTo: {
    intro: "Estirá, apuntá y encestá en el aro siguiente. Encadená canastas perfectas.",
    actions: [
      { title: "Tirar", icons: ["drag", "swipe"], note: "estirá y soltá" },
    ],
  },
  accent: "#ff7a45",
  category: "Precisión",
  order: 130,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 180,
};
