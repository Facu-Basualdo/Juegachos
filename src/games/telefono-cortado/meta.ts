import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "telefono-cortado",
  title: "Telefono Cortado",
  description: "Escribi una frase, dibuja la de otro y adivina que quiso decir un tercero.",
  category: "Party",
  path: "/games/telefono-cortado/",
  // Volvio al roster (arreglado) en esta fecha; habia entrado el 2026-07-27 y se retiro.
  added: "2026-09-25",
  mobile: true,

  order: 950,
  controls: "Mouse o dedo para dibujar (con deshacer), teclado para escribir y adivinar.",
};

//
// Sin `roomTimeLimitSec`: el server arbitra todas las fases con `setTimeout` propio,
// asi que la ronda llega a game over sola aunque todos esten idle — igual que Basta,
// Impostor, Bomba Palabra y Cadena de Palabras.

// El puntaje de sala es el puesto (`jugadores - puesto`), que depende de cuantos
// jugaron: no sirve como marca. El ranking global cuenta victorias en sala.
export const scoring: GameScoring = {
  direction: "higher",
  ranking: "wins",
};
