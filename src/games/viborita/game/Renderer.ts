import type { VbClientConfig } from "./ViboritaProtocol";
import { pelletRadiusOf } from "./motion";

/**
 * Render de Viborita en canvas 2D. Toda decision visual responde a DESIGN.md ("La
 * Landing"): la arena es una tarjeta crema sobre el fondo caqui del sitio, todo lleva
 * borde de tinta grueso, los colores son planos y la profundidad es la sombra dura
 * corrida hacia abajo de las tarjetas de la landing, no luz ni brillo.
 */

export interface Camera {
  /** Centro de la vista, en unidades de mundo. */
  x: number;
  y: number;
  /** Alto del mundo visible. */
  viewH: number;
}

export interface PelletView {
  x: number;
  y: number;
  color: number;
  mass: number;
}

export interface SnakeView {
  sid: number;
  /** Cuerpo, x/y planos de la cabeza a la cola. */
  points: number[];
  r: number;
  /** Angulo de la cabeza (para los ojos). */
  a: number;
  color: number;
  name: string;
  boosting: boolean;
  mine: boolean;
}

const BG = "#d6d3bd";
const CARD = "#efeee6";
const INK = "#111111";
const ACCENT = "#00f0ff";

/** Colores de las viboritas y de la comida (DESIGN.md). El server manda el indice. */
const COLORS = [
  "#00e5ff", "#ff4fa3", "#ffd23f", "#3ce88f", "#ff8a3d", "#9b6bff",
  "#3d7bff", "#ff4d4d", "#c6f432", "#1fd1b5", "#c4a3ff", "#ff6f61",
];
/** El mismo color mezclado con blanco: las rayas del lomo. */
const STRIPES = COLORS.map((c) => mix(c, "#ffffff", 0.45));

export class Renderer {
  private cfg: VbClientConfig | null = null;

  setConfig(cfg: VbClientConfig): void {
    this.cfg = cfg;
  }

  static color(index: number): string {
    return COLORS[index % COLORS.length];
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
    cam: Camera,
    pellets: Iterable<PelletView>,
    snakes: SnakeView[],
    time: number,
  ): void {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cssW, cssH);
    if (!this.cfg) return;

