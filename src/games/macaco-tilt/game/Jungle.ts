import { COLORS, PIVOT_Y, VIEW_HEIGHT, VIEW_WIDTH } from "./constants";

/** Extra width baked either side so a layer can sway without exposing its edge. */
const PAD = 90;
const BAKE_WIDTH = VIEW_WIDTH + PAD * 2;

/** How far each layer shifts per radian of plank tilt. Bigger = reads as closer. */
const SWAY_FAR = 26;
const SWAY_MID = 52;
const SWAY_NEAR = 96;

/**
 * The parallax jungle behind the plank: three baked layers plus live light shafts.
 *
 * The scene is a fixed location (a ledge over a gorge), so the layers **sway** rather
 * than scroll: each one offsets against the plank's tilt, by an amount proportional to
 * how close it reads. A slow idle drift keeps it alive when the plank is level.
 *
 * Everything static is rendered once into offscreen canvases at construction — the frame
 * loop only blits them. Per DESIGN.md each layer pays its distance three ways at once:
 * darker, less saturated, and lower internal contrast toward the back.
 */
export class Jungle {
  private readonly far: HTMLCanvasElement;
  private readonly mid: HTMLCanvasElement;
  private readonly near: HTMLCanvasElement;
  private time = 0;

  constructor() {
    this.far = this.bakeFar();
    this.mid = this.bakeMid();
    this.near = this.bakeNear();
  }

  update(dt: number): void {
    this.time += dt;
  }

  draw(ctx: CanvasRenderingContext2D, angle: number): void {
    this.drawSky(ctx);

    const drift = Math.sin(this.time * 0.24) * 7;
    ctx.drawImage(this.far, -PAD - angle * SWAY_FAR + drift * 0.3, 0);
    ctx.drawImage(this.mid, -PAD - angle * SWAY_MID + drift * 0.6, 0);

    this.drawShafts(ctx);
    this.drawChasm(ctx);

    ctx.drawImage(this.near, -PAD - angle * SWAY_NEAR + drift, 0);
  }

  // --- Sky and atmosphere -------------------------------------------------

