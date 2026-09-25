import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "word-bomb",
  title: "Bomba Palabra",
  description:
    "Bomba de palabras por turnos: aparece un fragmento (una silaba o combo de letras) y tenes hasta que se agote la mecha para escribir una palabra real que lo contenga. Si explota perdes una vida; el ultimo en pie gana. Solo se juega en salas.",
  path: "/games/word-bomb/",
  controls: "Escribi una palabra que contenga el fragmento y Enter, antes de que se agote la mecha.",
  accent: "#c0392b",
  category: "Party",
  order: 280,
  added: "2026-07-07",
  mobile: true,

};

// El puntaje de sala es el puesto (`jugadores - puesto`), que depende de cuantos
// jugaron: no sirve como marca. El ranking global cuenta victorias en sala.
export const scoring: GameScoring = {
  direction: "higher",
  ranking: "wins",
};
