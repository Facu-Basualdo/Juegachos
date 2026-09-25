/**
 * Modulo hoja del scoring: tipos y helpers puros, sin dependencias. Existe
 * separado de `scoring.ts` para romper el ciclo de imports: cada juego declara
 * su `scoring` en su `meta.ts` (que importa helpers de aca), y `scoring.ts`
 * arma el mapa con un glob de esos `meta.ts`. Si los helpers vivieran en
 * `scoring.ts`, el glob crearia una dependencia circular en runtime.
 */

/** Direccion de orden del ranking: mayor puntaje mejor, o menor mejor. */
export type Direction = "higher" | "lower";

export interface GameScoring {
  /** "higher" = mayor puntaje mejor (default de la mayoria de los juegos). */
  direction: Direction;
  /** Formatea el puntaje para mostrarlo (p.ej. reaction-time -> "213 ms"). */
  format?: (score: number) => string;
  /** Variantes independientes de ranking (p.ej. tamanos de sliding-puzzle). */
  variants?: string[];
  /** Etiqueta legible de cada variante para el selector de la landing. */
  variantLabel?: (variant: string) => string;
  /**
   * Direccion por variante, cuando distintas variantes se ordenan distinto que
   * el juego base. Ej: memory-match usa "higher" (pares) en modo sala, pero sus
   * rankings solo de tiempo y movimientos son "lower". Si falta una variante,
   * se usa `direction`.
   */
  variantDirection?: Record<string, Direction>;
  /** Formato por variante (mismo criterio que variantDirection). */
  variantFormat?: Record<string, (score: number) => string>;
  /**
   * Que mide el ranking global. "best" (default): el mejor puntaje de cada
   * jugador. "wins": cantidad de partidas de sala ganadas (1er puesto con al
   * menos otro jugador). Lo usan los juegos solo-sala cuyo puntaje de sala es el
   * puesto (`jugadores - puesto`): ese numero depende del tamano de la sala y no
   * sirve como marca a batir.
   */
  ranking?: RankingMetric;
  /**
   * Si las partidas TERMINADAS en sala cuentan para el ranking global (default
   * true). false en los juegos cuyo modo sala mide otra cosa que el modo solo
   * (duelos 1v1 contra IA vs contra humanos, otra duracion, otro puntaje): ahi el
   * mismo numero significaria dos cosas distintas en un mismo tablero.
   */
  roomRanked?: boolean;
}

/** Ver `GameScoring.ranking`. */
export type RankingMetric = "best" | "wins";

/**
 * Codifica tiempo (centisegundos) y movimientos en un unico puntaje para poder
 * ordenar un ranking por tiempo sin cambiar el esquema de la tabla:
 * `centisegundos * BASE + movimientos`. Como el tiempo ocupa la parte alta del
 * numero, ordenar ascendente ("lower") ordena por tiempo y usa los movimientos
 * como desempate. Los movimientos se topean por debajo de BASE. Compartido por
 * sliding-puzzle y memory-match (modo solo).
 */
const TIME_MOVES_BASE = 100000;

export function encodeTimeMoves(seconds: number, moves: number): number {
  const centis = Math.max(0, Math.round(seconds * 100));
  const clampedMoves = Math.min(Math.max(0, Math.round(moves)), TIME_MOVES_BASE - 1);
  return centis * TIME_MOVES_BASE + clampedMoves;
}

export function formatTimeMoves(encoded: number): string {
  const centis = Math.floor(encoded / TIME_MOVES_BASE);
  const moves = encoded % TIME_MOVES_BASE;
  return `${formatClock(centis)} - ${moves} mov`;
}

/**
 * Igual que encodeTimeMoves pero con los movimientos en la parte alta: ordena
 * un ranking por movimientos (menos mejor) y desempata por tiempo. Se usa en
 * torres-de-hanoi, donde el minimo de movimientos (2^n - 1) es la marca a batir
 * y el tiempo solo desempata entre soluciones igual de eficientes.
 * `movimientos * BASE + centisegundos`, con los centisegundos topeados por debajo
 * de BASE.
 */
const MOVES_TIME_BASE = 1000000;

export function encodeMovesTime(moves: number, seconds: number): number {
  const clampedMoves = Math.max(0, Math.round(moves));
  const centis = Math.min(Math.max(0, Math.round(seconds * 100)), MOVES_TIME_BASE - 1);
  return clampedMoves * MOVES_TIME_BASE + centis;
}

export function formatMovesTime(encoded: number): string {
  const moves = Math.floor(encoded / MOVES_TIME_BASE);
  const centis = encoded % MOVES_TIME_BASE;
  return `${moves} mov - ${formatClock(centis)}`;
}

/** "1:23.45" a partir de centisegundos (minutos:segundos.centesimas). */
export function formatClock(centiseconds: number): string {
  const cs = Math.max(0, Math.round(centiseconds));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
