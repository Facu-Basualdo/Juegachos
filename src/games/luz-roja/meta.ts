import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "luz-roja",
  title: "Luz Roja, Luz Verde",
  description:
    "La muñeca gigante canta de espaldas y vos corrés hacia la línea roja. Cuando se da vuelta y se le prenden los ojos, quedate quieto: si te movés un pelo, quedás eliminado. La canción cambia de ritmo cada vez, a veces amaga y frenar no es instantáneo. Tenés 45 segundos para cruzar. Solo se juega en salas.",
  path: "/games/luz-roja/",
  controls:
    "Corré con WASD o las flechas (en el celu: arrastrá el dedo) y soltá antes de que la muñeca se dé vuelta.",
  accent: "#d0232b",
  category: "Party",
  order: 1000,
  added: "2026-09-25",
  mobile: true,
  /**
   * El server corta solo a los 45s (al que no cruzo lo elimina), asi que esto es
   * la red por si el server se cae DESPUES de largar: 45s + congelado + espera del
   * roster dan ~56s, y el deadline de la sala ya suma 10s de navegacion.
   */
  roomTimeLimitSec: 70,
};

/**
 * El que pasa suma 100 + los segundos que le sobraron; el que no, su avance hacia la
 * meta (0-100). Asi un solo numero ordena bien a todos: cualquiera que paso le gana a
 * cualquiera que no, y entre los que no pasaron gana el que llego mas lejos.
 */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => (n >= 100 ? `pasó (+${(n - 100).toFixed(1)} s)` : `${Math.round(n)}% del camino`),
};
