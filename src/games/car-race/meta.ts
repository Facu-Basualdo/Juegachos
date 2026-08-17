import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "car-race",
  title: "Neon Drift",
  description: "Carrera 2D de drift: 6 circuitos (Mónaco, Shanghái, Silverstone y más) con boosts, conos y barreras, ranking por pista y salas online.",
  path: "/games/car-race/",
  controls: "Flechas o WASD para acelerar y girar; derrapá en las curvas.",
  accent: "#00f0ff",
  category: "Carreras",
  order: 110,
  added: "2026-07-03",
  mobile: true,

  roomTimeLimitSec: 240,
};

export const scoring: GameScoring = {
  direction: "lower",
  // Un ranking independiente por circuito (variante = id de la pista).
  variants: ["monaco", "shanghai", "silverstone", "red-dune", "glacier-loop", "magma-eight"],
  variantLabel: (v) =>
    ({
      monaco: "Mónaco",
      shanghai: "Shanghái",
      silverstone: "Silverstone",
      "red-dune": "Duna Roja",
      "glacier-loop": "Glaciar",
      "magma-eight": "Volcán",
    })[v] ?? v,
  format: (n) => {
    const m = Math.floor(n / 60000);
    const s = Math.floor((n % 60000) / 1000);
    const cs = Math.floor((n % 1000) / 10);
    return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  },
};
