import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "agar",
  title: "Agar",
  seo: { title: "Agar.io online gratis en español" },
  description:
    "Sos una celula en una placa de cultivo: comete la comida para crecer y a las celulas con menos masa que vos, y escapale a las mas grandes. Cuanto mas grande, mas lenta. Se juega online en una arena abierta con gente de todos lados, o en una sala con amigos donde gana el primero que llega a 1000 de masa.",
  path: "/games/agar/",
  controls: "Mové el mouse para guiar a tu celula (en el celu, arrastrá el dedo).",
  howTo: {
    intro: "Comé para crecer y tragate a los más chicos. Escapale a los más grandes.",
    actions: [{ title: "Moverse", icons: ["mouse", "joystick"], note: "la célula va hacia el mouse" }],
  },
  accent: "#2b6cb0",
  category: "Arcade",
  order: 1090,
  added: "2026-10-17",
  mobile: true,
  /**
   * Sin `roomTimeLimitSec`, a pedido del programador, y sin que eso pueda colgar la
   * ronda: termina sola cuando un humano llega a la meta de masa, o cuando ya no queda
   * ninguno vivo. El que se queda quieto lo terminan comiendo los bots, y el que deja
   * la pestana abierta sin tocar nada se disuelve a los 45 s (`room.afkMs` en
   * `server/src/games/agar-config.ts`). Si el server se cae, el cliente reporta lo que
   * tenia a los 20 s sin conexion.
   */
};

/**
 * El puntaje es la masa maxima de la vida. Las partidas de sala no van al ranking
 * global: el mapa es mas chico, tiene una meta que corta la partida y una sola vida,
 * asi que su masa no se compara con la de la arena publica.
 */
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${Math.round(n)} de masa`,
  roomRanked: false,
};
