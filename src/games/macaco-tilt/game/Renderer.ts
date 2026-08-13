import {
  COLORS,
  MONKEY_FOOT_HALF,
  PIVOT_X,
  PIVOT_Y,
  PLANK_THICKNESS,
  STRESS_CRACK_MIN,
  VIEW_WIDTH,
  WEDGE_HALF_BASE,
  WEDGE_HEIGHT,
} from "./constants";
import { Jungle } from "./Jungle";
import type { Monkey, MonkeyState } from "./Monkey";
import type { Particles } from "./Particles";
import type { Plank } from "./Plank";
import type { Wind } from "./Wind";

/**
 * Every pixel of the game, in view units.
 *
 * The order is strict and follows the DESIGN.md hierarchy: world (baked jungle), then
 * the fulcrum, the plank, the stability readout, the monkey, and finally particles on
 * top. Nothing here uses `shadowBlur` — glow is done with radial gradients, which is
 * roughly free next to a per-frame gaussian.
 */
export class Renderer {
  private readonly jungle = new Jungle();

  update(dt: number): void {
    this.jungle.update(dt);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    plank: Plank,
    monkey: Monkey,
    particles: Particles,
    wind: Wind,
  ): void {
    this.jungle.draw(ctx, plank.angle);
    this.drawLedge(ctx);
    this.drawWedge(ctx);

    ctx.save();
    ctx.translate(PIVOT_X, PIVOT_Y);
    ctx.rotate(plank.angle);
    this.drawPlank(ctx, plank);
    if (monkey.state !== "fall") {
      ctx.save();
      ctx.translate(monkey.pos, -PLANK_THICKNESS / 2);
      this.drawMonkey(ctx, monkey.state, monkey.phase, monkey.facing);
      ctx.restore();
    }
    ctx.restore();

    // The falling monkey lives in world space, not on the plank.
    if (monkey.state === "fall") {
      ctx.save();
      ctx.translate(monkey.fallX, monkey.fallY);
      ctx.rotate(monkey.fallRot);
      this.drawMonkey(ctx, "fall", monkey.phase, monkey.facing);
      ctx.restore();
    }

    this.drawParticles(ctx, particles);
    if (wind.active) this.drawWindWarning(ctx, wind);
  }

  // --- Fulcrum ------------------------------------------------------------

  /**
   * The rock the fulcrum stands on.
   *
   * Deliberately drawn here in **world space** and not baked into `Jungle`'s mid layer:
   * that layer sways against the plank's tilt, which would slide the rock out from
   * under the wedge exactly when the tilt is most dramatic. Kept dark so it reads as
   * the rim of the chasm and never competes with the plank for attention.
   */
  private drawLedge(ctx: CanvasRenderingContext2D): void {
    const cx = PIVOT_X;
    const top = PIVOT_Y + WEDGE_HEIGHT - 4;

    const g = ctx.createLinearGradient(cx, top, cx, top + 130);
    g.addColorStop(0, "#2b3a2c");
    g.addColorStop(0.4, "#1b2620");
    g.addColorStop(1, "#0b120e");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - 186, top);
    ctx.lineTo(cx + 186, top);
    ctx.lineTo(cx + 158, top + 74);
    ctx.lineTo(cx + 96, top + 130);
    ctx.lineTo(cx - 88, top + 124);
    ctx.lineTo(cx - 154, top + 66);
    ctx.closePath();
    ctx.fill();

    // Thin lit lip along the top — the one place the key light reaches.
    ctx.fillStyle = "rgba(180, 205, 165, 0.16)";
    ctx.fillRect(cx - 186, top, 372, 7);

