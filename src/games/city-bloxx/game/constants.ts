/**
 * All tunable values for Skyline (Three.js rework). Tune here first before
 * touching logic. Everything is in world units where 1 unit == one floor's
 * height, the base foundation sits at y = 0, and the pendulum swings along X
 * (Z is fixed — the camera is near-profile 2.5D).
 */

// --- Floor / block geometry ---
export const FLOOR_W = 2.4;
export const FLOOR_H = 1.0;
export const FLOOR_D = 2.0;
/** Horizontal center the foundation sits at; the tower's balance pivot. */
export const BASE_X = 0;

// --- Crane / pendulum (module 1) ---
/** Distance from the jib pivot down to the hanging block's center. */
export const CABLE_LEN = 2.6;
/** Vertical gap the block floats above its landing spot at rest (angle 0). */
export const HANG_GAP = 2.2;
/** Base angular frequency of the swing, rad/s. */
export const SWING_OMEGA_BASE = 1.75;
/** Frequency added per placed floor (whole run), capped. */
export const SWING_OMEGA_PER_FLOOR = 0.034;
export const SWING_OMEGA_MAX = 3.8;
/** Base swing amplitude (max cable angle from vertical), rad. */
export const SWING_ANGLE_BASE = 0.56;
/** Amplitude added per placed floor, capped. */
export const SWING_ANGLE_PER_FLOOR = 0.014;
export const SWING_ANGLE_MAX = 0.98;
/** Wind gust: erratic angle added on top of the clean swing. Grows with height. */
export const WIND_AMP_PER_FLOOR = 0.015;
export const WIND_AMP_MAX = 0.4;

// --- Drop physics (module 1) ---
/** Downward acceleration of a released block, units/s². */
export const DROP_GRAVITY = 22;
/**
 * Fraction of the pendulum's horizontal velocity the block keeps when released.
 * 1 = full physical inertia (the block flies sideways along its swing arc);
 * lower tames the drift at high, fast swings. Tune the "feel" here.
 */
export const DROP_INHERIT = 1;
/**
 * A missed block *bounces off the edge* instead of sinking straight down: it is
 * popped UP by `MISS_HOP` (units/s) and flung outward at `MISS_KICK` toward the
 * side it missed on, so it rises clear of the base slab's top and arcs down
 * beside it — never clipping through the wide gray base.
 */
export const MISS_KICK = 7;
export const MISS_HOP = 3.2;

// --- Window layout (shared by Blocks.ts and the landing rule below) ---
/** Columns of windows across a floor's face. */
export const WINDOW_COLS = 3;
/** Window width (world units). */
export const WINDOW_W = 0.34;
/** Outer edge of the outermost window, measured from the block center. */
export const WINDOW_OUTER_EDGE =
  -FLOOR_W / 2 + WINDOW_COLS * (FLOOR_W / (WINDOW_COLS + 1)) + WINDOW_W / 2;

// --- Collision / offset / balance (module 2) ---
/** |offset| under this (world units) counts as a clean "perfect" placement. */
export const PERFECT_OFFSET = 0.14;
/**
 * Max |offset| from the floor below for a drop to land at all. Set to the margin
 * between the block's outermost-window line and its edge, so a block that hangs
 * past its last window on the overhang side is unsupported there and **falls**
 * (the run ends). This is the strict "must stack within the last-window line"
 * rule — a bare corner touch no longer counts.
 */
export const MAX_LANDING_OFFSET = 0.85; // More permissive landing window (was: 0.75)
/** |comOffset| (world units) at which the tower topples and the run ends. */
export const TOPPLE_LIMIT = FLOOR_W * 0.50; // Slightly tighter limit for center-of-mass failures (was: FLOOR_W * 0.55)
/** Tower tilt (rad) when the center of mass reaches TOPPLE_LIMIT. */
export const MAX_LEAN = 0.13;
/** Angular spring frequency of the post-drop wobble, rad/s. */
export const WOBBLE_FREQ = 5.4;
/** Damping of the wobble spring. */
export const WOBBLE_DAMP = 2.5;
/** How hard a misaligned drop kicks the wobble, rad/s per unit of offset. */
export const WOBBLE_IMPULSE = 0.15; // Kicks the wobble spring harder on misaligned drops (was: 0.11)
/** Whip: how much more the top of the tower sways than a rigid lean would. */
export const WHIP_GAIN = 1.15;
/** Continuous "wind sway" the tower develops once its COM drifts. */
export const AMBIENT_SWAY_FREQ = 1.05;
export const AMBIENT_SWAY_MAX = 0.075;
/**
 * Instability ramp for the continuous sway. It is **0 for the whole first
 * building** (the base stays rock-solid) and then grows this much per floor
 * beyond `BUILDING_CAP_BASE`, so from the 2nd building on a badly-built tower
 * sways more and more the higher it climbs. Capped by `SWAY_INSTABILITY_MAX`.
 */
export const SWAY_RAMP_PER_FLOOR = 0.14;
export const SWAY_INSTABILITY_MAX = 4;
/**
 * Topple crumble: when the COM leaves the base the tower falls apart into
 * debris that scatter toward the topple side instead of a rigid rotation that
 * clipped the floors through the base slab. `CRUMBLE_KICK` is the outward speed
 * (grows with a floor's height), `CRUMBLE_HOP` the upward pop off the stack.
 */
export const CRUMBLE_KICK = 6;
export const CRUMBLE_HOP = 3.5;

// --- Population / scoring (module 4) ---
export const BASE_POP = 100;
/** Extra habitants for a perfect (dead-center) placement. */
export const PERFECT_BONUS = 150;
/** Consecutive perfects needed to light the combo state. */
export const COMBO_THRESHOLD = 3;
/** Population multiplier applied to floors placed while the combo is lit. */
export const COMBO_MULT = 2;
/** Bonus habitants per floor when a building is completed (its cap is reached). */
export const BUILDING_BONUS_PER_FLOOR = 60;
/** How much a perfect combo speeds up the next swing (fraction added to omega). */
export const COMBO_SPEEDUP = 0.18;

// --- Building cap ---
/** Floors of the first building before it completes and the next one begins. */
export const BUILDING_CAP_BASE = 10;
/** Extra floors each subsequent building allows (harder plans), capped. */
export const BUILDING_CAP_GROWTH = 2;
export const BUILDING_CAP_MAX = 20;

// --- Camera (module 3) ---
export const CAM_FOV = 32;
/** Sideways offset for the slight 3/4 read; small keeps it near-profile. */
export const CAM_X = 1.7;
export const CAM_Z = 15.5;
/** Camera height above its vertical focus point. */
export const CAM_Y_OFF = 0.6;
/** Focus sits this far ABOVE the tower top so the crane / hanging block fit. */
export const CAM_FOCUS_UP = 1.7;
/** Lerp rate for the vertical camera follow. */
export const CAM_LERP = 4;

// --- Feel ---
/** Max simulated dt per frame (s) so a hitch can't teleport a falling block. */
export const MAX_DT = 0.05;

// --- Height zones for the dynamic sky (module 3), in world-Y of the tower top ---
export const ZONE_CLOUDS_Y = 16;
export const ZONE_STRATO_Y = 42;
export const ZONE_SPACE_Y = 82;
