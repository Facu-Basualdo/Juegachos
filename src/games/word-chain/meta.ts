import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "word-chain",
  title: "Cadena de Palabras",
  description:
    "Encadenados por turnos: al primero le toca una letra al azar y escribe una palabra que empiece con ella; la ultima letra de esa palabra es la del siguiente. Tenes una sola vida, asi que si se te acaba el reloj quedas afuera. El ultimo en pie gana. Solo se juega en salas.",
  path: "/games/word-chain/",
  controls:
    "Escribi una palabra que empiece con la letra del eslabon y Enter, antes de que se acabe el reloj.",
  howTo: {
    intro: "Escribí una palabra que empiece con la letra que te toca antes de que se acabe el reloj.",
    actions: [
      { title: "Escribir", icons: ["keyboard"] },
      { title: "Mandar", icons: ["enter"] },
    ],
  },
  accent: "#ff6a1f",
  category: "Party",
  order: 290,
  added: "2026-07-09",
  mobile: true,
  roomsOnly: true,

};

// El puntaje de sala es el puesto (`jugadores - puesto`), que depende de cuantos
// jugaron: no sirve como marca. El ranking global cuenta victorias en sala.
export const scoring: GameScoring = {
  direction: "higher",
  ranking: "wins",
};
