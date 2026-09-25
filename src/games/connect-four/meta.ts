import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "connect-four",
  title: "Conecta 4",
  description:
    "Solta fichas y alinea 4 en fila, columna o diagonal. Solo es contra una IA dificil (racha de victorias); en sala es PvP por turnos.",
  path: "/games/connect-four/",
  controls: "Clic o toque en una columna para soltar tu ficha.",
  accent: "#facc15",
  category: "Puzzle",
  order: 270,
  added: "2026-07-04",
  mobile: true,

};

export const scoring: GameScoring = {
  direction: "higher",
  // Las partidas de sala no cuentan para el ranking global: en sala son duelos 1v1 contra humanos y el puntaje es otro que la racha contra la IA del modo solo.
  roomRanked: false,
};
