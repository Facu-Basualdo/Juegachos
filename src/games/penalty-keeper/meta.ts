import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "penalty-keeper",
  title: "Keepers!",
  description: "Sos el arquero en una tanda infinita de penales: movete y saltá para atajar. Tres goles y se termina.",
  path: "/games/penalty-keeper/",
  controls: "Flechas o mouse para moverte, y espacio o clic para saltar.",
  accent: "#38e07b",
  category: "Reflejos",
  order: 2,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 150,
};
