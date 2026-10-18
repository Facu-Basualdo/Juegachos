import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "puerco-arana",
  title: "Puerco Araña",
  description: "Lanzá la telaraña, columpiate entre los edificios con impulso de péndulo y llegá lo más lejos que puedas.",
  path: "/games/puerco-arana/",
  controls: "Mantené clic, espacio o toque para lanzar la telaraña al anclaje marcado y soltá para salir disparado.",
  howTo: {
    intro: "Columpiate entre los edificios: colgado no te caés, lo que mata es soltarte sin nada a tiro.",
    actions: [
      { title: "Telaraña", icons: ["space", "click", "hold"], note: "mantené para engancharte al anclaje marcado, soltá para salir disparado" },
    ],
  },
  accent: "#ff5d8f",
  category: "Arcade",
  order: 330,
  added: "2026-07-05",
  mobile: true,

  roomTimeLimitSec: 180,
};
