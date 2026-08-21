/**
 * Emparejado del modo sala: cada ronda los jugadores de la sala se reparten en
 * duelos 1v1 (un tablero por pareja). El orden es el de `room.players()` (por
 * `joined_at`, identico en todos los clientes), asi que cada cliente calcula el
 * mismo reparto sin necesidad de guardarlo: pares consecutivos (0-1, 2-3, ...).
 * Si la cantidad de jugadores es impar, el ultimo se queda sin rival humano y
 * juega contra la IA en su propio dispositivo (tablero local, no compartido).
 */

/** Nombre reservado del rival IA (nunca es un nickname real, ver NICKNAME_MAX). */
export const AI_NAME = "IA";

export interface Pairing {
  /** Fila de room_match_state de mi tablero (una por pareja en la ronda). */
  boardNo: number;
  /** Los dos asientos: [X, O]. Si vsAI, seats[1] === AI_NAME. */
  seats: [string, string];
  /** Mi asiento en ese tablero. */
  mySeat: 0 | 1;
  /** true = me toco jugar contra la IA (soy el jugador impar que sobra). */
  vsAI: boolean;
}

/** Reparto para `me`, o null si no esta en la lista (espectador). */
export function pairFor(players: string[], me: string): Pairing | null {
  const i = players.indexOf(me);
  if (i < 0) return null;

  const boardNo = Math.floor(i / 2);
  const isOddCount = players.length % 2 === 1;

  // Impares: el ultimo jugador (indice par, sin pareja) juega contra la IA.
  if (isOddCount && i === players.length - 1) {
    return { boardNo, seats: [me, AI_NAME], mySeat: 0, vsAI: true };
  }

  const a = players[boardNo * 2];
  const b = players[boardNo * 2 + 1];
  return { boardNo, seats: [a, b], mySeat: i % 2 === 0 ? 0 : 1, vsAI: false };
}

/** Todos los tableros PvP (parejas humanas completas) de una lista de jugadores. */
export function humanBoards(players: string[]): Array<{ boardNo: number; seats: [string, string] }> {
  const boards: Array<{ boardNo: number; seats: [string, string] }> = [];
  const pairs = Math.floor(players.length / 2);
  for (let b = 0; b < pairs; b++) {
    boards.push({ boardNo: b, seats: [players[b * 2], players[b * 2 + 1]] });
  }
  return boards;
}
