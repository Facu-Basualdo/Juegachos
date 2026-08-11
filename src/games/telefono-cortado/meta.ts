import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "telefono-cortado",
  title: "Telefono Cortado",
  description: "Escribi una frase, dibuja la de otro y adivina que quiso decir un tercero.",
  category: "Party",
  path: "/games/telefono-cortado/",
  added: "2026-07-27",
  order: 950,
  controls: "Mouse o dedo para dibujar, teclado para escribir y adivinar.",
  hidden: true,
};

// Sin `scoring`: el puntaje de sala es placement-based, o sea el default
// `{ direction: "higher" }` (ver `shared/scoring.ts`).
//
// Sin `roomTimeLimitSec`: el server arbitra todas las fases con `setTimeout` propio,
// asi que la ronda llega a game over sola aunque todos esten idle — igual que Basta,
// Impostor, Bomba Palabra y Cadena de Palabras.
