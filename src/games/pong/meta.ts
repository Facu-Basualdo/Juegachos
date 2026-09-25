import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "pong",
  title: "PONG",
  description: "Pong clasico: en la landing, un jugador contra la IA; en sala, duelos 1v1 arbitrados por el game server (el impar juega vs IA).",
  path: "/games/pong/",
  controls: "Mouse, flechas o W/S para mover tu paleta. En sala, primero a 3 goles.",
  accent: "#ffffff",
  category: "Arcade",
  order: 220,
  added: "2026-07-03",
  mobile: true,

};

export const scoring: GameScoring = {
  direction: "higher",
  // Las partidas de sala no cuentan para el ranking global: en sala es PvP contra humanos; el ranking solo es contra la IA.
  roomRanked: false,
};
