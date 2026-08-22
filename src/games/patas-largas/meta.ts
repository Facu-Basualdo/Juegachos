import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "patas-largas",
  title: "Patas Largas",
  description:
    "Una criatura de patas absurdamente largas cruzando la duna al amanecer. Cada toque manda una pata adelante, alternando siempre, y la gravedad hace el resto: el cuerpo bascula sobre el pie apoyado y vos elegís cuándo cortarle la caída.",
  path: "/games/patas-largas/",
  controls:
    "Un toque en la pantalla (o ESPACIO / ENTER) por paso, alternando patas solas. Mantené apretado y el paso sale más largo; soltá enseguida y das un pasito corto. Si tocás antes de tiempo la pata queda corta, si tardás el cuerpo ya se te fue de largo.",
  accent: "#d97a5a",
  category: "Arcade",
  order: 980,
  added: "2026-08-21",
  mobile: true,
  // Sin toques la criatura se queda parada: la pose de arranque es estable y
  // nada la voltea sola. En salas eso trabaria la ronda para siempre, asi que
  // la ronda tiene reloj propio.
  roomTimeLimitSec: 75,

  // OCULTO: la marcha todavia no es jugable. La criatura se para bien y no
  // despega nunca, pero caminar depende de una ventana geometrica de pocos
  // centimetros entre dos condiciones que hoy casi no se superponen (ver
  // "La tension geometrica que falta resolver" en el CLAUDE.md del juego).
  // El codigo, el modelo de simulacion y todo lo aprendido quedan versionados;
  // el juego no sale hasta que camine. Para publicarlo alcanza con borrar esta
  // linea.
  hidden: true,
};

// Puntaje = metros recorridos (mayor es mejor).
export const scoring: GameScoring = {
  direction: "higher",
  format: (n) => `${n} m`,
};
