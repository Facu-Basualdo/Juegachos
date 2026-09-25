import { getSupabase } from "./supabase";
import { getDirection, getRankingMetric } from "./scoring";
import { getNickname } from "./nickname";

/**
 * Ranking global. La tabla `scores` es el HISTORIAL de partidas terminadas (una
 * fila por partida de cada jugador con nombre, solo o en sala) y los rankings se
 * derivan de ahi con las RPC `leaderboard_best` / `leaderboard_wins` de
 * `supabase/schema.sql`: una fila por jugador (su mejor marca, o sus victorias),
 * historico o del mes en curso.
 */

export interface ScoreRow {
  player: string;
  score: number;
  created_at: string;
}

/** "all" = historico; "month" = desde el 1ro del mes en curso (hora Argentina). */
export type RankPeriod = "all" | "month";

interface SubmitOpts {
  variant?: string;
  /** Nombre a usar (si no, se toma el guardado en localStorage). */
  player?: string;
  /** De donde viene la partida (default "solo"). */
  source?: "solo" | "room";
  /** Puesto final en la partida de sala (1 = gano). */
  place?: number;
  /** Jugadores que compitieron en esa partida de sala. */
  players?: number;
}

interface FetchOpts {
  variant?: string;
  limit?: number;
  period?: RankPeriod;
}

// ---------- Mes en curso ----------

/**
 * Argentina no tiene horario de verano desde 2009: UTC-3 fijo. El mes arranca a
 * las 00:00 de ahi para todos, no a la medianoche de cada navegador, asi el
 * ranking mensual es el mismo mire quien mire.
 */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Reloj de pared argentino expresado en los campos UTC de un Date. */
function arWallClock(now: number): Date {
  return new Date(now - AR_OFFSET_MS);
}

/** Instante en que empezo el mes en curso (00:00 del dia 1, hora Argentina). */
export function monthStart(now = Date.now()): Date {
  const ar = arWallClock(now);
  return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1) + AR_OFFSET_MS);
}

/** "septiembre 2026". */
export function monthLabel(now = Date.now()): string {
  const ar = arWallClock(now);
  return `${MONTHS[ar.getUTCMonth()]} ${ar.getUTCFullYear()}`;
}

function sinceFor(period: RankPeriod | undefined): string | null {
  return period === "month" ? monthStart().toISOString() : null;
}

// ---------- Base sin migrar ----------

/**
 * Si la base todavia no corrio la migracion del historial (columnas `source` /
 * `place` / `players` y las RPC `leaderboard_*`), el ranking sigue andando con el
 * camino viejo. Se avisa UNA vez por consola, como hace `room/api.ts`.
 */
let legacyWarned = false;
function warnLegacy(): void {
  if (legacyWarned) return;
  legacyWarned = true;
  console.warn(
    "[leaderboard] falta la migracion del historial/ranking mensual: corre supabase/schema.sql en el SQL Editor",
  );
}

/** 42703 = columna inexistente (Postgres); PGRST204 = columna fuera del cache de PostgREST. */
function isMissingColumn(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST204";
}

/**
 * Recordado por pagina: una vez que se vio que faltan las RPC, no se las vuelve
 * a pedir. La landing pide el campeon de ~60 cards EN PARALELO, asi que ademas la
 * primera consulta hace de sonda y el resto la espera (`rpcProbe`): sin eso las
 * 60 salian antes de que volviera la primera y eran 60 errores 404 por visita.
 */
let rpcMissing = false;
let rpcProbe: Promise<void> | null = null;

/**
 * Corre `call` como sonda si todavia nadie lo hizo; si otra consulta ya es la
 * sonda, espera a que termine. Devuelve true si a este llamador le toco sondear
 * (y `call` ya corrio).
 */
async function probeRpc(call: () => Promise<void>): Promise<boolean> {
  if (rpcProbe) {
    await rpcProbe;
    return false;
  }
  rpcProbe = call();
  await rpcProbe;
  return true;
}

/** PGRST202 = la funcion RPC no existe. */
function isMissingFunction(code: string | undefined): boolean {
  return code === "PGRST202";
}

// ---------- Escritura ----------

