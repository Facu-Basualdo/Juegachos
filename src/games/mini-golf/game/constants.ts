// All tunable values for the mini golf. Tune here first.

// --- Ball physics (world units ~ meters) ---
export const BALL_R = 0.21;
export const GRAVITY = -14;
/** Per-second exponential damp on the velocity while airborne. */
export const AIR_DRAG = 0.05;
/** Per-second exponential damp on the tangential velocity while rolling. */
export const ROLL_FRICTION = 0.85;
/** Greens are slower and softer (per-floor overrides): heavy roll damp and
 *  a dead bounce. This is what gives La Isla's open back edge a real (and
 *  narrow) landing window for the ramp shot. */
export const GREEN_FRICTION = 3.4;
export const GREEN_REST = 0.12;
/** Extra damp once the ball is crawling on flat ground, so it settles. */
export const SETTLE_FRICTION = 6;
/** Below this speed (grounded, flat) the ball counts as stopped. */
export const STOP_SPEED = 0.14;
/** Seconds the ball must stay stopped before the next shot is allowed. */
export const STOP_DELAY = 0.3;
export const MAX_BALL_SPEED = 30;
/** Physics substep (s). */
export const PHYS_STEP = 1 / 240;

// --- Shooting ---
export const MAX_SHOT_SPEED = 15;
/** World units of drag-back that map to full power. */
export const MAX_PULL = 3.2;
/** Minimum power (0-1) for a release to count as a shot. */
export const MIN_SHOT_POWER = 0.06;
/** Screen px around the ball where a drag starts an aim instead of an orbit. */
export const AIM_PICK_PX = 64;

// --- Hole capture ---
export const HOLE_R = 0.32;
/** Faster than this over the cup and the ball just rolls across. */
export const HOLE_CAPTURE_SPEED = 4.5;
/** Rim-assist pull (accel) when rolling slowly near the cup. */
export const HOLE_PULL = 20;
export const SINK_TIME = 0.55;

// --- Rules ---
export const HOLES_PER_ROUND = 3;
/** Stroke cap per hole: reach it and the hole closes with this score. */
export const MAX_STROKES = 8;
/** Below this y the ball fell off the course: +1 stroke, back to the shot origin. */
export const FALL_Y = -7;

// --- Camera ---
export const CAM_MIN_DIST = 3;
export const CAM_MAX_DIST = 15;
export const CAM_DEFAULT_DIST = 9.5;
export const CAM_MIN_PITCH = 0.2;
export const CAM_MAX_PITCH = 1.35;
export const CAM_DEFAULT_PITCH = 0.62;
export const CAM_FOLLOW_LERP = 5;

// --- Shared countdown ---
export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75;

export const BEST_SCORE_KEY = "mini-golf:best";

// --- Palette (see DESIGN.md, "Storybook Fairway — Golden Hour") ---
export const SKY_TOP_COLOR = 0x35688c;
export const SKY_HORIZON_COLOR = 0xf3e2ac;
export const SUN_GLOW_COLOR = 0xffd98a;
export const FOG_COLOR = 0xd8cd9d;
export const GRASS_COLOR = 0x53a930;
export const GREEN_COLOR = 0x74c23e;
export const DIRT_COLOR = 0x5c3d20;
export const WOOD_COLOR = 0x9a6a38;
export const MOSS_COLOR = 0x6d8c36;
export const RED_COLOR = 0xc93a24;
export const TRIM_COLOR = 0xece0bd;
export const RAMP_BLUE_COLOR = 0x4aa7e0;
export const HOLE_DARK_COLOR = 0x1a140e;
export const CLOUD_COLOR = 0xfff4dc;
export const FOLIAGE_DARK_COLOR = 0x2f6b26;
export const FOLIAGE_MID_COLOR = 0x3f8a2e;
export const TRUNK_COLOR = 0x5c4326;
export const LANTERN_GLOW_COLOR = 0xffc966;
export const OUTLINE_COLOR: [number, number, number] = [0.11, 0.09, 0.06];
