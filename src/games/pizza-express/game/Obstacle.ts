import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import {
  COLOR_CHEESE,
  COLOR_CARDBOARD,
  COLOR_CRUST,
  COLOR_CREAM,
  COLOR_FOLIAGE,
  COLOR_TOMATO,
  COLOR_MOLTEN,
} from "./constants";

export type ObstacleKind = "cone" | "pothole" | "trashcan" | "crate" | "car" | "dog";

/** Half the collision width of each kind (world units). */
const HALF_WIDTH: Record<ObstacleKind, number> = {
  cone: 0.34,
  pothole: 0.62,
  trashcan: 0.42,
  crate: 0.52,
  car: 0.8,
  dog: 0.5,
};

/** Half the collision LENGTH along Z. Only the car (parked parallel to the
 *  road, so long in Z) needs one: it keeps testing collision while it straddles
 *  the scooter's plane instead of the usual single centre-crossing frame. */
const HALF_LENGTH: Partial<Record<ObstacleKind, number>> = {
  car: 1.6,
};

/**
 * One road hazard. All kinds are instant-death on contact. Each is a small prop
 * built from primitives (cel-shaded), positioned on the road and scrolling toward
 * the camera. `halfWidth` is its collision half-extent in X.
 */
export class Obstacle {
  readonly group = new THREE.Group();
  readonly kind: ObstacleKind;
  readonly halfWidth: number;
  readonly halfLength: number;
  resolved = false;
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private wobble = 0;
  // Dogs patrol horizontally across the street (dynamic obstacle).
  private patrolVX = 0;
  private patrolMin = 0;
  private patrolMax = 0;

  constructor(kind: ObstacleKind, x: number, z: number) {
    this.kind = kind;
    this.halfWidth = HALF_WIDTH[kind];
    this.halfLength = HALF_LENGTH[kind] ?? 0;
    this.group.position.set(x, 0, z);
    this.build();
  }

  get z(): number {
    return this.group.position.z;
  }

  /** Makes the dog trot across the street between [min, max] at `vx` units/s. */
  setPatrol(vx: number, min: number, max: number): void {
    this.patrolVX = vx;
    this.patrolMin = min;
    this.patrolMax = max;
    this.group.rotation.y = vx > 0 ? Math.PI : 0; // face the way it's walking
  }

  update(dz: number, dt: number): void {
    this.group.position.z += dz;
    if (this.kind === "dog") {
      // Trotting bounce.
      this.wobble += dt * 12;
      this.group.position.y = Math.abs(Math.sin(this.wobble)) * 0.12;
      // Cross the street, reversing (and turning around) at each edge.
      if (this.patrolVX !== 0) {
        let x = this.group.position.x + this.patrolVX * dt;
        if (x <= this.patrolMin) {
          x = this.patrolMin;
          this.patrolVX = Math.abs(this.patrolVX);
          this.group.rotation.y = Math.PI;
        } else if (x >= this.patrolMax) {
          x = this.patrolMax;
          this.patrolVX = -Math.abs(this.patrolVX);
          this.group.rotation.y = 0;
        }
        this.group.position.x = x;
      }
    }
  }

  /** True if the scooter at scooterX overlaps this hazard in X. */
  overlaps(scooterX: number, scooterHalf: number, tolerance: number): boolean {
    return Math.abs(scooterX - this.group.position.x) < this.halfWidth + scooterHalf - tolerance;
  }

