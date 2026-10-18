export const BEST_KEY = "puerco-arana:best";

// World reference: the street-to-sky slice every screen must show is WORLD_HEIGHT
// tall. The canvas fills the viewport and the visible world adapts to its aspect:
// wider screens see more city ahead, taller (portrait) screens see more sky.
export const WORLD_HEIGHT = 600; // y of the bottom edge of the road
export const MIN_VIEW_WIDTH = 600; // never show less than this much world horizontally
export const MAX_DPR = 2;

export const MAX_DT = 0.05; // clamp large frame gaps (tab switches) to avoid tunneling
export const PHYSICS_STEP = 1 / 120; // substep keeps the rope constraint stable at high speed

// Physics (world units are pixels; y grows downward).
export const GRAVITY = 1500; // px/s^2
export const PIG_RADIUS = 17;
export const AIR_DRAG = 0.05; // fraction of horizontal speed shed per second in free flight
export const MAX_SPEED = 1500; // hard cap on the pig's speed

// Web / swing.
export const WEB_RANGE = 520; // max grab distance: from the lowest safe swing it still reaches the highest anchor
export const WEB_BEHIND_MAX = 40; // anchors up to this far behind the pig are still grabbable
export const WEB_ABOVE_MIN = 24; // an anchor must sit at least this much above the pig
export const ROPE_MIN = 70; // never attach shorter than this (avoids dead pivots)
export const ROPE_CLEARANCE = 36; // the bottom of every swing stays this far above the street
export const REEL_SPEED = 1100; // px/s the web reels in when it was grabbed too long
export const SWING_PUMP = 300; // tangential px/s^2 fed into the FORWARD swing only
export const PUMP_MAX_SPEED = 950; // the pump stops helping above this speed

// The street: touching it ends the run.
export const STREET_Y = 548;

// Anchor generation (world px). Anchors sit on antenna tips of tall towers. The
// gap between them widens from the *_START to the *_END range over
// DIFFICULTY_DISTANCE px of progress.
export const ANCHOR_GAP_START: [number, number] = [210, 320];
export const ANCHOR_GAP_END: [number, number] = [300, 410];
export const DIFFICULTY_DISTANCE = 24000;
// Avenues: now and then the gap opens into a wide street with no tower, which
// only a well-timed, fast release crosses. More frequent and wider with progress.
export const AVENUE_CHANCE_START = 0.1;
export const AVENUE_CHANCE_END = 0.35;
export const AVENUE_GAP_START: [number, number] = [560, 700];
export const AVENUE_GAP_END: [number, number] = [680, 860];
export const AVENUE_FREE_ANCHORS = 4; // no avenue among the first anchors of a run
export const ANCHOR_Y_MIN = 50;
export const ANCHOR_Y_MAX = 230;
export const FIRST_ANCHOR_X = 250;

// Run start: already hanging from the first anchor, mid-swing.
export const START_X = 90;
export const START_Y = 300;
export const START_VX = 260;

// Scoring.
export const PX_PER_POINT = 40; // world px advanced per distance point
export const BONUS_SPEED = 650; // releasing faster than this grants a bonus (once per anchor)
export const BONUS_DIVISOR = 250; // bonus points = floor(speed / this)

// Camera: the pig is kept at this fraction of the view width, and the view
// rises to keep it at least CAMERA_TOP_MARGIN px below the top edge. On narrow
// (portrait) views the pig slides left, down to CAMERA_PIG_VIEW_X_MIN, so at
// least CAMERA_MIN_AHEAD px of city stay visible ahead of it.
export const CAMERA_PIG_VIEW_X = 0.36;
export const CAMERA_PIG_VIEW_X_MIN = 0.2;
export const CAMERA_MIN_AHEAD = 480;
export const CAMERA_EASE = 5; // exponential ease factor (per second)
export const CAMERA_TOP_MARGIN = 140;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.7; // seconds per countdown step

export const SOUND_VOLUME = 0.18;
