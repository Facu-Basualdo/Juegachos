import type { GameEntry } from "../../games";

export const meta: GameEntry = {
  id: "hot-potato",
  title: "Papa Caliente",
  description:
    "La papa pasa de mano en mano y explota cuando nadie sabe: el que la tiene en ese momento queda afuera. Para sacartela de encima tenes que marcar una secuencia de flechas, y no se la podes devolver al que te la paso. El ultimo en pie gana. Solo se juega en salas.",
  path: "/games/hot-potato/",
  controls:
    "Cuando tengas la papa, marca las flechas en orden (flechas o WASD, o los botones) para pasarla. Toca a un jugador (o Q / E) para elegir a quien.",
  accent: "#d9442b",
  category: "Party",
  order: 285,
  added: "2026-09-24",
  // La cruceta tactil esta, pero todavia no se probo en un telefono de verdad:
  // poner true despues de probarlo (ver "Jugable en celular" en el CLAUDE.md raiz).
  mobile: false,
};
