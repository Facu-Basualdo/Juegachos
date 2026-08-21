import {
  AIM_SPREAD,
  BURST_SPREAD,
  CANNON_LINGER,
  CANNON_RADIUS,
  CENTER,
  MUZZLE_OFFSET,
} from "./constants";
import { Cannonball } from "./Cannonball";

type Phase = "telegraph" | "fired";

/**
 * A cannon that pops up on the island rim, telegraphs its aim, then fires one
 * or more balls straight across the island and lingers as smoke before removal.
 * It does NOT aim at any player — it picks a chord through the island's middle,
 * so shots cross the play area and must be read and dodged.
 */
export class Cannon {
  /** Position on the rim. */
  readonly x: number;
  readonly y: number;
  /** Direction the barrel points / balls travel (unit vector). */
  readonly dx: number;
  readonly dy: number;
  /** Barrel angle for drawing. */
  readonly angle: number;

  private phase: Phase = "telegraph";
  /** Time left in the current phase. */
  private timer: number;
  /** How long the telegraph was, so the renderer can show a fill 0..1. */
  private readonly telegraphTotal: number;
  private readonly ballSpeed: number;
  private readonly burst: number;

  constructor(
    rimAngle: number,
    telegraph: number,
    ballSpeed: number,
    burst: number,
    rng: () => number,
  ) {
    this.ballSpeed = ballSpeed;
    this.burst = burst;
    this.x = CENTER + Math.cos(rimAngle) * CANNON_RADIUS;
    this.y = CENTER + Math.sin(rimAngle) * CANNON_RADIUS;

    // Aim at a point inside the island's middle -> a crossing chord. Uses the
    // field's seeded rng so every client fires the same shots (room mode).
    const ta = rng() * Math.PI * 2;
    const tr = rng() * AIM_SPREAD;
    const tx = CENTER + Math.cos(ta) * tr;
    const ty = CENTER + Math.sin(ta) * tr;
    const d = Math.hypot(tx - this.x, ty - this.y) || 1;
    this.dx = (tx - this.x) / d;
    this.dy = (ty - this.y) / d;
    this.angle = Math.atan2(this.dy, this.dx);

    this.timer = telegraph;
    this.telegraphTotal = telegraph;
  }

  get isTelegraphing(): boolean {
    return this.phase === "telegraph";
  }

  /** 0 at the start of the telegraph, 1 the instant it fires. */
  get chargeProgress(): number {
    if (this.phase !== "telegraph") return 1;
    return 1 - this.timer / this.telegraphTotal;
  }

  /** Recoil kick 0..1 that decays over the linger, for drawing the barrel. */
  get recoil(): number {
    if (this.phase !== "fired") return 0;
    return Math.max(0, this.timer / CANNON_LINGER);
  }

  /**
   * Advances the cannon. Returns balls to add to the field the moment it fires
   * (empty otherwise), and `done` once it should be removed.
   */
  update(dt: number): { fired: Cannonball[]; done: boolean } {
    this.timer -= dt;

    if (this.phase === "telegraph") {
      if (this.timer <= 0) {
        this.phase = "fired";
        this.timer = CANNON_LINGER;
        return { fired: this.makeBalls(), done: false };
      }
      return { fired: [], done: false };
    }

    return { fired: [], done: this.timer <= 0 };
  }

  private makeBalls(): Cannonball[] {
    const mx = this.x + this.dx * MUZZLE_OFFSET;
    const my = this.y + this.dy * MUZZLE_OFFSET;
    const balls: Cannonball[] = [];
    const base = this.angle;
    // Fan the burst symmetrically around the aim direction.
    for (let i = 0; i < this.burst; i++) {
      const offset =
        this.burst === 1 ? 0 : (i / (this.burst - 1) - 0.5) * 2 * BURST_SPREAD;
      const a = base + offset;
      balls.push(
        new Cannonball(mx, my, Math.cos(a) * this.ballSpeed, Math.sin(a) * this.ballSpeed),
      );
    }
    return balls;
  }
}