/**
 * Registra una partida terminada en el historial (y con eso en el ranking).
 * No-op silencioso si no hay credenciales Supabase o si el jugador todavia no
 * eligio un nickname. Devuelve true si se inserto la fila.
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

  const base = { game_id: gameId, variant: opts.variant ?? "", player, score };
  const row: Record<string, unknown> = { ...base, source: opts.source ?? "solo" };
  if (opts.place !== undefined && opts.players !== undefined) {
    row.place = opts.place;
    row.players = opts.players;
  }

  let { error } = await supabase.from("scores").insert(row);
  if (error && isMissingColumn(error.code)) {
    warnLegacy();
    // Sin las columnas nuevas, una fila de victoria no tiene donde guardar el
    // puesto: su `score` (el puesto invertido) no es una marca y ensuciaria el
    // tablero. Las demas entran igual, sin la etiqueta de origen.
    if (row.place !== undefined) return false;
    ({ error } = await supabase.from("scores").insert(base));
  }

  if (error) {
    console.warn("[leaderboard] no se pudo enviar el puntaje:", error.message);
    return false;
  }
  return true;
}

/**
 * Envia el puntaje solo si entra al Top N del MES (o si todavia hay lugar): quien
 * entra al historico tambien entra al del mes, asi que ese es el filtro amplio.
 * Pensado para marcas parciales al vuelo (p.ej. circuit-breaker al pasar de
 * nivel) sin llenar el historial con cada tramo. No-op sin credenciales o sin
 * nickname.
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
  const top = await fetchTop(gameId, { variant: opts.variant, limit, period: "month" });
  if (!qualifies(gameId, score, opts.variant, top, limit)) return false;
  return submitScore(gameId, score, { variant: opts.variant, player: opts.player });
}

/**
 * Si `score` entra a un Top N ya cargado: hay lugar mientras no se llenaron las
 * N filas; si estan llenas, califica al igualar o superar al peor.
 */
export function qualifies(
  gameId: string,
  score: number,
  variant: string | undefined,
  rows: ScoreRow[],
  limit = 10,
): boolean {
  if (rows.length < limit) return true;
  const worst = rows[rows.length - 1].score;
  return getDirection(gameId, variant) === "lower" ? score <= worst : score >= worst;
}

// ---------- Lectura ----------

/**
 * Top N del ranking de un juego (y variante), una fila por jugador. En los
 * juegos que rankean por victorias (`ranking: "wins"`) el `score` de cada fila
 * es la cantidad de victorias y la variante se ignora. Devuelve [] si no hay
 * credenciales o si falla.
 */
export async function fetchTop(gameId: string, opts: FetchOpts = {}): Promise<ScoreRow[]> {
  if (!getSupabase()) return [];
  return getRankingMetric(gameId) === "wins"
    ? fetchWins(gameId, opts)
    : fetchBest(gameId, opts);
}

async function fetchBest(gameId: string, opts: FetchOpts): Promise<ScoreRow[]> {
  const supabase = getSupabase()!;
  const ascending = getDirection(gameId, opts.variant) === "lower";
  const limit = opts.limit ?? 10;
  const since = sinceFor(opts.period);

  let result: ScoreRow[] | null = null;
  const callRpc = async (): Promise<void> => {
    const { data, error } = await supabase.rpc("leaderboard_best", {
      p_game_id: gameId,
      p_variant: opts.variant ?? "",
      p_ascending: ascending,
      p_since: since,
      p_limit: limit,
    });
    if (!error) {
      result = (data as ScoreRow[]) ?? [];
    } else if (isMissingFunction(error.code)) {
      rpcMissing = true;
      warnLegacy();
    } else {
      console.warn("[leaderboard] no se pudo leer el ranking:", error.message);
      result = [];
    }
  };
  const probed = await probeRpc(callRpc);
  if (!probed && !rpcMissing) await callRpc();
  if (result) return result;

  // Base sin migrar: trae las mejores filas y deja una por jugador aca. El
  // margen (x20) cubre a los que tienen varias marcas arriba de todo.
  let query = supabase
    .from("scores")
    .select("player, score, created_at")
    .eq("game_id", gameId)
    .eq("variant", opts.variant ?? "");
  if (since) query = query.gte("created_at", since);
  const { data: rows, error: rowsError } = await query
    .order("score", { ascending })
    // Desempate estable: a igual puntaje, primero el que lo hizo antes (mismo
    // criterio que game_leaders, asi el #1 de la card coincide con el del Salon).
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit * 20);
  if (rowsError) {
    console.warn("[leaderboard] no se pudo leer el ranking:", rowsError.message);
    return [];
  }
  const seen = new Set<string>();
  const best: ScoreRow[] = [];
  for (const row of (rows as ScoreRow[]) ?? []) {
    if (seen.has(row.player)) continue;
    seen.add(row.player);
    best.push(row);
    if (best.length >= limit) break;
  }
  return best;
}

async function fetchWins(gameId: string, opts: FetchOpts): Promise<ScoreRow[]> {
  const supabase = getSupabase()!;
  let result: ScoreRow[] = [];
  const callRpc = async (): Promise<void> => {
    const { data, error } = await supabase.rpc("leaderboard_wins", {
      p_game_id: gameId,
      p_since: sinceFor(opts.period),
      p_limit: opts.limit ?? 10,
    });
    if (!error) {
      result = (data as ScoreRow[]) ?? [];
    } else if (isMissingFunction(error.code)) {
      rpcMissing = true;
      warnLegacy();
    } else {
      console.warn("[leaderboard] no se pudo leer el ranking:", error.message);
    }
  };
  const probed = await probeRpc(callRpc);
  // Sin la migracion no hay puestos guardados: no hay nada que contar.
  if (!probed && !rpcMissing) await callRpc();
  return result;
}

/** "1 victoria" / "3 victorias". */
export function formatWins(count: number): string {
  return count === 1 ? "1 victoria" : `${count} victorias`;
}
