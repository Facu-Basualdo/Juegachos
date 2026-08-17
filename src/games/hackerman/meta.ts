import type { GameEntry } from "../../games";
import { type GameScoring, formatClock } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "hackerman",
  title: "Hackerman",
  description:
    "Tres intrusiones seguidas al estilo de los hackeos de GTA Online: cloná la huella, descifrá la secuencia y forzá la clave. Gana el que las resuelve más rápido.",
  path: "/games/hackerman/",
  controls: "Flechas para navegar, Enter para confirmar. Resolvé las 3 fases lo más rápido posible.",
  accent: "#33ff88",
  category: "Puzzle",
  order: 390,
  added: "2026-07-10",
  mobile: false,

  roomTimeLimitSec: 240,
};

// El ranking se ordena por tiempo total (menor mejor). El score es el tiempo de
// resolver los 3 niveles en centisegundos; formatClock lo muestra como m:ss.cs.
export const scoring: GameScoring = {
  direction: "lower",
  format: (centis) => formatClock(centis),
};
