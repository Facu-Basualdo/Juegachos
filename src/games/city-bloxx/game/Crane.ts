import * as THREE from "three";
import { toon, outlined } from "./materials";
import {
  BASE_X,
  CABLE_LEN,
  HANG_GAP,
  SWING_ANGLE_BASE,
  SWING_ANGLE_MAX,
  SWING_ANGLE_PER_FLOOR,
  SWING_OMEGA_BASE,
  SWING_OMEGA_MAX,
  SWING_OMEGA_PER_FLOOR,
  WIND_AMP_MAX,
  WIND_AMP_PER_FLOOR,
} from "./constants";

/**
 * Module 1 — the swinging crane (pendulum physics).
 *
 * The block hangs from a fixed jib pivot at x = 0 above the current tower top
 * and swings along X as simple harmonic motion, `angle = amp * sin(t*omega)`,
 * with an erratic wind gust added on top. As the tower climbs, `omega`, `amp`
 * and the wind all grow so the swing gets faster and less predictable. On drop
 * the pendulum is disabled and the block free-falls straight down (handled by
 * `Game`); this class only owns the hanging state and the crane's meshes.
 */
export class Crane {
  readonly group = new THREE.Group();
  /** Current cable angle from vertical (rad). */
  angle = 0;
  /** World position of the hanging block's center. */
  blockX = BASE_X;
  blockY = 0;
  /** Instantaneous horizontal velocity of the hanging block, units/s. */
  blockVx = 0;

  private time = 0;
  private pivotY = 0;
  private prevBlockX = BASE_X;
  private readonly cablePivot = new THREE.Group();

  constructor() {
    // Horizontal jib arm the trolley rides on.
    const jib = outlined(new THREE.BoxGeometry(7, 0.22, 0.3), toon(0xf2a63e));
    this.group.add(jib);
    // A little trolley block at the pivot.
    const trolley = outlined(new THREE.BoxGeometry(0.5, 0.34, 0.5), toon(0x3c3550));
    trolley.position.y = -0.2;
    this.group.add(trolley);

    // Cable + hook, pivoting around the trolley so the whole thing swings.
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, CABLE_LEN, 6),
      toon(0x2a2438),
    );
    cable.position.y = -CABLE_LEN / 2;
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), toon(0x55506a));
    hook.position.y = -CABLE_LEN;
    this.cablePivot.add(cable, hook);
    this.group.add(this.cablePivot);
  }

  reset(): void {
    this.time = 0;
    this.angle = 0;
    this.blockVx = 0;
    this.prevBlockX = BASE_X;
  }

  /**
   * Advances the pendulum for a frame.
   * @param floors  total floors placed this run (drives speed / amplitude / wind)
   * @param landingCenterY  world Y of the next floor's center (pivot tracks it)
   * @param comboSpeedup  fraction added to omega while a perfect combo is lit
   */
  update(dt: number, floors: number, landingCenterY: number, comboSpeedup = 0): void {
    this.time += dt;
    this.pivotY = landingCenterY + HANG_GAP + CABLE_LEN;

    const omega =
      Math.min(SWING_OMEGA_MAX, SWING_OMEGA_BASE + floors * SWING_OMEGA_PER_FLOOR) *
      (1 + comboSpeedup);
    const amp = Math.min(SWING_ANGLE_MAX, SWING_ANGLE_BASE + floors * SWING_ANGLE_PER_FLOOR);
    const windAmp = Math.min(WIND_AMP_MAX, floors * WIND_AMP_PER_FLOOR);

    const t = this.time;
    const clean = amp * Math.sin(t * omega);
    // Two incommensurate sines fake an erratic wind gust that grows with height.
    const gust = windAmp * (0.6 * Math.sin(t * 0.9 + 1.3) + 0.4 * Math.sin(t * 2.3 + 0.4));
    this.angle = clean + gust;

    this.blockX = BASE_X + Math.sin(this.angle) * CABLE_LEN;
    this.blockY = this.pivotY - Math.cos(this.angle) * CABLE_LEN;
    // Finite-difference the swing so a released block inherits the real
    // tangential velocity of the arc (fast near the center, ~0 at the extremes).
    if (dt > 0) this.blockVx = (this.blockX - this.prevBlockX) / dt;
    this.prevBlockX = this.blockX;
    this.syncMeshes();
  }

  /** Positions the visible jib + cable to match the current swing. */
  private syncMeshes(): void {
    this.group.position.set(BASE_X, this.pivotY, 0);
    // rotation.z = +angle sends the cable's hook to +x sin(angle)*CABLE_LEN,
    // matching blockX so the cable stays attached to the block (a -angle here
    // swung them in opposite directions — the block looked detached / floating).
    this.cablePivot.rotation.z = this.angle;
  }

  /** Hides the cable/hook once the block has been released. */
  setHolding(holding: boolean): void {
    this.cablePivot.visible = holding;
  }
}
