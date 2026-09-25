import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "marea-lava",
  title: "Marea de Lava",
  description:
    "Una pared de roca llena de salientes y la lava subiendo desde abajo, cada vez más rápido. Trepá saltando de plataforma en plataforma antes de que te alcance: gana el que llega más alto, y si llegás a la cima, mejor todavía. Solo se juega en salas.",
  path: "/games/marea-lava/",
  controls:
    "Movete con WASD o las flechas y saltá con ESPACIO (en el celu: arrastrá el dedo y tocá SALTAR). La sombra te marca dónde vas a caer.",
  accent: "#ff7a22",
  category: "Party",
  order: 1020,
  added: "2026-09-25",
  mobile: true,
  /**
   * El server corta solo a los 120s (para entonces la lava ya paso la cima), y la
   * lava alcanza sola a cualquiera que se quede quieto. Esto es la red por si el
   * server se cae DESPUES de largar.
   */
  roomTimeLimitSec: 150,
};

/**
 * Altura maxima en metros; el que llega a la cima suma 100 + los segundos que le
 * sobraron, asi cualquiera que llego le gana a cualquiera que no.
 */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => (n >= 100 ? `cima (+${(n - 100).toFixed(1)} s)` : `${n.toFixed(1)} m`),
};
