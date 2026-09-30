import { roomGames, type GameEntry } from "../../games";
import type { RoomSettings } from "./types";

/**
 * La Isla: la sala 3D (`/rooms/lobby/`, codigo en `src/lobby3d/`). En una sala con
 * `settings.lobby3d` los jugadores pasan entre ronda y ronda por una isla
 * compartida en vez de ver el overlay de la sala: ahi votan el proximo juego
 * parandose en un portal, marcan "listo" subiendose a una plataforma y ven los
 * resultados. Las paginas de los juegos solo muestran la partida (`playing`);
 * cualquier otra fase las devuelve a la isla (ver `roomMode.ts`).
 */

/** gameId con el que la pagina de la isla arranca su RoomMode (no es un juego). */
export const HUB_ID = "lobby3d";

/** URL de la isla de una sala. */
export function roomHubUrl(code: string): string {
  return `/rooms/lobby/?code=${code}`;
}

/** Si la sala se juega en la isla. */
export function isLobby3d(settings: RoomSettings | null | undefined): boolean {
  return settings?.lobby3d === true;
}

/**
 * Juegos de la isla: los rooms-only (`roomsOnly` en su `meta.ts`). Son los
 * portales de la galeria y el pool de sus votaciones.
 */
export const lobbyGames: GameEntry[] = roomGames.filter((g) => g.roomsOnly);

/** Pool de juegos votables de una sala: los de la isla en una sala 3D, todos en la comun. */
export function votePool(settings: RoomSettings | null | undefined): GameEntry[] {
  return isLobby3d(settings) && lobbyGames.length > 0 ? lobbyGames : roomGames;
}
