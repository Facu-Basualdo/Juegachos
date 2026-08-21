export const TOTAL_ROUNDS = 5;
export const BEST_KEY = "timing-bar:best";

/** Marker sweep speed in "full widths per second". Grows each round. */
export const BASE_SPEED = 0.75;
export const SPEED_STEP = 0.17; // per round after the first

/** Half-width (in normalized track units) of the visual center bullseye band. */
export const CENTER_HALF = 0.06;

/** Falloff exponent for the score curve: bigger = harsher penalty off-center. */
export const SCORE_EXP = 2.2;
export const MAX_POINTS = 100;

/** How long the round result stays on screen before the next round auto-starts (s). */
export const RESULT_HOLD = 1.0;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75; // seconds
export const MAX_DT = 0.1; // cap delta time to avoid jumps on tab blur

/** Palette (cream & ink, matching the landing / room overlays). */
export const COLORS = {
  paper: "#efeee6",
  ink: "#111111",
  muted: "#6f6d5e",
  accent: "#00f0ff",
  accentDeep: "#0091a6",
  hairline: "rgba(17, 17, 17, 0.14)",
  perfect: "#ff5a3c",
} as const;

/**
 * Score for a stop, given the marker distance from center.
 * @param dist normalized distance from center in [0, 1] (0 = dead center, 1 = edge).
 */
export function scoreForDistance(dist: number): number {
  const clamped = Math.max(0, Math.min(1, dist));
  return Math.round(MAX_POINTS * Math.pow(1 - clamped, SCORE_EXP));
}

export function ratingLabel(points: number): string {
  if (points >= 97) return "¡PERFECTO!";
  if (points >= 82) return "Excelente";
  if (points >= 60) return "Muy bien";
  if (points >= 35) return "Bien";
  if (points >= 12) return "Casi";
  return "Fallaste";
}
