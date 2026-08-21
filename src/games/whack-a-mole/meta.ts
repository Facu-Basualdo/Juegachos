import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "whack-a-mole",
  title: "Topos",
  description: "Aplasta todos los topos que asomen. Tienes 3 vidas y las pierdes al golpear bombas; los dorados valen mas. Ideal para picarse en salas con amigos.",
  path: "/games/whack-a-mole/",
  controls: "Clic o toque para aplastar los topos, evitando las bombas.",
  accent: "#6bbf5e",
  category: "Precisión",
  order: 250,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 120,
};
