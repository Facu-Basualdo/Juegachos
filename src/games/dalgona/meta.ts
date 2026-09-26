import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "dalgona",
  title: "Dalgona",
  description:
    "La prueba de la galleta de azúcar del Juego del Calamar. Elegís una lata a ciegas y te toca un círculo, un triángulo, una estrella o el temido paraguas. Tenés que sacar la figura del caramelo con una aguja sin que se parta: si vas rápido o te salís de la línea, cruje. Lamela para ablandarla.",
  path: "/games/dalgona/",
  controls:
    "Durante el 3, 2, 1 elegí una lata (clic, toque o 1-4). Después seguí el contorno arrastrando la aguja con el mouse o el dedo, despacio y sobre la línea. Mantené L o el botón LAMER para ablandar la galleta.",
  accent: "#d98c34",
  category: "Precisión",
  order: 1030,
  added: "2026-09-25",
  mobile: true,
};

/** Puntos de la figura (el paraguas vale más) más 3 por segundo sobrante; 0 si se rompe. */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${Math.round(n)} pts`,
};
