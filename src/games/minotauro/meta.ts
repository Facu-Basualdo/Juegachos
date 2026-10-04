import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "minotauro",
  title: "Minotauro",
  description:
    "Un laberinto de piedra a oscuras, una antorcha que se va gastando y el Minotauro cazándote por el ruido. Encontrá el ovillo de oro para bajar al laberinto de abajo, cada vez más grande y más hondo. Caminá despacio para que no te escuche, corré cuando te vea, y juntá aceite para no quedarte a ciegas.",
  path: "/games/minotauro/",
  controls:
    "Movete con WASD o las flechas (en el celu, arrastrá el dedo). Mantené SHIFT o el botón CORRER para correr, pero hace ruido. Encontrá el ovillo de oro para bajar.",
  howTo: {
    intro: "Bajá laberintos a oscuras: encontrá el ovillo de oro antes de que el Minotauro te escuche.",
    actions: [
      { title: "Caminar", icons: ["wasd", "arrows", "swipe"], note: "despacio no te escucha" },
      { title: "Correr", icons: ["key:SHIFT", "btn:CORRER"], note: "hace ruido" },
    ],
  },
  accent: "#e8b64a",
  category: "Arcade",
  order: 1050,
  added: "2026-10-04",
  mobile: true,
  /**
   * Quieto, el olfato del Minotauro termina la partida solo (va a donde estas pasado
   * `SMELL_START`); esto es la red para que un jugador muy bueno no estire la ronda.
   */
  roomTimeLimitSec: 240,
};
