import type { AgClientConfig } from "./AgarProtocol";

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

const PELLET_COLORS = ["#f4d35e", "#ee964b", "#f95738", "#9bc53d", "#5bc0eb", "#c3a6ff"];

export interface CellView {
  id: number;
  x: number;
  y: number;
  r: number;
  color: number;
  name: string;
  mine: boolean;
}

/** Colores provisorios por indice (el server reparte 12). */
const PLAYER_COLORS = [
  "#e4572e", "#29a3a3", "#f2b134", "#7b5ea7", "#4f9d69", "#d6457a",
  "#3c7ec4", "#c97c3a", "#8bb03f", "#b84a4a", "#5aa7c9", "#a36dbf",
];

export class Renderer {
  private cfg: AgClientConfig | null = null;

  setConfig(cfg: AgClientConfig): void {
    this.cfg = cfg;
  }

  /** Escala mundo -> px CSS para esta camara. */
  scaleFor(cam: Camera, cssH: number): number {
    return cssH / cam.viewH;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
    cam: Camera,
    pellets: ReadonlyMap<number, PelletView>,
    cells: CellView[],
  ): void {
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, cssW, cssH);
    if (!this.cfg) return;

    const scale = this.scaleFor(cam, cssH);
    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    this.drawGrid(ctx, cam, cssW / scale, cssH / scale, scale);
    this.drawPellets(ctx, cam, cssW / scale, cssH / scale, pellets);

    // Las chicas arriba de las grandes no taparian nada que importe; al reves si.
    const sorted = [...cells].sort((a, b) => a.r - b.r);
    for (const cell of sorted) this.drawCell(ctx, cell, scale);
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, scale: number): void {
    const size = this.cfg!.mapSize;
    ctx.fillStyle = "#182027";
    ctx.fillRect(0, 0, size, size);

    const step = 100;
    const x0 = Math.max(0, Math.floor((cam.x - w / 2) / step) * step);
    const x1 = Math.min(size, cam.x + w / 2);
    const y0 = Math.max(0, Math.floor((cam.y - h / 2) / step) * step);
    const y1 = Math.min(size, cam.y + h / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y += step) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3 / scale;
    ctx.strokeRect(0, 0, size, size);
  }

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
    for (const p of pellets.values()) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      ctx.fillStyle = PELLET_COLORS[p.color % PELLET_COLORS.length];
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCell(ctx: CanvasRenderingContext2D, cell: CellView, scale: number): void {
    const color = PLAYER_COLORS[cell.color % PLAYER_COLORS.length];
    ctx.beginPath();
    ctx.arc(cell.x, cell.y, cell.r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(2 / scale, cell.r * 0.06);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.stroke();

    if (cell.name && cell.r * scale > 14) {
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.max(10 / scale, cell.r * 0.32)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cell.name, cell.x, cell.y);
    }
  }
}
