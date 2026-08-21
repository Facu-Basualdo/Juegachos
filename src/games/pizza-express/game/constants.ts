// Pizza Express — all tunable values live here. Tune gameplay here first.
//
// Coordinate system: the road runs along Z. The scooter stays near z=0 while the
// world scrolls toward the camera (+Z). Obstacles / mailboxes spawn far ahead at
// negative Z and travel toward +Z. Y is up; the road surface is y=0.

// --- Road / play field ---
export const ROAD_HALF_WIDTH = 4.2; // asphalt half-width
export const SHOULDER = 1.1; // dirt/curb strip beyond the asphalt on each side
export const SCOOTER_HALF_WIDTH = 0.55;
// The scooter steers within these X bounds (kept a touch inside the asphalt).
export const STEER_LIMIT = ROAD_HALF_WIDTH - SCOOTER_HALF_WIDTH - 0.15;

// Roadside where mailboxes (customers) stand, and where houses sit behind them.
export const MAILBOX_X = ROAD_HALF_WIDTH + SHOULDER * 0.5;
export const HOUSE_X = ROAD_HALF_WIDTH + SHOULDER + 3.4;

// --- Scooter steering ---
export const SCOOTER_MOVE_SPEED = 12; // units/s of lateral steering
export const SCOOTER_SMOOTHING = 13; // velocity smoothing toward the target
export const SCOOTER_Z = 0;

// --- Camera (chase cam behind + above, looking down the road) ---
export const CAMERA_POS = { x: 0, y: 3.5, z: 8.2 };
export const CAMERA_LOOK = { x: 0, y: 0.7, z: -16 };
export const CAMERA_FOV = 62;
// The camera drifts a little with the scooter's X so steering feels connected
// without losing sight of the whole street.
export const CAMERA_X_FOLLOW = 0.16;

// --- Travel speed (ramps up fast over time) ---
export const BASE_SPEED = 15; // units/s the world scrolls at the start
export const MAX_SPEED = 48;
export const SPEED_RAMP_PER_SEC = 1.05; // linear climb of the speed cap over time

// --- Tutorial / presentation window ---
// The first seconds are a gentle intro: no lethal obstacles, thought-bubble
// hints, and the shield cushions misses so a new player can learn to throw.
export const TUTORIAL_SECONDS = 10;

// --- Miss allowances (neither pool regenerates; both only count post-tutorial) ---
// Errant throws: you can waste this many pizzas before the run ends, plus a
// one-time tutorial shield that absorbs the very first one.
export const MISS_PIZZAS = 3;
// Skipped customers: you can let this many mailboxes pass unserved before the
// run ends (each also breaks the combo).
export const MISS_CUSTOMERS = 5;

// --- Difficulty stepping (a pure function of play time, after the tutorial) ---
// Difficulty is quantized into levels so the game visibly steps up.
export const DIFFICULTY_STEP_SECONDS = 4; // seconds per difficulty level
export const DIFFICULTY_RAMP_SECONDS = 60; // reaches hardest values here, then holds

// --- Obstacles (instant death on contact) ---
export const OBSTACLE_SPAWN_Z = -95;
export const OBSTACLE_DESPAWN_MARGIN = 10; // past the scooter before recycling
export const OBSTACLE_SPACING_START = 17; // Z gap between rows, early
export const OBSTACLE_SPACING_MIN = 7.5; // tightest gap at max difficulty
export const OBSTACLE_ACTIVE_ROWS = 9; // rows kept alive ahead
// A row leaves a guaranteed clear gap the scooter can steer to; the gap centre
// may drift at most this fraction of the scooter's reachable travel between rows.
export const GAP_REACH_FACTOR = 0.72;
export const GAP_HALF_WIDTH_START = 2.5; // half-width of the safe gap, early
export const GAP_HALF_WIDTH_MIN = 1.25; // tightest safe gap at max difficulty
// Chance a row spawns a second obstacle (a wider block) — grows with difficulty.
export const DOUBLE_OBSTACLE_CHANCE_MAX = 0.55;
export const OBSTACLE_COLLIDE_TOLERANCE = 0.12; // units of forgiveness

// Dogs are the one **dynamic** obstacle: instead of a static prop, a dog row is a
// lone dog that trots back and forth across the whole street. You dodge it by
// timing (be out of its narrow band when it reaches you). Chance grows with
// difficulty; its patrol speed stays well under the scooter's so it's always
// avoidable.
export const DOG_ROW_CHANCE_MIN = 0.12;
export const DOG_ROW_CHANCE_MAX = 0.26;
export const DOG_SPEED_MIN = 2.4; // units/s horizontal patrol
export const DOG_SPEED_MAX = 5.2;

// --- Mailboxes (customers / delivery targets) ---
export const MAILBOX_SPAWN_Z = -92;
export const MAILBOX_DESPAWN_MARGIN = 8;
export const MAILBOX_SPACING_START = 26; // Z gap between customers, early
export const MAILBOX_SPACING_MIN = 15; // tightest at max difficulty
export const MAILBOX_ACTIVE = 6;
// The throw window is the Z band [THROW_MIN_Z, THROW_RANGE_Z] ahead of the
// scooter: a mailbox is only targetable while inside it, so each delivery is a
// TIMED drop — too early is out of range, and closer than THROW_MIN_Z is too
// late to lob (both waste the pizza). Kept tight on purpose (it used to be
// 0.5..18, which let you hold the throw until fully alongside and never miss).
export const THROW_RANGE_Z = 10;
export const THROW_MIN_Z = 3;
// Z past which a mailbox is considered "passed": it stops being a valid throw
// target (you can't score a box you already rode by — targeting moves to the next
// one ahead) and, if still pending, is marked missed (breaks the combo). Kept
// right at the scooter (~alongside) so you must serve it while it's ahead of you.
export const MAILBOX_MISS_Z = 0.5;

// --- Throwing pizzas ---
export const THROW_COOLDOWN = 0.22; // seconds between throws
export const PIZZA_FLIGHT_TIME = 0.36; // seconds a pizza takes to reach its target
export const PIZZA_ARC_HEIGHT = 2.2; // peak height of the parabola
export const PIZZA_ACTIVE_MAX = 12; // pool size
export const DELIVER_RADIUS = 1.6; // how close a pizza must arc to a mailbox

// --- Scoring ---
export const DELIVERY_BASE_POINTS = 100;
export const COMBO_MAX = 9; // multiplier cap

// --- Scenery pool (decorative props that wrap along Z) ---
export const SCENERY_SPAWN_Z = -110;
export const SCENERY_SPAN = 120; // wrap length
export const SCENERY_SPACING = 9; // Z gap between roadside prop clusters

// --- Sky / fog (warm dusk haze) ---
export const FOG_COLOR = 0xffc79a;
export const FOG_NEAR = 34;
export const FOG_FAR = 108;

// --- Palette (see DESIGN.md "Golden Hour Delivery") ---
export const COLOR_TOMATO = 0xd83a2b;
export const COLOR_PEPPERONI = 0xa8281c;
export const COLOR_CHEESE = 0xf2b134;
export const COLOR_MOLTEN = 0xffd36b;
export const COLOR_CARDBOARD = 0xc9995a;
export const COLOR_CRUST = 0x8a5a2b;
export const COLOR_CREAM = 0xf2e4c4;
export const COLOR_FOLIAGE = 0x4f8a3a;
export const COLOR_LEAF = 0x356026;
export const COLOR_TERRACOTTA = 0xc65a34;
export const COLOR_ASPHALT = 0x4a4038;
export const COLOR_DIRT = 0x9a7040;

export const BEST_SCORE_KEY = "pizza-express-best";
