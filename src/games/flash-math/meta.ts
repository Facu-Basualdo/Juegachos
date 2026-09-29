import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "flash-math",
  title: "Cálculo Flash",
  description:
    "Aparecen numeros de a uno que se suman y se restan. Memorizalos y escribi el resultado final.",
  path: "/games/flash-math/",
  controls: "Miralos aparecer y al final tecla el resultado con el teclado numerico (ENTER = OK).",
  howTo: {
    intro: "Aparecen números que se suman y se restan: memorizalos y escribí el resultado final.",
    actions: [
      { title: "Responder", icons: ["keys:1 2 3", "tap"], note: "el resultado" },
      { title: "Confirmar", icons: ["enter", "btn:OK"] },
    ],
  },
  accent: "#c8452e",
  category: "Puzzle",
  order: 145,
  added: "2026-07-08",
  mobile: true,

  roomTimeLimitSec: 120,
};

export const scoring: GameScoring = {
  // Las partidas de sala no cuentan para el ranking global: en sala reporta otro puntaje (`roomScore`) que el del ranking solo.
  roomRanked: false,
  direction: "higher",
  format: (n) => `${Math.round(n)} pts`,
};
