import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "cannon-dodge",
  title: "Cannon Dodge",
  description:
    "Sobreviví en una isla pirata esquivando las balas de cañón que la cruzan. Cuanto más aguantás, más difícil se pone.",
  path: "/games/cannon-dodge/",
  controls: "WASD o flechas para moverte por la isla y esquivar las balas. Aguantá lo máximo posible.",
  accent: "#f2b134",
  category: "Reflejos",
  order: 360,
  added: "2026-07-09",
  mobile: true,

};

// Puntaje = tiempo sobrevivido en segundos (mayor es mejor, con un decimal).
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n.toFixed(1)} s`,
};
