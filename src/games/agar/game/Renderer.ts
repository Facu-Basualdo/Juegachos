import type { AgClientConfig } from "./AgarProtocol";

/**
 * Render de Agar en canvas 2D. Toda decision visual responde a DESIGN.md
 * ("Camara de Conteo"): gel iluminado desde abajo, celulas como membranas tenidas y
 * traslucidas, reticulo de camara de Neubauer, vineta del ocular.
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
}

export interface CellView {
  id: number;
  x: number;
  y: number;
  r: number;
  color: number;
  name: string;
  mine: boolean;
}

const GEL = "#efe3c2";
const TUBE = "#17130e";
const INK = "#2a2118";

/** Tintes de celula (DESIGN.md). El server manda el indice. */
const STAINS = [
  "#2b6cb0", "#c2456b", "#6b3fa0", "#b8432f", "#2f8a5b", "#b07a1e",
  "#c0392b", "#a3307e", "#2f7f8f", "#5b5fb5", "#9a5b2e", "#4f7a2a",
];
const PELLET_STAINS = ["#d9a441", "#d97a6c", "#8fb3d9", "#a7c97f", "#c79fd6", "#e0c070"];

/** Puntos del contorno ondulado (mas para las grandes, que se ven de cerca). */
function outlinePoints(screenR: number): number {
  return screenR < 20 ? 18 : screenR < 60 ? 32 : 56;
}

export class Renderer {
  private cfg: AgClientConfig | null = null;

  setConfig(cfg: AgClientConfig): void {
    this.cfg = cfg;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
    cam: Camera,
    pellets: ReadonlyMap<number, PelletView>,
    cells: CellView[],
    time: number,
  ): void {
    ctx.fillStyle = TUBE;
    ctx.fillRect(0, 0, cssW, cssH);
    if (!this.cfg) return;

    const scale = cssH / cam.viewH;
    const w = cssW / scale;
    const h = cssH / scale;
    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    this.drawSlide(ctx, cam, w, h, scale);
    this.drawPellets(ctx, cam, w, h, pellets);
    // Las chicas arriba de las grandes: una grande encima taparia lo que importa.
    const sorted = [...cells].sort((a, b) => b.r - a.r);
    for (const cell of sorted) this.drawCell(ctx, cell, scale, time);
    for (const cell of sorted) this.drawLabel(ctx, cell, scale);
    ctx.restore();

    this.drawEyepiece(ctx, cssW, cssH);
  }

  /** El portaobjetos: gel, reticulo y canto del vidrio. */
  private drawSlide(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, scale: number): void {
    const size = this.cfg!.mapSize;
    ctx.fillStyle = GEL;
    ctx.fillRect(0, 0, size, size);

    const x0 = Math.max(0, cam.x - w / 2);
    const x1 = Math.min(size, cam.x + w / 2);
    const y0 = Math.max(0, cam.y - h / 2);
    const y1 = Math.min(size, cam.y + h / 2);

    // Reticulo fino cada 50 (se apaga cuando queda mas denso que 6 px).
    if (50 * scale >= 6) this.gridLines(ctx, x0, x1, y0, y1, 50, 1 / scale, "rgba(42,33,24,0.07)");
    // Lineas triples cada 250, como el reticulo de una camara de Neubauer.
    const thin = 1 / scale;
    for (const off of [-3 / scale, 0, 3 / scale]) {
      this.gridLines(ctx, x0, x1, y0, y1, 250, thin, "rgba(42,33,24,0.13)", off);
    }

    // Canto del vidrio.
    ctx.strokeStyle = "rgba(42,33,24,0.55)";
    ctx.lineWidth = 4 / scale;
    ctx.strokeRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(42,33,24,0.18)";
    ctx.lineWidth = 14 / scale;
    ctx.strokeRect(-9 / scale, -9 / scale, size + 18 / scale, size + 18 / scale);
  }

