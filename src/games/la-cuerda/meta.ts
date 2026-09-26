import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "la-cuerda",
  title: "La Cuerda",
  description:
    "Un puente angosto sobre el vacío y dos cuerdas enormes que giran cada vez más rápido, cada una para su lado. Saltalas en el momento justo, no te caigas por el tramo roto y cuidate de los empujones: gana el que llega más lejos, y si cruzás, mejor todavía. Solo se juega en salas.",
  path: "/games/la-cuerda/",
  controls:
    "Movete con WASD, mirá con el mouse (hacé clic para capturarlo, ESC lo suelta), saltá con ESPACIO y empujá con F. En el celu: joystick a la izquierda, arrastrá a la derecha para mirar y tocá SALTAR o EMPUJAR. El golpe de cada cuerda contra el puente te marca el ritmo.",
  accent: "#f4a6bf",
  category: "Party",
  order: 1030,
  added: "2026-09-25",
  mobile: true,
  /**
   * El server corta solo a los 90s (y al que no cruzo para entonces lo deja afuera).
   * Esto es la red por si el server se cae DESPUES de largar.
   */
  roomTimeLimitSec: 120,
};

/**
 * Metros avanzados sobre el puente; el que cruza suma 100 + los segundos que le
 * sobraron, asi cualquiera que cruzo le gana a cualquiera que no.
 */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => (n >= 100 ? `cruzó (+${(n - 100).toFixed(1)} s)` : `${n.toFixed(1)} m`),
};
