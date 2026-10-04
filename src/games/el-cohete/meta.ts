import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "el-cohete",
  title: "El Cohete",
  description:
    "Un casino de los años 50 y un cohete de hojalata que despega con tus fichas arriba. El multiplicador sube y sube hasta que explota: bajate a tiempo y cobrás. Si el motor tose con humo blanco es un amague; si sale humo negro, saltá ya. Diez vuelos para hacer saltar la banca.",
  path: "/games/el-cohete/",
  controls:
    "Elegí la apuesta con las fichas (o las flechas) y apretá ESPACIO o el botón APOSTAR. En vuelo, ESPACIO o BAJARME para cobrar antes de que explote. Humo blanco: amague. Humo negro: explota.",
  howTo: {
    intro: "Apostá, mirá cómo sube el multiplicador y bajate antes de que explote.",
    actions: [
      { title: "Apostar", icons: ["space", "btn:APOSTAR"], note: "elegí cuánto con las fichas" },
      { title: "Bajarse", icons: ["space", "btn:BAJARME"], note: "humo negro: ¡ya!" },
      { title: "Apuesta", icons: ["arrows", "click", "tap"], note: "x2, ½ o sumá fichas" },
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
