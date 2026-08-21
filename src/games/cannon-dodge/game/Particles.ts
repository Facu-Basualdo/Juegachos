interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** "smoke" drifts and grows; "spark" flies straight and shrinks. */
  kind: "smoke" | "spark";
}

/** Tiny fire-and-forget particle pool for muzzle smoke and death sprays. */
export class Particles {
  private readonly items: Particle[] = [];

  clear(): void {
    this.items.length = 0;
  }

  /** Puff of grey smoke pushed along (dx, dy) from a muzzle. */
  smoke(x: number, y: number, dx: number, dy: number): void {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 1.2;
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const rx = dx * ca - dy * sa;
      const ry = dx * sa + dy * ca;
      const speed = 40 + Math.random() * 90;
      this.items.push({
        x,
        y,
        vx: rx * speed,
        vy: ry * speed,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.4,
        size: 5 + Math.random() * 7,
        color: "230, 224, 210",
        kind: "smoke",
      });
    }
  }

  /** Splash / debris burst when the pirate is hit. */
  burst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 220;
      this.items.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.5,
        size: 3 + Math.random() * 4,
        color,
        kind: "spark",
      });
    }
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.items.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "smoke") {
        p.vx *= 0.9;
        p.vy *= 0.9;
        p.size += 14 * dt;
      } else {
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const t = 1 - p.life / p.maxLife;
      const r = p.kind === "smoke" ? p.size : p.size * t;
      ctx.globalAlpha = p.kind === "smoke" ? t * 0.5 : t;
      ctx.fillStyle = `rgba(${p.color}, 1)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
