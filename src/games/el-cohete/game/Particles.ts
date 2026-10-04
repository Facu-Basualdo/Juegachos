import * as THREE from "three";

/**
 * Un pool de particulas en un solo `THREE.Points` (una llamada de dibujo). Todo vive en
 * Float32Arrays preasignados: nada de `new` por cuadro. Dos pools en la escena: uno
 * aditivo (fuego, chispas) y uno normal (humo, que tiene que tapar).
 *
 * El sprite es procedural (sin textura): un disco suave con borde ruidoso para el humo.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private readonly size: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly seed: Float32Array;
  private next = 0;
  private readonly geo: THREE.BufferGeometry;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.col0 = new Float32Array(cap * 3);
    this.col1 = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.size1 = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.alpha0 = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap).fill(1);
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.seed = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this.seed[i] = Math.random();

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("seed", new THREE.BufferAttribute(this.seed, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 0 : 1 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute float seed;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        uniform float uSoft;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p) * 2.0;
          // El humo tiene el borde apenas irregular (bocanada), el fuego es un disco suave.
          // Ondulacion chica y de frecuencias bajas: alta se leia como copo de nieve.
          float a = atan(p.y, p.x);
          float wob = uSoft * 0.07 * (sin(a * 2.0 + vSeed * 40.0) + 0.6 * sin(a * 3.0 - vSeed * 17.0));
          float m = 1.0 - smoothstep(0.2 + wob, 1.0 + wob, d);
          m *= m;
          if (m <= 0.0) discard;
          gl_FragColor = vec4(vColor, m * vAlpha);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  /** Escala de tamano segun el alto de la pantalla (los tamanos son en unidades de mundo). */
  setScale(viewportH: number, fovDeg: number): void {
    const s = viewportH / (2 * Math.tan((fovDeg * Math.PI) / 360));
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = s;
  }

  /**
   * Emite una particula. Colores 0x RGB; `c1` es el color al morir (el fuego se
   * oscurece a humo). `s0`/`s1` tamano al nacer y al morir, en unidades de mundo.
   */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    c0: number,
    c1: number,
    s0: number,
    s1: number,
    alpha = 1,
    drag = 1.2,
    grav = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.col0[k] = ((c0 >> 16) & 255) / 255;
    this.col0[k + 1] = ((c0 >> 8) & 255) / 255;
    this.col0[k + 2] = (c0 & 255) / 255;
    this.col1[k] = ((c1 >> 16) & 255) / 255;
    this.col1[k + 1] = ((c1 >> 8) & 255) / 255;
    this.col1[k + 2] = (c1 & 255) / 255;
    this.size0[i] = s0;
    this.size1[i] = s1;
    this.alpha0[i] = alpha;
    this.life[i] = life;
    this.max[i] = life;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt: number): void {
    for (let i = 0; i < this.cap; i++) {
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp - this.grav[i] * dt;
      this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.col[k] = this.col0[k] + (this.col1[k] - this.col0[k]) * t;
      this.col[k + 1] = this.col0[k + 1] + (this.col1[k + 1] - this.col0[k + 1]) * t;
      this.col[k + 2] = this.col0[k + 2] + (this.col1[k + 2] - this.col0[k + 2]) * t;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      // Entra rapido y se va despacio.
      this.alpha[i] = this.alpha0[i] * Math.min(1, t * 8) * (1 - t * t);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }
}
