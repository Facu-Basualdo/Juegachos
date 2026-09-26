import { mulberry32, type Candy } from "./Candy";
import { STRESS_WARN } from "./constants";
import type { Rival } from "./Rivals";

/** Paleta (DESIGN.md "Caramelo en la Lata"). */
const SAND = "#eadbbd";
const PINK = "#e0457b";
const TEAL = "#1f8a7a";
const RED = "#e8232d";
const CANDY_LIGHT = "#f2b85c";
const CANDY_MID = "#d98c34";
const CANDY_EDGE = "#a4561c";
const GROOVE = "rgba(150,78,22,0.8)";
const CARVED = "#3f1c06";
const TIN_LIGHT = "#e3e6ea";
const TIN_MID = "#aab0b8";
const TIN_DARK = "#7c838c";
const FONT = '"Trebuchet MS", sans-serif';

export type RenderPhase = "menu" | "choose" | "reveal" | "play" | "broken" | "done";

export interface NeedleView {
  visible: boolean;
  x: number;
  y: number;
  pressed: boolean;
  /** Con dedo: donde esta el dedo (la punta va por encima). */
  finger: { x: number; y: number } | null;
}

export interface RenderState {
  phase: RenderPhase;
  candy: Candy | null;
  /** Lata elegida (0-3) o -1. */
  chosen: number;
  /** Lata bajo el puntero, para resaltarla. */
  hover: number;
  /** 0-1 de la animacion de la tapa. */
  revealT: number;
  /** Segundos desde que se rompio o salio la figura. */
  endT: number;
  needle: NeedleView;
  time: number;
  /** Los demas jugadores de la sala (vacio fuera de sala). */
  rivals: Rival[];
  /** Quienes eligieron cada lata, para ponerles el nombre abajo. */
  pickers: string[][];
  /** Rivales sin noticias hace rato. */
  isStale: (r: Rival) => boolean;
}

/** Donde y de que tamaño se dibuja una galleta (px CSS; `r` es el radio del caramelo). */
interface View {
  cx: number;
  cy: number;
  r: number;
}

type CandyMode = "play" | "broken" | "done";

