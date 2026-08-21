import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "sword-balance",
  title: "Pulso de Acero",
  description:
    "Mantené la espada en equilibrio sobre la mano el mayor tiempo posible antes de que se caiga.",
  path: "/games/sword-balance/",
  controls: "Mantené ← → (o A/D), o tocá y sostené cada lado de la pantalla, para equilibrar la espada.",
  accent: "#7fb0ff",
  category: "Precisión",
  order: 350,
  added: "2026-07-07",
  mobile: true,

};

export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n.toFixed(1)} s`,
};
