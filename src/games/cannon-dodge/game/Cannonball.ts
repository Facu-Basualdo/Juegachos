import { BALL_CULL_MARGIN, BALL_RADIUS, CENTER, ISLAND_RADIUS } from "./constants";

/** A single cannonball travelling in a straight line across the island. */
export class Cannonball {
  /** Short trail of past positions for the smoke streak (newest first). */
  readonly trail: { x: number; y: number }[] = [];

  x: number;
  y: number;
  private readonly vx: number;
  private readonly vy: number;

  constructor(x: number, y: number, vx: number, vy: number) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
  }

  update(dt: number): void {
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > 6) this.trail.pop();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** True once the ball has left the island (plus a margin) and can be culled. */
  get offMap(): boolean {
    const dist = Math.hypot(this.x - CENTER, this.y - CENTER);
    return dist > ISLAND_RADIUS + BALL_CULL_MARGIN;
  }

  hits(px: number, py: number, pr: number): boolean {
    const rr = BALL_RADIUS + pr;
    return (this.x - px) ** 2 + (this.y - py) ** 2 <= rr * rr;
  }
}
