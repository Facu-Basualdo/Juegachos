import {
  BALL_SPEED_MAX,
  BALL_SPEED_START,
  BURST_MAX,
  BURST_STEP_LEVELS,
  RAMP_SECONDS,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
  STEP_SECONDS,
  TELEGRAPH_MIN,
  TELEGRAPH_START,
} from "./constants";
import { Cannon } from "./Cannon";
import { Cannonball } from "./Cannonball";
import type { Player } from "./Player";

/** Result of a field tick for the Game to turn into sound/particles. */
export interface FieldResult {
  /** Cannons that started telegraphing this tick (rumble/appear sound). */
  spawned: number;
  /** Cannons that fired this tick (boom sound + muzzle smoke). */
  fired: { x: number; y: number; dx: number; dy: number }[];
  /** True the frame the player is struck by a ball. */
  died: boolean;
}

/**
 * Difficulty at elapsed survival time `t` (seconds). It steps up in discrete
 * levels — one every STEP_SECONDS — instead of ramping continuously, so each
 * jump is clearly felt. Each level tightens the spawn interval, telegraph and
 * ball speed by an even amount until the max at RAMP_SECONDS, then holds.
 */
function difficulty(t: number): {
  spawnInterval: number;
  ballSpeed: number;
  telegraph: number;
  burst: number;
} {
  const level = Math.floor(t / STEP_SECONDS);
  const maxLevel = RAMP_SECONDS / STEP_SECONDS;
  // Linear fraction of the way to max, quantized to the current level.
  const f = Math.min(1, level / maxLevel);
  return {
    spawnInterval: SPAWN_INTERVAL_START + (SPAWN_INTERVAL_MIN - SPAWN_INTERVAL_START) * f,
    ballSpeed: BALL_SPEED_START + (BALL_SPEED_MAX - BALL_SPEED_START) * f,
    telegraph: TELEGRAPH_START + (TELEGRAPH_MIN - TELEGRAPH_START) * f,
    // 1 ball early; an extra ball unlocks every BURST_STEP_LEVELS levels.
    burst: Math.min(BURST_MAX, 1 + Math.floor(level / BURST_STEP_LEVELS)),
  };
}

/** Seedable PRNG (mulberry32): identical sequence for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Owns every live cannon and cannonball, the spawn ramp, and collisions. */
export class CannonField {
  readonly cannons: Cannon[] = [];
  readonly balls: Cannonball[] = [];

  private elapsed = 0;
  private spawnTimer = 0;
  /** Last rim angle used, to avoid two cannons stacking in the same spot. */
  private lastAngle = 0;
  /** Seeded RNG: in room mode the same seed makes every client fire the same
   * cannons/balls, so the pirates you see are dodging the same shots. */
  private rng: () => number = Math.random;

  /** @param seed shared per room+round (room mode) or random (solo). */
  reset(seed: number): void {
    this.cannons.length = 0;
    this.balls.length = 0;
    this.elapsed = 0;
    this.spawnTimer = 0.6; // a short grace before the first shot
    this.rng = mulberry32(seed);
    this.lastAngle = this.rng() * Math.PI * 2;
  }

  update(dt: number, player: Player): FieldResult {
    this.elapsed += dt;
    const diff = difficulty(this.elapsed);
    const result: FieldResult = { spawned: 0, fired: [], died: false };

    // --- Spawn cannons on the ramp ---
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnCannon(diff.telegraph, diff.ballSpeed, diff.burst);
      result.spawned++;
      // Jitter the interval a little so it doesn't feel metronomic.
      this.spawnTimer = diff.spawnInterval * (0.8 + this.rng() * 0.4);
    }

    // --- Update cannons (they may fire balls) ---
    for (let i = this.cannons.length - 1; i >= 0; i--) {
      const c = this.cannons[i];
      const out = c.update(dt);
      if (out.fired.length > 0) {
        this.balls.push(...out.fired);
        result.fired.push({ x: c.x, y: c.y, dx: c.dx, dy: c.dy });
      }
      if (out.done) this.cannons.splice(i, 1);
    }

    // --- Update balls, cull off-map, test the player ---
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.update(dt);
      if (b.offMap) {
        this.balls.splice(i, 1);
        continue;
      }
      if (b.hits(player.x, player.y, player.radius)) {
        result.died = true;
      }
    }

    return result;
  }

  private spawnCannon(telegraph: number, ballSpeed: number, burst: number): void {
    // Pick a rim angle at least ~0.6 rad away from the previous one.
    let angle = 0;
    for (let tries = 0; tries < 6; tries++) {
      angle = this.rng() * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(angle - this.lastAngle), Math.cos(angle - this.lastAngle))) > 0.6) {
        break;
      }
    }
    this.lastAngle = angle;
    this.cannons.push(new Cannon(angle, telegraph, ballSpeed, burst, this.rng));
  }
}