    const scale = cssH / cam.viewH;
    const w = cssW / scale;
    const h = cssH / scale;
    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    this.drawArena(ctx, cam, w, h, scale);
    this.drawPellets(ctx, cam, w, h, scale, pellets, time);
    // La propia arriba de todo: es la que el jugador tiene que leer siempre.
    const ordered = [...snakes].sort((a, b) => Number(a.mine) - Number(b.mine));
    for (const s of ordered) this.drawSnake(ctx, s, scale);
    for (const s of ordered) this.drawName(ctx, s, scale);
    ctx.restore();
  }

  /** La arena: una tarjeta redonda crema con borde de tinta y su sombra dura. */
  private drawArena(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, scale: number): void {
    const R = this.cfg!.mapRadius;
    ctx.fillStyle = "rgba(17,17,17,0.9)";
    ctx.beginPath();
    ctx.arc(R, R + 14 / scale, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CARD;
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.fill();

    // Puntos de cuaderno: dan la sensacion de velocidad sin competir con nada. Se
    // espacian al alejarse para que nunca queden mas densos que ~16 px.
    let step = 50;
    while (step * scale < 16) step *= 2;
    const dot = 1.6 / scale;
    const x0 = Math.ceil((cam.x - w / 2) / step) * step;
    const y0 = Math.ceil((cam.y - h / 2) / step) * step;
    ctx.fillStyle = "rgba(17,17,17,0.16)";
    ctx.beginPath();
    for (let x = x0; x <= cam.x + w / 2; x += step) {
      for (let y = y0; y <= cam.y + h / 2; y += step) {
        if ((x - R) ** 2 + (y - R) ** 2 > R * R) continue;
        ctx.moveTo(x + dot, y);
        ctx.arc(x, y, dot, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    ctx.strokeStyle = INK;
    ctx.lineWidth = 5 / scale;
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawPellets(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    scale: number,
    pellets: Iterable<PelletView>,
    time: number,
  ): void {
    const x0 = cam.x - w / 2 - 20;
    const x1 = cam.x + w / 2 + 20;
    const y0 = cam.y - h / 2 - 20;
    const y1 = cam.y + h / 2 + 20;
    const visible: PelletView[] = [];
    for (const p of pellets) if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) visible.push(p);
    const radius = (p: PelletView) => pelletRadiusOf(p.mass) * (1 + 0.1 * Math.sin(time * 3 + p.x * 0.07 + p.y * 0.05));

    // Contorno de tinta en una sola pasada, despues el relleno por color.
    ctx.fillStyle = INK;
    ctx.beginPath();
    const border = 1.6 / scale;
    for (const p of visible) {
      const r = radius(p) + border;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    for (let c = 0; c < COLORS.length; c++) {
      ctx.fillStyle = COLORS[c];
      ctx.beginPath();
      for (const p of visible) {
        if (p.color !== c) continue;
        const r = radius(p);
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  private drawSnake(ctx: CanvasRenderingContext2D, s: SnakeView, scale: number): void {
    if (s.points.length < 2) return;
    const color = COLORS[s.color % COLORS.length];
    const border = Math.max(2.5 / scale, s.r * 0.14);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Sombra dura corrida hacia abajo, como las tarjetas de la landing.
    const drop = Math.max(4 / scale, s.r * 0.35);
    ctx.save();
    ctx.translate(0, drop);
    this.tracePath(ctx, s.points);
    ctx.strokeStyle = "rgba(17,17,17,0.22)";
    ctx.lineWidth = s.r * 2 + border * 2;
    ctx.stroke();
    ctx.restore();

    this.tracePath(ctx, s.points);
    if (s.boosting) {
      // Turbo: el acento cian del sitio rodeando el contorno.
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = s.r * 2 + border * 2 + Math.max(10 / scale, s.r * 0.6);
      ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = s.r * 2 + border * 2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = s.r * 2;
    ctx.stroke();

    // Rayas del lomo, fijas respecto de la cabeza (como los segmentos de verdad).
    ctx.setLineDash([s.r * 0.9, s.r * 1.4]);
    ctx.lineDashOffset = -s.r * 1.2;
    ctx.strokeStyle = STRIPES[s.color % STRIPES.length];
    ctx.lineWidth = s.r * 1.1;
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "round";

    this.drawHead(ctx, s, color, border);
  }

  /** Curva suave por los puntos medios: con cuerdas sueltas se verian codos al doblar. */
  private tracePath(ctx: CanvasRenderingContext2D, p: number[]): void {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    const n = p.length / 2;
    for (let i = 1; i < n - 1; i++) {
      const mx = (p[i * 2] + p[i * 2 + 2]) / 2;
      const my = (p[i * 2 + 1] + p[i * 2 + 3]) / 2;
      ctx.quadraticCurveTo(p[i * 2], p[i * 2 + 1], mx, my);
    }
    ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  }

  private drawHead(ctx: CanvasRenderingContext2D, s: SnakeView, color: string, border: number): void {
    const hx = s.points[0];
    const hy = s.points[1];
    const r = s.r * 1.08;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = border;
    ctx.strokeStyle = INK;
    ctx.stroke();

    // Ojos: blancos con borde de tinta y la pupila mirando hacia donde va.
    const eyeR = s.r * 0.42;
    const pupilR = s.r * 0.22;
    for (const side of [-1, 1]) {
      const ea = s.a + side * 0.75;
      const ex = hx + Math.cos(ea) * s.r * 0.55;
      const ey = hy + Math.sin(ea) * s.r * 0.55;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = border * 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex + Math.cos(s.a) * eyeR * 0.4, ey + Math.sin(s.a) * eyeR * 0.4, pupilR, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
  }

  /** Nombre en Archivo, tinta con filete crema, arriba de la cabeza. */
  private drawName(ctx: CanvasRenderingContext2D, s: SnakeView, scale: number): void {
    if (!s.name || s.points.length < 2) return;
    const size = Math.max(13 / scale, s.r * 0.8);
    ctx.font = `800 ${size}px Archivo, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    ctx.lineWidth = size * 0.28;
    ctx.strokeStyle = CARD;
    const x = s.points[0];
    const y = s.points[1] - s.r * 1.3 - 4 / scale;
    ctx.strokeText(s.name, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(s.name, x, y);
  }
}

/** Mezcla dos colores #rrggbb (k = cuanto del segundo). */
function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * k));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
