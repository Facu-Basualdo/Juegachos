import { mulberry32, type Candy } from "./Candy";
import { STRESS_WARN } from "./constants";

/** Paleta (DESIGN.md "Caramelo en la Lata"). */
const SAND = "#eadbbd";
const PINK = "#e0457b";
const TEAL = "#1f8a7a";
const CANDY_LIGHT = "#f2b85c";
const CANDY_MID = "#d98c34";
const CANDY_EDGE = "#a4561c";
const GROOVE = "rgba(150,78,22,0.8)";
const CARVED = "#3f1c06";
const TIN_LIGHT = "#e3e6ea";
const TIN_MID = "#aab0b8";
const TIN_DARK = "#7c838c";

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
}

/**
 * Dibujo 2D de Dalgona. La camara esta arriba de la lata y no se mueve.
 *
 * Capas: el piso y la galleta con su figura estampada se pintan UNA vez por tamaño
 * de pantalla / figura en canvases aparte (los poros son miles de puntitos); cada
 * cuadro solo se dibuja lo que cambia: el tallado, las grietas, la aguja y el brillo
 * de la saliva.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floor = document.createElement("canvas");
  private readonly candyLayer = document.createElement("canvas");
  private candyFor: Candy | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Centro y radio de la galleta, en px CSS. */
  cx = 0;
  cy = 0;
  r = 100;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    // Franjas del HUD: arriba el reloj y el nombre, abajo el boton de lamer.
    const top = 118;
    const bottom = 118;
    const avail = Math.max(160, this.h - top - bottom);
    // En vertical el ancho es lo que limita: la galleta se come mas pantalla.
    const widthShare = this.w < this.h ? 0.44 : 0.38;
    this.r = Math.max(70, Math.min(this.w * widthShare, avail * 0.43));
    this.cx = this.w / 2;
    this.cy = top + avail / 2;
    this.paintFloor();
    this.candyFor = null;
  }

  /** Pantalla (px CSS) a galleta (radio 1). */
  toCandy(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.cx) / this.r, y: (py - this.cy) / this.r };
  }

  /** Centro y radio de cada lata cerrada al elegir (en fila o 2x2 segun la pantalla). */
  tinSlots(): { x: number; y: number; r: number }[] {
    // Van un poco abajo del centro: el 3/2/1 se dibuja arriba (ver style.css).
    const wide = this.w > this.h * 1.1;
    if (wide) {
      const r = Math.min(this.r * 0.5, (this.w - 160) / 11);
      const gap = r * 2.7;
      const y = this.cy + this.r * 0.45;
      return [0, 1, 2, 3].map((i) => ({ x: this.cx + (i - 1.5) * gap, y, r }));
    }
    const r = Math.min(this.r * 0.55, this.w / 5.6);
    const gap = r * 2.6;
    const y0 = this.cy + r * 0.45;
    return [0, 1, 2, 3].map((i) => ({
      x: this.cx + ((i % 2) - 0.5) * gap,
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

  draw(s: RenderState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.floor, 0, 0, this.w, this.h);

    if (s.phase === "menu") {
      this.drawTin(this.cx, this.cy, this.r * 1.16, 1, "", false);
      return;
    }
    if (s.phase === "choose") {
      this.tinSlots().forEach((slot, i) => {
        const pulse = i === s.chosen ? 1 + Math.sin(s.time * 8) * 0.03 : i === s.hover ? 1.04 : 1;
        this.drawTin(slot.x, slot.y, slot.r * pulse, 1, String(i + 1), i === s.chosen);
      });
      return;
    }
    const candy = s.candy;
    if (!candy) return;
    if (this.candyFor !== candy) this.paintCandy(candy);

    if (s.phase === "reveal") {
      this.drawReveal(s);
      return;
    }

    this.drawTin(this.cx, this.cy, this.r * 1.16, 0, "", false);
    if (s.phase === "done") this.drawDone(candy, s.endT);
    else ctx.drawImage(this.candyLayer, this.cx - this.r, this.cy - this.r, this.r * 2, this.r * 2);

    if (s.phase !== "done") {
      this.drawCarving(candy);
      this.drawWarnings(candy);
    }
    if (candy.wet > 0.01) this.drawWet(candy.wet);
    if (s.phase === "broken") this.drawBroken(candy, s.endT);
    if (s.phase === "play" && s.needle.visible) this.drawNeedle(s.needle);
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

  /** La galleta con poros, brillo y la figura estampada, en su propio canvas. */
  private paintCandy(candy: Candy): void {
    this.candyFor = candy;
    const size = Math.round(this.r * 2 * this.dpr);
    const c = this.candyLayer;
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
    // Poros del bicarbonato.
    const rand = mulberry32(candy.binCount * 31 + 7);
    const pores = Math.round(900 + this.r * 4);
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
    g.lineWidth = 0.018;
    g.strokeStyle = "rgba(255,226,165,0.7)";
    g.stroke();
    g.restore();
    trace();
    g.lineWidth = 0.011;
    g.strokeStyle = GROOVE;
    g.stroke();
  }

  // ---------- Lata ----------

  private drawTin(x: number, y: number, r: number, lid: number, label: string, selected: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(4, 7, r * 1.02, 0, Math.PI * 2);
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
        ctx.font = `900 ${Math.round(r * 0.75)}px "Trebuchet MS", sans-serif`;
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
      ctx.lineWidth = Math.max(4, r * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** La lata elegida va al centro y la tapa sale deslizandose. */
  private drawReveal(s: RenderState): void {
    const ctx = this.ctx;
    const slots = this.tinSlots();
    const from = slots[Math.max(0, s.chosen)];
    const t = s.revealT;
    const move = easeOut(Math.min(1, t / 0.45));
    const x = from.x + (this.cx - from.x) * move;
    const y = from.y + (this.cy - from.y) * move;
    const r = from.r + (this.r * 1.16 - from.r) * move;
    this.drawTin(x, y, r, 0, "", false);
    const k = r / (this.r * 1.16);
    ctx.drawImage(this.candyLayer, x - this.r * k, y - this.r * k, this.r * 2 * k, this.r * 2 * k);
    const slide = easeIn(Math.max(0, (t - 0.45) / 0.55));
    ctx.save();
    ctx.globalAlpha = 1 - slide * 0.6;
    this.drawTin(x + slide * this.w * 0.8, y - slide * 30, r, 1, String(s.chosen + 1), false);
    ctx.restore();
  }

  // ---------- Tallado y grietas ----------

  private binPath(candy: Candy, b: number): void {
    const ctx = this.ctx;
    const a = candy.binStart[b];
    const e = Math.min(candy.sx.length, candy.binStart[b + 1] + 1);
    ctx.moveTo(this.cx + candy.sx[a] * this.r, this.cy + candy.sy[a] * this.r);
    for (let i = a + 1; i <= e; i++) {
      const j = i % candy.sx.length;
      ctx.lineTo(this.cx + candy.sx[j] * this.r, this.cy + candy.sy[j] * this.r);
    }
  }

  private drawCarving(candy: Candy): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let b = 0; b < candy.binCount; b++) if (candy.carve[b] >= 1) this.binPath(candy, b);
    ctx.lineWidth = Math.max(3, this.r * 0.03);
    ctx.strokeStyle = CARVED;
    ctx.stroke();
    for (let b = 0; b < candy.binCount; b++) {
      const c = candy.carve[b];
      if (c <= 0 || c >= 1) continue;
      ctx.beginPath();
      this.binPath(candy, b);
      ctx.lineWidth = Math.max(1.8, this.r * (0.012 + 0.016 * c));
      ctx.strokeStyle = `rgba(63,28,6,${0.3 + 0.6 * c})`;
      ctx.stroke();
    }
  }

  private drawWarnings(candy: Candy): void {
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
          const px = this.cx + line[i][0] * this.r;
          const py = this.cy + line[i][1] * this.r;
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

  private drawBroken(candy: Candy, t: number): void {
    const ctx = this.ctx;
    const grow = Math.min(1, t / 0.18);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const line of candy.crack) {
      const n = Math.max(2, Math.round(line.length * grow));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = this.cx + line[i][0] * this.r;
        const py = this.cy + line[i][1] * this.r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = Math.max(3, this.r * 0.022);
      ctx.strokeStyle = "#2a1204";
      ctx.stroke();
      ctx.lineWidth = Math.max(1.2, this.r * 0.008);
      ctx.strokeStyle = "rgba(255,240,205,0.85)";
      ctx.stroke();
    }
    // El caramelo pierde el color y un destello rojo cierra el intento.
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(70,50,40,${0.35 * Math.min(1, t / 0.5)})`;
    ctx.fill();
    const flash = Math.max(0, 1 - t / 0.6);
    if (flash > 0) {
      ctx.fillStyle = `rgba(232,35,45,${0.35 * flash})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  /** La figura sale: el sobrante se parte en seis gajos que se van y la figura sube. */
  private drawDone(candy: Candy, t: number): void {
    const ctx = this.ctx;
    const o = candy.shape.outline;
    const shapePath = () => {
      ctx.moveTo(this.cx + o[0][0] * this.r, this.cy + o[0][1] * this.r);
      for (let i = 1; i < o.length; i++) ctx.lineTo(this.cx + o[i][0] * this.r, this.cy + o[i][1] * this.r);
      ctx.closePath();
    };
    const out = easeOut(Math.min(1, t / 0.9));
    for (let k = 0; k < 6 && out < 1; k++) {
      const a0 = (k / 6) * Math.PI * 2;
      const a1 = ((k + 1) / 6) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - out * 1.3);
      ctx.translate(Math.cos(mid) * out * this.r * 0.5, Math.sin(mid) * out * this.r * 0.5);
      ctx.beginPath();
      ctx.moveTo(this.cx, this.cy);
      ctx.arc(this.cx, this.cy, this.r, a0, a1);
      ctx.closePath();
      shapePath();
      ctx.clip("evenodd");
      ctx.drawImage(this.candyLayer, this.cx - this.r, this.cy - this.r, this.r * 2, this.r * 2);
      ctx.restore();
    }
    const lift = 1 + 0.08 * out;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.scale(lift, lift);
    ctx.translate(-this.cx, -this.cy);
    ctx.save();
    ctx.translate(6 * out, 10 * out);
    ctx.beginPath();
    shapePath();
    ctx.fillStyle = `rgba(60,35,15,${0.35 * out})`;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    shapePath();
    ctx.clip();
    ctx.drawImage(this.candyLayer, this.cx - this.r, this.cy - this.r, this.r * 2, this.r * 2);
    ctx.restore();
  }

  private drawWet(wet: number): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.cx - this.r * 0.2, this.cy - this.r * 0.25, this.r * 0.1, this.cx, this.cy, this.r);
    g.addColorStop(0, `rgba(255,190,205,${0.42 * wet})`);
    g.addColorStop(1, `rgba(255,150,170,${0.12 * wet})`);
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.cx - this.r * 0.05, this.cy - this.r * 0.05, this.r * 0.7, Math.PI * 1.1, Math.PI * 1.5);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * wet})`;
    ctx.lineWidth = this.r * 0.04;
    ctx.stroke();
  }

  private drawNeedle(n: NeedleView): void {
    const ctx = this.ctx;
    const len = Math.max(90, this.r * 0.95);
    const dx = 0.42;
    const dy = -0.91;
    const ex = n.x + dx * len;
    const ey = n.y + dy * len;
    ctx.lineCap = "round";
    // Sombra sobre el caramelo.
    ctx.beginPath();
    ctx.moveTo(n.x + 5, n.y + 8);
    ctx.lineTo(ex + 22, ey + 30);
    ctx.strokeStyle = "rgba(50,25,8,0.28)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = "#5b6068";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = "#e9edf2";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Ojo de la aguja.
    ctx.beginPath();
    ctx.ellipse(ex - dx * 9, ey - dy * 9, 2, 5, Math.atan2(dy, dx) + Math.PI / 2, 0, Math.PI * 2);
    ctx.strokeStyle = "#5b6068";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (n.pressed) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 3, 0, Math.PI * 2);
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
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}
