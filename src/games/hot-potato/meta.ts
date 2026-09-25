import type { GameEntry } from "../../games";
import type { GameScoring } from "../../shared/scoring-core";

export const meta: GameEntry = {
  id: "hot-potato",
  title: "Papa Caliente",
  description:
    "La papa pasa de mano en mano y explota cuando nadie sabe: el que la tiene en ese momento queda afuera. Para sacartela de encima tenes que marcar una secuencia de flechas, y no se la podes devolver al que te la paso. El ultimo en pie gana. Solo se juega en salas.",
  path: "/games/hot-potato/",
  controls:
    "Cuando tengas la papa, marca las 4 flechas en orden (flechas o WASD, o los botones) para pasarla. Toca a un jugador (o Q / E) para elegir a quien. La aguja muestra cuanto lleva la papa: los primeros 9 segundos nunca explota; de ahi a los 20 puede explotar en cualquier momento, y cuanto mas pasa, mas probable.",
  accent: "#d9442b",
  category: "Party",
  order: 285,
  added: "2026-09-24",
  // La cruceta tactil esta, pero todavia no se probo en un telefono de verdad:
  // poner true despues de probarlo (ver "Jugable en celular" en el CLAUDE.md raiz).
  mobile: false,
};

// El puntaje de sala es el puesto (`jugadores - puesto`), que depende de cuantos
// jugaron: no sirve como marca. El ranking global cuenta victorias en sala.
export const scoring: GameScoring = {
  direction: "higher",
  ranking: "wins",
};
