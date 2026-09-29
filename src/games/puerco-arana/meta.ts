import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "puerco-arana",
  title: "Puerco Araña",
  description: "Lanzá la telaraña, columpiate entre los edificios con impulso de péndulo y llegá lo más lejos que puedas.",
  path: "/games/puerco-arana/",
  controls: "Mantené clic, espacio o toque para lanzar la telaraña y soltá para columpiarte.",
  howTo: {
    intro: "Lanzá la telaraña y columpiate entre los edificios para llegar lo más lejos posible.",
    actions: [
      { title: "Telaraña", icons: ["space", "click", "hold"], note: "mantené y soltá para columpiarte" },
    ],
  },
  accent: "#ff5d8f",
  category: "Arcade",
  order: 330,
  added: "2026-07-05",
  mobile: true,

  roomTimeLimitSec: 180,
};
