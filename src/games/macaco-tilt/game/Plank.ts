import {
  ANG_DAMPING,
  ANG_JITTER,
  PLANK_HALF_MIN,
  PLANK_HALF_START,
  PLANK_TORQUE_GAIN,
  STRESS_BUILD,
  STRESS_RECOVER,
  STRESS_SEGMENT,
  TORQUE_GAIN,
  TRIM_CHUNK,
  TRIM_FIRST,
  TRIM_KICK,
  TRIM_INTERVAL,
  TRIM_INTERVAL_DECAY,
  TRIM_INTERVAL_MIN,
} from "./constants";

/** A chunk that just broke off, so the caller can spawn splinters and shake there. */
export interface TrimEvent {
  /** -1 = left end, +1 = right end. */
  side: -1 | 1;
  /** Distance from the pivot where the break happened (signed, plank-local). */
  at: number;
}

/** How many fatigue segments cover a full-width plank. */
const SEGMENT_COUNT = Math.ceil((PLANK_HALF_START * 2) / STRESS_SEGMENT);

/**
 * The bamboo plank resting on the fulcrum: its tilt, and the chunks that keep
 * breaking off the ends.
 *
 * The tilt is a plain rigid-body rotation about the pivot. The destabilising term is
 * the monkey's weight acting through its lever arm — `tau = m*g*d*cos(theta)`, with
 * `m*g` and the moment of inertia folded into `TORQUE_GAIN`. There is deliberately
 * **no restoring force**: a plank balanced on a wedge is in neutral equilibrium, so
 * letting go at 10deg keeps it at 10deg. Getting back to level means walking to the
 * high side, which is the whole game.
 */
export class Plank {
  angle = 0;
  angleVel = 0;
  /** Half widths are tracked per side, because trimming makes the plank asymmetric. */
  halfLeft = PLANK_HALF_START;
  halfRight = PLANK_HALF_START;

  private trimTimer = TRIM_FIRST;
  private trimGap = TRIM_INTERVAL;
  /** Fatigue per segment, 0..1. Indexed off a fixed origin so the segments stay put
   * as the ends break away. */
  private readonly stress = new Array<number>(SEGMENT_COUNT).fill(0);

  reset(): void {
    this.angle = 0;
    this.angleVel = 0;
    this.halfLeft = PLANK_HALF_START;
    this.halfRight = PLANK_HALF_START;
    this.trimTimer = TRIM_FIRST;
    this.trimGap = TRIM_INTERVAL;
    this.stress.fill(0);
  }

  /** Read-only fatigue values, for the renderer to draw the cracks. */
  get segments(): readonly number[] {
    return this.stress;
  }

  /** Highest fatigue anywhere on the plank, for the creak warning. */
  get peakStress(): number {
    let max = 0;
    for (const s of this.stress) if (s > max) max = s;
    return max;
  }

  /** Plank-local centre of a fatigue segment. */
  segmentCentre(index: number): number {
    return -PLANK_HALF_START + (index + 0.5) * STRESS_SEGMENT;
  }

  private segmentIndex(x: number): number {
    const i = Math.floor((x + PLANK_HALF_START) / STRESS_SEGMENT);
    return Math.max(0, Math.min(SEGMENT_COUNT - 1, i));
  }