  private mesh(geom: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    this.disposables.push(geom, mat);
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  private build(): void {
    switch (this.kind) {
      case "cone": {
        // A real traffic cone: orange rubber base slab + orange cone with the
        // white band painted ON the cone — a truncated-cone sleeve hugging the
        // surface, matte, not glowing. (The old version was a flat additive
        // torus floating near the tip: a full-on halo.)
        this.mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), toonMat(0xc94d1d, {}), 0, 0.04, 0);
        this.mesh(new THREE.ConeGeometry(0.3, 0.62, 14), toonMat(0xe8622a, {}), 0, 0.39, 0);
        // Sleeve radii follow the cone's taper at its height (+0.02 outset).
        this.mesh(new THREE.CylinderGeometry(0.12, 0.19, 0.15, 14), toonMat(COLOR_CREAM, {}), 0, 0.44, 0);
        break;
      }
      case "pothole": {
        // A flat dark patch on the asphalt with a broken-edge ring.
        const hole = this.mesh(new THREE.CircleGeometry(0.6, 22), toonMat(0x15110d, {}), 0, 0.02, 0);
        hole.rotation.x = -Math.PI / 2;
        const ring = this.mesh(new THREE.RingGeometry(0.55, 0.7, 22), toonMat(0x2f2822, {}), 0, 0.015, 0);
        ring.rotation.x = -Math.PI / 2;
        break;
      }
      case "trashcan": {
        this.mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.8, 14), toonMat(0x5a6b52, {}), 0, 0.4, 0);
        this.mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 14), toonMat(COLOR_FOLIAGE, {}), 0, 0.84, 0);
        break;
      }
      case "crate": {
        // A toppled stack of pizza boxes.
        this.mesh(new THREE.BoxGeometry(0.9, 0.22, 0.9), toonMat(COLOR_CARDBOARD, {}), 0, 0.12, 0);
        this.mesh(new THREE.BoxGeometry(0.82, 0.2, 0.82), toonMat(COLOR_CREAM, {}), 0.1, 0.34, -0.05).rotation.y = 0.4;
        this.mesh(new THREE.CircleGeometry(0.16, 16), glowMat(COLOR_CHEESE, 1), 0.1, 0.45, -0.05).rotation.x = -Math.PI / 2;
        break;
      }
      case "car": {
        // A car parked ALONG the street (long in Z, like the scooter drives),
        // low-poly toon: body, dark glass cabin with a body-colour roof, four
        // wheels, bumpers, headlights (front, -Z) and taillights (rear, +Z).
        // Warm palette only (see DESIGN.md). Randomly faces either way.
        const color = [0xc65a34, 0xd8a13a, 0xf2e4c4, 0x6b8f3a][Math.floor(Math.random() * 4)];
        const bodyMat = toonMat(color, {});
        this.mesh(new THREE.BoxGeometry(1.4, 0.46, 2.9), bodyMat, 0, 0.52, 0);
        // Glass greenhouse + roof, set slightly toward the rear.
        this.mesh(new THREE.BoxGeometry(1.24, 0.4, 1.45), glowMat(0x2a3a44, 0.95), 0, 0.95, 0.18);
        this.mesh(new THREE.BoxGeometry(1.3, 0.09, 1.5), bodyMat, 0, 1.19, 0.18);
        for (const wx of [-0.68, 0.68]) {
          for (const wz of [-0.95, 0.95]) {
            const wheel = this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), toonMat(0x1c1712, {}), wx, 0.3, wz);
            wheel.rotation.z = Math.PI / 2;
          }
        }
        for (const bz of [-1.5, 1.5]) {
          this.mesh(new THREE.BoxGeometry(1.44, 0.14, 0.18), toonMat(0x2a2320, {}), 0, 0.36, bz);
        }
        for (const lx of [-0.45, 0.45]) {
          this.mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), glowMat(COLOR_MOLTEN, 1), lx, 0.62, -1.47);
          this.mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), glowMat(COLOR_TOMATO, 1), lx, 0.62, 1.47);
        }
        if (Math.random() < 0.5) this.group.rotation.y = Math.PI;
        break;
      }
      case "dog": {
        const body = toonMat(COLOR_CRUST, {});
        this.mesh(new THREE.CapsuleGeometry(0.22, 0.5, 5, 8), body, 0, 0.45, 0).rotation.z = Math.PI / 2;
        this.mesh(new THREE.SphereGeometry(0.22, 12, 10), body, -0.42, 0.55, 0);
        // Snout + angry glowing eyes.
        this.mesh(new THREE.BoxGeometry(0.2, 0.14, 0.16), toonMat(0x5a3a1e, {}), -0.6, 0.5, 0);
        for (const ez of [-0.09, 0.09]) this.mesh(new THREE.SphereGeometry(0.04, 8, 8), glowMat(COLOR_TOMATO, 1), -0.5, 0.62, ez);
        for (const lx of [-0.3, 0.3]) for (const lz of [-0.14, 0.14]) this.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 6), body, lx, 0.16, lz);
        this.mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 6), body, 0.42, 0.6, 0).rotation.z = -0.7;
        break;
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

export { HALF_WIDTH };
