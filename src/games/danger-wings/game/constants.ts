// All tunable values for Danger Wings. Tune here first before touching logic.
// World units live in the XY plane; the camera looks down -Z at the origin.

export const BEST_SCORE_KEY = "danger-wings:best";

// --- Room (the iron cell) ---------------------------------------------------
export const SIDE_X = 3.0; // inner face of the left / right walls at x = ±SIDE_X
export const CEIL_Y = 4.6; // inner face of the ceiling
export const FLOOR_Y = -4.6; // inner face of the floor
export const WALL_THICKNESS = 0.7;
export const ROOM_DEPTH = 1.8; // z-extent of the walls (the 2.5D box)

// --- Bird (the crow) --------------------------------------------------------
export const BIRD_RADIUS = 0.36; // collision half-size (box)
export const BIRD_MODEL_SCALE = 0.8; // visual scale of the crow model
export const GRAVITY = -24; // units/s^2
export const JUMP_VELOCITY = 7.2; // upward impulse applied on each flap
export const MAX_FALL_SPEED = -12; // terminal downward velocity
export const SPEED_X_BASE = 3.6; // horizontal speed at score 0
export const SPEED_X_MAX = 5.6; // horizontal speed cap
export const SPEED_X_PER_POINT = 0.045; // added to |vx| per point of score
export const BOUNCE_VY_ASSIST = 1.7; // subtle vy nudge on wall bounce (game feel)

// --- Fixed ceiling / floor spikes ------------------------------------------
export const FIXED_SPIKE_LEN = 0.72;
export const FIXED_SPIKE_RADIUS = 0.26;
export const FIXED_SPIKE_COUNT = 9; // per row
// Death lines: the spike tips reaching into the arena.
export const CEIL_TIP_Y = CEIL_Y - FIXED_SPIKE_LEN;
export const FLOOR_TIP_Y = FLOOR_Y + FIXED_SPIKE_LEN;

// --- Dynamic side spikes ----------------------------------------------------
export const SIDE_SLOTS = 9; // candidate positions along each side wall
export const SIDE_SPIKE_LEN = 0.9;
export const SIDE_SPIKE_RADIUS = 0.28;
export const SIDE_SPIKE_HALF = 0.42; // collision half-height of one spike
export const SIDE_SPIKE_EMERGE_TIME = 0.26; // seconds to slide fully out
export const SIDE_SPIKE_RETRACT_TIME = 0.16; // seconds to pull back in
export const SLOT_MARGIN = 0.35; // clearance from the fixed spikes

// Difficulty: how many side spikes emerge, by current score. [min, max].
export function spikeCountRange(score: number): [number, number] {
  if (score <= 5) return [2, 3];
  if (score <= 15) return [3, 5];
  if (score <= 20) return [4, 6];
  return [5, 7];
}

// --- Candy / relic (collectible) -------------------------------------------
export const CANDY_FIRST_BOUNCE = 4; // first relic appears after this many bounces
export const CANDY_BOUNCE_INTERVAL = 6; // bounces between relics
export const CANDY_RADIUS = 0.46;
export const CANDY_COLLECT_DIST = 0.72; // center distance for pickup
export const CANDY_POINTS = 3; // bonus points per relic
export const CANDY_Y_RANGE = 2.6; // relic spawns at x=0, y in [-range, range]

// --- Camera -----------------------------------------------------------------
export const CAM_FOV = 52;
export const CAM_FIT_MARGIN = 1.14; // extra room around the cell when fitting

// --- Palette (Consecrated Iron, see DESIGN.md) -----------------------------
export const COLOR_STONE = 0x231f2e; // dark indigo cell walls
export const COLOR_STONE_TRIM = 0x16121f;
export const COLOR_IRON = 0x4a4d57; // gunmetal spikes
export const COLOR_IRON_TIP = 0x8f939c; // cold specular tip
export const COLOR_FEATHER = 0x15141b; // crow body (almost the void)
export const COLOR_BEAK = 0xc4a24a; // tarnished gold
export const COLOR_EYE = 0xefe7d2; // bone white
export const COLOR_RELIC = 0xc41530; // blood-ruby, same red as the far windows
export const COLOR_MOON = 0xd9d3bf;

// Ambient tint cycle: every 10 points the cell slides one step colder / stranger,
// always within the near-black register (see DESIGN.md "slow dread").
export const TINT_CYCLE = [
  0x0b0a16, // indigo
  0x140913, // old-blood maroon
  0x08130f, // drowned teal
  0x0f0819, // deep violgrave
];
export const TINT_PERIOD = 10; // points per step

// --- Environment / backdrop -------------------------------------------------
// Optional AI-painted backdrop (generate in Krea with the prompt in DESIGN.md,
// drop it here). Missing -> the procedural gothic canvas is used instead.
export const BACKDROP_URL = "/models/danger-wings/backdrop.jpg";
export const COLOR_TORCH = 0xff8a3c; // warm ember flame / torchlight
export const COLOR_EMBER = 0xffb060; // drifting embers
