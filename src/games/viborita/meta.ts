import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "viborita",
  title: "Viborita",
  seo: { title: "Slither.io online gratis en español" },
  description:
    "Una viborita que sigue al mouse: comé para crecer y hacé que las demás choquen la cabeza contra tu cuerpo, porque el que choca se convierte en comida. Mantené apretado para el turbo, que va al doble pero te cuesta largo. Online en una arena abierta con gente de todos lados, o en una sala con amigos donde gana la primera que llega a 600 de largo.",
  path: "/games/viborita/",
  controls: "Apuntá con el mouse y mantené apretado el click o Espacio para el turbo (en el celu, joystick y botón TURBO).",
  howTo: {
    intro: "Comé para crecer y hacé que las demás choquen contra tu cuerpo. No toques el de nadie.",
    actions: [
      { title: "Moverse", icons: ["mouse", "joystick"] },
      { title: "Turbo", icons: ["click", "space", "btn:TURBO"], note: "mantené apretado, gasta largo" },
    ],
  },
  accent: "#00f0ff",
  category: "Arcade",
  order: 1090,
  added: "2026-10-17",
  mobile: true,
  /**
   * Sin `roomTimeLimitSec`, a pedido del programador, y sin que eso pueda colgar la
   * ronda: termina sola cuando una humana llega a la meta de largo, o cuando ya no
   * queda ninguna viva. La que no toca nada sigue derecho y se estrella contra el borde
   * (el mapa de sala se cruza en menos de 20 s); la que da vueltas sin parar se la
   * terminan cortando los bots, y `room.afkMs` (45 s) es la ultima red. Si el server se
   * cae, el cliente reporta lo que tenia a los 20 s sin conexion.
   */
};

/**
 * El puntaje es el largo maximo de la vida. Las partidas de sala no van al ranking
 * global: mapa mas chico, una meta que corta la partida y una sola vida, asi que no se
 * comparan con la arena publica.
 */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${Math.round(n)} de largo`,
  roomRanked: false,
};
