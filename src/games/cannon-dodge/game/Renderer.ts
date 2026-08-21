import {
  BALL_RADIUS,
  CENTER,
  ISLAND_RADIUS,
  MUZZLE_OFFSET,
  PLAYER_RADIUS,
  SHORE_WIDTH,
  VIEW_SIZE,
} from "./constants";
import type { CannonField } from "./CannonField";
import type { Cannon } from "./Cannon";
import type { Player } from "./Player";
import type { Particles } from "./Particles";

/** A live snapshot of another player's pirate (room mode). */
export interface RemotePirate {
  x: number;
  y: number;
  facing: number;
  color: string;
  name: string;
  alive: boolean;
}

/** Everything the renderer needs to know about the local pirate this frame. */
export interface LocalPirate {
  player: Player;
  color: string;
  alive: boolean;
  /** Draw the white "this is you" ring (room mode, where others are on-screen). */
  self: boolean;
}

/** Deterministic per-seed RNG so decorations stay put between frames. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

interface Palm {
  x: number;
  y: number;
  scale: number;
  rot: number;
}

/** All 2D canvas drawing for Cannon Dodge — sunny tropical pirate island. */
export class Renderer {
  private readonly base: HTMLCanvasElement;
  private wave = 0;

  constructor() {
    this.base = document.createElement("canvas");
    this.base.width = VIEW_SIZE;
    this.base.height = VIEW_SIZE;
    this.buildBase();
  }

  update(dt: number): void {
    this.wave += dt;
  }

  // ---- Static island layer (baked once) -------------------------------------
  private palms: Palm[] = [];

  private buildBase(): void {
    const ctx = this.base.getContext("2d")!;
    const rng = seeded(20260709);

    // Sea: bright tropical gradient.
    const sea = ctx.createRadialGradient(CENTER, CENTER, ISLAND_RADIUS * 0.7, CENTER, CENTER, VIEW_SIZE * 0.75);
    sea.addColorStop(0, "#2bb7c4");
    sea.addColorStop(0.6, "#159bb3");
    sea.addColorStop(1, "#0c7ea0");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);

