import {
  FALL_GRAVITY,
  FALL_SPIN,
  PANIC_ANGLE,
  SLIDE_GRAVITY,
  WALK_ACCEL,
  WALK_FRICTION,
  WALK_TRACTION_MIN,
} from "./constants";

export type MonkeyState = "idle" | "walk" | "panic" | "fall";

/**
 * The monkey on the plank: where it stands, which way it leans, and which of the four
 * animation states it is in.
 *
 * Position (`pos`) is the signed distance from the pivot **along the plank**, which is
 * also the lever arm the tilt physics reads. Everything else here is presentation.
 */
export class Monkey {
  pos = 0;
  vel = 0;
  state: MonkeyState = "idle";
  /** -1 = looking left, +1 = looking right. Only changes while actually walking. */
  facing: -1 | 1 = 1;
  /** Free-running animation clock, in seconds. */
  phase = 0;

  // --- Free fall (world space, only meaningful once state === "fall") ---
  fallX = 0;
  fallY = 0;
  private fallVX = 0;
  private fallVY = 0;
  fallRot = 0;
  private fallSpin = 0;

  reset(): void {
    this.pos = 0;
    this.vel = 0;
    this.state = "idle";
    this.facing = 1;
    this.phase = 0;
    this.fallRot = 0;
  }

  /**
   * Walks / slides along the plank for one frame.
   *
   * @param input -1, 0 or +1 from the player.
   * @param angle Current plank tilt (radians).
   *
   * There is deliberately **no ledge stop**: the monkey will happily walk itself off the
   * end. Committing to a big lean is meant to be a gamble you can lose, and the edge is
   * a hazard the player has to respect on their own. A version that clamped the walk at
   * the lip was tried and removed — it was invisible (nothing told the player why they
   * had stopped) and it was covering for the uncapped gusts that `GUST_AUTHORITY` now
   * fixes properly.
   */
  update(dt: number, input: number, angle: number): void {
    this.phase += dt;


    // Gravity drags the monkey toward the low end. This is the feedback loop that makes
    // the game tense: sliding downhill lengthens the lever arm, which tilts the plank
    // further, which makes the slide faster.
    const slide = SLIDE_GRAVITY * Math.sin(angle);

    // Traction falls off as the plank steepens — past ~30deg there is barely anything to
    // push against, so climbing back is a losing race rather than a stroll.
    const traction = Math.max(WALK_TRACTION_MIN, Math.cos(angle));
    const walk = input * WALK_ACCEL * traction;

    this.vel += (slide + walk) * dt;
    this.vel -= WALK_FRICTION * this.vel * dt;
    this.pos += this.vel * dt;

    if (input !== 0) this.facing = input > 0 ? 1 : -1;
    this.state = Math.abs(angle) > PANIC_ANGLE ? "panic" : input !== 0 ? "walk" : "idle";
  }

  /**
   * Detaches the monkey from the plank and starts the tumble.
   *
   * @param x World-space x where it left the plank.
   * @param y World-space y (feet) where it left the plank.
   * @param angle Plank tilt at that moment, which seeds the launch direction.
   */
  startFall(x: number, y: number, angle: number): void {
    this.state = "fall";
    this.fallX = x;
    this.fallY = y;
    // Carry the along-plank velocity out into the world, rotated by the plank's tilt.
    this.fallVX = this.vel * Math.cos(angle);
    this.fallVY = this.vel * Math.sin(angle) - 120; // a small pop so it clears the plank
    this.fallRot = angle;
    this.fallSpin = (this.vel >= 0 ? 1 : -1) * FALL_SPIN;
  }

  updateFall(dt: number): void {
    this.phase += dt;
    this.fallVY += FALL_GRAVITY * dt;
    this.fallX += this.fallVX * dt;
    this.fallY += this.fallVY * dt;
    this.fallRot += this.fallSpin * dt;
  }
}
