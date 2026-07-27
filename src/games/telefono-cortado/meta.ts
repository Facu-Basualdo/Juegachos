import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "telefono-cortado",
  title: "Telefono Cortado",
  description: "Dibuja lo que lees y describe lo que ves. Juego en cadena.",
  category: "Party",
  path: "/games/telefono-cortado/",
  added: "2026-07-27",
  order: 950,
  controls: "Usa el raton o tacto para dibujar, teclado para escribir.",
  roomsHidden: false,
  roomTimeLimitSec: 60
};

export const scoring: GameScoring = {
  direction: "higher",
};
