import * as THREE from "three";
import { getDotTexture } from "./dotTexture";

const MAX = 260;

/**
 * A single additive point-cloud pool for cosmetic bursts: crash dust/debris and
 * delivery sparkles. Fire-and-forget — `burst` seeds particles at a point, and
 * `update` integrates velocity + gravity + drag and fades them by scaling colour.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly base: THREE.Color[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < MAX; i++) this.base.push(new THREE.Color());
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.5,
      map: getDotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;
  }

  reset(): void {
    this.life.fill(0);
    this.col.fill(0);
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, count: number, spread: number, up: number): void {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const ang = Math.random() * Math.PI * 2;
      const sp = Math.random() * spread;
      this.vel[i * 3] = Math.cos(ang) * sp;
      this.vel[i * 3 + 1] = up * (0.4 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(ang) * sp;
      const life = 0.4 + Math.random() * 0.5;
      this.life[i] = life;
      this.maxLife[i] = life;
      this.base[i].copy(c);
    }
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= 9 * dt; // gravity
      this.vel[i * 3] *= 0.96;
      this.vel[i * 3 + 2] *= 0.96;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.base[i].r * k;
      this.col[i * 3 + 1] = this.base[i].g * k;
      this.col[i * 3 + 2] = this.base[i].b * k;
    }
    if (dirty) {
      (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
