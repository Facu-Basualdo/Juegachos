import { getSupabase } from "./supabase";
import { getScoring, getDirection } from "./scoring";
import { games } from "../games";

/**
 * "Salón de la fama": ranking de quienes son #1 (líder) en el ranking global de
 * más juegos. Es un valor DERIVADO en vivo de la tabla `scores` (los mismos
 * rankings que muestran las cards), no un contador persistente: por cada juego
 * del roster se toma su líder actual (dirección/variante como en la card) y se
 * cuenta cuántos juegos lidera cada jugador. Sin credenciales devuelve vacío y
 * la sección no aparece.
 *
 * La resolución de los líderes ocurre en la base (RPC `game_leaders`, ver
 * `supabase/schema.sql`): un round-trip que devuelve una fila por tablero. Antes
 * se bajaba la tabla `scores` entera y se calculaba en el navegador, lo que crecía
 * sin techo con cada puntaje cargado (y lo hacía tanto la landing como /fame/).
 */

export interface LeaderRow {
  player: string;
  /** Cantidad de juegos que este jugador lidera (es #1 del ranking). */
  games: number;
}

export interface GameLeaders {
  ranking: LeaderRow[];
  /** Total de juegos que tienen al menos un líder (un puntaje cargado). */
  totalGames: number;
}

/** Tablero representativo de un juego: el que muestra la card como campeón. */
interface Board {
  game_id: string;
  variant: string;
  /** true = menor es mejor (reaction-time, sliding-puzzle, ...). */
  ascending: boolean;
}

interface LeaderQueryRow {
  game_id: string;
  player: string;
}

const CACHE_KEY = "mg:leaders";
/** Ventana de frescura del cache: el podio no cambia cada segundo. */
const CACHE_TTL_MS = 60_000;

/**
 * Un tablero por juego del roster: la 1.a variante declarada en su `meta.ts`, o
 * el tablero sin variante ("") para los juegos que no las tienen. Es exactamente
 * el board que cada card de la landing muestra como su campeón.
 */
function representativeBoards(): Board[] {
  return games.map((game) => {
    const variant = getScoring(game.id).variants?.[0];
    return {
      game_id: game.id,
      variant: variant ?? "",
      ascending: getDirection(game.id, variant) === "lower",
    };
  });
}

function tally(rows: LeaderQueryRow[]): GameLeaders {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.player, (counts.get(row.player) ?? 0) + 1);

  const ranking = [...counts.entries()]
    .map(([player, count]) => ({ player, games: count }))
    .sort((a, b) => b.games - a.games || (a.player < b.player ? -1 : 1));

  return { ranking, totalGames: rows.length };
}

/**
 * Camino de compatibilidad para bases sin la migración de `game_leaders`: una
 * consulta `limit 1` por tablero (todas indexadas por `scores_board_idx`). Son
 * ~40 requests chicos en vez de uno, pero sigue sin bajar la tabla entera.
 */
async function fetchLeadersPerBoard(boards: Board[]): Promise<LeaderQueryRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const results = await Promise.all(
    boards.map(async (board) => {
      const { data, error } = await supabase
        .from("scores")
        .select("player")
        .eq("game_id", board.game_id)
        .eq("variant", board.variant)
        .order("score", { ascending: board.ascending })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1);
      if (error || !data || data.length === 0) return null;
      return { game_id: board.game_id, player: (data[0] as { player: string }).player };
    }),
  );
  return results.filter((row): row is LeaderQueryRow => row !== null);
}

/**
 * Trae el líder de cada juego y arma el ranking de líderes. Cachea el resultado
 * en localStorage (ver `cachedGameLeaders`) para que navegar landing -> /fame/ no
 * repita la consulta ni parpadee.
 */
export async function fetchGameLeaders(): Promise<GameLeaders> {
  const supabase = getSupabase();
  if (!supabase) return { ranking: [], totalGames: 0 };

  const boards = representativeBoards();
  let rows: LeaderQueryRow[];

  const { data, error } = await supabase.rpc("game_leaders", { boards });
  if (error) {
    // PGRST202 = la función no existe (falta correr supabase/schema.sql).
    if (error.code === "PGRST202") {
      console.warn(
        "[leaders] falta la función game_leaders: corré supabase/schema.sql en el SQL Editor",
      );
      rows = await fetchLeadersPerBoard(boards);
    } else {
      console.warn("[leaders] no se pudieron leer los líderes:", error.message);
      return cachedGameLeaders();
    }
  } else {
    rows = (data ?? []) as LeaderQueryRow[];
  }

  const leaders = tally(rows);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), leaders }));
  } catch {
    // localStorage lleno o bloqueado: seguimos sin cache.
  }
  return leaders;
}

/**
 * Último podio conocido (localStorage) para pintar sincrónicamente al cargar,
 * antes de que responda Supabase. Vacío si no hay cache o si ya venció el TTL.
 */
export function cachedGameLeaders(): GameLeaders {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { ranking: [], totalGames: 0 };
    const parsed = JSON.parse(raw) as { at?: number; leaders?: GameLeaders };
    if (!parsed?.leaders || !Array.isArray(parsed.leaders.ranking)) {
      return { ranking: [], totalGames: 0 };
    }
    if (Date.now() - (parsed.at ?? 0) > CACHE_TTL_MS) return { ranking: [], totalGames: 0 };
    return parsed.leaders;
  } catch {
    return { ranking: [], totalGames: 0 };
  }
}
