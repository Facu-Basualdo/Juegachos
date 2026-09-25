import {
  C_BLUE,
  C_GRID,
  C_GRID_STRONG,
  C_INK,
  C_INK_WASH,
  C_MARGIN,
  C_MARGIN_SOFT,
  C_PAPER,
  C_PENCIL,
  FIELD_BOT,
  FIELD_TOP,
  PX_PER_CM,
  VIEW_H,
  VIEW_W,
  mulberry32,
} from "./constants";
import type { Bar, Blot, Course } from "./Course";
import type { Trail } from "./Trail";

const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const GRID = 24;

/** Una birome en pantalla: su trazo y donde esta la punta ahora. */
export interface PenView {
  trail: Trail;
  headX: number;
  headY: number;
  color: string;
  self: boolean;
  dead: boolean;
  name: string;
  score: number;
}

/** Mancha que deja una birome al chocar. */
export interface Splat {
  x: number;
  y: number;
  color: string;
  seed: number;
  age: number;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  life: number;
}

/** Dibuja la hoja; no guarda estado de juego salvo las gotas decorativas. */
export class Renderer {
  private readonly drops: Drop[] = [];
  /** La vista esta girada 90 grados (celular parado): los textos se enderezan. */
  private upright = false;

  burst(x: number, y: number, color: string): void {
    const rand = Math.random;
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2;
      const s = 80 + rand() * 260;
      this.drops.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        r: 1.2 + rand() * 3.2,
        color,
        life: 0.35 + rand() * 0.35,
      });
    }
  }

  clearDrops(): void {
    this.drops.length = 0;
  }

  update(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 1 - 5 * dt;
      d.vy *= 1 - 5 * dt;
      if (d.life <= 0) this.drops.splice(i, 1);
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    camX: number,
    course: Course,
    pens: PenView[],
    splats: Splat[],
    showNames: boolean,
    rotated: boolean,
  ): void {
    this.upright = rotated;
    this.drawPaper(ctx, camX);
    this.drawObstacles(ctx, camX, course);

    // Rivales primero y translucidos: la tinta propia manda.
    for (const p of pens) if (!p.self) this.drawTrail(ctx, camX, p, 0.55, 2.4);
    for (const s of splats) this.drawSplat(ctx, camX, s);
    for (const p of pens) if (p.self) this.drawTrail(ctx, camX, p, 1, 3.2);

    ctx.save();
    ctx.translate(-camX, 0);
    for (const d of this.drops) {
      ctx.globalAlpha = Math.min(1, d.life * 3);
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (const p of pens) {
      if (p.dead) continue;
      if (p.self) this.drawBirome(ctx, p.headX - camX, p.headY, p.trail.holdAt(p.headX));
      else this.drawRivalHead(ctx, camX, p, showNames);
    }
  }

  // ------------------------------------------------------------------ papel

  private drawPaper(ctx: CanvasRenderingContext2D, camX: number): void {
    ctx.fillStyle = C_PAPER;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Cuadriculado que se desliza con la camara.
    const off = -(((camX % GRID) + GRID) % GRID);
    ctx.lineWidth = 1;
    ctx.strokeStyle = C_GRID;
    ctx.beginPath();
    for (let x = off; x <= VIEW_W; x += GRID) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, VIEW_H);
    }
    for (let y = FIELD_TOP % GRID; y <= VIEW_H; y += GRID) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(VIEW_W, y + 0.5);
    }
    ctx.stroke();

    // Afuera de los margenes: un velo rojo apenas, para que se lea "no pasar".
    ctx.fillStyle = C_MARGIN_SOFT;
    ctx.fillRect(0, 0, VIEW_W, FIELD_TOP);
    ctx.fillRect(0, FIELD_BOT, VIEW_W, VIEW_H - FIELD_BOT);

    // Margenes dobles, como en el cuaderno.
    ctx.strokeStyle = C_MARGIN;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FIELD_TOP);
    ctx.lineTo(VIEW_W, FIELD_TOP);
    ctx.moveTo(0, FIELD_BOT);
    ctx.lineTo(VIEW_W, FIELD_BOT);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, FIELD_TOP - 5);
    ctx.lineTo(VIEW_W, FIELD_TOP - 5);
    ctx.moveTo(0, FIELD_BOT + 5);
    ctx.lineTo(VIEW_W, FIELD_BOT + 5);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Regla al pie: una marca cada 10 cm, con el numero.
    const step = PX_PER_CM * 10;
    const first = Math.ceil((camX - 20) / step) * step;
    ctx.strokeStyle = C_GRID_STRONG;
    ctx.fillStyle = C_PENCIL;
    ctx.font = `13px ${HAND}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.globalAlpha = 0.55;
    for (let x = first; x < camX + VIEW_W + 20; x += step) {
      const sx = x - camX;
      ctx.beginPath();
      ctx.moveTo(sx, FIELD_BOT + 8);
      ctx.lineTo(sx, FIELD_BOT + 16);
      ctx.stroke();
      if (x > 0) this.label(ctx, `${Math.round(x / PX_PER_CM)}`, sx, FIELD_BOT + 16);
    }
    // Linea de largada.
    if (camX < 40) {
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = C_PENCIL;
      ctx.beginPath();
      ctx.moveTo(-camX, FIELD_TOP + 6);
      ctx.lineTo(-camX, FIELD_BOT - 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- obstaculos

  private drawObstacles(ctx: CanvasRenderingContext2D, camX: number, course: Course): void {
    const obs = course.obstacles;
    const right = camX + VIEW_W;
    for (let i = course.firstFrom(camX); i < obs.length; i++) {
      const o = obs[i];
      if (o.left > right) break;
      if (o.right < camX) continue;
      if (o.kind === "bar") this.drawBar(ctx, o, camX);
      else this.drawBlot(ctx, o, camX);
    }
  }

  /** Tachon: rectangulo rayado a mano en dos pasadas cruzadas, con borde temblado. */
  private drawBar(ctx: CanvasRenderingContext2D, b: Bar, camX: number): void {
    const x = b.left - camX;
    const w = b.right - b.left;
    const y = b.y;
    const h = b.h;
    const rand = mulberry32(b.seed);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = C_INK_WASH;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = C_INK;
    ctx.lineCap = "round";
    // Primera pasada: rayas a 45 grados, apretadas.
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let d = -h; d < w + 6; d += 5 + rand() * 1.5) {
      ctx.moveTo(x + d, y + h + 2);
      ctx.lineTo(x + d + h + rand() * 3, y - 2);
    }
    ctx.stroke();
    // Segunda pasada: cruzada y mas suelta.
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let d = -h; d < w + 6; d += 8 + rand() * 3) {
      ctx.moveTo(x + d, y - 2);
      ctx.lineTo(x + d + h + rand() * 4, y + h + 2);
    }
    ctx.stroke();
    ctx.restore();

    // Contorno temblado (solo los lados que no tocan el margen).
    ctx.strokeStyle = C_INK;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    const j = () => (rand() - 0.5) * 2.2;
    const top = y <= FIELD_TOP ? y - 1 : y;
    const bot = y + h >= FIELD_BOT ? y + h + 1 : y + h;
    ctx.moveTo(x + j(), top);
    ctx.lineTo(x + j(), bot);
    ctx.moveTo(x + w + j(), top);
    ctx.lineTo(x + w + j(), bot);
    if (y > FIELD_TOP) {
      ctx.moveTo(x, y + j());
      ctx.lineTo(x + w, y + j());
    }
    if (y + h < FIELD_BOT) {
      ctx.moveTo(x, y + h + j());
      ctx.lineTo(x + w, y + h + j());
    }
    ctx.stroke();
  }

  /** Manchon: contorno irregular suave, aureola de papel embebido y brillo humedo. */
  private drawBlot(ctx: CanvasRenderingContext2D, b: Blot, camX: number): void {
    const cx = b.x - camX;
    ctx.fillStyle = C_INK_WASH;
    this.blobPath(ctx, cx, b.y, b.r * 1.14, b.edge);
    ctx.fill();
    ctx.fillStyle = C_INK;
    ctx.globalAlpha = 0.93;
    this.blobPath(ctx, cx, b.y, b.r, b.edge);
    ctx.fill();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(cx - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.32, b.r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private blobPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, edge: number[]): void {
    const n = edge.length;
    const pt = (i: number): [number, number] => {
      const a = (i / n) * Math.PI * 2;
      const rr = r * edge[i % n];
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    };
    ctx.beginPath();
    const [x0, y0] = pt(0);
    const [x1, y1] = pt(1);
    ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
    for (let i = 1; i <= n; i++) {
      const [ax, ay] = pt(i);
      const [bx, by] = pt(i + 1);
      ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    ctx.closePath();
  }

  /** fillText que se lee derecho aunque la vista este girada. */
  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    if (!this.upright) {
      ctx.fillText(text, x, y);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // ----------------------------------------------------------------- trazos

  private drawTrail(ctx: CanvasRenderingContext2D, camX: number, p: PenView, alpha: number, width: number): void {
    const t = p.trail;
    if (t.length === 0) return;
    const start = Math.max(0, t.indexAt(camX - 20));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    const sx = Math.max(t.xs[start], camX - 20);
    ctx.moveTo(sx - camX, t.yAt(sx));
    for (let i = start + 1; i < t.length && t.xs[i] <= p.headX; i++) {
      ctx.lineTo(t.xs[i] - camX, t.ys[i]);
    }
    ctx.lineTo(p.headX - camX, p.headY);
    ctx.stroke();
    ctx.restore();
  }

  private drawSplat(ctx: CanvasRenderingContext2D, camX: number, s: Splat): void {
    const x = s.x - camX;
    if (x < -80 || x > VIEW_W + 80) return;
    const grow = Math.min(1, s.age / 0.18);
    const rand = mulberry32(s.seed);
    const edge: number[] = [];
    for (let i = 0; i < 16; i++) edge.push(0.7 + rand() * 0.6);
    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.9;
    this.blobPath(ctx, x, s.y, 16 * grow, edge);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const d = (20 + rand() * 18) * grow;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, s.y + Math.sin(a) * d, 1.5 + rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ puntas

  /** La birome propia: cuerpo transparente hexagonal, tubito de tinta y tapon. */
  private drawBirome(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean): void {
    const angle = -Math.PI / 3 + (up ? -0.07 : 0.07);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Sombra suave sobre el papel.
    ctx.fillStyle = "rgba(43, 43, 51, 0.12)";
    ctx.beginPath();
    ctx.moveTo(4, 6);
    ctx.lineTo(118, 12);
    ctx.lineTo(118, 22);
    ctx.lineTo(14, 10);
    ctx.fill();

    // Cono de metal y bolita.
    ctx.fillStyle = "#b9bcc4";
    ctx.strokeStyle = C_PENCIL;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(14, -3.2);
    ctx.lineTo(14, 3.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C_BLUE;
    ctx.beginPath();
    ctx.arc(1.5, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Cuerpo: plastico transparente con la cara del hexagono.
    ctx.fillStyle = "rgba(236, 241, 247, 0.92)";
    ctx.beginPath();
    ctx.moveTo(14, -5.5);
    ctx.lineTo(112, -6);
    ctx.lineTo(112, 6);
    ctx.lineTo(14, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(43, 43, 51, 0.25)";
    ctx.beginPath();
    ctx.moveTo(16, -2);
    ctx.lineTo(110, -2);
    ctx.stroke();

    // Tubito de tinta azul adentro.
    ctx.fillStyle = C_BLUE;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(16, 0, 90, 2.2);
    ctx.globalAlpha = 1;

    // Tapon del fondo.
    ctx.fillStyle = C_BLUE;
    ctx.strokeStyle = C_PENCIL;
    ctx.beginPath();
    ctx.moveTo(112, -5);
    ctx.lineTo(122, -4);
    ctx.lineTo(122, 4);
    ctx.lineTo(112, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Rival: punta chica de su color, nombre y cm a mano. Si esta fuera de cuadro, un cartelito al borde. */
  private drawRivalHead(ctx: CanvasRenderingContext2D, camX: number, p: PenView, showNames: boolean): void {
    const sx = p.headX - camX;
    ctx.font = `13px ${HAND}`;
    ctx.textBaseline = "middle";
    if (sx < 6 || sx > VIEW_W - 6) {
      const ahead = sx > VIEW_W - 6;
      const label = ahead ? `${p.name} ${p.score} >` : `< ${p.name} ${p.score}`;
      const y = Math.max(FIELD_TOP + 12, Math.min(FIELD_BOT - 12, p.headY));
      ctx.textAlign = ahead ? "right" : "left";
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = p.color;
      this.label(ctx, label, ahead ? VIEW_W - 8 : 8, y);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = p.color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(sx, p.headY, 3.6, 0, Math.PI * 2);
    ctx.fill();
    if (showNames) {
      ctx.textAlign = "left";
      this.label(ctx, `${p.name} · ${p.score}`, sx + 8, p.headY - 12);
    }
    ctx.globalAlpha = 1;
  }
}
