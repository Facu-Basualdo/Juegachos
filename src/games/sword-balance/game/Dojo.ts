import * as THREE from "three";

/**
 * The dojo stage: a dark floor catching the spotlight pool, and slow dust motes
 * drifting in the beam. Pure atmosphere — no gameplay.
 */
export class Dojo {
  readonly group = new THREE.Group();
  private readonly dust: THREE.Points;
  private readonly dustVel: Float32Array;
  private readonly count = 140;

  constructor() {
    // Floor — very dark, slightly glossy so the spotlight leaves a soft pool.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(24, 64),
      new THREE.MeshStandardMaterial({ color: 0x0b0c11, roughness: 0.72, metalness: 0.15 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.9;
    floor.receiveShadow = true;
    this.group.add(floor);

    // A faint ring on the floor, like the edge of a tatami circle.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.1, 3.25, 64),
      new THREE.MeshBasicMaterial({ color: 0x1a1c26, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.88;
    this.group.add(ring);

    // Dust motes.
    const positions = new Float32Array(this.count * 3);
    this.dustVel = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 6;
      positions[i * 3 + 1] = Math.random() * 6 - 1.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 3;
      this.dustVel[i] = 0.05 + Math.random() * 0.12;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xc9d4e6,
        size: 0.035,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(this.dust);
  }

  update(dt: number): void {
    const pos = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      let y = pos.getY(i) + this.dustVel[i] * dt;
      if (y > 4.5) {
        y = -1.5;
        pos.setX(i, (Math.random() - 0.5) * 6);
        pos.setZ(i, (Math.random() - 0.5) * 3);
      }
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }
}
