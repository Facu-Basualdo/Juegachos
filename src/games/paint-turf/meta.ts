import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "paint-turf",
  title: "Manchon",
  description:
    "Captura la zona a los brochazos: sos un pincel suelto sobre una hoja y pintas cada celda por la que pasas, robandole las que ya eran de otro. Tenes un salpicon con enfriamiento que pinta un circulo grande y deja aturdido al que agarre adentro. A los 90 segundos gana el que se quedo con mas tablero. Solo se juega en salas.",
  path: "/games/paint-turf/",
  controls: "Movete con WASD o las flechas (en el celu arrastra el dedo) y salpica con ESPACIO.",
  accent: "#e0523f",
  category: "Party",
  order: 970,
  added: "2026-08-20",
  mobile: true,
  /**
   * El server termina la ronda solo a los 90s pase lo que pase, asi que en teoria
   * esto sobra (como en Basta o Impostor). Esta igual como red: si el server se
   * cae DESPUES de que la partida arranco, el cliente no ve nunca el "over" y sin
   * tope la ronda quedaria colgada para toda la sala. El numero es un techo, no la
   * duracion: 90s de partida + el congelado inicial + la espera del roster dan
   * ~105s, y el deadline de la sala ya suma 10s de navegacion. Se muestra en el
   * briefing, asi que tampoco conviene inflarlo: al lado de la descripcion, que
   * dice los 90 segundos, un tope muy alto se lee como si la partida durara eso.
   */
  roomTimeLimitSec: 120,
};

/**
 * El puntaje son las celdas propias al terminar (el tablero son 35x23 = 805). Se
 * formatea con la unidad porque un "214" pelado en la tabla de la ronda no dice
 * nada.
 */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${Math.round(n)} celdas`,
};
