import * as THREE from "three";
import {
  AMBIENT_SWAY_FREQ,
  AMBIENT_SWAY_MAX,
  BASE_X,
  FLOOR_H,
  MAX_LANDING_OFFSET,
  MAX_LEAN,
  PERFECT_OFFSET,
  TOPPLE_LIMIT,
  WHIP_GAIN,
  WOBBLE_DAMP,
  WOBBLE_FREQ,
  WOBBLE_IMPULSE,
} from "./constants";

/** One placed floor. `restX` is its structural X with no sway applied. */
interface Floor {
  restX: number;
  centerY: number;
  mesh: THREE.Object3D;
}

export interface PlaceResult {
  /** False when the block missed its support entirely (the run ends). */
  ok: boolean;
  perfect: boolean;
  /** Signed X offset from the floor below (world units). */
  offset: number;
  /** 1 = dead center, 0 = barely hanging on; drives population. */
  quality: number;
}

/**
 * Module 2 — the stacked tower: Box-overlap collision, alignment offset,
 * center-of-mass balance, and the structural whip sway.
 *
 * Each floor keeps a structural `restX`; the *visible* X adds a sway offset that
 * grows with height (the whip), driven by three things: a static lean toward the
 * center of mass, a transient wobble spring kicked on every off-center drop, and
 * a continuous wind sway that appears once the COM drifts. When the COM leaves
 * the base footprint the tower topples and the run ends.
 */
export class Tower {
  readonly group = new THREE.Group();

  private floors: Floor[] = [];
  private comOffsetV = 0;
  private totalAngle = 0;

  // Wobble spring (transient).
  private wobble = 0;
  private wobbleVel = 0;
  // Continuous sway clock.
  private swayClock = 0;

  get count(): number {
    return this.floors.length;
  }

  reset(): void {
    for (const f of this.floors) this.group.remove(f.mesh);
    this.floors = [];
    this.comOffsetV = 0;
    this.totalAngle = 0;
    this.wobble = 0;
    this.wobbleVel = 0;
    this.swayClock = 0;
  }

  /** World Y of the center of the next floor to be placed. */
  landingCenterY(): number {
    return (this.count + 0.5) * FLOOR_H;
  }

  /** World Y of the top surface the crane hovers over. */
  landingTopY(): number {
    return this.count * FLOOR_H;
  }

  /** Structural X of the floor below the next one (the foundation if empty). */
  private topRestX(): number {
    return this.count === 0 ? BASE_X : this.floors[this.count - 1].restX;
  }

  /** Pure sway displacement (world units) at a given floor center height. */
  private swayAt(centerY: number): number {
    const height = Math.max(this.count * FLOOR_H, FLOOR_H);
    const whip = 1 + WHIP_GAIN * (centerY / height);
    return Math.sin(this.totalAngle) * centerY * whip;
  }

  /** Current swayed world X of a floor. */
  private worldXOf(restX: number, centerY: number): number {
    return restX + this.swayAt(centerY);
  }

  /** Current swayed world X of the top floor (or the base center if empty). */
  topWorldX(): number {
    if (this.count === 0) return BASE_X;
    const top = this.floors[this.count - 1];
    return this.worldXOf(top.restX, top.centerY);
  }

  /** Seam position (world) at the top of the tower, for effects. */
  topSeam(): { x: number; y: number } {
    return { x: this.topWorldX(), y: this.landingTopY() };
  }

  /**
   * Resolves a dropped block landing at world X `dropX`, adding `mesh` to the
   * tower on success. A drop whose offset hangs the block past its last-window
   * line (`|offset| > MAX_LANDING_OFFSET`) is unsupported and returns
   * `{ ok: false }` (the run ends); it does not consume the mesh.
   */
  place(dropX: number, mesh: THREE.Object3D): PlaceResult {
    const topX = this.topWorldX();
    const offset = dropX - topX;

    if (Math.abs(offset) > MAX_LANDING_OFFSET) {
      return { ok: false, perfect: false, offset, quality: 0 };
    }

    const perfect = Math.abs(offset) < PERFECT_OFFSET;
    const centerY = this.landingCenterY();

    // Perfect: snap dead-center onto the floor below (no structural drift, rigid
    // stack). Otherwise keep it where it visually landed by removing the sway at
    // this height so the new floor's rest position matches the drop.
    const restX = perfect ? this.topRestX() : dropX - this.swayAt(centerY);

    const floor: Floor = { restX, centerY, mesh };
    this.floors.push(floor);
    mesh.position.set(this.worldXOf(restX, centerY), centerY, 0);
    this.group.add(mesh);

    if (!perfect) this.wobbleVel += WOBBLE_IMPULSE * offset;
    this.recomputeCom();

    const quality = Math.max(0, Math.min(1, 1 - Math.abs(offset) / MAX_LANDING_OFFSET));
    return { ok: true, perfect, offset, quality };
  }

  private recomputeCom(): void {
    if (this.count === 0) {
      this.comOffsetV = 0;
      return;
    }
    let sum = 0;
    for (const f of this.floors) sum += f.restX;
    this.comOffsetV = sum / this.count - BASE_X;
  }

  /** Signed center-of-mass offset from the base (world units). */
  comOffset(): number {
    return this.comOffsetV;
  }

  /** COM offset normalized to [-1, 1] against the topple limit, for the HUD. */
  balanceRatio(): number {
    return Math.max(-1, Math.min(1, this.comOffsetV / TOPPLE_LIMIT));
  }

  isToppled(): boolean {
    return Math.abs(this.comOffsetV) > TOPPLE_LIMIT;
  }

  /**
   * Detaches every floor mesh for a crumble (used on topple). Returns each with
   * its current world X/Y so `Game` can turn them into independent falling
   * debris that scatter off to the side, instead of rigidly rotating the whole
   * tower through the base slab. The tower group has no rotation, so a floor's
   * local position is its world position.
   */
  detachFloors(): { mesh: THREE.Object3D; x: number; y: number }[] {
    const out = this.floors.map((f) => ({ mesh: f.mesh, x: f.mesh.position.x, y: f.centerY }));
    for (const f of this.floors) this.group.remove(f.mesh);
    this.floors = [];
    return out;
  }

  /**
   * @param instability  continuous-sway multiplier from `Game`: 0 during the
   *   first building (the base), ramping up from the 2nd building on.
   */
  update(dt: number, instability: number): void {
    this.swayClock += dt;

    // Wobble spring (transient kick from off-center drops).
    const springAcc = -WOBBLE_FREQ * WOBBLE_FREQ * this.wobble - 2 * WOBBLE_DAMP * this.wobbleVel;
    this.wobbleVel += springAcc * dt;
    this.wobble += this.wobbleVel * dt;

    // Static lean toward the heavy side.
    const lean = Math.max(-1, Math.min(1, this.comOffsetV / TOPPLE_LIMIT)) * MAX_LEAN;

    // Continuous wind sway: worse the more off-balance (badly built) AND the
    // further past the base building we are (instability, 0 during building 1).
    const ambientAmp =
      Math.min(1, Math.abs(this.comOffsetV) / TOPPLE_LIMIT) * AMBIENT_SWAY_MAX * instability;
    const ambient = ambientAmp * Math.sin(this.swayClock * AMBIENT_SWAY_FREQ);

    this.totalAngle = lean + this.wobble + ambient;

    for (const f of this.floors) {
      f.mesh.position.x = this.worldXOf(f.restX, f.centerY);
    }
  }
}
