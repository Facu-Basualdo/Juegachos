import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "timing-bar",
  title: "Al Centro",
  description: "Una regla con un marcador que barre de lado a lado y acelera cada ronda. Frenalo lo mas cerca del centro que puedas: el puntaje final es el promedio de 5 rondas.",
  path: "/games/timing-bar/",
  controls: "ESPACIO (o clic) para frenar el marcador. Cuanto mas al centro, mas puntos.",
  accent: "#00f0ff",
  category: "Reflejos",
  order: 65,
  added: "2026-07-07",
  mobile: true,

  roomTimeLimitSec: 90,
};

export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${Math.round(n)} pts`,
};
