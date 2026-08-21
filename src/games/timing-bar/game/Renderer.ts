import { CENTER_HALF, COLORS } from "./constants";

export interface RenderState {
  /** Marker position along the track, normalized [0, 1]. */
  pos: number;
  /** True once the marker has been stopped for the round. */
  frozen: boolean;
  /** Points scored on the frozen stop (only meaningful when frozen). */
  frozenPoints: number;
  /** 0..1 progress of the perfect-hit flash animation (0 = none). */
  flash: number;
  /** Whether the marker/ruler should be shown at all (hidden on menus). */
  visible: boolean;
}

/**
 * Draws the cream & ink ruler and its sweeping marker on a canvas.
 * The canvas is sized to its CSS box and kept crisp via devicePixelRatio.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
  }

  draw(state: RenderState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (!state.visible || this.cssW === 0) return;

    const margin = Math.max(28, this.cssW * 0.08);
    const left = margin;
    const right = this.cssW - margin;
    const trackW = right - left;
    const midY = this.cssH / 2;
    const half = Math.min(120, this.cssH * 0.26); // half-height of the tick band

    const xAt = (p: number) => left + p * trackW;
    const centerX = xAt(0.5);

    // --- Center bullseye band ---
    ctx.fillStyle = "rgba(0, 240, 255, 0.16)";
    ctx.fillRect(xAt(0.5 - CENTER_HALF), midY - half, xAt(0.5 + CENTER_HALF) - xAt(0.5 - CENTER_HALF), half * 2);

    // --- Ticks ---
    ctx.strokeStyle = COLORS.hairline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 50; i++) {
      const p = i / 50;
      const x = xAt(p);
      const isMajor = i % 5 === 0;
      const h = isMajor ? half * 0.62 : half * 0.34;
      ctx.moveTo(x, midY - h);
      ctx.lineTo(x, midY + h);
    }
    ctx.stroke();

    // --- Baseline ---
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left, midY);
    ctx.lineTo(right, midY);
    ctx.stroke();

    // --- Center target line ---
    ctx.strokeStyle = COLORS.accentDeep;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(centerX, midY - half);
    ctx.lineTo(centerX, midY + half);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Perfect-hit flash (expanding ring around center) ---
    if (state.flash > 0) {
      const r = half * (0.4 + state.flash * 1.4);
      ctx.strokeStyle = `rgba(255, 90, 60, ${(1 - state.flash) * 0.9})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(centerX, midY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- Marker ---
    const markerX = xAt(state.pos);
    let markerColor: string = COLORS.ink;
    if (state.frozen) {
      if (state.frozenPoints >= 97) markerColor = COLORS.perfect;
      else if (state.frozenPoints >= 60) markerColor = COLORS.accentDeep;
      else markerColor = COLORS.muted;
    }

    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(markerX, midY - half * 1.12);
    ctx.lineTo(markerX, midY + half * 1.12);
    ctx.stroke();
    ctx.lineCap = "butt";

    // Pointer triangles (top and bottom)
    ctx.fillStyle = markerColor;
    const t = 9;
    ctx.beginPath();
    ctx.moveTo(markerX - t, midY - half * 1.12 - t);
    ctx.lineTo(markerX + t, midY - half * 1.12 - t);
    ctx.lineTo(markerX, midY - half * 1.12 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(markerX - t, midY + half * 1.12 + t);
    ctx.lineTo(markerX + t, midY + half * 1.12 + t);
    ctx.lineTo(markerX, midY + half * 1.12 - 2);
    ctx.closePath();
    ctx.fill();

    // Frozen score label floating above the marker
    if (state.frozen) {
      ctx.fillStyle = markerColor;
      ctx.font = "700 26px 'Inter', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`+${state.frozenPoints}`, markerX, midY - half * 1.12 - t - 8);
    }
  }
}
