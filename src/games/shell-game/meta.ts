import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "shell-game",
  title: "El Trile",
  description: "Sigue con la mirada el vaso que oculta la moneda. !Cada nivel mezcla mas rapido, hace mas pases y agrega mas vasos!",
  path: "/games/shell-game/",
  controls: "Clic o toque en el vaso que oculta la moneda.",
  accent: "#ffdd53",
  category: "Reflejos",
  order: 210,
  added: "2026-07-03",
  mobile: true,

};

export const scoring: GameScoring = {
  // Las partidas de sala no cuentan para el ranking global: en sala reporta otro puntaje que el nivel alcanzado del ranking solo.
  roomRanked: false,
  direction: "higher",
  format: (n) => `Nivel ${n}`,
};
