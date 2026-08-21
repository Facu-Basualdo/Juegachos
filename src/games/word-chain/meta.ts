import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "word-chain",
  title: "Cadena de Palabras",
  description:
    "Encadenados por turnos: al primero le toca una letra al azar y escribe una palabra que empiece con ella; la ultima letra de esa palabra es la del siguiente. Tenes una sola vida, asi que si se te acaba el reloj quedas afuera. El ultimo en pie gana. Solo se juega en salas.",
  path: "/games/word-chain/",
  controls:
    "Escribi una palabra que empiece con la letra del eslabon y Enter, antes de que se acabe el reloj.",
  accent: "#ff6a1f",
  category: "Party",
  order: 290,
  added: "2026-07-09",
  mobile: true,

};
