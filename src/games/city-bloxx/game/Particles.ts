import * as THREE from "three";

const MAX = 160;
const GRAVITY = 9;

/**
 * Module 4 (visual half) — a tiny fire-and-forget spark pool for the perfect /
 * combo bursts. Gold additive points that fly out of the seam and fade; nothing
 * here touches gameplay. Fade is done through per-vertex color under additive
 * blending (color -> 0 reads as invisible), since PointsMaterial has no
 * per-particle alpha.
 */
export class Particles {
  readonly points: THREE.Points;

  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly tint = new Float32Array(MAX * 3);
  private cursor = 0;

  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.22,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Emits a burst at world (x, y). `power` scales count + spread (combo size). */
  burst(x: number, y: number, power = 1): void {
    const count = Math.min(MAX, Math.round(22 + power * 10));
    for (let i = 0; i < count; i++) {
      const s = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.pos[s * 3] = x;
      this.pos[s * 3 + 1] = y;
      this.pos[s * 3 + 2] = (Math.random() - 0.5) * 1.2;
      const ang = Math.random() * Math.PI * 2;
      const spd = (1.4 + Math.random() * 2.6) * (0.8 + power * 0.15);
      this.vx[s] = Math.cos(ang) * spd;
      this.vy[s] = 1.5 + Math.random() * 3.2;
      this.vz[s] = Math.sin(ang) * spd * 0.5;
      this.life[s] = this.maxLife[s] = 0.5 + Math.random() * 0.5;
      // Warm gold with a little variation.
      this.tint[s * 3] = 1;
      this.tint[s * 3 + 1] = 0.78 + Math.random() * 0.2;
      this.tint[s * 3 + 2] = 0.3 + Math.random() * 0.2;
    }
  }

  update(dt: number): void {
    for (let s = 0; s < MAX; s++) {
      if (this.life[s] <= 0) {
        this.col[s * 3] = this.col[s * 3 + 1] = this.col[s * 3 + 2] = 0;
        continue;
      }
      this.life[s] -= dt;
      this.vy[s] -= GRAVITY * dt;
      this.pos[s * 3] += this.vx[s] * dt;
      this.pos[s * 3 + 1] += this.vy[s] * dt;
      this.pos[s * 3 + 2] += this.vz[s] * dt;
      const f = Math.max(0, this.life[s] / this.maxLife[s]);
      this.col[s * 3] = this.tint[s * 3] * f;
      this.col[s * 3 + 1] = this.tint[s * 3 + 1] * f;
      this.col[s * 3 + 2] = this.tint[s * 3 + 2] * f;
    }
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let s = 0; s < MAX; s++) {
      this.life[s] = 0;
      this.col[s * 3] = this.col[s * 3 + 1] = this.col[s * 3 + 2] = 0;
    }
    (this.points.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }
}
