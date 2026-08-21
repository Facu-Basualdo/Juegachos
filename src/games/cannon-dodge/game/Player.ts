import {
  CENTER,
  ISLAND_RADIUS,
  PLAY_INSET,
  PLAYER_ACCEL,
  PLAYER_RADIUS,
  PLAYER_SPEED,
} from "./constants";

/** The pirate. Free 8-direction movement, confined to the sandy play circle. */
export class Player {
  x = CENTER;
  y = CENTER;
  vx = 0;
  vy = 0;
  /** Facing angle (radians), for drawing which way the pirate looks. */
  facing = -Math.PI / 2;
  readonly radius = PLAYER_RADIUS;

  /** Max distance the player's centre may be from the island centre. */
  private static readonly maxDist = ISLAND_RADIUS - PLAY_INSET - PLAYER_RADIUS;

  reset(): void {
    this.x = CENTER;
    this.y = CENTER;
    this.vx = 0;
    this.vy = 0;
    this.facing = -Math.PI / 2;
  }

  /**
   * @param ix -1..1 horizontal input
   * @param iy -1..1 vertical input
   */
  update(dt: number, ix: number, iy: number): void {
    // Normalise so diagonals aren't faster than cardinals.
    let dx = ix;
    let dy = iy;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }

    const targetVx = dx * PLAYER_SPEED;
    const targetVy = dy * PLAYER_SPEED;
    const t = Math.min(1, PLAYER_ACCEL * dt);
    this.vx += (targetVx - this.vx) * t;
    this.vy += (targetVy - this.vy) * t;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (mag > 0.01) this.facing = Math.atan2(dy, dx);

    // Confine to the play circle (slide along the shore instead of sticking).
    const ox = this.x - CENTER;
    const oy = this.y - CENTER;
    const dist = Math.hypot(ox, oy);
    if (dist > Player.maxDist) {
      const k = Player.maxDist / dist;
      this.x = CENTER + ox * k;
      this.y = CENTER + oy * k;
      // Kill the outward component of velocity so it doesn't keep pushing.
      const nx = ox / dist;
      const ny = oy / dist;
      const outward = this.vx * nx + this.vy * ny;
      if (outward > 0) {
        this.vx -= outward * nx;
        this.vy -= outward * ny;
      }
    }
  }
}
