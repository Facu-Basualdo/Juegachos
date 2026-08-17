import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "mecano",
  title: "Mecano",
  description:
    "Juego de mecanografia: escribi la mayor cantidad de palabras en 30 segundos. El puntaje es tu velocidad en palabras por minuto.",
  path: "/games/mecano/",
  controls: "Escribí las palabras con el teclado. Espacio confirma cada palabra.",
  accent: "#a5b4fc",
  category: "Reflejos",
  order: 275,
  added: "2026-07-06",
  mobile: false,

  // Sin roomTimeLimitSec: el sprint de 30s llega solo al game over, asi que la
  // ronda no necesita reloj propio (ver CLAUDE.md, "Salas").
};

// Scoring is the default { direction: "higher" } (more PPM is better), so no
// `export const scoring` is needed here.
