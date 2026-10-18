import {
  AIR_DRAG,
  ANCHOR_GAP_END,
  ANCHOR_GAP_START,
  ANCHOR_Y_MAX,
  ANCHOR_Y_MIN,
  AVENUE_CHANCE_END,
  AVENUE_CHANCE_START,
  AVENUE_FREE_ANCHORS,
  AVENUE_GAP_END,
  AVENUE_GAP_START,
  DIFFICULTY_DISTANCE,
  GRAVITY,
  MAX_SPEED,
  PIG_RADIUS,
  PUMP_MAX_SPEED,
  REEL_SPEED,
  ROPE_CLEARANCE,
  ROPE_MIN,
  STREET_Y,
  SWING_PUMP,
  WEB_ABOVE_MIN,
  WEB_BEHIND_MAX,
  WEB_RANGE,
} from "./constants";

// Pure swing simulation: no DOM, no sound, no randomness of its own. Game.ts
// drives it, and it can be stepped headless to check that the run is playable.

export interface Anchor {
  x: number;
  y: number;
  /** Releasing from this anchor already paid a speed bonus (one per anchor). */
  paid: boolean;
}

export interface Pig {
  x: number;
  y: number;
  vx: number;
  vy: number;
  attached: Anchor | null;
  /** Current rope length; reels in towards ropeTarget, never grows. */
  rope: number;
  ropeTarget: number;
}

/** Longest rope whose lowest point still clears the street. */
export function safeRope(anchor: Anchor): number {
  return STREET_Y - PIG_RADIUS - ROPE_CLEARANCE - anchor.y;
}

/**
 * The anchor a press would grab right now: above the pig, within WEB_RANGE and
 * not too far behind; among those, the one furthest ahead.
 */
export function pickAnchor(pig: Pig, anchors: readonly Anchor[]): Anchor | null {
  let best: Anchor | null = null;
  for (const a of anchors) {
    const dx = a.x - pig.x;
    if (dx < -WEB_BEHIND_MAX) continue;
    if (pig.y - a.y < WEB_ABOVE_MIN) continue;
    if (Math.hypot(dx, a.y - pig.y) > WEB_RANGE) continue;
    if (!best || a.x > best.x) best = a;
  }
  return best;
}

/** Hooks the pig to an anchor: taut at the current distance, reeling in if that is unsafe. */
export function attach(pig: Pig, anchor: Anchor): void {
  const dist = Math.hypot(anchor.x - pig.x, anchor.y - pig.y);
  pig.attached = anchor;
  pig.rope = Math.max(ROPE_MIN, dist);
  pig.ropeTarget = Math.max(ROPE_MIN, Math.min(dist, safeRope(anchor)));
}

/** Advances one substep. Returns true when the pig touched the street. */
export function stepPig(pig: Pig, dt: number): boolean {
  pig.vy += GRAVITY * dt;

  const a = pig.attached;
  if (a) {
    // Reel at least as fast as the pig moves, or a fast grab of a far anchor
    // would still carry it into the street before the rope got short enough.
    if (pig.rope > pig.ropeTarget) {
      const reel = Math.max(REEL_SPEED, Math.hypot(pig.vx, pig.vy));
      pig.rope = Math.max(pig.ropeTarget, pig.rope - reel * dt);
    }

    // Pump only the forward half of the swing: it keeps the run moving without
    // also feeding the back-and-forth that used to trap the pig in place.
    const dist = Math.hypot(pig.x - a.x, pig.y - a.y) || 1;
    const nx = (pig.x - a.x) / dist;
    const ny = (pig.y - a.y) / dist;
    let tx = -ny;
    let ty = nx;
    if (pig.vx * tx + pig.vy * ty < 0) {
      tx = -tx;
      ty = -ty;
    }
    if (tx > 0 && Math.hypot(pig.vx, pig.vy) < PUMP_MAX_SPEED) {
      pig.vx += tx * SWING_PUMP * dt;
      pig.vy += ty * SWING_PUMP * dt;
    }
  } else {
    pig.vx -= pig.vx * AIR_DRAG * dt;
  }

  const speed = Math.hypot(pig.vx, pig.vy);
  if (speed > MAX_SPEED) {
    pig.vx = (pig.vx / speed) * MAX_SPEED;
    pig.vy = (pig.vy / speed) * MAX_SPEED;
  }

  pig.x += pig.vx * dt;
  pig.y += pig.vy * dt;

  if (a) {
    // Rope constraint: project back onto the circle and kill outward velocity.
    // With the rope slack (inside the circle) the pig falls freely.
    const dx = pig.x - a.x;
    const dy = pig.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > pig.rope && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      pig.x = a.x + nx * pig.rope;
      pig.y = a.y + ny * pig.rope;
      const radial = pig.vx * nx + pig.vy * ny;
      if (radial > 0) {
        pig.vx -= radial * nx;
        pig.vy -= radial * ny;
      }
    }

    // Last resort: while hooked the web always holds. If the pig would still
    // touch the street, the rope shortens right there and the fall stops.
    const floor = STREET_Y - PIG_RADIUS - 1;
    if (pig.y > floor) {
      pig.y = floor;
      if (pig.vy > 0) pig.vy = 0;
      pig.rope = Math.max(ROPE_MIN, Math.hypot(pig.x - a.x, pig.y - a.y));
      pig.ropeTarget = Math.min(pig.ropeTarget, pig.rope);
    }
    return false;
  }

  return pig.y + PIG_RADIUS >= STREET_Y;
}

function lerpRange(a: [number, number], b: [number, number], t: number, r: number): number {
  const min = a[0] + (b[0] - a[0]) * t;
  const max = a[1] + (b[1] - a[1]) * t;
  return min + r * (max - min);
}

/**
 * Next anchor after `prevX`; `index` is how many anchors the run already has
 * and `rnd` a [0, 1) source (Math.random in game).
 */
export function nextAnchor(prevX: number, index: number, rnd: () => number): Anchor {
  const t = Math.min(1, Math.max(0, prevX / DIFFICULTY_DISTANCE));
  const avenueChance = AVENUE_CHANCE_START + (AVENUE_CHANCE_END - AVENUE_CHANCE_START) * t;
  const avenue = index >= AVENUE_FREE_ANCHORS && rnd() < avenueChance;
  const gap = avenue
    ? lerpRange(AVENUE_GAP_START, AVENUE_GAP_END, t, rnd())
    : lerpRange(ANCHOR_GAP_START, ANCHOR_GAP_END, t, rnd());
  return {
    x: prevX + gap,
    y: ANCHOR_Y_MIN + rnd() * (ANCHOR_Y_MAX - ANCHOR_Y_MIN),
    paid: false,
  };
}
