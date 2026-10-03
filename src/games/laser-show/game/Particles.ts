import * as THREE from "three";
import { glowTexture } from "./textures";

const POOL = 400;
const GRAVITY = 14;

/**
 * Chispas (DESIGN.md: el concursante que toca un laser chisporrotea y sale de
 * cuadro). Un solo `Points` aditivo con un pool fijo: nada se crea por cuadro.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(POOL * 3);
  private readonly col = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly life = new Float32Array(POOL);
  private readonly maxLife = new Float32Array(POOL);
  private readonly base = new Float32Array(POOL * 3);
  private cursor = 0;
  private readonly tmp = new THREE.Color();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.32,
        map: glowTexture(),
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    for (let i = 0; i < POOL; i++) this.pos[i * 3 + 1] = -999;
  }

  /** Estallido de chispas en (x, y, z), del color del laser y blancas. */
  burst(x: number, y: number, z: number, color: string, count = 70): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % POOL;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 1.2 - 0.2;
      const sp = 2 + Math.random() * 6;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y + Math.random() * 1.2;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = up * sp + 2;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.tmp.set(Math.random() < 0.35 ? "#ffffff" : color);
      this.base[i * 3] = this.tmp.r;
      this.base[i * 3 + 1] = this.tmp.g;
      this.base[i * 3 + 2] = this.tmp.b;
      this.maxLife[i] = this.life[i] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < POOL; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= GRAVITY * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.base[i * 3] * k;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * k;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * k;
    }
    if (!any) return;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
