export interface GameEntry {
  id: string;
  title: string;
  description: string;
  path: string;
  /** Accent color used to theme the game's card on the landing page. */
  accent?: string;
  /** Como se juega: una linea breve con los controles, mostrada en el briefing
   * previo a cada ronda en modo sala. Sin valor, el briefing omite los controles. */
  controls?: string;
  /** Categoria para los filtros de la landing. */
  category: string;
  /** Orden en la landing (menor primero). Sin valor va al final, alfabetico por titulo. */
  order?: number;
  /** Fecha en que se agrego el juego (ISO `YYYY-MM-DD`). Ordena el modo "Nuevos"
   * de la landing, que es el orden por defecto. Obligatorio en juegos nuevos:
   * `order` es curado a mano y no refleja cuando entro cada juego. */
  added: string;
  /**
   * Si el juego se puede jugar en celular. **Obligatorio** (como `added`) y a
   * proposito: sin un valor por defecto, un juego nuevo no puede colarse
   * marcado como apto sin que alguien lo haya probado en un telefono.
   *
   * Para poner `true` hacen falta las dos cosas, no una:
   * 1. Que se pueda **arrancar** con un toque. En movil no hay Enter, asi que el
   *    listener de arranque tiene que colgar del container o del overlay, nunca
   *    del canvas: la pantalla de inicio es un overlay que lo tapa y se come el
   *    toque (era el bug de 10 juegos). Ver `flappy-bird` (container) o
   *    `timberman` (overlay) como referencia.
   * 2. Que se pueda **jugar** sin teclado fisico: puntero/tactil, botones en
   *    pantalla, o su propio teclado en pantalla (como `wordle`).
   *
   * Hoy solo `mecano`, `typing-race` y `hackerman` son `false`: escuchan
   * `window keydown` sin ningun `<input>`, asi que en un telefono el teclado
   * virtual no aparece nunca y no hay con que jugarlos.
   */
  mobile: boolean;
  /** Ocultar del roster sin borrar la entrada (landing y salas). El juego sigue en el repo. */
  hidden?: boolean;
  /** Excluir solo del modo sala (selección, votación, random y picker del host),
   * pero seguir mostrándolo en la landing. Para juegos que no van bien en multijugador. */
  roomsHidden?: boolean;
  /**
   * Tope de tiempo de la ronda **en modo sala**, en segundos. Solo lo declaran los
   * juegos que sin reloj no terminan nunca (o se estiran demasiado): al vencer, cada
   * jugador reporta su parcial y la ronda cierra. Sin este campo la ronda no tiene
   * reloj y cierra cuando todos terminan su partida, que es el caso normal.
   * No afecta al juego fuera de las salas.
   */
  roomTimeLimitSec?: number;
}

/** Portada del juego generada por IA; si falta, la card muestra un fallback. */
export function coverUrl(gameId: string): string {
  return `/covers/${gameId}.jpg`;
}

// Registro auto-descubierto: cada juego declara su propia metadata en
// src/games/<id>/meta.ts y este glob la junta. Agregar un juego no requiere
// tocar este archivo (principio Open/Closed), lo que evita conflictos de merge.
const modules = import.meta.glob<{ meta: GameEntry }>("./games/*/meta.ts", {
  eager: true,
});

export const games: GameEntry[] = Object.values(modules)
  .map((m) => m.meta)
  .filter((g) => !g.hidden)
  .sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.title.localeCompare(b.title),
  );

/**
 * Juegos disponibles en modo sala: excluye los marcados `roomsHidden` (que no
 * van bien en multijugador). Se usa para la selección/votación/random y el picker
 * del host; los lookups por id siguen usando `games` para que cualquier ronda ya
 * en curso resuelva su título/URL igual.
 */
export const roomGames: GameEntry[] = games.filter((g) => !g.roomsHidden);
