import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";
import { formatClock } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "boilerbound",
  title: "Boilerbound",
  description:
    "Esquivá los chorros de vapor que erupcionan del piso en patrones de jefe. Corré, saltá, colgate de las paredes y usá el dash para aguantar lo máximo posible.",
  path: "/games/boilerbound/",
  controls: "Flechas o A/D para correr, espacio para saltar y colgarte de las paredes, y dash para esquivar el vapor.",
  accent: "#ff8a3d",
  category: "Arcade",
  order: 290,
  added: "2026-07-05",
  mobile: true,

};

// El puntaje es el tiempo sobrevivido en centisegundos: mayor es mejor, se
// muestra como reloj (m:ss.cc).
export const scoring: GameScoring = {
  direction: "higher",
  format: (score) => formatClock(score),
};