    // Moss creeping over the edge, dark enough to stay in the background.
    ctx.fillStyle = "rgba(45, 107, 63, 0.55)";
    for (let i = 0; i < 10; i++) {
      const x = cx - 166 + i * 37;
      ctx.beginPath();
      ctx.ellipse(x, top + 5, 19 + (i % 3) * 6, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawWedge(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createLinearGradient(PIVOT_X - WEDGE_HALF_BASE, 0, PIVOT_X + WEDGE_HALF_BASE, 0);
    g.addColorStop(0, "#7a5230");
    g.addColorStop(0.32, "#a06d3d");
    g.addColorStop(1, "#4d3018");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(PIVOT_X, PIVOT_Y - 6);
    ctx.lineTo(PIVOT_X + WEDGE_HALF_BASE, PIVOT_Y + WEDGE_HEIGHT);
    ctx.lineTo(PIVOT_X - WEDGE_HALF_BASE, PIVOT_Y + WEDGE_HEIGHT);
    ctx.closePath();
    ctx.fill();

    // Lit left face, per the single light source.
    ctx.fillStyle = "rgba(244, 208, 63, 0.16)";
    ctx.beginPath();
    ctx.moveTo(PIVOT_X, PIVOT_Y - 6);
    ctx.lineTo(PIVOT_X - WEDGE_HALF_BASE, PIVOT_Y + WEDGE_HEIGHT);
    ctx.lineTo(PIVOT_X - WEDGE_HALF_BASE * 0.45, PIVOT_Y + WEDGE_HEIGHT);
    ctx.closePath();
    ctx.fill();

    // Lashing where the wedge was bound together.
    ctx.strokeStyle = "#3a2a14";
    ctx.lineWidth = 4;
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      const y = PIVOT_Y - 6 + (WEDGE_HEIGHT + 6) * t;
      const half = WEDGE_HALF_BASE * t;
      ctx.beginPath();
      ctx.moveTo(PIVOT_X - half, y);
      ctx.lineTo(PIVOT_X + half, y);
      ctx.stroke();
    }
  }

  // --- Plank --------------------------------------------------------------

  private drawPlank(ctx: CanvasRenderingContext2D, plank: Plank): void {
    const half = PLANK_THICKNESS / 2;
    const l = -plank.halfLeft;
    const r = plank.halfRight;

    // Body, with the jagged snapped ends drawn as part of the path.
    ctx.beginPath();
    ctx.moveTo(l, -half);
    ctx.lineTo(r, -half);
    this.jaggedEnd(ctx, r, half, 1);
    ctx.lineTo(l, half);
    this.jaggedEnd(ctx, l, half, -1);
    ctx.closePath();

    const g = ctx.createLinearGradient(0, -half, 0, half);
    g.addColorStop(0, "#e0a45c");
    g.addColorStop(0.28, COLORS.woodLight);
    g.addColorStop(0.75, COLORS.woodDark);
    g.addColorStop(1, COLORS.woodShadow);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // Lengthwise grain.
    ctx.strokeStyle = "rgba(94, 58, 26, 0.32)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const y = -half + 5 + i * 5.5;
      ctx.beginPath();
      ctx.moveTo(l, y);
      for (let x = l; x <= r; x += 40) {
        ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 1.2);
      }
      ctx.stroke();
    }

