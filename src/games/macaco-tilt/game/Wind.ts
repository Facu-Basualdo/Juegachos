import {
  GUST_AUTHORITY,
  GUST_BASE,
  GUST_FIRST,
  GUST_INTERVAL_MAX,
  GUST_INTERVAL_MIN,
  GUST_MAX,
  GUST_PUSH_TIME,
  GUST_RAMP,
  GUST_WARNING,
  TORQUE_GAIN,
} from "./constants";

type Phase = "idle" | "warning" | "gusting";

/**
 * Isolated wind gusts that ramp up the longer the run lasts.
 *
 * Every gust is **telegraphed**: `GUST_WARNING` seconds of leaves streaming across the
 * screen before anything actually pushes, so a death always reads as "I was warned and
 * mistimed it" rather than as noise. The shove itself is spread over `GUST_PUSH_TIME`
 * instead of landing as a single-frame impulse — a spike would be untelegraphable and
 * would also let a lucky frame boundary swallow it.
 */
export class Wind {
  private phase: Phase = "idle";
  private timer = GUST_FIRST;
  /** -1 = pushes the plank's left side down, +1 = right side down. */
  private direction: -1 | 1 = 1;
  /** Total angular velocity this gust will deliver (rad/s). */
  private strength = 0;

  reset(): void {
    this.phase = "idle";
    this.timer = GUST_FIRST;
    this.direction = 1;
    this.strength = 0;
  }

  /** True while leaves should be streaming as a warning (or the gust is landing). */
  get active(): boolean {
    return this.phase !== "idle";
  }

  get dir(): -1 | 1 {
    return this.direction;
  }

  /** 0..1 intensity for the leaf stream, so the warning visibly builds. */
  get intensity(): number {
    if (this.phase === "warning") return 0.35 + 0.65 * (1 - this.timer / GUST_WARNING);
    if (this.phase === "gusting") return 1;
    return 0;
  }

  /**
   * Advances the schedule and returns the angular acceleration to apply this frame
   * (0 outside the push window).
   *
   * `halfLeft` / `halfRight` are the plank's current reach. They matter because the
   * gust is capped against the counter-torque the player can actually generate — see
   * `GUST_AUTHORITY`. Passing stale widths would let a gust outrun the player again.
   */
  update(dt: number, elapsed: number, halfLeft: number, halfRight: number): number {
    this.timer -= dt;

    if (this.phase === "idle") {
      if (this.timer <= 0) {
        this.phase = "warning";
        this.timer = GUST_WARNING;
        this.direction = Math.random() < 0.5 ? -1 : 1;
        // A gust that pushes the right side down is answered by standing on the left,
        // so the lever the player gets is that side's remaining half-width.
        const lever = this.direction > 0 ? halfLeft : halfRight;
        const counterable = GUST_AUTHORITY * TORQUE_GAIN * lever * GUST_PUSH_TIME;
        this.strength = Math.min(GUST_MAX, GUST_BASE + elapsed * GUST_RAMP, counterable);
      }
      return 0;
    }

    if (this.phase === "warning") {
      if (this.timer <= 0) {
        this.phase = "gusting";
        this.timer = GUST_PUSH_TIME;
      }
      return 0;
    }

    // Gusting: front-loaded so the hit has a punch, then tails off.
    if (this.timer <= 0) {
      this.phase = "idle";
      this.timer = GUST_INTERVAL_MIN + Math.random() * (GUST_INTERVAL_MAX - GUST_INTERVAL_MIN);
      return 0;
    }
    const k = this.timer / GUST_PUSH_TIME; // 1 -> 0 across the push
    const shape = 2 * k; // integrates to 1 over the window
    return (this.direction * this.strength * shape) / GUST_PUSH_TIME;
  }
}
