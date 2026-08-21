import type { GameEntry } from "../../games";
import { type GameScoring, formatClock } from "../../shared/scoring-core";
import { LEVEL_COUNT } from "./game/levels";

export const meta: GameEntry = {
  id: "circuit-breaker",
  title: "Circuit Breaker",
  description:
    "Lleva la senal por el circuito hasta el conector destino sin tocar las paredes: si chocas, volves al inicio. Inspirado en el Circuit Breaker de GTA Online.",
  path: "/games/circuit-breaker/",
  controls: "Avanza sola; girá con las flechas o WASD para no tocar las paredes.",
  accent: "#33e39a",
  category: "Precisión",
  order: 320,
  added: "2026-07-06",
  mobile: true,

  roomTimeLimitSec: 180,
};

// El ranking se ordena por tiempo (menor mejor). Cada puntaje codifica el tiempo
// y la cantidad de choques en un solo numero (encodeTimeMoves): el tiempo manda el
// orden y los choques desempatan / se muestran al lado.
// Hay un board "general" (los niveles juntos) y uno por cada nivel; todos usan la
// misma direccion/formato, asi que alcanza con listarlos en `variants`.
const TIME_MOVES_BASE = 100000;
const levelVariants = Array.from({ length: LEVEL_COUNT }, (_, i) => `nivel-${i + 1}`);
export const scoring: GameScoring = {
  direction: "lower",
  format: (encoded) =>
    `${formatClock(Math.floor(encoded / TIME_MOVES_BASE))} - ${encoded % TIME_MOVES_BASE} choques`,
  variants: ["general", ...levelVariants],
  variantLabel: (v) => (v === "general" ? `General (${LEVEL_COUNT} niveles)` : `Nivel ${v.split("-")[1]}`),
};
