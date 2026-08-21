import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";
import { decodeScore } from "./game/constants";

export const meta: GameEntry = {
  id: "typing-race",
  title: "Final Sentence",
  description:
    "Thriller de mecanografia: un revolver en la sien y cada error carga una bala. Escribi las frases sin fallar y sobrevivi la ruleta. Solo uno queda en pie.",
  path: "/games/typing-race/",
  controls: "Escribí las frases con el teclado, sin errores.",
  accent: "#c1121f",
  category: "Reflejos",
  order: 270,
  added: "2026-07-04",
  mobile: false,

  roomTimeLimitSec: 180,
};

/**
 * Puntaje codificado = frases superadas (primario) + ppm (desempate), ver
 * `encodeScore`. Asi el ranking (global y de sala) ordena primero por frases y
 * despues por velocidad. Variante propia ("final") para arrancar con un tablero
 * limpio (el score cambio de escala respecto de "Mecano" y de la version previa).
 */
export const scoring: GameScoring = {
  direction: "higher",
  variants: ["final"],
  variantLabel: () => "Supervivencia",
  format: (n) => {
    const { frases, ppm } = decodeScore(n);
    return `${frases} ${frases === 1 ? "frase" : "frases"} · ${ppm} ppm`;
  },
};
