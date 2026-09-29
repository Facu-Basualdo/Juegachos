import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "neon-cylinder",
  title: "Neon Vortex",
  description: "Esquiva las porciones que giran alrededor del cilindro neón y sobrevive el mayor tiempo posible.",
  path: "/games/neon-cylinder/",
  controls: "Flechas o A/D, o tocá izquierda y derecha, para girar el cilindro.",
  howTo: {
    intro: "Esquivá los bloques que giran alrededor del cilindro y aguantá lo más que puedas.",
    actions: [
      { title: "Girar", icons: ["ad", "arrows-lr", "tap-sides"] },
    ],
  },
  accent: "#ff00e6",
  category: "Arcade",
  order: 10,
  added: "2026-07-03",
  mobile: true,

};