  private drawSky(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
    g.addColorStop(0, COLORS.skyHigh);
    g.addColorStop(0.42, COLORS.skyMid);
    g.addColorStop(1, COLORS.skyDeep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    // The single light source: high and to the left, per DESIGN.md.
    const sun = ctx.createRadialGradient(200, -60, 20, 200, -60, 620);
    sun.addColorStop(0, "rgba(244, 208, 63, 0.30)");
    sun.addColorStop(0.5, "rgba(244, 208, 63, 0.09)");
    sun.addColorStop(1, "rgba(244, 208, 63, 0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  }

  /** Diagonal god rays. Cheap gradient quads — no shadowBlur in the frame path. */
  private drawShafts(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const shafts = [
      { x: 150, w: 70 },
      { x: 340, w: 46 },
      { x: 620, w: 58 },
      { x: 820, w: 38 },
    ];
    for (let i = 0; i < shafts.length; i++) {
      const s = shafts[i];
      // Each shaft breathes at its own rate so they never pulse in unison.
      const alpha = 0.055 + 0.028 * Math.sin(this.time * 0.5 + i * 1.7);
      const g = ctx.createLinearGradient(s.x, 0, s.x + 150, VIEW_HEIGHT);
      g.addColorStop(0, `rgba(244, 208, 63, ${alpha})`);
      g.addColorStop(0.65, `rgba(244, 208, 63, ${alpha * 0.35})`);
      g.addColorStop(1, "rgba(244, 208, 63, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x + s.w, 0);
      ctx.lineTo(s.x + s.w + 165, VIEW_HEIGHT);
      ctx.lineTo(s.x + 150, VIEW_HEIGHT);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** The void the monkey falls into: a dark well with a mist lip at the top. */
  private drawChasm(ctx: CanvasRenderingContext2D): void {
    const top = PIVOT_Y + 150;
    const g = ctx.createLinearGradient(0, top, 0, VIEW_HEIGHT);
    g.addColorStop(0, "rgba(6, 18, 12, 0)");
    g.addColorStop(0.45, "rgba(4, 12, 8, 0.85)");
    g.addColorStop(1, "rgba(2, 6, 4, 1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, VIEW_WIDTH, VIEW_HEIGHT - top);

    // Mist rolling over the lip, drifting slowly so the drop reads as deep.
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 3; i++) {
      const y = top + 30 + i * 34;
      const x = Math.sin(this.time * 0.18 + i * 2.1) * 60;
      const m = ctx.createRadialGradient(VIEW_WIDTH / 2 + x, y, 10, VIEW_WIDTH / 2 + x, y, 420);
      m.addColorStop(0, "rgba(190, 225, 200, 0.5)");
      m.addColorStop(1, "rgba(190, 225, 200, 0)");
      ctx.fillStyle = m;
      ctx.fillRect(0, y - 90, VIEW_WIDTH, 180);
    }
    ctx.restore();
  }

  // --- Baked layers -------------------------------------------------------

  private makeLayer(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement("canvas");
    canvas.width = BAKE_WIDTH;
    canvas.height = VIEW_HEIGHT;
    return { canvas, ctx: canvas.getContext("2d")! };
  }

  private bakeFar(): HTMLCanvasElement {
    const { canvas, ctx } = this.makeLayer();

    // Distant canopy: almost a flat silhouette, desaturated toward blue.
    ctx.fillStyle = COLORS.canopyFar;
    ctx.beginPath();
    ctx.moveTo(0, VIEW_HEIGHT);
    ctx.lineTo(0, 250);
    for (let x = 0; x <= BAKE_WIDTH; x += 46) {
      const h = 200 + Math.sin(x * 0.013) * 46 + Math.sin(x * 0.041) * 22;
      ctx.quadraticCurveTo(x + 23, h - 34, x + 46, h);
    }
    ctx.lineTo(BAKE_WIDTH, VIEW_HEIGHT);
    ctx.closePath();
    ctx.fill();

    // Haze band separating this layer from the next — the atmosphere that sells depth.
    const haze = ctx.createLinearGradient(0, 170, 0, 400);
    haze.addColorStop(0, "rgba(120, 170, 140, 0.20)");
    haze.addColorStop(1, "rgba(120, 170, 140, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 170, BAKE_WIDTH, 230);

    return canvas;
  }

  private bakeMid(): HTMLCanvasElement {
    const { canvas, ctx } = this.makeLayer();

    // Trunks: cylinders, lit from the left like everything else.
    const trunks = [70, 300, 560, 860, 1060];
    for (const x of trunks) {
      const w = 40 + ((x * 7) % 24);
      const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      g.addColorStop(0, "#2a3f2a");
      g.addColorStop(0.3, "#3d5a38");
      g.addColorStop(1, "#1a2a1c");
      ctx.fillStyle = g;
      ctx.fillRect(x - w / 2, 120, w, VIEW_HEIGHT - 120);

      // Crown sitting on top of the trunk.
      this.leafCluster(ctx, x, 150, 96, COLORS.canopyMid, "#3f8a4e", 7);
    }

    // Hanging lianas, drawn as tapering curves.
    const lianas = [180, 420, 700, 960];
    for (let i = 0; i < lianas.length; i++) {
      const x = lianas[i];
      ctx.strokeStyle = "#25502f";
      ctx.lineWidth = 5 - (i % 2);
      ctx.beginPath();
      ctx.moveTo(x, 140);
      ctx.bezierCurveTo(x + 34, 250, x - 30, 330, x + 14, 440);
      ctx.stroke();
      // A couple of leaves clinging to it.
      ctx.fillStyle = "#316b3b";
      ctx.beginPath();
      ctx.ellipse(x + 20, 268, 15, 7, 0.5, 0, Math.PI * 2);
      ctx.ellipse(x - 12, 352, 13, 6, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas;
  }

  private bakeNear(): HTMLCanvasElement {
    const { canvas, ctx } = this.makeLayer();

    // Foreground fronds framing the top corners and the bottom edge. They are the
    // closest thing on screen, so they get the brightest greens and hardest contrast —
    // but they stay out of the centre, which belongs to the plank.
    this.leafCluster(ctx, 30, 40, 132, COLORS.canopyNear, "#6fd47f", 8);
    this.leafCluster(ctx, 205, -20, 104, COLORS.canopyNear, "#6fd47f", 7);
    this.leafCluster(ctx, BAKE_WIDTH - 40, 30, 138, COLORS.canopyNear, "#6fd47f", 8);
    this.leafCluster(ctx, BAKE_WIDTH - 220, -26, 100, COLORS.canopyNear, "#6fd47f", 6);
    this.leafCluster(ctx, 90, VIEW_HEIGHT + 20, 118, "#2f6b3d", "#458a4f", 6);
    this.leafCluster(ctx, BAKE_WIDTH - 100, VIEW_HEIGHT + 26, 124, "#2f6b3d", "#458a4f", 6);

    // Vignette, so the eye is pushed back to the centre.
    const v = ctx.createRadialGradient(
      BAKE_WIDTH / 2,
      VIEW_HEIGHT / 2,
      VIEW_HEIGHT * 0.42,
      BAKE_WIDTH / 2,
      VIEW_HEIGHT / 2,
      VIEW_HEIGHT * 0.95,
    );
    v.addColorStop(0, "rgba(0, 0, 0, 0)");
    v.addColorStop(1, "rgba(2, 10, 6, 0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, BAKE_WIDTH, VIEW_HEIGHT);

    return canvas;
  }

  /**
   * A blob of overlapping leaf lobes with a lit top. Building foliage from stacked
   * ellipses (rather than one shape) is what gives it volume instead of a sticker edge.
   */
  private leafCluster(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    base: string,
    light: string,
    lobes: number,
  ): void {
    // Shaded body.
    ctx.fillStyle = base;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + cx * 0.01;
      const d = radius * 0.5;
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(a) * d,
        cy + Math.sin(a) * d * 0.62,
        radius * 0.62,
        radius * 0.44,
        a * 0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // Top-left highlight: the single light source landing on the upper lobes.
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < Math.max(2, lobes - 3); i++) {
      const a = Math.PI + (i / lobes) * Math.PI * 1.1;
      const d = radius * 0.46;
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(a) * d,
        cy + Math.sin(a) * d * 0.62 - radius * 0.12,
        radius * 0.38,
        radius * 0.24,
        a * 0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
