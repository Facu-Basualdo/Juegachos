import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "impostor",
  title: "Impostor",
  description:
    "Deduccion social: a todos menos al impostor se les muestra la misma palabra secreta. Por turnos cada uno da una pista de una palabra sin cantarla; el impostor solo sabe la categoria e improvisa. Despues votan quien es el impostor: si lo descubren tiene una chance de adivinar la palabra para robar la ronda. Solo se juega en salas.",
  path: "/games/impostor/",
  controls:
    "En tu turno escribi UNA palabra-pista relacionada a la secreta (el impostor improvisa). Despues vota al que creas impostor. Si sos el impostor descubierto, adivina la palabra.",
  accent: "#c9313b",
  category: "Party",
  order: 390,
  added: "2026-07-10",
};
