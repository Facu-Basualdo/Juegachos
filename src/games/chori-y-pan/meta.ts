import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "chori-y-pan",
  title: "Chori y Pan",
  description:
    "Un chorizo y un pan perdidos en el templo de la parrilla sagrada. El Chori camina sobre las brasas y el agua lo empapa; el Pan nada en el agua y las brasas lo queman. Pisá botones, mové palancas y empujá cajas para que los dos lleguen a su puerta. En salas, carrera de parejas por tres salas del templo, y el que sobra apuesta.",
  path: "/games/chori-y-pan/",
  controls: "Chori con las flechas, Pan con W A D. Saltá con arriba / W. Al chimichurri vencido no lo toca nadie.",
  howTo: {
    intro: "Los dos tienen que llegar a su puerta. El Chori pisa brasas; el Pan, agua.",
    actions: [
      { title: "Chori", icons: ["arrows"], note: "brasas sí, agua no" },
      { title: "Pan", icons: ["wasd"], note: "agua sí, brasas no" },
    ],
  },
  accent: "#ff7a1a",
  category: "Party",
  order: 1070,
  added: "2026-10-04",
  mobile: false,
  /**
   * El game server corta la carrera a los 300 s; esto es la red por si el server se cae
   * despues de largar: carrera + apuesta (12 s) + cuenta regresiva + espera del roster.
   */
  roomTimeLimitSec: 330,
};

/**
 * Tiempo de las tres salas menos 2 s por gema, en milisegundos: menos es mejor. En sala
 * la pareja que no salio del templo reporta 10.000.000 - salas * 1.000.000 (ver
 * `roomScore`), que ordena despues de todas las que terminaron. Las carreras de sala no
 * van al ranking global: son online, con otros niveles y de a dos personas distintas.
 */
export const scoring: GameScoring = {
  direction: "lower",
  roomRanked: false,
  format: (ms) => {
    if (ms >= 7_000_000) return `${Math.round((10_000_000 - ms) / 1_000_000)}/3 salas`;
    const t = ms / 1000;
    const m = Math.floor(t / 60);
    return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
  },
};