  private gridLines(
    ctx: CanvasRenderingContext2D,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    step: number,
    width: number,
    color: string,
    off = 0,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      ctx.moveTo(x + off, y0);
      ctx.lineTo(x + off, y1);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      ctx.moveTo(x0, y + off);
      ctx.lineTo(x1, y + off);
    }
    ctx.stroke();
  }

  /** Colonias: un punto del tinte con un centro mas claro. Sin halo. */
  private drawPellets(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    pellets: ReadonlyMap<number, PelletView>,
  ): void {
    const r = this.cfg!.pelletRadius;
    const x0 = cam.x - w / 2 - r;
    const x1 = cam.x + w / 2 + r;
    const y0 = cam.y - h / 2 - r;
    const y1 = cam.y + h / 2 + r;
    for (let color = 0; color < PELLET_STAINS.length; color++) {
      ctx.fillStyle = PELLET_STAINS[color];
      ctx.beginPath();
      for (const p of pellets.values()) {
        if (p.color !== color || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,250,235,0.55)";
    ctx.beginPath();
    for (const p of pellets.values()) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      ctx.moveTo(p.x - r * 0.25 + r * 0.35, p.y - r * 0.3);
      ctx.arc(p.x - r * 0.25, p.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /** Membrana ondulada, relleno traslucido del tinte y nucleo en las grandes. */
  private drawCell(ctx: CanvasRenderingContext2D, cell: CellView, scale: number, time: number): void {
    const stain = STAINS[cell.color % STAINS.length];
    const screenR = cell.r * scale;
    const n = outlinePoints(screenR);
    // La ondulacion es chica (2.5% del radio) y lenta; la fase sale del id para que
    // ninguna celula respire igual que otra.
    const amp = cell.r * 0.025;
    const phase = cell.id * 1.7;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wob = Math.sin(a * 5 + time * 1.6 + phase) * amp + Math.sin(a * 3 - time * 1.1 + phase) * amp * 0.6;
      const rr = cell.r + wob;
      const x = cell.x + Math.cos(a) * rr;
      const y = cell.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.globalAlpha = 0.62;
    ctx.fillStyle = stain;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1.5 / scale, cell.r * 0.07);
    ctx.strokeStyle = cell.mine ? INK : stain;
    ctx.stroke();

    // Citoplasma: un centro un poco mas claro, como un cuerpo con volumen bajo la luz.
    if (screenR > 14) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#fffaf0";
      ctx.beginPath();
      ctx.arc(cell.x - cell.r * 0.18, cell.y - cell.r * 0.2, cell.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Nucleo, solo cuando se ve de cerca.
    if (screenR > 30) {
      const nx = cell.x + Math.cos(phase) * cell.r * 0.28;
      const ny = cell.y + Math.sin(phase) * cell.r * 0.28;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = stain;
      ctx.beginPath();
      ctx.arc(nx, ny, cell.r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Nombre en tinta con un filete de papel, y la masa en monoespaciada para la propia. */
  private drawLabel(ctx: CanvasRenderingContext2D, cell: CellView, scale: number): void {
    const screenR = cell.r * scale;
    if (!cell.name || screenR < 16) return;
    const size = Math.max(11 / scale, cell.r * 0.3);
    ctx.font = `600 ${size}px "Segoe UI", "Helvetica Neue", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = "rgba(246,239,220,0.85)";
    ctx.strokeText(cell.name, cell.x, cell.y);
    ctx.fillStyle = INK;
    ctx.fillText(cell.name, cell.x, cell.y);
  }

  /** La vineta circular del ocular. */
  private drawEyepiece(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const r = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.55, w / 2, h / 2, r);
    g.addColorStop(0, "rgba(23,19,14,0)");
    g.addColorStop(1, "rgba(23,19,14,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** Muestra de tinte para el HUD (el top 10 colorea cada fila). */
  static stain(color: number): string {
    return STAINS[color % STAINS.length];
  }
}