  /**
   * Accumulates fatigue under the monkey and relieves it everywhere else.
   *
   * Returns the break event on the frame a segment gives way, else null. The break is
   * always **where the monkey is standing**, which is what deletes the "park on the
   * pivot" strategy: standing on the fulcrum snaps the plank at the fulcrum and takes
   * a whole side with it.
   */
  stepStress(dt: number, monkeyPos: number): TrimEvent | null {
    const active = this.segmentIndex(monkeyPos);
    let snap: TrimEvent | null = null;

    for (let i = 0; i < this.stress.length; i++) {
      const centre = this.segmentCentre(i);
      // Segments already broken off carry no load.
      if (centre <= -this.halfLeft || centre >= this.halfRight) {
        this.stress[i] = 0;
        continue;
      }
      if (i === active) {
        // Full rate on the segment actually carrying the weight, wherever the monkey
        // stands inside it — otherwise parking on a segment boundary would halve the
        // load and double your survival, which is a seam players would find.
        this.stress[i] = Math.min(1, this.stress[i] + STRESS_BUILD * dt);
        if (this.stress[i] >= 1 && !snap) snap = { side: centre >= 0 ? 1 : -1, at: centre };
      } else {
        // Relief is **continuous in distance**, not all-or-nothing per segment: a
        // segment the monkey has only half stepped off recovers at half rate. Without
        // this, shuffling inside one segment relieved nothing and the plank cracked
        // under a player who was visibly moving — unreadable and unfair.
        const weight = Math.max(0, 1 - Math.abs(centre - monkeyPos) / STRESS_SEGMENT);
        this.stress[i] = Math.max(0, this.stress[i] - STRESS_RECOVER * (1 - weight) * dt);
      }
    }

    if (snap) {
      // Everything outboard of the break falls away, and the bar lurches like any
      // other break. Usually fatal, but a monkey already drifting off the segment can
      // survive by a hair — which is the "phew" the mechanic needs to stay fair.
      if (snap.side === 1) this.halfRight = Math.max(0, snap.at);
      else this.halfLeft = Math.max(0, -snap.at);
      this.stress.fill(0);
      this.angleVel += -snap.side * TRIM_KICK;
    }
    return snap;
  }

  /**
   * Integrates the tilt for one frame.
   *
   * @param leverArm Signed distance of the monkey from the pivot (plank-local px).
   * @param windAccel Extra angular acceleration from the current gust, if any.
   */
  update(dt: number, leverArm: number, windAccel: number): void {
    const cos = Math.cos(this.angle);
    const monkeyTorque = TORQUE_GAIN * leverArm * cos;
    const plankTorque = PLANK_TORQUE_GAIN * this.centreOfMass * cos;
    const jitter = (Math.random() * 2 - 1) * ANG_JITTER;
    const accel = monkeyTorque + plankTorque + windAccel + jitter - ANG_DAMPING * this.angleVel;
    this.angleVel += accel * dt;
    this.angle += this.angleVel * dt;
  }

  /**
   * The plank's own centre of mass, signed distance from the pivot.
   *
   * Zero while both sides match; once one end is shorter the midpoint of the remaining
   * bar sits on the long side, so the plank leans that way under its own weight.
   */
  get centreOfMass(): number {
    return (this.halfRight - this.halfLeft) / 2;
  }

  /** Advances the break-off schedule; returns an event on the frame a chunk goes. */
  stepTrim(dt: number): TrimEvent | null {
    this.trimTimer -= dt;
    if (this.trimTimer > 0) return null;

    this.trimGap = Math.max(TRIM_INTERVAL_MIN, this.trimGap - TRIM_INTERVAL_DECAY);
    this.trimTimer = this.trimGap;

    // Random side (asymmetry is the point — it keeps resetting the player's sense of
    // where the edges are), falling back to the other side when one is already stubbed.
    const leftAvailable = this.halfLeft > PLANK_HALF_MIN;
    const rightAvailable = this.halfRight > PLANK_HALF_MIN;
    if (!leftAvailable && !rightAvailable) return null;

    let side: -1 | 1;
    if (leftAvailable && rightAvailable) side = Math.random() < 0.5 ? -1 : 1;
    else side = leftAvailable ? -1 : 1;

    // Losing an end throws the plank toward whatever is left: the chunk that fell was
    // holding that side down, so the bar lurches away from the break.
    this.angleVel += -side * TRIM_KICK;

    if (side === -1) {
      this.halfLeft = Math.max(PLANK_HALF_MIN, this.halfLeft - TRIM_CHUNK);
      return { side, at: -this.halfLeft };
    }
    this.halfRight = Math.max(PLANK_HALF_MIN, this.halfRight - TRIM_CHUNK);
    return { side, at: this.halfRight };
  }

  /** Signed plank-local position of one end. */
  edge(side: -1 | 1): number {
    return side === -1 ? -this.halfLeft : this.halfRight;
  }

  /** True while the monkey's feet are still fully on the (shrinking) plank. */
  supports(pos: number, footHalf: number): boolean {
    return pos - footHalf > -this.halfLeft && pos + footHalf < this.halfRight;
  }
}
