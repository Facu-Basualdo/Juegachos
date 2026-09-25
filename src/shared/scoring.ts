import type { Direction, GameScoring, RankingMetric } from "./scoring-core";

// Re-exporta el modulo hoja para que los importadores existentes (Game.ts,
// Hud.ts, etc.) sigan usando `.../shared/scoring` sin cambios.
export type { Direction, GameScoring, RankingMetric } from "./scoring-core";
export {
  encodeTimeMoves,
  formatTimeMoves,
  encodeMovesTime,
  formatMovesTime,
  formatClock,
} from "./scoring-core";

/**
 * Configuracion de ranking por juego, auto-descubierta: cada juego declara un
 * `export const scoring: GameScoring` en su src/games/<id>/meta.ts y este glob
 * los junta (la clave es el `id` de la carpeta). Agregar un juego no requiere
 * tocar este archivo (Open/Closed), igual que el registro de src/games.ts.
 *
 * Los juegos con el default (`{ direction: "higher" }`) no declaran `scoring`:
 * no aparecen en el mapa y `getScoring` les devuelve el default.
 */
const modules = import.meta.glob<{ scoring?: GameScoring }>("../games/*/meta.ts", {
  eager: true,
});

export const GAME_SCORING: Record<string, GameScoring> = {};
for (const [path, mod] of Object.entries(modules)) {
  if (!mod.scoring) continue;
  const id = path.match(/\/games\/([^/]+)\/meta\.ts$/)?.[1];
  if (id) GAME_SCORING[id] = mod.scoring;
}

/** Devuelve la config de un juego, con default seguro si no esta declarado. */
export function getScoring(gameId: string): GameScoring {
  return GAME_SCORING[gameId] ?? { direction: "higher" };
}

/** Direccion de orden de un juego (o de una variante concreta si difiere). */
export function getDirection(gameId: string, variant?: string): Direction {
  const s = getScoring(gameId);
  if (variant && s.variantDirection && variant in s.variantDirection) {
    return s.variantDirection[variant];
  }
  return s.direction;
}

/** Formatea un puntaje segun la config del juego (y variante si aplica). */
export function formatScore(gameId: string, score: number, variant?: string): string {
  const s = getScoring(gameId);
  const fmt = (variant && s.variantFormat?.[variant]) ?? s.format;
  return fmt ? fmt(score) : String(score);
}

/** Que mide el ranking global del juego (ver `GameScoring.ranking`). */
export function getRankingMetric(gameId: string): RankingMetric {
  return getScoring(gameId).ranking ?? "best";
}

/** Si las partidas terminadas en sala cuentan para su ranking global. */
export function isRoomRanked(gameId: string): boolean {
  return getScoring(gameId).roomRanked ?? true;
}
