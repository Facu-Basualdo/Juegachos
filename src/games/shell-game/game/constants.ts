export const BEST_KEY = "mg:shell-game:best";
export const TOTAL_LIVES = 1;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA!"];
export const COUNTDOWN_STEP = 0.5; // seconds per tick
export const MAX_DT = 0.1; // clamp delta-time to avoid jumps on tab switch

// Room mode only: seconds a surviving player has to pick a cup before being
// auto-resolved. Without this a disconnected player who never chooses would
// stall the Battle Royale forever (revealed never turns true). On timeout the
// player auto-picks an invalid slot (eliminated) and the host force-resolves
// any survivor who never chose.
export const ROOM_SELECT_TIME_LIMIT_SEC = 12;
// Extra margin the host waits past the selection deadline before force-resolving,
// so an in-flight choice from a present-but-slow player still lands.
export const ROOM_FORCE_RESOLVE_GRACE_MS = 2500;

export interface LevelConfig {
  cups: number;
  swaps: number;
  speed: number; // Duration of each swap in ms
}

export const LEVEL_CONFIGS: Record<number, LevelConfig> = {
  1: { cups: 3, swaps: 3, speed: 600 },
  2: { cups: 4, swaps: 6, speed: 500 },
  3: { cups: 4, swaps: 9, speed: 420 },
  4: { cups: 5, swaps: 12, speed: 350 },
  5: { cups: 5, swaps: 15, speed: 300 },
};

export function getLevelConfig(level: number): LevelConfig {
  if (LEVEL_CONFIGS[level]) return LEVEL_CONFIGS[level];
  // Infinite difficulty scaling beyond level 5:
  // Cap at 5 cups, keep piling on swaps and speeding up (minimum speed 200ms)
  const cups = 5;
  const swaps = 15 + (level - 5) * 3;
  const speed = Math.max(200, 300 - (level - 5) * 20);
  return { cups, swaps, speed };
}

// Room mode (Battle Royale) difficulty: harsher than solo from the first level.
// A room round has to eliminate players quickly, and everyone watches the same
// shuffle, so the easy ramp-up of the solo game just made level 1 a formality
// that nobody failed. It starts already at the 5-cup cap and at a speed the solo
// curve only reaches around level 4.
export const ROOM_LEVEL_CONFIGS: Record<number, LevelConfig> = {
  1: { cups: 5, swaps: 8, speed: 380 },
  2: { cups: 5, swaps: 11, speed: 330 },
  3: { cups: 5, swaps: 14, speed: 290 },
  4: { cups: 5, swaps: 17, speed: 250 },
  5: { cups: 5, swaps: 20, speed: 220 },
};

export function getRoomLevelConfig(level: number): LevelConfig {
  if (ROOM_LEVEL_CONFIGS[level]) return ROOM_LEVEL_CONFIGS[level];
  const cups = 5;
  const swaps = 20 + (level - 5) * 3;
  const speed = Math.max(160, 220 - (level - 5) * 15);
  return { cups, swaps, speed };
}
