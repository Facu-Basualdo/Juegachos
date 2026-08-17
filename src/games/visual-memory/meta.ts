import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "visual-memory",
  title: "Constelación",
  description: "Se encienden unas celdas de la grilla un instante: memorizá el patrón y volvé a marcarlas. Cada nivel suma celdas.",
  path: "/games/visual-memory/",
  controls: "Mirá qué celdas se encienden y, cuando se apaguen, tocá esas mismas. Tenés 3 vidas.",
  accent: "#5fe1ff",
  category: "Puzzle",
  order: 47,
  added: "2026-07-09",
  mobile: true,

  roomTimeLimitSec: 120,
};

// Scoring por defecto: { direction: "higher" } (nivel mas alto = mejor). No se
// declara `export const scoring` a proposito (el default lo cubre).