/**
 * Dibujo 2D de Dalgona. La camara esta arriba de la lata y no se mueve.
 *
 * Todo se dibuja por "vistas" (centro + radio), asi la misma galleta se pinta en
 * grande (la propia) y en miniatura (las de los rivales, al costado o en una fila
 * arriba en el celu). Cuando la partida propia termina y los demas siguen, la
 * pantalla pasa a una grilla con todos los rivales en grande (`watching`).
 *
 * Capas: el piso y cada galleta con su figura estampada se pintan UNA vez por tamaño
 * en canvases aparte (los poros son miles de puntitos); cada cuadro solo se dibuja
 * lo que cambia: el tallado, las grietas, las agujas y el brillo de la saliva.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floor = document.createElement("canvas");
  private readonly layers = new WeakMap<Candy, { canvas: HTMLCanvasElement; size: number }>();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private rivalCount = 0;
  private watching = false;
  /** La galleta propia. */
  private main: View = { cx: 0, cy: 0, r: 100 };
  private rivalViews: View[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  get cx(): number {
    return this.main.cx;
  }

  get cy(): number {
    return this.main.cy;
  }

  get r(): number {
    return this.main.r;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.layout();
    this.paintFloor();
  }

  /** Cuantos rivales hay en la sala y si se los esta mirando en grande. */
  setRivals(count: number, watching: boolean): void {
    if (count === this.rivalCount && watching === this.watching) return;
    this.rivalCount = count;
    this.watching = watching;
    this.layout();
  }

  /** Pantalla (px CSS) a galleta propia (radio 1). */
  toCandy(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.main.cx) / this.main.r, y: (py - this.main.cy) / this.main.r };
  }

  /** Centro y radio de cada lata cerrada al elegir (en fila o 2x2 segun la pantalla). */
  tinSlots(): { x: number; y: number; r: number }[] {
    // Van un poco abajo del centro: el 3/2/1 se dibuja arriba (ver style.css).
    const { cx, cy, r: cr } = this.main;
    const wide = this.w > this.h * 1.1;
    if (wide) {
      const side = this.rivalCount > 0 ? this.sideWidth() * (this.rivalCount > 4 ? 2 : 1) : 0;
      const r = Math.min(cr * 0.5, (this.w - 160 - side) / 11);
      const gap = r * 2.7;
      const y = cy + cr * 0.45;
      return [0, 1, 2, 3].map((i) => ({ x: cx + (i - 1.5) * gap, y, r }));
    }
    const r = Math.min(cr * 0.55, this.w / 5.6);
    const gap = r * 2.6;
    const y0 = cy + r * 0.45;
    return [0, 1, 2, 3].map((i) => ({
      x: cx + ((i % 2) - 0.5) * gap,
      y: y0 + (Math.floor(i / 2) - 0.5) * gap,
      r,
    }));
  }

  tinAt(px: number, py: number): number {
    const slots = this.tinSlots();
    for (let i = 0; i < slots.length; i++) {
      if (Math.hypot(px - slots[i].x, py - slots[i].y) <= slots[i].r * 1.1) return i;
    }
    return -1;
  }

  // ---------- Distribucion ----------

  /** Ancho de cada columna de rivales en horizontal. */
  private sideWidth(): number {
    const perCol = this.rivalCount > 4 ? Math.ceil(this.rivalCount / 2) : this.rivalCount;
    return this.sideRadius(perCol) * 2.5 + 30;
  }

  private sideRadius(perCol: number): number {
    const avail = this.h - 118 - 30;
    return Math.max(18, Math.min(58, avail / (perCol * 3.1)));
  }

  private layout(): void {
    // Franjas del HUD: arriba el reloj y el nombre, abajo el boton de lamer.
    const top = 118;
    const bottom = 118;
    const n = this.rivalCount;
    const wide = this.w > this.h * 1.1;
    this.rivalViews = [];

    if (n > 0 && this.watching) {
      // Mirando: grilla con todos los rivales en grande.
      const rect = { x: 16, y: top, w: this.w - 32, h: this.h - top - 40 };
      let best = { cols: 1, r: 0 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const r = Math.min(rect.w / cols / 2.7, (rect.h / rows - 34) / 2.5);
        if (r > best.r) best = { cols, r };
      }
      const rows = Math.ceil(n / best.cols);
      const cellW = rect.w / best.cols;
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / best.cols);
        const inRow = row === rows - 1 ? n - row * best.cols : best.cols;
        const col = i - row * best.cols;
        const offset = ((best.cols - inRow) * cellW) / 2;
        this.rivalViews.push({
          cx: rect.x + offset + cellW * (col + 0.5),
          cy: rect.y + (rect.h / rows) * (row + 0.5) - 12,
          r: best.r,
        });
      }
      this.main = { cx: this.w / 2, cy: top + (this.h - top - bottom) / 2, r: best.r };
      return;
    }

    if (n > 0 && wide) {
      // Horizontal: una columna a la derecha (y otra a la izquierda desde 5 rivales).
      const two = n > 4;
      const perCol = two ? Math.ceil(n / 2) : n;
      const mr = this.sideRadius(perCol);
      const colW = mr * 2.5 + 30;
      const slot = (this.h - top - 50) / perCol;
      for (let i = 0; i < n; i++) {
        const left = two && i >= perCol;
        const k = left ? i - perCol : i;
        this.rivalViews.push({
          cx: left ? 34 + colW / 2 : this.w - 34 - colW / 2,
          cy: top + slot * (k + 0.5) - 8,
          r: mr,
        });
      }
      const avail = Math.max(160, this.h - top - bottom);
      const free = this.w - (colW + 20) * (two ? 2 : 1) - 40;
      const r = Math.max(70, Math.min(avail * 0.43, free / 2 / 1.2, this.w * 0.38));
      const cx = two ? this.w / 2 : (this.w - colW - 20) / 2;
      this.main = { cx, cy: top + avail / 2, r };
      return;
    }

    if (n > 0) {
      // Vertical: una fila de rivales debajo del HUD.
      const mr = Math.max(14, Math.min(34, (this.w - 24) / (n * 2.55)));
      const band = mr * 2.32 + 34;
      const gap = (this.w - 24) / n;
      for (let i = 0; i < n; i++) this.rivalViews.push({ cx: 12 + gap * (i + 0.5), cy: top + mr * 1.16 + 2, r: mr });
      const t2 = top + band;
      const avail = Math.max(160, this.h - t2 - bottom);
      const r = Math.max(70, Math.min(this.w * 0.44, avail * 0.45));
      this.main = { cx: this.w / 2, cy: t2 + avail / 2, r };
      return;
    }

    const avail = Math.max(160, this.h - top - bottom);
    // En vertical el ancho es lo que limita: la galleta se come mas pantalla.
    const widthShare = this.w < this.h ? 0.44 : 0.38;
    this.main = { cx: this.w / 2, cy: top + avail / 2, r: Math.max(70, Math.min(this.w * widthShare, avail * 0.43)) };
  }

  // ---------- Cuadro ----------

  draw(s: RenderState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.floor, 0, 0, this.w, this.h);

    if (this.watching && s.rivals.length > 0) {
      s.rivals.forEach((r, i) => this.drawRival(this.rivalViews[i], r, s, true));
      return;
    }

    if (s.phase === "menu") {
      this.drawTin(this.main.cx, this.main.cy, this.main.r * 1.16, 1, "", false);
    } else if (s.phase === "choose") {
      this.tinSlots().forEach((slot, i) => {
        const pulse = i === s.chosen ? 1 + Math.sin(s.time * 8) * 0.03 : i === s.hover ? 1.04 : 1;
        this.drawTin(slot.x, slot.y, slot.r * pulse, 1, String(i + 1), i === s.chosen);
        this.drawPickers(slot, s.pickers[i] ?? []);
      });
    } else if (s.candy) {
      if (s.phase === "reveal") this.drawReveal(s, s.candy);
      else {
        this.drawCandy(this.main, s.candy, s.phase, s.endT);
        if (s.phase === "broken") this.drawFlash(s.endT);
        if (s.phase === "play" && s.needle.visible) this.drawNeedle(s.needle, this.main.r, true);
      }
    }
    s.rivals.forEach((r, i) => this.drawRival(this.rivalViews[i], r, s, false));
  }

  // ---------- Capas fijas ----------

  private paintFloor(): void {
    const c = this.floor;
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    const g = c.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = SAND;
    g.fillRect(0, 0, this.w, this.h);
    // Grano de arena sembrado.
    const rand = mulberry32(99);
    const grains = Math.round((this.w * this.h) / 90);
    for (let i = 0; i < grains; i++) {
      g.fillStyle = rand() < 0.5 ? "rgba(160,130,90,0.13)" : "rgba(255,255,255,0.18)";
      g.fillRect(rand() * this.w, rand() * this.h, 1.4, 1.4);
    }
    // Borde pintado del patio: rosa y verde agua.
    const m = Math.min(this.w, this.h) * 0.035;
    g.lineWidth = Math.max(6, m * 0.45);
    g.strokeStyle = PINK;
    g.strokeRect(m, m, this.w - m * 2, this.h - m * 2);
    g.strokeStyle = TEAL;
    g.lineWidth = Math.max(3, m * 0.2);
    g.strokeRect(m * 1.9, m * 1.9, this.w - m * 3.8, this.h - m * 3.8);
  }

  /** La galleta con poros, brillo y la figura estampada, cacheada por tamaño. */
  private layerFor(candy: Candy, r: number): HTMLCanvasElement {
    const size = Math.max(8, Math.round(r * 2 * this.dpr));
    const cached = this.layers.get(candy);
    if (cached && cached.size === size) return cached.canvas;
    const c = cached?.canvas ?? document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    const k = size / 2;
    g.setTransform(k, 0, 0, k, k, k); // coordenadas de galleta
    const base = g.createRadialGradient(-0.15, -0.2, 0.05, 0, 0, 1);
    base.addColorStop(0, CANDY_LIGHT);
    base.addColorStop(0.7, CANDY_MID);
    base.addColorStop(0.93, CANDY_EDGE);
    base.addColorStop(1, "#7d3c10");
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fillStyle = base;
    g.fill();
    g.save();
    g.clip();
    // Poros del bicarbonato (menos en las miniaturas: no se ven y cuestan).
    const rand = mulberry32(candy.binCount * 31 + 7);
    const pores = Math.round(Math.min(900 + r * 4, r * r * 0.25));
    for (let i = 0; i < pores; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand());
      const pr = (0.004 + rand() * 0.012) * (rand() < 0.1 ? 2 : 1);
      g.beginPath();
      g.ellipse(Math.cos(a) * d, Math.sin(a) * d, pr, pr * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      g.fillStyle = rand() < 0.55 ? "rgba(120,55,10,0.35)" : "rgba(255,225,160,0.35)";
      g.fill();
    }
    // Brillo curvo del azucar.
    g.beginPath();
    g.arc(-0.05, -0.05, 0.82, Math.PI * 1.05, Math.PI * 1.45);
    g.lineWidth = 0.06;
    g.strokeStyle = "rgba(255,240,200,0.28)";
    g.stroke();
    g.restore();
    // Figura estampada: filo claro abajo a la derecha, ranura oscura encima.
    const o = candy.shape.outline;
    const trace = () => {
      g.beginPath();
      g.moveTo(o[0][0], o[0][1]);
      for (let i = 1; i < o.length; i++) g.lineTo(o[i][0], o[i][1]);
      g.closePath();
    };
    g.lineJoin = "round";
    g.save();
    g.translate(0.008, 0.01);
    trace();
    g.lineWidth = r < 60 ? 0.03 : 0.018;
    g.strokeStyle = "rgba(255,226,165,0.7)";
    g.stroke();
    g.restore();
    trace();
    g.lineWidth = r < 60 ? 0.025 : 0.011;
    g.strokeStyle = GROOVE;
    g.stroke();
    this.layers.set(candy, { canvas: c, size });
    return c;
  }

  // ---------- Lata ----------

  private drawTin(x: number, y: number, r: number, lid: number, label: string, selected: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(r * 0.035, r * 0.06, r * 1.02, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(70,45,20,0.28)";
    ctx.fill();
    const body = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    body.addColorStop(0, TIN_LIGHT);
    body.addColorStop(0.75, TIN_MID);
    body.addColorStop(1, TIN_DARK);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.93, 0, Math.PI * 2);
    ctx.stroke();
    // Un golpe en la hojalata.
    ctx.beginPath();
    ctx.arc(r * 0.45, r * 0.5, r * 0.18, Math.PI * 1.1, Math.PI * 1.8);
    ctx.strokeStyle = "rgba(60,64,70,0.35)";
    ctx.lineWidth = r * 0.025;
    ctx.stroke();
    if (lid > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(90,96,104,0.55)";
      ctx.lineWidth = r * 0.03;
      ctx.stroke();
      if (label) {
        ctx.font = `900 ${Math.round(r * 0.75)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(label, r * 0.03, r * 0.06);
        ctx.fillStyle = "rgba(80,86,94,0.85)";
        ctx.fillText(label, 0, 0);
      }
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2);
      ctx.strokeStyle = PINK;
      ctx.lineWidth = Math.max(3, r * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Nombres de los rivales que eligieron esta lata, abajo de ella. */
  private drawPickers(slot: { x: number; y: number; r: number }, names: string[]): void {
    if (names.length === 0) return;
    const ctx = this.ctx;
    const shown = names.slice(0, 3);
    const extra = names.length - shown.length;
    const text = shown.join(", ") + (extra > 0 ? ` +${extra}` : "");
    const size = Math.max(11, Math.round(slot.r * 0.2));
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const y = slot.y + slot.r * 1.2;
    const tw = Math.min(ctx.measureText(text).width, slot.r * 2.4);
    ctx.fillStyle = "rgba(12,12,14,0.72)";
    ctx.fillRect(slot.x - tw / 2 - 6, y - 3, tw + 12, size + 7);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, slot.x, y, slot.r * 2.4);
  }

  /** La lata elegida va al centro y la tapa sale deslizandose. */
  private drawReveal(s: RenderState, candy: Candy): void {
    const ctx = this.ctx;
    const from = this.tinSlots()[Math.max(0, s.chosen)];
    const t = s.revealT;
    const move = easeOut(Math.min(1, t / 0.45));
    const m = this.main;
    const x = from.x + (m.cx - from.x) * move;
    const y = from.y + (m.cy - from.y) * move;
    const r = from.r + (m.r * 1.16 - from.r) * move;
    this.drawTin(x, y, r, 0, "", false);
    const cr = r / 1.16;
    ctx.drawImage(this.layerFor(candy, m.r), x - cr, y - cr, cr * 2, cr * 2);
    const slide = easeIn(Math.max(0, (t - 0.45) / 0.55));
    ctx.save();
    ctx.globalAlpha = 1 - slide * 0.6;
    this.drawTin(x + slide * this.w * 0.8, y - slide * 30, r, 1, String(s.chosen + 1), false);
    ctx.restore();
  }

  // ---------- Galleta (propia o de un rival) ----------

  private drawCandy(v: View, candy: Candy, mode: CandyMode, endT: number): void {
    this.drawTin(v.cx, v.cy, v.r * 1.16, 0, "", false);
    if (mode === "done") this.drawDone(v, candy, endT);
    else this.ctx.drawImage(this.layerFor(candy, v.r), v.cx - v.r, v.cy - v.r, v.r * 2, v.r * 2);
    if (mode !== "done") {
      this.drawCarving(v, candy);
      this.drawWarnings(v, candy);
    }
    if (candy.wet > 0.01) this.drawWet(v, candy.wet);
    if (mode === "broken") this.drawBroken(v, candy, endT);
  }

  private binPath(v: View, candy: Candy, b: number): void {
    const ctx = this.ctx;
    const a = candy.binStart[b];
    const e = Math.min(candy.sx.length, candy.binStart[b + 1] + 1);
    ctx.moveTo(v.cx + candy.sx[a] * v.r, v.cy + candy.sy[a] * v.r);
    for (let i = a + 1; i <= e; i++) {
      const j = i % candy.sx.length;
      ctx.lineTo(v.cx + candy.sx[j] * v.r, v.cy + candy.sy[j] * v.r);
    }
  }

  private drawCarving(v: View, candy: Candy): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let b = 0; b < candy.binCount; b++) if (candy.carve[b] >= 1) this.binPath(v, candy, b);
    ctx.lineWidth = Math.max(1.6, v.r * 0.03);
    ctx.strokeStyle = CARVED;
    ctx.stroke();
    for (let b = 0; b < candy.binCount; b++) {
      const c = candy.carve[b];
      if (c <= 0 || c >= 1) continue;
      ctx.beginPath();
      this.binPath(v, candy, b);
      ctx.lineWidth = Math.max(1.1, v.r * (0.012 + 0.016 * c));
      ctx.strokeStyle = `rgba(63,28,6,${0.3 + 0.6 * c})`;
      ctx.stroke();
    }
  }

  private drawWarnings(v: View, candy: Candy): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    for (let b = 0; b < candy.binCount; b++) {
      const st = candy.stress[b];
      if (st <= STRESS_WARN) continue;
      const a = Math.min(1, (st - STRESS_WARN) / (1 - STRESS_WARN));
      for (const line of candy.warnCracks[b]) {
        const n = Math.max(2, Math.round(line.length * (0.4 + 0.6 * a)));
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const px = v.cx + line[i][0] * v.r;
          const py = v.cy + line[i][1] * v.r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = `rgba(90,40,8,${0.5 * a})`;
        ctx.stroke();
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = `rgba(255,244,214,${0.9 * a})`;
        ctx.stroke();
      }
    }
  }

  private drawBroken(v: View, candy: Candy, t: number): void {
    const ctx = this.ctx;
    const grow = Math.min(1, t / 0.18);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const line of candy.crack) {
      const n = Math.max(2, Math.round(line.length * grow));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = v.cx + line[i][0] * v.r;
        const py = v.cy + line[i][1] * v.r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = Math.max(1.6, v.r * 0.022);
      ctx.strokeStyle = "#2a1204";
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, v.r * 0.008);
      ctx.strokeStyle = "rgba(255,240,205,0.85)";
      ctx.stroke();
    }
    // El caramelo pierde el color.
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, v.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(70,50,40,${0.35 * Math.min(1, t / 0.5)})`;
    ctx.fill();
  }

  /** Destello rojo de pantalla completa: solo para la galleta propia. */
  private drawFlash(t: number): void {
    const flash = Math.max(0, 1 - t / 0.6);
    if (flash <= 0) return;
    this.ctx.fillStyle = `rgba(232,35,45,${0.35 * flash})`;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  /** La figura sale: el sobrante se parte en seis gajos que se van y la figura sube. */
  private drawDone(v: View, candy: Candy, t: number): void {
    const ctx = this.ctx;
    const o = candy.shape.outline;
    const layer = this.layerFor(candy, v.r);
    const shapePath = () => {
      ctx.moveTo(v.cx + o[0][0] * v.r, v.cy + o[0][1] * v.r);
      for (let i = 1; i < o.length; i++) ctx.lineTo(v.cx + o[i][0] * v.r, v.cy + o[i][1] * v.r);
      ctx.closePath();
    };
    const out = easeOut(Math.min(1, t / 0.9));
    for (let k = 0; k < 6 && out < 1; k++) {
      const a0 = (k / 6) * Math.PI * 2;
      const a1 = ((k + 1) / 6) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - out * 1.3);
      ctx.translate(Math.cos(mid) * out * v.r * 0.5, Math.sin(mid) * out * v.r * 0.5);
      ctx.beginPath();
      ctx.moveTo(v.cx, v.cy);
      ctx.arc(v.cx, v.cy, v.r, a0, a1);
      ctx.closePath();
      shapePath();
      ctx.clip("evenodd");
      ctx.drawImage(layer, v.cx - v.r, v.cy - v.r, v.r * 2, v.r * 2);
      ctx.restore();
    }
    const lift = 1 + 0.08 * out;
    ctx.save();
    ctx.translate(v.cx, v.cy);
    ctx.scale(lift, lift);
    ctx.translate(-v.cx, -v.cy);
    ctx.save();
    ctx.translate(v.r * 0.027 * out, v.r * 0.044 * out);
    ctx.beginPath();
    shapePath();
    ctx.fillStyle = `rgba(60,35,15,${0.35 * out})`;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    shapePath();
    ctx.clip();
    ctx.drawImage(layer, v.cx - v.r, v.cy - v.r, v.r * 2, v.r * 2);
    ctx.restore();
  }

  private drawWet(v: View, wet: number): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(v.cx - v.r * 0.2, v.cy - v.r * 0.25, v.r * 0.1, v.cx, v.cy, v.r);
    g.addColorStop(0, `rgba(255,190,205,${0.42 * wet})`);
    g.addColorStop(1, `rgba(255,150,170,${0.12 * wet})`);
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, v.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(v.cx - v.r * 0.05, v.cy - v.r * 0.05, v.r * 0.7, Math.PI * 1.1, Math.PI * 1.5);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * wet})`;
    ctx.lineWidth = v.r * 0.04;
    ctx.stroke();
  }

  private drawNeedle(n: NeedleView, scale: number, shadow: boolean): void {
    const ctx = this.ctx;
    const len = Math.max(18, scale * 0.95);
    const dx = 0.42;
    const dy = -0.91;
    const ex = n.x + dx * len;
    const ey = n.y + dy * len;
    const thick = scale < 60 ? 0.5 : 1;
    ctx.lineCap = "round";
    if (shadow) {
      ctx.beginPath();
      ctx.moveTo(n.x + 5, n.y + 8);
      ctx.lineTo(ex + 22, ey + 30);
      ctx.strokeStyle = "rgba(50,25,8,0.28)";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = "#5b6068";
    ctx.lineWidth = 4 * thick;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = "#e9edf2";
    ctx.lineWidth = 2 * thick;
    ctx.stroke();
    if (scale >= 60) {
      // Ojo de la aguja.
      ctx.beginPath();
      ctx.ellipse(ex - dx * 9, ey - dy * 9, 2, 5, Math.atan2(dy, dx) + Math.PI / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "#5b6068";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    if (n.pressed) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 3 * thick, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(40,18,4,0.6)";
      ctx.fill();
    }
    if (n.finger) {
      ctx.beginPath();
      ctx.arc(n.finger.x, n.finger.y, 20, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ---------- Rivales ----------

  private drawRival(v: View | undefined, r: Rival, s: RenderState, big: boolean): void {
    if (!v) return;
    const ctx = this.ctx;
    const stale = s.isStale(r);
    ctx.save();
    if (stale) ctx.globalAlpha = 0.45;
    const candy = r.candy;
    if (!candy || r.status === "choose" || r.status === "wait") {
      this.drawTin(v.cx, v.cy, v.r * 1.16, 1, r.tin >= 0 ? String(r.tin + 1) : "?", r.tin >= 0);
    } else {
      const mode: CandyMode =
        r.status === "broken" || r.status === "time" ? "broken" : r.status === "done" ? "done" : "play";
      this.drawCandy(v, candy, mode, r.endT);
      // La tension por tramo no viaja: un aro rojo avisa que esta por romperse.
      if (mode === "play" && r.stress > 0.5) {
        ctx.beginPath();
        ctx.arc(v.cx, v.cy, v.r * 1.02, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(232,35,45,${0.35 + 0.5 * Math.min(1, (r.stress - 0.5) / 0.5)})`;
        ctx.lineWidth = Math.max(2, v.r * 0.06);
        ctx.stroke();
      }
      if (mode === "play" && r.needle) {
        this.drawNeedle(
          { visible: true, x: v.cx + r.nx * v.r, y: v.cy + r.ny * v.r, pressed: r.pressed, finger: null },
          v.r,
          big,
        );
      }
    }
    // Nombre y estado abajo de la lata.
    const size = big ? Math.max(13, Math.min(18, v.r * 0.16)) : Math.max(10, Math.min(13, v.r * 0.3));
    const y = v.cy + v.r * 1.2 + 3;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillStyle = "#2a2118";
    ctx.fillText(r.name, v.cx, y, v.r * 2.6);
    const [text, color] = rivalLine(r, stale);
    ctx.font = `700 ${Math.round(size * 0.85)}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(text, v.cx, y + size + 1, v.r * 2.6);
    ctx.restore();
  }
}

function rivalLine(r: Rival, stale: boolean): [string, string] {
  if (stale) return ["SIN SEÑAL", "#6b6259"];
  const shape = r.candy?.shape.name ?? "";
  switch (r.status) {
    case "wait":
      return ["...", "#6b6259"];
    case "choose":
      return [r.tin >= 0 ? `LATA ${r.tin + 1}` : "ELIGIENDO", "#6b6259"];
    case "play":
      return [`${shape} ${Math.round((r.candy?.progress ?? 0) * 100)}%`, "#8a4712"];
    case "broken":
      return ["ROTA", RED];
    case "time":
      return ["SIN TIEMPO", RED];
    case "done":
      return [`¡SALIÓ! ${r.score}`, TEAL];
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}
