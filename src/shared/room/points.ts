import { getScoring } from "../scoring";
import type { RoomState, RoundScoreRow } from "./types";

/**
 * Calculo de puestos y puntos de cada ronda. Funciones puras y deterministicas:
 * todos los clientes computan lo mismo a partir del mismo snapshot de la DB,
 * asi que nadie necesita "publicar" totales.
 */

export interface RankedPlayer {
  player: string;
  /** Puntaje reportado, o null si el jugador no reporto nada en la ronda. */
  score: number | null;
  finished: boolean;
  /** Puesto 1-based (los empatados comparten puesto). */
  rank: number;
  /** Puntos ganados en la ronda. */
  points: number;
}

/**
 * Nivel de comparacion. Primero los puntajes comparables entre si, despues los
 * parciales que no se pueden comparar (ver abajo), y al final los que no
 * reportaron nada (0 puntos).
 */
const TIER_SCORED = 0;
const TIER_UNCOMPARABLE = 1;
const TIER_ABSENT = 2;

interface Entry {
  player: string;
  score: number | null;
  finished: boolean;
  tier: number;
  /** Clave de orden dentro del tier (mayor = mejor). */
  key: number;
}

/**
 * Ordena la ronda y reparte puntos por posicion: con N jugadores registrados en
 * la sala, el 1.o gana N, el 2.o N-1, etc. Los empatados comparten el puntaje
 * mas alto de su grupo. Los que no reportaron (ausentes) siempre valen 0.
 *
 * Regla para juegos con direction "lower" (reaction-time, sliding-puzzle): un
 * parcial por timeout NO es comparable (menos movimientos sin resolver
 * "ganaria"), asi que todos los parciales empatan entre si detras de los que
 * terminaron.
 *
 * En juegos "higher" el parcial SI es comparable: son los puntos que el jugador
 * llevaba cuando se corto la ronda, tan validos como los de quien murio antes de
 * que venciera el reloj. Por eso van en el MISMO tier que los terminados. Antes
 * iban en un tier propio detras de ellos, lo que premiaba morir temprano: en
 * Asteroides, morir a los 30 s con 500 puntos le ganaba a seguir vivo al minuto
 * 3 con 3000.
 */
export function rankRound(
  gameId: string,
  roomPlayers: string[],
  roundScores: RoundScoreRow[],
): RankedPlayer[] {
  const direction = getScoring(gameId).direction;
  const byPlayer = new Map<string, RoundScoreRow>();
  for (const row of roundScores) byPlayer.set(row.player, row);

  const entries: Entry[] = roomPlayers.map((player) => {
    const row = byPlayer.get(player);
    if (!row) {
      return { player, score: null, finished: false, tier: TIER_ABSENT, key: 0 };
    }
    if (!row.finished && direction === "lower") {
      // Parcial no comparable: empatan todos entre si.
      return { player, score: row.score, finished: false, tier: TIER_UNCOMPARABLE, key: 0 };
    }
    const key = direction === "lower" ? -row.score : row.score;
    return { player, score: row.score, finished: row.finished, tier: TIER_SCORED, key };
  });

  entries.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.key !== b.key) return b.key - a.key;
    // Desempate estable y deterministico entre clientes.
    return a.player < b.player ? -1 : a.player > b.player ? 1 : 0;
  });

  const total = roomPlayers.length;
  const ranked: RankedPlayer[] = [];
  let i = 0;
  while (i < entries.length) {
    // Grupo de empatados: mismo tier y misma clave.
    let j = i;
    while (
      j < entries.length &&
      entries[j].tier === entries[i].tier &&
      entries[j].key === entries[i].key
    ) {
      j++;
    }
    const rank = i + 1;
    const points = entries[i].tier === TIER_ABSENT ? 0 : Math.max(total - i, 0);
    for (let k = i; k < j; k++) {
      const e = entries[k];
      ranked.push({ player: e.player, score: e.score, finished: e.finished, rank, points });
    }
    i = j;
  }
  return ranked;
}

export interface TotalRow {
  player: string;
  points: number;
  /** Puesto 1-based en el tablero acumulado (empatados comparten puesto). */
  rank: number;
}

/**
 * Tablero acumulado: suma los puntos de todas las rondas ya jugadas
 * (room_rounds x room_round_scores), ordenado de mayor a menor.
 */
export function computeTotals(state: RoomState): TotalRow[] {
  const totals = new Map<string, number>();
  for (const player of state.players) totals.set(player, 0);

  for (const round of state.rounds) {
    const roundScores = state.scores.filter((s) => s.round_no === round.round_no);
    for (const r of rankRound(round.game_id, state.players, roundScores)) {
      totals.set(r.player, (totals.get(r.player) ?? 0) + r.points);
    }
  }

  const rows = [...totals.entries()]
    .map(([player, points]) => ({ player, points, rank: 0 }))
    .sort((a, b) => (b.points - a.points) || (a.player < b.player ? -1 : 1));

  rows.forEach((row, idx) => {
    row.rank = idx > 0 && rows[idx - 1].points === row.points ? rows[idx - 1].rank : idx + 1;
  });
  return rows;
}
