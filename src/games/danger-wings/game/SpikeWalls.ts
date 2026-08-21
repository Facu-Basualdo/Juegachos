import * as THREE from "three";
import {
  SIDE_X,
  CEIL_TIP_Y,
  FLOOR_TIP_Y,
  SIDE_SLOTS,
  SIDE_SPIKE_LEN,
  SIDE_SPIKE_RADIUS,
  SIDE_SPIKE_HALF,
  SIDE_SPIKE_EMERGE_TIME,
  SIDE_SPIKE_RETRACT_TIME,
  SLOT_MARGIN,
  BIRD_RADIUS,
  COLOR_IRON,
  COLOR_IRON_TIP,
} from "./constants";

interface Spike {
  mesh: THREE.Mesh;
  slotY: number;
  present: boolean; // whether it should be out
  progress: number; // 0 = retracted, 1 = fully out
}

/**
 * The two side walls' emerging spikes. Following the original's rule, the wall
 * the bird is flying *toward* has its spikes fully out waiting for it, while the
 * wall it just left retracts immediately. New spikes are chosen on each bounce.
 */
export class SpikeWalls {
  readonly object = new THREE.Group();

  private readonly left: Spike[] = [];
  private readonly right: Spike[] = [];
  private readonly slotYs: number[] = [];

  constructor() {
    // Even slot positions between the fixed ceiling / floor teeth.
    const top = CEIL_TIP_Y - SLOT_MARGIN;
    const bottom = FLOOR_TIP_Y + SLOT_MARGIN;
    for (let i = 0; i < SIDE_SLOTS; i++) {
      this.slotYs.push(bottom + ((top - bottom) * i) / (SIDE_SLOTS - 1));
    }

    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_IRON,
      roughness: 0.4,
      metalness: 0.9,
      emissive: new THREE.Color(COLOR_IRON_TIP),
      emissiveIntensity: 0.08,
    });

    for (const slotY of this.slotYs) {
      this.right.push(this.makeSpike(slotY, 1, mat));
      this.left.push(this.makeSpike(slotY, -1, mat));
    }
  }

  private makeSpike(slotY: number, side: 1 | -1, mat: THREE.Material): Spike {
    // Cone baked to point inward with its base at local x = 0 and tip at
    // local x = ∓SIDE_SPIKE_LEN, so the mesh's x drives the protrusion.
    const geo = new THREE.ConeGeometry(SIDE_SPIKE_RADIUS, SIDE_SPIKE_LEN, 4);
    if (side > 0) {
      geo.rotateZ(Math.PI / 2); // apex -> -x (right wall points left)
      geo.translate(-SIDE_SPIKE_LEN / 2, 0, 0);
    } else {
      geo.rotateZ(-Math.PI / 2); // apex -> +x (left wall points right)
      geo.translate(SIDE_SPIKE_LEN / 2, 0, 0);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 4; // diamond cross-section -> forged tooth
    mesh.position.y = slotY;
    mesh.visible = false;
    this.object.add(mesh);
    const spike: Spike = { mesh, slotY, present: false, progress: 0 };
    this.applyProgress(spike, side);
    return spike;
  }

  private applyProgress(spike: Spike, side: 1 | -1): void {
    const protrusion = spike.progress * SIDE_SPIKE_LEN;
    // Retracted (progress 0): mesh pushed out by SIDE_SPIKE_LEN so the tip sits
    // flush with the wall face and the body hides inside the stone.
    const hidden = SIDE_SPIKE_LEN - protrusion;
    spike.mesh.position.x = side > 0 ? SIDE_X + hidden : -SIDE_X - hidden;
    spike.mesh.visible = spike.progress > 0.02;
  }

  private spikesFor(side: 1 | -1): Spike[] {
    return side > 0 ? this.right : this.left;
  }

  /**
   * Choose `count` random slots on the given wall to have spikes out. If
   * `avoidSlot` is given, that slot is guaranteed to stay clear — used for the
   * opening approach so the bird, locked at centre, always has a gap.
   */
  presentWall(side: 1 | -1, count: number, avoidSlot?: number): void {
    const spikes = this.spikesFor(side);
    let indices = [...Array(SIDE_SLOTS).keys()];
    if (avoidSlot !== undefined) indices = indices.filter((i) => i !== avoidSlot);
    // Fisher-Yates partial shuffle.
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const chosen = new Set(indices.slice(0, Math.min(count, indices.length)));
    for (let i = 0; i < spikes.length; i++) {
      spikes[i].present = chosen.has(i);
    }
  }

  retractWall(side: 1 | -1): void {
    for (const s of this.spikesFor(side)) s.present = false;
  }

  reset(): void {
    for (const side of [1, -1] as const) {
      for (const s of this.spikesFor(side)) {
        s.present = false;
        s.progress = 0;
        this.applyProgress(s, side);
      }
    }
  }

  update(dt: number): void {
    for (const side of [1, -1] as const) {
      for (const s of this.spikesFor(side)) {
        const target = s.present ? 1 : 0;
        if (s.progress !== target) {
          const rate = dt / (s.present ? SIDE_SPIKE_EMERGE_TIME : SIDE_SPIKE_RETRACT_TIME);
          s.progress = s.present
            ? Math.min(1, s.progress + rate)
            : Math.max(0, s.progress - rate);
          this.applyProgress(s, side);
        }
      }
    }
  }

  /**
   * Death test against the wall the bird is heading toward. `dir` is the bird's
   * horizontal direction (+1 toward the right wall, -1 toward the left wall).
   */
  checkHit(birdX: number, birdY: number, dir: number): boolean {
    const side: 1 | -1 = dir >= 0 ? 1 : -1;
    const spikes = this.spikesFor(side);
    for (const s of spikes) {
      if (s.progress < 0.35) continue; // barely out, not lethal yet
      if (Math.abs(birdY - s.slotY) > SIDE_SPIKE_HALF) continue;
      const protrusion = s.progress * SIDE_SPIKE_LEN;
      if (side > 0) {
        const tipX = SIDE_X - protrusion;
        if (birdX + BIRD_RADIUS >= tipX) return true;
      } else {
        const tipX = -SIDE_X + protrusion;
        if (birdX - BIRD_RADIUS <= tipX) return true;
      }
    }
    return false;
  }
}
