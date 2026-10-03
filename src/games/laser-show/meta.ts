import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "laser-show",
  title: "Láser Show",
  description:
    "Un escenario redondo de programa de TV y lásers que lo barren cada vez más rápido. Saltá los rojos, que van rasantes; agachate ante los celestes, que van altos; salí corriendo de la lluvia de rayos y cuidate de los empujones. Gana el último en pie. Solo se juega en salas.",
  path: "/games/laser-show/",
  controls:
    "Movete con WASD o las flechas, saltá con ESPACIO, agachate manteniendo SHIFT o C y empujá con F o clic (en el celu: arrastrá el dedo y tocá SALTAR, AGACHARSE o EMPUJAR). Los lásers rojos se saltan y los celestes se esquivan agachado.",
  howTo: {
    intro: "Saltá los lásers rojos, agachate ante los celestes y salí de la lluvia de rayos.",
    actions: [
      { title: "Movimiento", icons: ["wasd", "arrows", "swipe"] },
      { title: "Saltar", icons: ["space", "btn:SALTAR"] },
      { title: "Agacharse", icons: ["key:SHIFT", "key:C", "btn:AGACHARSE"], note: "mantener" },
      { title: "Empujar", icons: ["key:F", "click", "btn:EMPUJAR"] },
    ],
  },
  accent: "#ff4a1c",
  category: "Party",
  order: 1040,
  added: "2026-10-02",
  mobile: true,
  roomsOnly: true,
  /**
   * El server termina la partida solo (queda uno en pie y juega su vuelta de honor,
   * se caen todos, o el tope de 150 s), y un jugador quieto cae al primer laser
   * rasante. Esto es la red por si el server se cae DESPUES de largar: 150 s de show +
   * la cuenta regresiva + la espera del roster.
   */
  roomTimeLimitSec: 180,
};

/** Segundos aguantados. El ultimo en pie suma la vuelta de honor, asi que siempre gana. */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n.toFixed(1)} s`,
};
