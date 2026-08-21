/** Una particula en coordenadas de MUNDO (se proyecta con la iso al dibujar). */
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const GRAVITY = 6.5;
const MAX_PARTICLES = 260;

/** Pool chico de polvo, chispas y esquirlas. Todo en unidades de mundo. */
export class Particles {
  readonly items: Particle[] = [];

  clear(): void {
    this.items.length = 0;
  }

  private push(p: Particle): void {
    if (this.items.length >= MAX_PARTICLES) this.items.shift();
    this.items.push(p);
  }

  /** Polvo del aterrizaje: se abre en anillo bajo, casi sin altura. */
  dust(x: number, y: number, count = 9): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 1.1;
      this.push({
        x,
        y,
        z: 0.02,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.6,
        vz: 0.3 + Math.random() * 0.5,
        life: 0.42 + Math.random() * 0.22,
        maxLife: 0.64,
        size: 2 + Math.random() * 3,
        color: "168, 128, 79",
      });
    }
  }

  /** Chispas que la viga de brasa arranca de las losas. */
  sparks(x: number, y: number, count = 3): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.push({
        x,
        y,
        z: 0.05 + Math.random() * 0.1,
        vx: Math.cos(a) * (0.7 + Math.random() * 1.6),
        vy: Math.sin(a) * (0.5 + Math.random()),
        vz: 1.2 + Math.random() * 1.9,
        life: 0.3 + Math.random() * 0.35,
        maxLife: 0.65,
        size: 1.4 + Math.random() * 1.8,
        color: Math.random() < 0.4 ? "255, 240, 208" : "255, 122, 24",
      });
    }
  }

  /** Estallido de la muerte. */
  burst(x: number, y: number, z: number, color: string, count = 18): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.2 + Math.random() * 2.6;
      this.push({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.6,
        vz: 1.4 + Math.random() * 3,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1,
        size: 2 + Math.random() * 3.5,
        color,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      p.vz -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.28;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
    }
  }
}
