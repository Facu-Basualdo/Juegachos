import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "kunai-throw",
  title: "Kunai Strike",
  description: "Arroja kunais y clávalos en el tronco que gira sin que un kunai golpee a otro.",
  path: "/games/kunai-throw/",
  controls: "Espacio, clic o toque para arrojar el kunai.",
  accent: "#f5a623",
  category: "Precisión",
  order: 150,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 180,
};