    // Bamboo nodes: rings every 64px, measured from the pivot so they stay put as the
    // ends break away.
    ctx.strokeStyle = "rgba(70, 44, 18, 0.55)";
    ctx.lineWidth = 3;
    const first = Math.ceil(l / 64) * 64;
    for (let x = first; x <= r; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, -half);
      ctx.lineTo(x, half);
      ctx.stroke();
      ctx.fillStyle = "rgba(224, 164, 92, 0.45)";
      ctx.fillRect(x + 2, -half, 3, PLANK_THICKNESS);
    }

    // Specular band along the top edge — the light source landing on a cylinder.
    const spec = ctx.createLinearGradient(0, -half, 0, -half + 7);
    spec.addColorStop(0, "rgba(255, 233, 180, 0.55)");
    spec.addColorStop(1, "rgba(255, 233, 180, 0)");
    ctx.fillStyle = spec;
    ctx.fillRect(l, -half, r - l, 7);

    this.drawCracks(ctx, plank, half);

    ctx.restore();
  }

  /**
   * Fatigue cracks where the monkey has been standing. Drawn inside the plank clip so
   * they can never bleed past a broken end.
   *
   * This is the only warning the player gets before the plank snaps under them, so it
   * has to be readable at a glance: the crack widens, darkens and grows a hot char
   * edge as the segment approaches failure.
   */
  private drawCracks(ctx: CanvasRenderingContext2D, plank: Plank, half: number): void {
    const segments = plank.segments;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (s < STRESS_CRACK_MIN) continue;
      const x = plank.segmentCentre(i);
      const t = (s - STRESS_CRACK_MIN) / (1 - STRESS_CRACK_MIN);

      // Charred halo spreading around the failing segment. Deliberately wider than the
      // monkey's stance (~40px) so it fringes out either side of the feet — the crack
      // grows exactly where the monkey is standing, so the monkey would otherwise hide
      // the only warning the player gets.
      ctx.globalAlpha = 0.25 + t * 0.5;
      const scorch = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
      scorch.addColorStop(0, "rgba(40, 20, 8, 0)");
      scorch.addColorStop(0.5, "rgba(40, 20, 8, 0.85)");
      scorch.addColorStop(1, "rgba(40, 20, 8, 0)");
      ctx.fillStyle = scorch;
      ctx.fillRect(x - 30, -half, 60, half * 2);

      // The split itself: a jagged line across the bar, widening with fatigue.
      ctx.globalAlpha = 0.55 + t * 0.45;
      ctx.strokeStyle = "#1d0f05";
      ctx.lineWidth = 1.4 + t * 3.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, -half);
      const wiggle = 3 + t * 4;
      ctx.lineTo(x + wiggle, -half + half * 0.7);
      ctx.lineTo(x - wiggle * 0.7, half * 0.2);
      ctx.lineTo(x + wiggle * 0.4, half);
      ctx.stroke();

      // Splitting fibres at the very end — the "it is about to go" tell.
      if (t > 0.6) {
        ctx.globalAlpha = (t - 0.6) / 0.4;
        ctx.strokeStyle = "#e8a45c";
        ctx.lineWidth = 1.2;
        for (let k = -1; k <= 1; k += 2) {
          ctx.beginPath();
          ctx.moveTo(x + k * 2, -half + 4);
          ctx.lineTo(x + k * 9, half - 4);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Draws the splintered profile of a broken end (from top edge to bottom edge). */
  private jaggedEnd(ctx: CanvasRenderingContext2D, x: number, half: number, dir: -1 | 1): void {
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const poke = i % 2 === 0 ? 7 : -3;
      ctx.lineTo(x + dir * poke, -half + PLANK_THICKNESS * t);
    }
  }

  // --- Monkey -------------------------------------------------------------

  /**
   * The monkey, drawn with its feet at the origin and standing up in -y.
   *
   * Built from stacked shaded masses rather than outlined flats (DESIGN.md), and posed
   * entirely from `state` + `phase`, so swapping in a spritesheet later means replacing
   * this one method without touching the physics.
   */
  private drawMonkey(
    ctx: CanvasRenderingContext2D,
    state: MonkeyState,
    phase: number,
    facing: -1 | 1,
  ): void {
    const panic = state === "panic" || state === "fall";
    // Arm rhythm: slow balancing sway when calm, frantic flailing in panic.
    const rate = panic ? 19 : state === "walk" ? 9 : 3.2;
    const swing = Math.sin(phase * rate);
    const bob = panic ? Math.abs(swing) * 2.5 : Math.sin(phase * rate * 0.5) * 1.6;

    ctx.save();
    ctx.translate(0, -bob);

    this.drawTail(ctx, phase, facing, panic);

    // Legs: planted apart, knees slightly bent. They stay still — the arms do the acting.
    const legSpread = state === "walk" ? 11 : 8;
    for (const side of [-1, 1] as const) {
      const lift = state === "walk" && side === facing ? Math.max(0, swing) * 5 : 0;
      ctx.fillStyle = COLORS.furDark;
      ctx.beginPath();
      ctx.ellipse(side * legSpread, -12 - lift, 7.5, 14, side * 0.12, 0, Math.PI * 2);
      ctx.fill();
      // Foot.
      ctx.fillStyle = COLORS.skin;
      ctx.beginPath();
      ctx.ellipse(side * (legSpread + 2), -3 - lift, MONKEY_FOOT_HALF * 0.55, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Torso: a shaded mass, light from the upper left.
    const body = ctx.createRadialGradient(-7, -44, 3, 0, -36, 30);
    body.addColorStop(0, COLORS.furLight);
    body.addColorStop(0.55, COLORS.fur);
    body.addColorStop(1, COLORS.furDark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, -34, 19, 25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly patch.
    ctx.fillStyle = "rgba(240, 201, 155, 0.75)";
    ctx.beginPath();
    ctx.ellipse(0, -29, 11.5, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawArms(ctx, state, swing, panic);
    this.drawHead(ctx, state, phase, facing, swing);

    ctx.restore();
  }

  private drawTail(
    ctx: CanvasRenderingContext2D,
    phase: number,
    facing: -1 | 1,
    panic: boolean,
  ): void {
    const wag = Math.sin(phase * (panic ? 12 : 2.4)) * (panic ? 16 : 7);
    ctx.strokeStyle = COLORS.furDark;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-facing * 12, -26);
    ctx.quadraticCurveTo(-facing * 42, -34 + wag, -facing * 34, -62 + wag);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.fur;
    ctx.stroke();
  }

  private drawArms(
    ctx: CanvasRenderingContext2D,
    state: MonkeyState,
    swing: number,
    panic: boolean,
  ): void {
    for (const side of [-1, 1] as const) {
      // Balancing pose: arms out sideways, gently pumping in opposition.
      // Panic pose: arms thrown up and shaking fast.
      let lift: number;
      if (panic) lift = 1.15 + swing * side * 0.4;
      else if (state === "walk") lift = 0.55 + swing * side * 0.35;
      else lift = 0.75 + swing * side * 0.45;

      const sx = side * 15;
      const sy = -46;
      const hx = sx + side * Math.cos(lift) * 26;
      const hy = sy - Math.sin(lift) * 26;

      ctx.strokeStyle = COLORS.fur;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + side * 16, sy - Math.sin(lift) * 8, hx, hy);
      ctx.stroke();

      // Rim light on the upper edge of the arm.
      ctx.strokeStyle = "rgba(224, 174, 110, 0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 2.5);
      ctx.quadraticCurveTo(sx + side * 16, sy - Math.sin(lift) * 8 - 2.5, hx, hy - 2);
      ctx.stroke();

      // Hand.
      ctx.fillStyle = COLORS.skin;
      ctx.beginPath();
      ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHead(
    ctx: CanvasRenderingContext2D,
    state: MonkeyState,
    phase: number,
    facing: -1 | 1,
    swing: number,
  ): void {
    const panic = state === "panic" || state === "fall";
    // In panic the head shakes; otherwise it tilts gently with the balancing rhythm.
    const shake = panic ? Math.sin(phase * 34) * 1.8 : 0;
    const cy = -72;

    ctx.save();
    ctx.translate(shake, cy);

    // Ears behind the skull.
    ctx.fillStyle = COLORS.furDark;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.arc(side * 19, 1, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.skin;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.arc(side * 19, 1, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Skull.
    const skull = ctx.createRadialGradient(-6, -7, 2, 0, 0, 24);
    skull.addColorStop(0, COLORS.furLight);
    skull.addColorStop(0.6, COLORS.fur);
    skull.addColorStop(1, COLORS.furDark);
    ctx.fillStyle = skull;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();

    // Muzzle / face mask — the lighter field the features sit on.
    ctx.fillStyle = COLORS.skin;
    ctx.beginPath();
    ctx.ellipse(0, 3, 15, 13.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(200, 150, 100, 0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawFace(ctx, state, facing, swing, phase);

    ctx.restore();
  }

  /**
   * Four complete face sets, not one face with variations — same approach as the
   * reaction faces in Bomba Palabra. The face is the loudest signal the game has, so
   * each state gets its own eyes, brows and mouth.
   */
  private drawFace(
    ctx: CanvasRenderingContext2D,
    state: MonkeyState,
    facing: -1 | 1,
    swing: number,
    phase: number,
  ): void {
    const ex = 6.5;
    const ey = -1;

    if (state === "fall") {
      // Screaming: huge whites, pinprick pupils, gaping mouth.
      for (const side of [-1, 1] as const) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(side * ex, ey, 5.6, 6.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1a1008";
        ctx.beginPath();
        ctx.arc(side * ex, ey + 0.5, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      this.brows(ctx, ex, -9.5, 0.55, -0.55);
      ctx.fillStyle = "#3a1512";
      ctx.beginPath();
      ctx.ellipse(0, 9, 6.2, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d9576a";
      ctx.beginPath();
      ctx.ellipse(0, 12.5, 3.4, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (state === "panic") {
      // Wide-eyed terror, brows up, mouth open with teeth. Trembles with the head.
      const wobble = Math.sin(phase * 28) * 0.6;
      for (const side of [-1, 1] as const) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(side * ex, ey, 5.2, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1a1008";
        ctx.beginPath();
        ctx.arc(side * ex + wobble, ey + 1, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(side * ex + wobble - 0.8, ey - 0.3, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      this.brows(ctx, ex, -9, 0.42, -0.42);
      ctx.fillStyle = "#3a1512";
      ctx.beginPath();
      ctx.ellipse(0, 9.5, 6.8, 5.4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Upper teeth — the grimace that sells the panic.
      ctx.fillStyle = "#fff6e0";
      ctx.fillRect(-4.6, 5.2, 9.2, 2.6);
      return;
    }

    // Calm and walking share the same eyes; walking looks where it is going and
    // flattens the mouth into concentration.
    const look = state === "walk" ? facing * 1.6 : Math.sin(swing) * 0.7;
    for (const side of [-1, 1] as const) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(side * ex, ey, 4.4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1008";
      ctx.beginPath();
      ctx.arc(side * ex + look, ey + 0.6, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(side * ex + look - 1, ey - 0.8, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state === "walk") {
      this.brows(ctx, ex, -7.5, -0.18, 0.18);
      ctx.strokeStyle = "#5b3418";
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-3.5, 9);
      ctx.lineTo(3.5, 9);
      ctx.stroke();
      return;
    }

    this.brows(ctx, ex, -7.8, 0.1, -0.1);
    ctx.strokeStyle = "#5b3418";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-4, 8);
    ctx.quadraticCurveTo(0, 11.5, 4, 8);
    ctx.stroke();
  }

  private brows(
    ctx: CanvasRenderingContext2D,
    ex: number,
    y: number,
    tiltL: number,
    tiltR: number,
  ): void {
    ctx.strokeStyle = "#4a2a12";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    for (const [side, tilt] of [
      [-1, tiltL],
      [1, tiltR],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(side * ex - 4, y + tilt * 4);
      ctx.lineTo(side * ex + 4, y - tilt * 4);
      ctx.stroke();
    }
  }

  // --- Particles and wind -------------------------------------------------

  private drawParticles(ctx: CanvasRenderingContext2D, particles: Particles): void {
    for (const p of particles.all) {
      const alpha = Math.min(1, p.life / (p.maxLife * 0.4));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

      if (p.kind === "sweat") {
        // Teardrop: a circle with a point pulled back along its travel.
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 1.7);
        ctx.quadraticCurveTo(p.size, 0, 0, p.size);
        ctx.quadraticCurveTo(-p.size, 0, 0, -p.size * 1.7);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.arc(-p.size * 0.3, -p.size * 0.2, p.size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "splinter") {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -2, p.size, 4);
        ctx.fillStyle = "rgba(255, 233, 180, 0.4)";
        ctx.fillRect(-p.size / 2, -2, p.size, 1.2);
      } else {
        // Leaf: a pointed ellipse with a midrib.
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(20, 50, 28, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-p.size, 0);
        ctx.lineTo(p.size, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** The banner that telegraphs an incoming gust and which way it will push. */
  private drawWindWarning(ctx: CanvasRenderingContext2D, wind: Wind): void {
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.012);
    const alpha = wind.intensity * pulse;
    const y = 92;
    const cx = VIEW_WIDTH / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = "rgba(10, 30, 18, 0.55)";
    ctx.beginPath();
    ctx.roundRect(cx - 118, y - 24, 236, 44, 22);
    ctx.fill();

    ctx.fillStyle = COLORS.light;
    ctx.font = "700 20px Verdana, Geneva, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("VIENTO", cx, y - 1);

    // Chevrons pointing where the gust is headed.
    ctx.strokeStyle = COLORS.light;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < 3; i++) {
      const ox = cx + wind.dir * (66 + i * 17);
      ctx.globalAlpha = alpha * (1 - i * 0.22);
      ctx.beginPath();
      ctx.moveTo(ox - wind.dir * 7, y - 10);
      ctx.lineTo(ox + wind.dir * 6, y - 1);
      ctx.lineTo(ox - wind.dir * 7, y + 8);
      ctx.stroke();
    }

    ctx.restore();
  }
}
