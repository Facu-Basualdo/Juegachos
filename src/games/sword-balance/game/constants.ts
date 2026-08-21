export const BEST_KEY = "sword-balance:best";

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75; // seconds per countdown label
export const MAX_DT = 0.05; // clamp delta time to avoid physics jumps on tab blur

// --- Inverted-pendulum physics (angle in radians, 0 = perfectly upright) ---

/** Past this tilt the sword drops and the run ends (~58deg). */
export const FAIL_ANGLE = 1.02;
/** Destabilizing gravity: angular accel = GRAVITY * sin(angle). High enough that
 * doing nothing topples in ~1s — the sword must be actively balanced. */
export const GRAVITY = 5.0;
/**
 * Corrective torque while a side is held. Paired with high DAMPING this is
 * "damping-dominated": holding commands a steady lean *rate* (~CONTROL/DAMPING
 * rad/s) instead of raw acceleration, which is what makes hold-to-lean balancing
 * actually controllable rather than a runaway double integrator.
 */
export const CONTROL_TORQUE = 6.5;
export const DAMPING = 3.2;

// --- Perturbation: gusts that ramp up the longer you survive ---

export const GUST_MIN_INTERVAL = 0.8; // seconds between gusts (min)
export const GUST_MAX_INTERVAL = 2.0; // seconds between gusts (max)
export const GUST_BASE = 0.5; // gust velocity impulse at t=0 (rad/s)
export const GUST_RAMP = 0.06; // extra impulse per second survived
export const GUST_MAX = 2.4; // cap on gust impulse
export const JITTER = 0.25; // continuous small accel noise amplitude
export const START_KICK = 0.5; // initial random angular velocity so play begins unstable

// Visual feedback: how far the wrist visibly leans when a side is held.
export const WRIST_LEAN = 0.22; // radians

/** Seconds for the blade to swing flat after a failed run. */
export const FALL_DURATION = 0.42;
