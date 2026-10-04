import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "el-cohete",
  title: "El Cohete",
  description:
    "Un casino de los años 50 y un cohete de hojalata que despega con tus fichas arriba. El multiplicador sube y sube hasta que explota de la nada: cobrá a tiempo y ganás, quedate de más y lo perdés todo. Cuatro vuelos para hacer saltar la banca.",
  path: "/games/el-cohete/",
  controls:
    "Elegí cuánto apostar tocando una ficha (o las teclas 1-5) y apretá ESPACIO o el botón APOSTAR. En vuelo, tocá la pantalla (o ESPACIO) para cobrar antes de que explote.",
  howTo: {
    intro: "Apostá, mirá cómo sube el multiplicador y cobrá antes de que explote.",
    actions: [
      { title: "Elegí la apuesta", icons: ["click", "tap"], note: "tocá una ficha" },
      { title: "Apostar", icons: ["space", "btn:APOSTAR"] },
      { title: "Cobrar", icons: ["space", "click", "tap"], note: "tocá la pantalla antes de que explote" },
    ],
  },
  accent: "#ffd36a",
  category: "Reflejos",
  order: 1060,
  added: "2026-10-04",
  mobile: true,
};

/** Fichas al final de los diez vuelos (se arranca con 1.000). */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${Math.round(n).toLocaleString("es-AR")} fichas`,
};
