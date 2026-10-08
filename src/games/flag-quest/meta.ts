import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "flag-quest",
  title: "FlagQuest",
  description:
    "Aparece una bandera y tenés cinco segundos para elegir de qué país es entre cuatro opciones. Cuanto más rápido, más puntos.",
  path: "/games/flag-quest/",
  controls: "Elegí el país con un clic o un toque, o con las teclas 1 a 4.",
  howTo: {
    intro: "Aparece una bandera: elegí de qué país es entre cuatro. Tenés 5 segundos y cuanto más rápido, más puntos.",
    actions: [{ title: "Responder", icons: ["click", "tap", "keys:1 2 3 4"] }],
  },
  accent: "#8b2e1f",
  category: "Puzzle",
  order: 1080,
  added: "2026-10-07",
  mobile: true,
  // La ronda termina sola (15 x 6.1 s), asi que no lo necesita como corte: el tope
  // da un vencimiento unico por ronda, que es parte de la semilla de las banderas
  // (ver roomSeed en Game.ts). Sin el, la revancha repetia las mismas.
  roomTimeLimitSec: 150,
  seo: {
    title: "FlagQuest: adiviná la bandera, juego de banderas online gratis",
  },
};

// Dos tableros: el solitario con vidas (sin fin, sube de nivel) y la ronda de sala
// de 15 banderas fijas. No son comparables entre si: uno puede durar 40 banderas.
export const scoring: GameScoring = {
  direction: "higher",
  variants: ["clasico", "sala"],
  variantLabel: (v) => (v === "sala" ? "Salas (15 banderas)" : "Clásico (3 vidas)"),
  format: (n) => `${Math.round(n)} pts`,
};
