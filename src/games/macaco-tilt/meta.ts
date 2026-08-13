import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "macaco-tilt",
  title: "Macaco Tilt",
  description:
    "Mantené al mono en equilibrio sobre el tablón de bambú mientras se le rompen los extremos y el viento lo empuja.",
  path: "/games/macaco-tilt/",
  controls: "Caminá con ← → (o A/D), o tocá cada lado de la pantalla, para reacomodar el peso.",
  accent: "#f4d03f",
  category: "Precisión",
  order: 960,
  added: "2026-08-12",
};

export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n.toFixed(2)} s`,
};
