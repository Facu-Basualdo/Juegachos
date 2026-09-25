import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "derrumbe",
  title: "Derrumbe",
  description:
    "Cuatro pisos de bloques colgados sobre la lava y cada bloque que pisás se cae medio segundo después. No podés quedarte quieto: corré, saltá los agujeros y rompele el piso a los demás. Gana el último que queda en pie. Solo se juega en salas.",
  path: "/games/derrumbe/",
  controls:
    "Corré con WASD o las flechas, saltá con ESPACIO y girá la cámara con Q / E o arrastrando el mouse (en el celu: joystick a la izquierda y botón SALTAR).",
  accent: "#d8463b",
  category: "Party",
  order: 990,
  added: "2026-09-24",
  mobile: true,
  /**
   * El server termina la partida solo (queda uno en pie, o el tope de 120s, y el
   * piso se pudre a partir de los 40s), asi que en teoria esto sobra, como en
   * Manchon. Esta de red: si el server se cae DESPUES de largar, el cliente no ve
   * nunca el "over" y sin tope la ronda quedaria colgada. 120s de partida + el
   * congelado + la espera del roster dan ~135s; el deadline de la sala ya suma 10s
   * de navegacion.
   */
  roomTimeLimitSec: 140,
};

/** Segundos aguantados. El ultimo en pie suma la vuelta de honor, asi que siempre gana. */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n.toFixed(1)} s`,
};
