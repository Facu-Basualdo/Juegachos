import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "helix-jump",
  title: "Helix Jump",
  description: "Rota la torre para hacer descender la bola a través de los huecos, esquivando los obstáculos de color.",
  path: "/games/helix-jump/",
  controls: "Flechas o A/D, o arrastrá, para rotar la torre.",
  accent: "#00ffcc",
  category: "Arcade",
  order: 55,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 180,
};
