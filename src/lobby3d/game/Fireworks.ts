import * as THREE from "three";

/**
 * Festejo de la final (DESIGN.md: luna roja, bengalas y ceniza): bengalas que suben
 * detras de las carteleras y revientan en chispas rojas y blancas, y ceniza cayendo
 * sobre el podio. Cosmetico y local: cada pantalla tira las suyas, no viaja nada por
 * la red ni importa que no coincidan.
 */

const COLORS = ["#ff2a1a", "#ff5a36", "#ffb35c", "#e8e4d8", "#c0392b"];
/** Ceniza: grises apagados. */
const ASH = ["#5a5652", "#3d3a37", "#77716a", "#2a2826"];
const SPARKS = 80;
const MAX_BURSTS = 6;
const BURST_LIFE = 2;
const LAUNCH_EVERY = 0.75;
const CONFETTI = 240;
const CONFETTI_RADIUS = 5.5;
const CONFETTI_TOP = 10;

/** Chispa redonda con borde suave (sin esto los puntos se dibujan como cuadrados). */
function sparkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

interface Burst {
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  pos: Float32Array;
  vel: Float32Array;
  age: number;
  /** Fase de subida (el cohete) antes de reventar. */
  rising: boolean;
  target: THREE.Vector3;
}

export class Fireworks {
  readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly confetti: THREE.InstancedMesh;
  private readonly confettiState: Float32Array;
  private active = false;
  /** Avisos para el sonido (el Hub los engancha a `Sounds`). */
  onLaunch: () => void = () => {};
  onBurst: () => void = () => {};
  private launchTimer = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor() {
    const spark = sparkTexture();
    for (let i = 0; i < MAX_BURSTS; i++) {
      const pos = new Float32Array(SPARKS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        map: spark,
        size: 0.32,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      this.group.add(points);
      this.bursts.push({ points, mat, pos, vel: new Float32Array(SPARKS * 3), age: 99, rising: false, target: new THREE.Vector3() });
    }

    // Confeti: una InstancedMesh de papelitos; por instancia x, y, z, giro, velocidad.
    this.confetti = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.14, 0.08),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
      CONFETTI,
    );
    this.confetti.frustumCulled = false;
    this.confettiState = new Float32Array(CONFETTI * 5);
    const c = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) {
      // Arranca todo "en el piso" (apagado): recien la final lo tira desde arriba.
      this.resetPaper(i, -1);
      this.confetti.setColorAt(i, c.set(ASH[i % ASH.length]));
    }
    this.confetti.visible = false;
    this.group.add(this.confetti);
  }

  setActive(active: boolean): void {
    if (active && !this.active) {
      this.launchTimer = 0;
      for (let i = 0; i < CONFETTI; i++) this.resetPaper(i, CONFETTI_TOP * (0.6 + Math.random() * 0.8));
    }
    this.active = active;
  }

  private resetPaper(i: number, y: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * CONFETTI_RADIUS;
    const o = i * 5;
    this.confettiState[o] = Math.cos(a) * r;
    this.confettiState[o + 1] = y;
    this.confettiState[o + 2] = Math.sin(a) * r;
    this.confettiState[o + 3] = Math.random() * 6;
    this.confettiState[o + 4] = 0.5 + Math.random() * 0.6;
  }

  private launch(): void {
    const b = this.bursts.find((x) => x.age >= BURST_LIFE);
    if (!b) return;
    // Detras de la galeria (al norte, que es adonde se mira al entrar) y a la altura
    // del cielo que entra en cuadro desde la plaza.
    const a = (Math.random() - 0.5) * Math.PI * 1.1;
    const r = 16 + Math.random() * 8;
    b.target.set(Math.sin(a) * r, 8 + Math.random() * 5, -Math.cos(a) * r);
    // El cohete sube desde el borde de la isla: todas las chispas juntas, en fila.
    for (let i = 0; i < SPARKS; i++) {
      b.pos[i * 3] = b.target.x;
      b.pos[i * 3 + 1] = -2 - i * 0.03;
      b.pos[i * 3 + 2] = b.target.z;
    }
    b.mat.color.set("#ffe8b0");
    b.mat.opacity = 1;
    b.mat.size = 0.4;
    b.age = 0;
    b.rising = true;
    b.points.visible = true;
    this.onLaunch();
  }

  private explode(b: Burst): void {
    this.onBurst();
    b.rising = false;
    b.age = 0;
    b.mat.color.set(COLORS[Math.floor(Math.random() * COLORS.length)]);
    b.mat.size = 0.75;
    const speed = 5 + Math.random() * 3;
    for (let i = 0; i < SPARKS; i++) {
      // Direcciones parejas sobre una esfera (espiral de Fibonacci).
      const y = 1 - (2 * (i + 0.5)) / SPARKS;
      const rr = Math.sqrt(1 - y * y);
      const th = i * 2.39996;
      const k = speed * (0.85 + Math.random() * 0.3);
      b.vel[i * 3] = Math.cos(th) * rr * k;
      b.vel[i * 3 + 1] = y * k;
      b.vel[i * 3 + 2] = Math.sin(th) * rr * k;
      b.pos[i * 3] = b.target.x;
      b.pos[i * 3 + 1] = b.target.y;
      b.pos[i * 3 + 2] = b.target.z;
    }
  }

  update(dt: number): void {
    if (this.active) {
      this.launchTimer -= dt;
      if (this.launchTimer <= 0) {
        this.launchTimer = LAUNCH_EVERY * (0.6 + Math.random() * 0.8);
        this.launch();
      }
    }

    for (const b of this.bursts) {
      if (b.age >= BURST_LIFE) continue;
      if (b.rising) {
        // Sube rapido hacia su punto; al llegar, revienta.
        let arrived = false;
        for (let i = 0; i < SPARKS; i++) {
          const o = i * 3 + 1;
          b.pos[o] += (b.target.y - b.pos[o]) * Math.min(1, dt * 3.2);
          if (i === 0 && b.target.y - b.pos[o] < 0.4) arrived = true;
        }
        if (arrived) this.explode(b);
      } else {
        b.age += dt;
        const drag = Math.exp(-dt * 1.4);
        for (let i = 0; i < SPARKS; i++) {
          const o = i * 3;
          b.vel[o] *= drag;
          b.vel[o + 1] = b.vel[o + 1] * drag - 3.5 * dt;
          b.vel[o + 2] *= drag;
          b.pos[o] += b.vel[o] * dt;
          b.pos[o + 1] += b.vel[o + 1] * dt;
          b.pos[o + 2] += b.vel[o + 2] * dt;
        }
        b.mat.opacity = Math.max(0, 1 - b.age / BURST_LIFE);
        if (b.age >= BURST_LIFE) b.points.visible = false;
      }
      b.points.geometry.getAttribute("position").needsUpdate = true;
    }

    // Confeti: mientras esta activo se recicla arriba; apagado, termina de caer.
    let any = false;
    for (let i = 0; i < CONFETTI; i++) {
      const o = i * 5;
      const st = this.confettiState;
      if (st[o + 1] < -0.5) {
        if (!this.active) continue;
        this.resetPaper(i, CONFETTI_TOP + Math.random() * 2);
      }
      any = true;
      st[o + 1] -= st[o + 4] * dt;
      st[o + 3] += dt * 4;
      const sway = Math.sin(st[o + 3]) * 0.4 * dt;
      st[o] += sway;
      this.v.set(st[o], Math.max(st[o + 1], 0.02), st[o + 2]);
      this.e.set(st[o + 3], st[o + 3] * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v, this.q, this.s);
      this.confetti.setMatrixAt(i, this.m);
    }
    this.confetti.visible = any;
    this.confetti.instanceMatrix.needsUpdate = true;
  }
}
