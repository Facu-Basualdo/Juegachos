import { roomGames, type GameEntry } from "../../games";
import type { RoomSettings } from "./types";

/**
 * La Feria: la sala 3D (`/rooms/lobby/`, codigo en `src/lobby3d/`; en el codigo le
 * decimos "hub" o "isla", su primer nombre). En una sala con `settings.lobby3d` los
 * jugadores pasan entre ronda y ronda por una feria compartida en vez de ver el
 * overlay de la sala: ahi votan el proximo juego parandose en la chapa frente a su
 * afiche y ven los resultados. La votacion se abre sola y, al vencer, la partida
 * arranca directo (sin briefing). Las paginas de los juegos solo muestran la partida
 * (`playing`); cualquier otra fase las devuelve a la isla (ver `roomMode.ts`).
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
 * Cuantas carteleras tiene la feria: en cada votacion se sortean esos juegos de todo
 * el pool (`roomGames`) y cada cartelera muestra uno. Antes eran siempre los mismos
 * (los `roomsOnly`); el programador pidio que roten y que salgan de todos los juegos
 * de sala. El arco de carteleras (`GALLERY_SPAN` en `src/lobby3d/game/constants.ts`)
 * esta medido para esta cantidad: si se cambia, revisar que no tape el cartel de
 * records ni la torre.
 */
export const LOBBY3D_POSTERS = 15;

/** Pool de juegos votables de una sala (comun o 3D): todos los de sala. */
export function votePool(): GameEntry[] {
  return roomGames;
}

/**
 * Voto de "otros juegos" en La Feria (una fila de `room_votes` con este `game_id`,
 * como el "ready" del briefing): con mas de la mitad de los conectados en REROLL, el
 * host sortea afiches nuevos, borra los votos y reinicia la cuenta.
 */
export const REROLL_VOTE = "reroll";

/**
 * `count` juegos del pool en un orden al azar, distintos entre si. Con `seed` el
 * orden es el mismo en todos los clientes (los afiches de la feria antes de la
 * primera votacion, que todavia no viene de la DB); sin ella, `Math.random`.
 * `exclude` (los afiches del reroll anterior) se evita mientras alcance el pool.
 */
export function sampleGames(count: number, seed?: number, exclude: string[] = []): GameEntry[] {
  let s = (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const rand = (): number => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const all = votePool();
  const fresh = all.filter((g) => !exclude.includes(g.id));
  const pool = fresh.length >= count ? fresh : [...all];
  const out: GameEntry[] = [];
  while (out.length < count && pool.length > 0) out.push(...pool.splice(Math.floor(rand() * pool.length), 1));
  return out;
}
