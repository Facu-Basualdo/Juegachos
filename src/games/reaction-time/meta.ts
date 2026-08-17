import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "reaction-time",
  title: "Reflex",
  description: "Pon a prueba tus reflejos en este juego de 5 rondas. El puntaje final es tu tiempo de reacción promedio.",
  path: "/games/reaction-time/",
  controls: "Clic o ENTER apenas cambie el color, lo más rápido que puedas.",
  accent: "#39ff14",
  category: "Reflejos",
  order: 60,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 90,
};

export const scoring: GameScoring = {
  direction: "lower",
  format: (n) => `${Math.round(n)} ms`,
};