    // Concentric foam rings around the island for a bit of water motion feel.
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.1 - i * 0.02})`;
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, ISLAND_RADIUS + 14 + i * 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Foam ring hugging the beach.
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, ISLAND_RADIUS + 3, 0, Math.PI * 2);
    ctx.stroke();

    // Wet shore ring.
    ctx.fillStyle = "#d9b26a";
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, ISLAND_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Dry sand disc.
    const sand = ctx.createRadialGradient(CENTER - 40, CENTER - 60, 40, CENTER, CENTER, ISLAND_RADIUS);
    sand.addColorStop(0, "#f4dda3");
    sand.addColorStop(0.7, "#eccf86");
    sand.addColorStop(1, "#e2be6f");
    ctx.fillStyle = sand;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, ISLAND_RADIUS - SHORE_WIDTH, 0, Math.PI * 2);
    ctx.fill();

    // Sand speckle texture.
    for (let i = 0; i < 340; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * (ISLAND_RADIUS - SHORE_WIDTH - 6);
      const x = CENTER + Math.cos(a) * r;
      const y = CENTER + Math.sin(a) * r;
      ctx.fillStyle = rng() > 0.5 ? "rgba(180,150,90,0.35)" : "rgba(255,240,200,0.4)";
      ctx.beginPath();
      ctx.arc(x, y, rng() * 1.6 + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // A soft inner clearing so the centre reads as open play space.
    const clearing = ctx.createRadialGradient(CENTER, CENTER, 0, CENTER, CENTER, ISLAND_RADIUS * 0.55);
    clearing.addColorStop(0, "rgba(255,246,220,0.5)");
    clearing.addColorStop(1, "rgba(255,246,220,0)");
    ctx.fillStyle = clearing;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, ISLAND_RADIUS * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Scatter a few palms and rocks near the shore (not in the play centre).
    this.palms = [];
    const decorCount = 7;
    for (let i = 0; i < decorCount; i++) {
      const a = (i / decorCount) * Math.PI * 2 + rng() * 0.5;
      const r = ISLAND_RADIUS - SHORE_WIDTH - 18 - rng() * 26;
      this.palms.push({
        x: CENTER + Math.cos(a) * r,
        y: CENTER + Math.sin(a) * r,
        scale: 0.85 + rng() * 0.4,
        rot: rng() * Math.PI * 2,
      });
    }
    for (const p of this.palms) this.drawPalm(ctx, p);

    // A couple of rocks for flavour.
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const r = (0.3 + rng() * 0.5) * (ISLAND_RADIUS - SHORE_WIDTH);
      const x = CENTER + Math.cos(a) * r;
      const y = CENTER + Math.sin(a) * r;
      ctx.fillStyle = "#9c9488";
      ctx.beginPath();
      ctx.ellipse(x, y, 6 + rng() * 6, 5 + rng() * 4, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.ellipse(x - 2, y - 2, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPalm(ctx: CanvasRenderingContext2D, p: Palm): void {
    // Top-down palm: shadow, trunk dot, radiating fronds.
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(p.scale, p.scale);

    ctx.fillStyle = "rgba(80,60,30,0.22)";
    ctx.beginPath();
    ctx.ellipse(3, 4, 20, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      const grad = ctx.createLinearGradient(0, 0, 22, 0);
      grad.addColorStop(0, "#2f8f4e");
      grad.addColorStop(1, "#1f6e39");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.quadraticCurveTo(16, -6, 24, 0);
      ctx.quadraticCurveTo(16, 6, 0, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = "#6b4a25";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- Dynamic frame --------------------------------------------------------
  draw(
    ctx: CanvasRenderingContext2D,
    field: CannonField,
    local: LocalPirate,
    remotes: RemotePirate[],
    particles: Particles,
  ): void {
    ctx.drawImage(this.base, 0, 0);

    // Telegraph aim lines (under everything else so balls read on top).
    for (const c of field.cannons) {
      if (c.isTelegraphing) this.drawTelegraph(ctx, c);
    }

    // Cannons.
    for (const c of field.cannons) this.drawCannon(ctx, c);

    // Cannonballs with smoke trails.
    for (const b of field.balls) {
      for (let i = b.trail.length - 1; i >= 0; i--) {
        const t = b.trail[i];
        const f = (b.trail.length - i) / b.trail.length;
        ctx.fillStyle = `rgba(60,60,70,${0.12 * f})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, BALL_RADIUS * (0.4 + f * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      this.drawBall(ctx, b.x, b.y);
    }

    // Other players first, so the local pirate always draws on top.
    for (const r of remotes) {
      this.drawPirate(ctx, r.x, r.y, PLAYER_RADIUS, r.facing, r.color, {
        name: r.name,
        alive: r.alive,
      });
    }

    if (local.alive) {
      this.drawPirate(ctx, local.player.x, local.player.y, local.player.radius, local.player.facing, local.color, {
        self: local.self,
      });
    }

    particles.draw(ctx);
  }

  private drawTelegraph(ctx: CanvasRenderingContext2D, c: Cannon): void {
    const p = c.chargeProgress;
    const len = ISLAND_RADIUS * 2.1;
    const ex = c.x + c.dx * len;
    const ey = c.y + c.dy * len;

    ctx.save();
    // Dashed danger line that fills toward red as the shot charges.
    ctx.setLineDash([10, 10]);
    ctx.lineDashOffset = -this.wave * 40;
    ctx.strokeStyle = `rgba(210,40,40,${0.25 + p * 0.5})`;
    ctx.lineWidth = 2 + p * 2;
    ctx.beginPath();
    ctx.moveTo(c.x + c.dx * MUZZLE_OFFSET, c.y + c.dy * MUZZLE_OFFSET);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();

    // Growing muzzle glow just before firing.
    const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 26 * p + 4);
    glow.addColorStop(0, `rgba(255,180,60,${0.7 * p})`);
    glow.addColorStop(1, "rgba(255,180,60,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 26 * p + 4, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCannon(ctx: CanvasRenderingContext2D, c: Cannon): void {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);

    // Recoil pushes the barrel back (opposite the aim) briefly.
    const recoil = -c.recoil * 8;

    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(recoil, 3, 22, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wooden carriage.
    ctx.fillStyle = "#6b3f1e";
    ctx.beginPath();
    ctx.roundRect(-14 + recoil, -12, 22, 24, 4);
    ctx.fill();
    ctx.fillStyle = "#4d2c13";
    ctx.beginPath();
    ctx.arc(-8 + recoil, -12, 5, 0, Math.PI * 2);
    ctx.arc(-8 + recoil, 12, 5, 0, Math.PI * 2);
    ctx.fill();

    // Bronze barrel pointing along +x (the aim direction).
    const barrel = ctx.createLinearGradient(0, -7, 0, 7);
    barrel.addColorStop(0, "#c8912f");
    barrel.addColorStop(0.5, "#f2c869");
    barrel.addColorStop(1, "#8a5f1c");
    ctx.fillStyle = barrel;
    ctx.beginPath();
    ctx.roundRect(recoil, -7, 30, 14, 6);
    ctx.fill();
    // Muzzle ring.
    ctx.fillStyle = "#5f3f14";
    ctx.beginPath();
    ctx.roundRect(26 + recoil, -8, 5, 16, 3);
    ctx.fill();
    // Bore.
    ctx.fillStyle = "#1c140a";
    ctx.beginPath();
    ctx.arc(30 + recoil, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawBall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Subtle ground shadow for depth.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 4, BALL_RADIUS, BALL_RADIUS * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, BALL_RADIUS);
    g.addColorStop(0, "#5a5a66");
    g.addColorStop(0.5, "#26262e");
    g.addColorStop(1, "#0a0a10");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Specular highlight (keeps the black ball readable on any sand tone).
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(x - 3, y - 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPirate(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    facing: number,
    bandana: string,
    opts: { name?: string; alive?: boolean; self?: boolean } = {},
  ): void {
    const alive = opts.alive !== false;

    // Dead remotes linger faded, so you can still see who was knocked out.
    ctx.save();
    if (!alive) ctx.globalAlpha = 0.35;

    // Name tag above other players.
    if (opts.name) {
      ctx.font = "bold 12px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.fillStyle = bandana;
      ctx.strokeText(opts.name, x, y - radius - 8);
      ctx.fillText(opts.name, x, y - radius - 8);
    }

    // Self highlight ring so you can pick yourself out of the pack.
    if (opts.self) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 4, radius + 2, radius, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (striped pirate shirt).
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(facing + Math.PI / 2);

    ctx.fillStyle = "#f4f1e8";
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    // Shirt stripes — the per-player identity colour (matches the bandana).
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = bandana;
    for (let sy = -radius; sy < radius; sy += 8) {
      ctx.fillRect(-radius, sy, radius * 2, 4);
    }
    ctx.restore();

    // Head with a red bandana, offset toward facing (which is +y after rotate).
    const hx = 0;
    const hy = radius * 0.55;
    ctx.fillStyle = "#e7b98a";
    ctx.beginPath();
    ctx.arc(hx, hy, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    // Bandana cap — the per-player identity colour.
    ctx.fillStyle = bandana;
    ctx.beginPath();
    ctx.arc(hx, hy, radius * 0.6, Math.PI, Math.PI * 2);
    ctx.fill();
    // Bandana knot tail.
    ctx.beginPath();
    ctx.moveTo(hx - radius * 0.5, hy - 1);
    ctx.lineTo(hx - radius * 0.9, hy + 3);
    ctx.lineTo(hx - radius * 0.5, hy + 4);
    ctx.closePath();
    ctx.fill();

    // Outline for pop.
    ctx.strokeStyle = "rgba(40,25,15,0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore(); // translate/rotate
    ctx.restore(); // globalAlpha / name / self ring
  }
}
