import * as THREE from "three";

const VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (320.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.04, d));
}
`;

export interface BurstOptions {
  count: number;
  color: THREE.Color;
  /** Velocidad base del chorro. */
  speed: number;
  /** Dispersion angular en radianes alrededor de la vertical. */
  spread: number;
  size: number;
  life: number;
  /** Empuje extra en X (para que el polvo salga hacia atras del pisotazo). */
  drift?: number;
}

/**
 * Un unico sistema de particulas para todo el juego: polvo al pisar y estallido
 * al caer salen del mismo pool. Blending normal, no aditivo: es tierra, no luz.
 */
export class Particles {
  readonly points: THREE.Points;

  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private cursor = 0;

  constructor(max = 420) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setDrawRange(0, max);
    // Las particulas se posicionan en mundo; sin esto Three las cullea al azar.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  burst(origin: THREE.Vector3, opts: BurstOptions): void {
    const drift = opts.drift ?? 0;
    for (let n = 0; n < opts.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;

      const a = (Math.random() - 0.5) * opts.spread;
      const around = Math.random() * Math.PI * 2;
      const s = opts.speed * (0.45 + Math.random() * 0.8);

      this.pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.16;
      this.pos[i * 3 + 1] = origin.y + Math.random() * 0.08;
      this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.16;

      this.vel[i * 3] = Math.sin(a) * s * Math.cos(around) + drift;
      this.vel[i * 3 + 1] = Math.cos(a) * s;
      this.vel[i * 3 + 2] = Math.sin(a) * s * Math.sin(around);

      this.col[i * 3] = opts.color.r;
      this.col[i * 3 + 1] = opts.color.g;
      this.col[i * 3 + 2] = opts.color.b;

      this.size[i] = opts.size * (0.6 + Math.random() * 0.9);
      this.maxLife[i] = opts.life * (0.7 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.alpha[i] = 1;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      // Gravedad suave + rozamiento del aire: el polvo flota, no cae como piedra.
      this.vel[i * 3 + 1] -= 3.6 * dt;
      const drag = Math.max(0, 1 - 1.4 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] *= drag;
      this.vel[i * 3 + 2] *= drag;

      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;

      if (this.pos[i * 3 + 1] < 0.01) {
        this.pos[i * 3 + 1] = 0.01;
        this.vel[i * 3 + 1] *= -0.18;
      }

      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t * t * 0.85;
    }

    const geo = this.points.geometry;
    geo.getAttribute("position").needsUpdate = true;
    geo.getAttribute("aAlpha").needsUpdate = true;
    geo.getAttribute("aSize").needsUpdate = true;
    geo.getAttribute("aColor").needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.points.geometry.getAttribute("aAlpha").needsUpdate = true;
  }
}
