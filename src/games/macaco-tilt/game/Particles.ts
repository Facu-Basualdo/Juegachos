import { COLORS, VIEW_HEIGHT } from "./constants";

export type ParticleKind = "sweat" | "splinter" | "leaf";

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
}

const SPLINTER_COLORS = [COLORS.woodLight, COLORS.woodDark, COLORS.woodShadow];
const LEAF_COLORS = [COLORS.canopyNear, COLORS.canopyMid, "#6fbf72"];

/**
 * Fire-and-forget particle pool for the three cosmetic effects: sweat flicked off the
 * monkey, wood splinters when a chunk of plank breaks, and leaves riding the wind.
 *
 * Nothing here feeds back into gameplay — `Game` spawns from events and `Renderer` draws
 * whatever is alive.
 */
export class Particles {
  private readonly items: Particle[] = [];

  clear(): void {
    this.items.length = 0;
  }

  get all(): readonly Particle[] {
    return this.items;
  }

  /** A bead of sweat flicked off the monkey's head. */
  sweat(x: number, y: number): void {
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.items.push({
      kind: "sweat",
      x,
      y,
      vx: dir * (40 + Math.random() * 90),
      vy: -60 - Math.random() * 90,
      rot: 0,
      spin: 0,
      size: 3 + Math.random() * 2.5,
      life: 0.9,
      maxLife: 0.9,
      color: "#bfe9ff",
    });
  }

  /** A burst of bamboo shards where the plank just snapped. */
  splinters(x: number, y: number, dir: -1 | 1, count = 16): void {
    for (let i = 0; i < count; i++) {
      this.items.push({
        kind: "splinter",
        x: x + (Math.random() * 2 - 1) * 8,
        y: y + (Math.random() * 2 - 1) * 8,
        vx: dir * (60 + Math.random() * 260),
        vy: -160 + Math.random() * 200,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() * 2 - 1) * 14,
        size: 4 + Math.random() * 9,
        life: 1.1 + Math.random() * 0.5,
        maxLife: 1.6,
        color: SPLINTER_COLORS[(Math.random() * SPLINTER_COLORS.length) | 0],
      });
    }
  }

  /**
   * A leaf blown in from one edge. Spawned continuously while a gust is telegraphing,
   * so the direction of the incoming shove is readable before it lands.
   */
  windLeaf(dir: -1 | 1, viewWidth: number, intensity: number): void {
    const speed = (260 + Math.random() * 340) * (0.5 + intensity * 0.5);
    this.items.push({
      kind: "leaf",
      x: dir > 0 ? -30 : viewWidth + 30,
      y: 40 + Math.random() * (VIEW_HEIGHT - 120),
      vx: dir * speed,
      vy: -30 + Math.random() * 60,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() * 2 - 1) * 9,
      size: 7 + Math.random() * 9,
      life: 3,
      maxLife: 3,
      color: LEAF_COLORS[(Math.random() * LEAF_COLORS.length) | 0],
    });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      // Leaves ride the air (they flutter and barely fall); the rest obey gravity.
      if (p.kind === "leaf") {
        p.vy += Math.sin(p.life * 6 + p.x * 0.01) * 40 * dt;
      } else {
        p.vy += 900 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }
}
