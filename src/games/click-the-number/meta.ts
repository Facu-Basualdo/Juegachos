import type { GameEntry } from "../../games";
import { type GameScoring, formatClock } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "click-the-number",
  title: "Click the Number",
  description: "Los numeros del 1 al 25 desordenados en una grilla: tocalos en orden lo mas rapido posible.",
  path: "/games/click-the-number/",
  controls: "Clic o toque en cada numero, del mas chico al mas grande, contrarreloj.",
  accent: "#22d3ee",
  category: "Reflejos",
  order: 400,
  added: "2026-07-16",
  mobile: true,

  roomTimeLimitSec: 90,
};

export const scoring: GameScoring = {
  // El puntaje es el tiempo en centesimas: menos es mejor. No hay movimientos
  // que codificar (cada acierto es forzoso), asi que va crudo con formatClock.
  direction: "lower",
  variants: ["3", "4", "5"],
  variantLabel: (v) => `${v}x${v}`,
  format: formatClock,
};
