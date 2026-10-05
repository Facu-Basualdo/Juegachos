// Lo carga `plugin.ts` con `runnerImport` de Vite (no lo importa nadie del sitio).
// Reusa el roster de verdad (`src/games.ts`: sin `hidden`, ordenado por `order`) en
// vez de parsear los meta.ts a mano, y suma TODAS las metas para saber cuales son
// las paginas de juegos ocultos.
import type { GameEntry } from "../../src/games";

export { games } from "../../src/games";

const modules = import.meta.glob<{ meta: GameEntry }>("../../src/games/*/meta.ts", {
  eager: true,
});

export const allMetas: GameEntry[] = Object.values(modules).map((m) => m.meta);
