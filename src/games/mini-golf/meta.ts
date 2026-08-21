import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "mini-golf",
  title: "Hole in None",
  description:
    "Tres hoyos de minigolf cartoon en 3D con molinetes, bumpers y atajos arriesgados. Embocá la pelota en la menor cantidad de golpes.",
  path: "/games/mini-golf/",
  controls:
    "Arrastrá desde la pelota para apuntar y dosificar la fuerza y soltá para pegar. Arrastrá fuera de la pelota para girar la cámara y usá la rueda para el zoom.",
  accent: "#5fc248",
  category: "Precisión",
  order: 350,
  added: "2026-07-07",
  mobile: true,

  roomTimeLimitSec: 300,
};

// El puntaje es el total de golpes de los 3 hoyos: menos es mejor.
export const scoring: GameScoring = {
  direction: "lower",
  format: (score) => `${score} golpes`,
};
