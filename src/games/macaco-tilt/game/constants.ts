export const BEST_KEY = "macaco-tilt:best";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75; // seconds per countdown label
export const MAX_DT = 0.05; // clamp delta time so a backgrounded tab can't teleport the physics

// --- Fixed view box (letterboxed into the window by Game.resize) ---
export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 640;

// --- Scene geometry (view units) ---
/** The fulcrum tip: the plank rotates around exactly this point. */
export const PIVOT_X = VIEW_WIDTH / 2;
export const PIVOT_Y = 400;
export const PLANK_THICKNESS = 26;
/** Half width per side at the start of a run (so the plank is 400px wide). */
export const PLANK_HALF_START = 200;
/** Trimming stops here, otherwise the plank would vanish under the monkey's feet. */
export const PLANK_HALF_MIN = 46;
export const WEDGE_HEIGHT = 104;
export const WEDGE_HALF_BASE = 78;

// --- Monkey ---
/** Half the foot span: the monkey falls when |pos| + this exceeds the edge. */
export const MONKEY_FOOT_HALF = 15;
export const MONKEY_HEIGHT = 92;

// --- Torque physics (angle in radians, 0 = level, positive = right side down) ---

/**
 * Angular acceleration per unit of lever arm, i.e. the `m*g` of `tau = m*g*d*cos(theta)`
 * folded into one constant and divided by the plank's moment of inertia. At the very end
 * of a fresh plank (d = 200) this is ~2.2 rad/s^2, which tips fast enough to scare.
 */
export const TORQUE_GAIN = 0.011;
/**
 * The plank's **own** weight, acting through its own centre of mass.
 *
 * While the plank is symmetric this contributes nothing (the centre of mass sits on the
 * pivot). Once an end breaks off, the remaining side outweighs the stub and the plank
 * leans that way by itself — which is what makes a break *change the board* instead of
 * just removing floor. Deliberately weaker than `TORQUE_GAIN` so that even at maximum
 * asymmetry a player pinned to the short end can still fight it.
 */
export const PLANK_TORQUE_GAIN = 0.006;
/** Angular drag. With TORQUE_GAIN this caps the tilt rate at ~1.2 rad/s at the far end. */
export const ANG_DAMPING = 1.8;
/** Past this tilt the plank has dumped the monkey no matter what (~54deg). */
export const FAIL_ANGLE = 0.95;
/** The monkey switches to its PANIC face and animation here (25deg, per the brief). */
export const PANIC_ANGLE = 0.436;
/** Sweat drops start flying here (~17deg) — the tell fires before the panic does. */
export const DANGER_ANGLE = 0.3;
/**
 * Continuous angular noise. Without it a monkey parked exactly on the pivot sits in a
 * dead-stable equilibrium forever, which would let an idle player hang a room round.
 */
export const ANG_JITTER = 0.1;

// --- Walking along the plank (position is signed distance from the pivot) ---

/** Gravity pulling the monkey toward the low end: accel = this * sin(theta). */
export const SLIDE_GRAVITY = 900;
export const WALK_ACCEL = 1800;
/** Velocity drag along the plank. WALK_ACCEL / this is the flat-ground top speed (~257 px/s). */
export const WALK_FRICTION = 7;
/**
 * Traction falls off with cos(theta) — on a steep plank the monkey can barely push off.
 * This is what makes >30deg feel like a losing battle instead of a slow walk back.
 */
export const WALK_TRACTION_MIN = 0.25;

// --- Plank trimming: the ends break off in stages, never smoothly ---

export const TRIM_FIRST = 8; // seconds before the first chunk goes
export const TRIM_INTERVAL = 7.5; // seconds between chunks after that
export const TRIM_INTERVAL_MIN = 4;
export const TRIM_INTERVAL_DECAY = 0.35; // each trim brings the next one closer
export const TRIM_CHUNK = 24; // px removed from one side per stage
/** Screen shake when a chunk breaks off. */
export const TRIM_SHAKE = 9;
/**
 * Angular velocity kick toward the now-heavier side the instant a chunk snaps off.
 * The shifted centre of mass alone is a slow lean; this is the jolt that makes the
 * break register as an event you have to answer right now.
 */
export const TRIM_KICK = 0.45;

// --- Fatigue: the bamboo cracks wherever the monkey parks ---

/**
 * Width of one fatigue segment. Roughly a foot span, so stepping one segment over is
 * enough to relieve the one you were on — the mechanic asks for constant small
 * movement, it does not ask for sprinting.
 */
export const STRESS_SEGMENT = 34;
/**
 * Fatigue per second under the monkey: 1 / this = seconds of standing still to snap
 * (~3.3s). **This is the main difficulty knob of the game** — raise it to punish
 * parking harder, lower it to give more room to react to the creak.
 */
export const STRESS_BUILD = 0.3;
/** Fatigue shed per second once the monkey steps off. Slower than the build on
 * purpose, so shuffling between two segments still loses ground. */
export const STRESS_RECOVER = 0.18;
/** Fatigue at which the bamboo starts creaking audibly. */
export const STRESS_WARN = 0.5;
/** Fatigue at which the crack starts being drawn. */
export const STRESS_CRACK_MIN = 0.12;

// --- Wind gusts: telegraphed, then a hard shove ---

export const GUST_FIRST = 4;
export const GUST_INTERVAL_MIN = 2;
export const GUST_INTERVAL_MAX = 4;
/** Leaves stream across the screen for this long before the gust actually lands. */
export const GUST_WARNING = 1.1;
export const GUST_BASE = 0.85; // angular impulse at t=0 (rad/s)
export const GUST_RAMP = 0.035; // extra impulse per second survived
export const GUST_MAX = 2.1;
/**
 * Ceiling on a gust, expressed as a multiple of the counter-torque the monkey can
 * actually produce from the far end of the side it must stand on:
 * `strength <= GUST_AUTHORITY * TORQUE_GAIN * lever * GUST_PUSH_TIME`.
 *
 * Without it, gust strength ramps with elapsed time while the player's authority
 * *shrinks* with the plank, so late in a run a gust flips the plank no matter how
 * perfectly it is answered. Simulated (`sim.cjs`): at `halfLeft` 46 and t=45s a good
 * human peaked at 54deg against a 54deg fail angle — unavoidable death.
 *
 * At 5x the cap only binds below ~69px of half-width, so the early and mid game are
 * untouched and this acts purely as a late-game safety valve. Late peaks land around
 * 33-40deg: still frightening, no longer a coin flip.
 */
export const GUST_AUTHORITY = 5;
/** The gust keeps pushing for this long after it lands, so it can't be tapped away. */
export const GUST_PUSH_TIME = 0.55;

// --- Falling into the chasm ---

export const FALL_GRAVITY = 1500;
export const FALL_SPIN = 6.5; // rad/s while tumbling
/** How long the fall plays before the game-over overlay appears. */
export const FALL_DURATION = 1.15;

// --- Palette (see DESIGN.md, "Luz de Dosel") ---

export const COLORS = {
  skyDeep: "#0d2818",
  skyMid: "#153a22",
  skyHigh: "#1b4d2e",
  canopyFar: "#12301f",
  canopyMid: "#2d6b3f",
  canopyNear: "#4a9c5d",
  light: "#f4d03f",
  woodLight: "#c8873f",
  woodDark: "#8b5a2b",
  woodShadow: "#5e3a1a",
  fur: "#8b5e34",
  furLight: "#b07a45",
  furDark: "#5f3f22",
  skin: "#f0c99b",
  danger: "#e8503a",
  safe: "#7ed957",
} as const;
