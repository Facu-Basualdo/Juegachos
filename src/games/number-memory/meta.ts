import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "number-memory",
  title: "Número Fugaz",
  description: "Memorizá el número que aparece un instante y escribilo cuando se esfuma. Cada acierto suma un dígito.",
  path: "/games/number-memory/",
  controls: "Elegí modo, mirá el número, y cuando desaparezca tipealo (teclado o teclas en pantalla) y confirmá con OK/Enter.",
  accent: "#ffca57",
  category: "Puzzle",
  order: 45,
  added: "2026-07-09",
  mobile: true,

  roomTimeLimitSec: 120,
};

// Dos modos, cada uno con su ranking (mas digitos = mejor):
//  - "aleatorio": un numero nuevo al azar cada ronda, un digito mas largo.
//  - "escalera": el mismo numero que crece, +1 digito por ronda.
export const scoring: GameScoring = {
  direction: "higher",
  variants: ["aleatorio", "escalera"],
  variantLabel: (v) => (v === "escalera" ? "Escalera" : "Aleatorio"),
  format: (n) => `${n} dígitos`,
};
