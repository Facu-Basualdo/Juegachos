import { getSupabase } from "./supabase";
import { getDirection } from "./scoring";
import { getNickname } from "./nickname";

export interface ScoreRow {
  player: string;
  score: number;
  created_at: string;
}

interface SubmitOpts {
  variant?: string;
  /** Nombre a usar (si no, se toma el guardado en localStorage). */
  player?: string;
}

interface FetchOpts {
  variant?: string;
  limit?: number;
}

/**
 * Envia un puntaje al ranking global. No-op silencioso si no hay credenciales
 * Supabase o si el jugador todavia no eligio un nickname. Devuelve true si se
 * inserto la fila.
 */
export async function submitScore(
  gameId: string,
  score: number,
  opts: SubmitOpts = {},
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!Number.isFinite(score)) return false;

  const player = opts.player ?? getNickname();
  if (!player) return false;

  const { error } = await supabase.from("scores").insert({
    game_id: gameId,
    variant: opts.variant ?? "",
    player,
    score,
  });

  if (error) {
    console.warn("[leaderboard] no se pudo enviar el puntaje:", error.message);
    return false;
  }
  return true;
}

/**
 * Envia el puntaje solo si entra al Top N actual (o si todavia hay lugar). Pensado
 * para guardar marcas parciales al vuelo (p.ej. al pasar de nivel) sin llenar la
 * tabla con puntajes que no entran. No-op sin credenciales o sin nickname.
 */
export async function submitScoreIfTop(
  gameId: string,
  score: number,
  opts: SubmitOpts & { limit?: number } = {},
): Promise<boolean> {
  if (!getSupabase()) return false;
  if (!Number.isFinite(score)) return false;
  if (!getNickname()) return false;

  const limit = opts.limit ?? 10;
  const top = await fetchTop(gameId, { variant: opts.variant, limit });
  if (top.length >= limit) {
    const worst = top[top.length - 1].score;
    const qualifies =
      getDirection(gameId, opts.variant) === "lower" ? score <= worst : score >= worst;
    if (!qualifies) return false;
  }
  return submitScore(gameId, score, { variant: opts.variant, player: opts.player });
}

/**
 * Trae el Top N del ranking de un juego (y variante). El orden depende de la
 * direccion configurada del juego (menor mejor para reaction-time / sliding).
 * Devuelve [] si no hay credenciales o si falla.
 */
export async function fetchTop(
  gameId: string,
  opts: FetchOpts = {},
): Promise<ScoreRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const ascending = getDirection(gameId, opts.variant) === "lower";
  const limit = opts.limit ?? 10;

  const { data, error } = await supabase
    .from("scores")
    .select("player, score, created_at")
    .eq("game_id", gameId)
    .eq("variant", opts.variant ?? "")
    .order("score", { ascending })
    // Desempate estable: a igual puntaje, primero el que lo hizo antes. Sin esto
    // el orden de los empatados lo decide Postgres y el #1 de la card podia no
    // coincidir con el lider que cuenta el Salon de la fama (game_leaders usa el
    // mismo criterio).
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    console.warn("[leaderboard] no se pudo leer el ranking:", error.message);
    return [];
  }
  return (data as ScoreRow[]) ?? [];
}
