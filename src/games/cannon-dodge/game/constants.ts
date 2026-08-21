// Fixed authoring space: a square so the round island keeps its proportions at
// any window size. Game.render() letterboxes it to the window.
export const VIEW_SIZE = 720;
export const CENTER = VIEW_SIZE / 2;

// Frame clamp so a tab switch can't teleport the player through a wall of balls.
export const MAX_DT = 1 / 30;

// --- Island geometry (all in view units, measured from CENTER) ---
/** Radius of the sandy beach edge (where the water starts). */
export const ISLAND_RADIUS = 316;
/** Wet-shore ring width drawn just inside the beach edge. */
export const SHORE_WIDTH = 30;
/** How far in from the beach edge the player is kept (stays on dry sand). */
export const PLAY_INSET = 30;

// --- Player ---
export const PLAYER_RADIUS = 13;
/** Movement speed in px/s. */
export const PLAYER_SPEED = 250;
/** How quickly the player reaches full speed / stops (higher = snappier). */
export const PLAYER_ACCEL = 14;

// --- Cannons ---
/** The rim ring the cannons sit on (just outside the sand). */
export const CANNON_RADIUS = ISLAND_RADIUS + 8;
/** Distance from the cannon body to where the ball is born. */
export const MUZZLE_OFFSET = 30;
/** Radius of the inner circle a cannon may aim its chord through. Shots cross
 * the island (they are NOT aimed at any player) but pass near the middle. */
export const AIM_SPREAD = 130;
/** After firing, the cannon lingers this long (smoke + fade) before removal. */
export const CANNON_LINGER = 0.9;

// --- Cannonballs ---
export const BALL_RADIUS = 9;
/** A ball is culled once it is this far outside the island. */
export const BALL_CULL_MARGIN = 60;

// --- Difficulty ramp (everything is a function of elapsed survival time) ---
// Difficulty steps up in discrete levels: one every STEP_SECONDS. It reaches its
// hardest values at RAMP_SECONDS (= STEP_SECONDS * number of steps) and holds.
export const STEP_SECONDS = 2;
export const RAMP_SECONDS = 100; // 50 steps of 2s to reach max difficulty

/** Seconds between cannon spawns: eased from START down to MIN. */
export const SPAWN_INTERVAL_START = 1.45;
export const SPAWN_INTERVAL_MIN = 0.34;

/** Ball travel speed (px/s): eased from START up to MAX. */
export const BALL_SPEED_START = 185;
export const BALL_SPEED_MAX = 430;

/** Warning/telegraph time before a cannon fires (s): eased from START to MIN.
 * Kept above a fair floor so a shot is always dodgeable. */
export const TELEGRAPH_START = 1.1;
export const TELEGRAPH_MIN = 0.52;

// --- Room mode: live view of the other players (Neon Drift model) ---
/** How often each client broadcasts its pirate position (ms) — 10/s. Kept at or
 * below 10/s because a full room (8 pirates) multiplies it against the Realtime
 * server's per-second message cap for the channel, which drops the socket. */
export const NET_SEND_MS = 100;
/** A still pirate re-sends at most this often (ms): a keepalive, so an idle or
 * sunk player doesn't burn the channel's budget at the full rate. Must stay well
 * under REMOTE_STALE_MS or the others would purge him. */
export const NET_IDLE_MS = 1000;
/** A remote pirate that hasn't updated in this long (ms) is dropped. Generous on
 * purpose: a couple of seconds of network hiccup should not make a rival vanish
 * — he just holds his last position until the next snapshot arrives. */
export const REMOTE_STALE_MS = 6000;

/** Bandana palette — one distinct colour per player (by seat order). */
export const BANDANA_COLORS = [
  "#d23b3b", // red (default / solo)
  "#2f6fe0", // blue
  "#2fa84a", // green
  "#f2c81e", // yellow
  "#9b4dd6", // purple
  "#ee7d2b", // orange
  "#22c3d6", // cyan
  "#ff6fae", // pink
];

/** 32-bit deterministic hash (djb2) for seeds and colour fallback. */
export function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** Balls fired per cannon grows with time (fanned spread). Capped at MAX. */
export const BURST_MAX = 3;
/** One extra ball per cannon is unlocked every this many difficulty levels
 * (so with STEP_SECONDS = 2, +1 ball at ~34s and again at ~68s). */
export const BURST_STEP_LEVELS = 17;
/** Half-angle (radians) of the fan when a cannon fires more than one ball. */
export const BURST_SPREAD = 0.16;
