import { COLS, POOL_FLOOR, POOL_SURFACE, ROWS } from "./constants";
import type { Hero, Tile } from "./Level";
import { drawChori, drawPan } from "./Sprites";
import type { HeroBody, World, WorldEvent } from "./World";

/** Colores de canal (DESIGN.md): dorado, violeta, turquesa, rosa, naranja. */
const CHANNEL: Record<string, string> = { a: "#ffd36a", b: "#b48cff", c: "#4ee6d2", d: "#ff6fae", e: "#ff9a4a" };
const chColor = (ch: string) => CHANNEL[ch] ?? "#ffd36a";

const STONE = "#6f6a4c";
const STONE_LIGHT = "#a59d72";
const STONE_DARK = "#3e3a28";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  glow: boolean;
}

interface HeroAnim {
  walk: number;
  squash: number;
  deadT: number;
  lastY: number;
}

/**
 * Dibujo de Chori y Pan (DESIGN.md "Parrilla Sagrada"). El fondo del templo y la
 * piedra se pintan UNA vez por nivel en un canvas aparte; cada cuadro van los liquidos,
 * los mecanismos, las gemas, los personajes y las particulas.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache = document.createElement("canvas");
  private dpr = 1;
  private w = 0;
  private h = 0;
  /** px por celda y origen del tablero. */
  s = 24;
  ox = 0;
  oy = 0;
  private margins = { top: 64, bottom: 16, side: 16 };
  private world: World | null = null;
  private torches: { x: number; y: number }[] = [];
  private readonly particles: Particle[] = [];
  private readonly anim: Record<Hero, HeroAnim> = {
    chori: { walk: 0, squash: 0, deadT: 0, lastY: 0 },
    pan: { walk: 0, squash: 0, deadT: 0, lastY: 0 },
  };
  private doorGlow: Record<Hero, number> = { chori: 0, pan: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  setMargins(m: { top: number; bottom: number; side: number }): void {
    this.margins = m;
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
    const m = this.margins;
    const aw = this.w - m.side * 2;
    const ah = this.h - m.top - m.bottom;
    this.s = Math.max(6, Math.min(aw / COLS, ah / ROWS));
    this.ox = Math.round((this.w - this.s * COLS) / 2);
    this.oy = Math.round(m.top + (ah - this.s * ROWS) / 2);
    if (this.world) this.paintStatic(this.world);
  }

  setWorld(world: World): void {
    this.world = world;
    this.particles.length = 0;
    for (const a of Object.values(this.anim)) {
      a.squash = 0;
      a.deadT = 0;
    }
    this.doorGlow = { chori: 0, pan: 0 };
    this.paintStatic(world);
  }

  /** Celdas a px. */
  px(x: number): number {
    return this.ox + x * this.s;
  }

  py(y: number): number {
    return this.oy + y * this.s;
  }

  // ---------- Fondo y piedra (una vez por nivel) ----------

  private paintStatic(world: World): void {
    const s = this.s;
    const W = Math.ceil(COLS * s);
    const H = Math.ceil(ROWS * s);
    this.cache.width = Math.round(W * this.dpr);
    this.cache.height = Math.round(H * this.dpr);
    const g = this.cache.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const rand = rng(world.level.def.id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const t = (x: number, y: number) => world.tileAt(x, y);
    const solidish = (k: Tile) => k === "solid";

    // Pared del fondo: sillares grandes y oscuros.
    g.fillStyle = "#1a1810";
    g.fillRect(0, 0, W, H);
    const rowH = 1.5 * s;
    for (let r = 0; r * rowH < H; r++) {
      const off = (r % 2) * 1.2 * s;
      for (let x = -off; x < W; x += 2.4 * s) {
        const k = rand();
        g.fillStyle = `rgb(${34 + k * 10}, ${32 + k * 9}, ${22 + k * 6})`;
        g.fillRect(x + 1, r * rowH + 1, 2.4 * s - 2, rowH - 2);
      }
    }
    // Jeroglificos tenues en los huecos grandes.
    for (let i = 0; i < 14; i++) {
      const cx = 2 + Math.floor(rand() * (COLS - 4));
      const cy = 2 + Math.floor(rand() * (ROWS - 4));
      let free = true;
      for (let yy = cy - 1; yy <= cy + 1 && free; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) if (t(xx, yy) !== "empty") free = false;
      if (!free) continue;
      this.glyph(g, (cx + 0.5) * s, (cy + 0.5) * s, s * 0.9, Math.floor(rand() * 4));
    }

    // Antorchas: en una pared, a la altura de la cara.
    this.torches = [];
    for (let i = 0; i < 40 && this.torches.length < 5; i++) {
      const x = 1 + Math.floor(rand() * (COLS - 2));
      const y = 2 + Math.floor(rand() * (ROWS - 5));
      if (t(x, y) !== "empty" || t(x, y + 1) !== "empty") continue;
      if (!(solidish(t(x - 1, y)) || solidish(t(x + 1, y)))) continue;
      if (this.torches.some((o) => Math.abs(o.x - x) + Math.abs(o.y - y) < 8)) continue;
      this.torches.push({ x, y });
      g.fillStyle = "#2a2014";
      g.fillRect((x + 0.42) * s, (y + 0.45) * s, 0.16 * s, 0.45 * s);
      g.fillStyle = "#4a3a20";
      g.fillRect((x + 0.3) * s, (y + 0.4) * s, 0.4 * s, 0.1 * s);
    }

    // Bloques de piedra.
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const k = t(x, y);
        if (k === "solid") this.stone(g, x, y, s, rand, t(x, y - 1), t(x, y + 1), t(x - 1, y), t(x + 1, y));
        else if (k === "slopeR" || k === "slopeL") this.slope(g, x, y, s, k);
        else if (k === "embers" || k === "water" || k === "goo") this.basin(g, x, y, s, t(x - 1, y), t(x + 1, y));
      }
    }
    // Enredaderas colgando de los techos.
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS - 1; y++) {
        if (!(t(x, y) === "solid" && t(x, y + 1) === "empty") || rand() > 0.12) continue;
        const len = (1 + rand() * 2.2) * s;
        const vx = (x + 0.2 + rand() * 0.6) * s;
        g.strokeStyle = "#3f5a26";
        g.lineWidth = Math.max(1, s * 0.05);
        g.beginPath();
        g.moveTo(vx, (y + 1) * s);
        g.quadraticCurveTo(vx + (rand() - 0.5) * s * 0.6, (y + 1) * s + len * 0.5, vx + (rand() - 0.5) * s * 0.3, (y + 1) * s + len);
        g.stroke();
        for (let j = 0; j < 4; j++) {
          g.fillStyle = j % 2 ? "#5f8a3a" : "#4a7030";
          g.beginPath();
          g.ellipse(vx + (rand() - 0.5) * s * 0.3, (y + 1) * s + len * (0.2 + j * 0.22), s * 0.09, s * 0.05, rand() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // Viñeta: los bordes del templo en penumbra.
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  private glyph(g: CanvasRenderingContext2D, cx: number, cy: number, sz: number, kind: number): void {
    g.save();
    g.strokeStyle = "rgba(217, 180, 90, 0.14)";
    g.lineWidth = Math.max(1, sz * 0.06);
    g.strokeRect(cx - sz / 2, cy - sz / 2, sz, sz);
    g.beginPath();
    if (kind === 0) {
      g.ellipse(cx, cy, sz * 0.3, sz * 0.18, 0, 0, Math.PI * 2);
      g.moveTo(cx + sz * 0.08, cy);
      g.arc(cx, cy, sz * 0.08, 0, Math.PI * 2);
    } else if (kind === 1) {
      for (let a = 0; a < 10; a += 0.3) {
        const r = a * sz * 0.035;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    } else if (kind === 2) {
      g.moveTo(cx - sz * 0.3, cy + sz * 0.2);
      for (let i = 0; i < 4; i++) g.lineTo(cx - sz * 0.3 + (i + 0.5) * sz * 0.15, cy + (i % 2 ? sz * 0.2 : -sz * 0.2));
      g.lineTo(cx + sz * 0.3, cy + sz * 0.2);
    } else {
      // Un choripan estilizado: el chiste del templo.
      g.ellipse(cx, cy + sz * 0.05, sz * 0.32, sz * 0.13, 0, 0, Math.PI * 2);
      g.moveTo(cx - sz * 0.26, cy - sz * 0.02);
      g.lineTo(cx + sz * 0.26, cy - sz * 0.02);
    }
    g.stroke();
    g.restore();
  }

  private stone(g: CanvasRenderingContext2D, x: number, y: number, s: number, rand: () => number, up: Tile, down: Tile, left: Tile, right: Tile): void {
    const X = x * s;
    const Y = y * s;
    const k = rand();
    g.fillStyle = `rgb(${103 + k * 18}, ${98 + k * 16}, ${68 + k * 12})`;
    g.fillRect(X, Y, s, s);
    // Moteado.
    for (let i = 0; i < 3; i++) {
      g.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,240,200,0.06)";
      g.fillRect(X + rand() * s * 0.8, Y + rand() * s * 0.8, s * (0.1 + rand() * 0.2), s * (0.06 + rand() * 0.12));
    }
    // Junta de sillares (a cuadros desfasados por fila).
    g.fillStyle = STONE_DARK;
    if ((x + (y % 2)) % 2 === 0 && right === "solid") g.fillRect(X + s - 1, Y, 1, s);
    if (down === "solid") g.fillRect(X, Y + s - 1, s, 1);
    // Bordes expuestos.
    const open = (k2: Tile) => k2 !== "solid";
    if (open(up)) {
      g.fillStyle = STONE_LIGHT;
      g.fillRect(X, Y, s, Math.max(2, s * 0.1));
      // Musgo.
      for (let i = 0; i < 4; i++) {
        g.fillStyle = rand() < 0.5 ? "#5f8a3a" : "#7aa848";
        const mx = X + rand() * s * 0.85;
        g.beginPath();
        g.ellipse(mx + s * 0.08, Y + s * 0.04, s * (0.08 + rand() * 0.1), s * 0.07, 0, Math.PI, 0);
        g.fill();
      }
    }
    if (open(down)) {
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(X, Y + s - Math.max(2, s * 0.12), s, Math.max(2, s * 0.12));
    }
    if (open(left)) {
      g.fillStyle = "rgba(255,240,200,0.1)";
      g.fillRect(X, Y, Math.max(1, s * 0.06), s);
    }
    if (open(right)) {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(X + s - Math.max(1, s * 0.07), Y, Math.max(1, s * 0.07), s);
    }
  }

  private slope(g: CanvasRenderingContext2D, x: number, y: number, s: number, k: Tile): void {
    const X = x * s;
    const Y = y * s;
    g.fillStyle = STONE;
    g.beginPath();
    if (k === "slopeR") {
      g.moveTo(X, Y + s);
      g.lineTo(X + s, Y);
      g.lineTo(X + s, Y + s);
    } else {
      g.moveTo(X, Y);
      g.lineTo(X + s, Y + s);
      g.lineTo(X, Y + s);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = STONE_LIGHT;
    g.lineWidth = Math.max(2, s * 0.1);
    g.beginPath();
    if (k === "slopeR") {
      g.moveTo(X, Y + s);
      g.lineTo(X + s, Y);
    } else {
      g.moveTo(X, Y);
      g.lineTo(X + s, Y + s);
    }
    g.stroke();
    g.strokeStyle = "#6a9a40";
    g.lineWidth = Math.max(1, s * 0.05);
    g.stroke();
  }

  private basin(g: CanvasRenderingContext2D, x: number, y: number, s: number, left: Tile, right: Tile): void {
    const X = x * s;
    const Y = y * s;
    g.fillStyle = STONE;
    g.fillRect(X, Y + POOL_FLOOR * s, s, (1 - POOL_FLOOR) * s);
    g.fillStyle = "#1a1408";
    g.fillRect(X, Y + POOL_SURFACE * s, s, (POOL_FLOOR - POOL_SURFACE) * s);
    // Labios de la pileta.
    g.fillStyle = STONE_LIGHT;
    if (left !== "embers" && left !== "water" && left !== "goo") g.fillRect(X - 1, Y + POOL_SURFACE * s - 1, Math.max(2, s * 0.08), (POOL_FLOOR - POOL_SURFACE) * s + 2);
    if (right !== "embers" && right !== "water" && right !== "goo") g.fillRect(X + s - Math.max(2, s * 0.08) + 1, Y + POOL_SURFACE * s - 1, Math.max(2, s * 0.08), (POOL_FLOOR - POOL_SURFACE) * s + 2);
  }

  // ---------- Cuadro ----------

  /** Eventos del mundo que tienen efecto visual (polvo, chispas, salpicones). */
  onEvent(e: WorldEvent): void {
    if (!this.world) return;
    if (e.type === "land") {
      const h = this.world.heroes[e.hero];
      this.anim[e.hero].squash = -Math.min(1, e.speed / 22);
      for (let i = 0; i < 6; i++) this.puff(h.x + h.w / 2 + (Math.random() - 0.5) * 0.6, h.y + h.h, (Math.random() - 0.5) * 2, -Math.random() * 1.2, 0.5, 0.12, "rgba(190,180,140,0.5)", 2, false);
    } else if (e.type === "jump") {
      this.anim[e.hero].squash = 0.5;
    } else if (e.type === "die") {
      const h = this.world.heroes[e.hero];
      const color = e.cause === "water" ? "#9fe2ff" : e.cause === "goo" ? "#c4f06a" : "#ffb04a";
      for (let i = 0; i < 26; i++) this.puff(h.x + h.w / 2, h.y + h.h * 0.6, (Math.random() - 0.5) * 6, -Math.random() * 6, 0.9, 0.1 + Math.random() * 0.08, color, 12, e.cause === "embers");
      for (let i = 0; i < 12; i++) this.puff(h.x + h.w / 2, h.y + h.h * 0.4, (Math.random() - 0.5) * 1.5, -1.5 - Math.random() * 1.5, 1.6, 0.25, "rgba(60,55,50,0.55)", -0.6, false);
    } else if (e.type === "gem") {
      const color = e.hero === "chori" ? "#ff5a3a" : "#9fe2ff";
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.puff(e.x + 0.5, e.y + 0.5, Math.cos(a) * 4, Math.sin(a) * 4, 0.5, 0.08, color, 0, true);
      }
    } else if (e.type === "lever" || e.type === "plate") {
      for (let i = 0; i < 5; i++) this.puff(e.x + 0.5, e.y + 0.9, (Math.random() - 0.5) * 2, -Math.random(), 0.4, 0.08, "rgba(190,180,140,0.5)", 2, false);
    }
  }

  private puff(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, grav: number, glow: boolean): void {
    if (this.particles.length > 600) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, grav, glow });
  }

  draw(time: number, dt: number, extra?: { ghost?: Hero[] }): void {
    const world = this.world;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#0d0c08";
    g.fillRect(0, 0, this.w, this.h);
    if (!world) return;
    const s = this.s;
    g.drawImage(this.cache, this.ox, this.oy, COLS * s, ROWS * s);
    g.save();
    g.translate(this.ox, this.oy);

    this.drawTorches(g, time);
    this.drawLiquids(g, world, time, dt);
    this.drawDoors(g, world, time, dt);
    this.drawGems(g, world, time);
    this.drawFans(g, world, time, dt);
    this.drawPlates(g, world);
    this.drawLevers(g, world);
    this.drawGates(g, world);
    this.drawLifts(g, world);
    this.drawBoxes(g, world);
    for (const hero of ["pan", "chori"] as Hero[]) this.drawHero(g, world.heroes[hero], time, dt, extra?.ghost?.includes(hero) ?? false);
    this.drawParticles(g, dt);
    g.restore();
  }

  private drawTorches(g: CanvasRenderingContext2D, time: number): void {
    const s = this.s;
    for (const t of this.torches) {
      const cx = (t.x + 0.5) * s;
      const cy = (t.y + 0.38) * s;
      const f = 1 + Math.sin(time * 13 + t.x) * 0.08 + Math.sin(time * 7.3 + t.y) * 0.06;
      g.save();
      g.globalCompositeOperation = "lighter";
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, s * 3.2 * f);
      glow.addColorStop(0, "rgba(255,160,60,0.32)");
      glow.addColorStop(1, "rgba(255,120,40,0)");
      g.fillStyle = glow;
      g.fillRect(cx - s * 3.4, cy - s * 3.4, s * 6.8, s * 6.8);
      g.restore();
      g.fillStyle = "#ff8a2a";
      g.beginPath();
      g.ellipse(cx, cy - s * 0.05, s * 0.13 * f, s * 0.24 * f, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ffe08a";
      g.beginPath();
      g.ellipse(cx, cy, s * 0.06, s * 0.12 * f, 0, 0, Math.PI * 2);
      g.fill();
      if (Math.random() < 0.05) this.puff(t.x + 0.5, t.y + 0.2, (Math.random() - 0.5) * 0.4, -1, 0.8, 0.04, "#ffb04a", -0.5, true);
    }
  }

  private drawLiquids(g: CanvasRenderingContext2D, world: World, time: number, _dt: number): void {
    const s = this.s;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const k = world.tileAt(x, y);
        if (k !== "embers" && k !== "water" && k !== "goo") continue;
        const X = x * s;
        const top = (y + POOL_SURFACE) * s;
        const bot = (y + POOL_FLOOR) * s;
        const wave = (u: number) => Math.sin(time * 3 + (x + u) * 2.2) * s * 0.035 + Math.sin(time * 1.7 + (x + u) * 5) * s * 0.015;
        const cols = k === "embers" ? ["#ff7a1a", "#c42a0a"] : k === "water" ? ["#3aa8ff", "#14508a"] : ["#7ad13a", "#2e5a14"];
        const grad = g.createLinearGradient(0, top, 0, bot);
        grad.addColorStop(0, cols[0]);
        grad.addColorStop(1, cols[1]);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(X, bot);
        for (let i = 0; i <= 4; i++) g.lineTo(X + (i / 4) * s, top + wave(i / 4));
        g.lineTo(X + s, bot);
        g.closePath();
        g.fill();
        // Brillo de la superficie.
        g.strokeStyle = k === "embers" ? "rgba(255,230,140,0.9)" : k === "water" ? "rgba(200,240,255,0.85)" : "rgba(220,255,150,0.8)";
        g.lineWidth = Math.max(1, s * 0.05);
        g.beginPath();
        for (let i = 0; i <= 4; i++) {
          const px = X + (i / 4) * s;
          if (i === 0) g.moveTo(px, top + wave(0));
          else g.lineTo(px, top + wave(i / 4));
        }
        g.stroke();
        if (k === "embers") {
          // Carbones que respiran.
          for (let i = 0; i < 2; i++) {
            const glow = 0.5 + 0.5 * Math.sin(time * 2 + x * 3 + i * 2);
            g.fillStyle = `rgba(${120 + glow * 135}, ${30 + glow * 60}, 10, 0.9)`;
            g.beginPath();
            g.ellipse(X + (0.3 + i * 0.4) * s, bot - s * 0.05, s * 0.13, s * 0.06, 0, Math.PI, 0);
            g.fill();
          }
          if (Math.random() < 0.06) this.puff(x + Math.random(), y + POOL_SURFACE, (Math.random() - 0.5) * 0.6, -1.5 - Math.random() * 2, 0.9, 0.035, "#ffcc5a", -0.4, true);
          g.save();
          g.globalCompositeOperation = "lighter";
          g.fillStyle = "rgba(255, 90, 20, 0.12)";
          g.fillRect(X, top - s * 0.6, s, s * 0.6);
          g.restore();
        } else if (k === "goo") {
          g.fillStyle = "rgba(20,60,10,0.8)";
          for (let i = 0; i < 3; i++) g.fillRect(X + ((x * 7 + i * 13) % 10) / 10 * s, top + s * 0.08 + i * s * 0.04, s * 0.06, s * 0.03);
          if (Math.random() < 0.03) this.puff(x + Math.random(), y + POOL_SURFACE + 0.05, 0, -0.6, 0.6, 0.05, "rgba(196,240,106,0.8)", 0, false);
        }
      }
    }
  }

  private drawDoors(g: CanvasRenderingContext2D, world: World, time: number, dt: number): void {
    const s = this.s;
    for (const hero of ["chori", "pan"] as Hero[]) {
      const d = world.level.doors[hero];
      const inDoor = world.heroes[hero].inDoor;
      this.doorGlow[hero] += ((inDoor ? 1 : 0) - this.doorGlow[hero]) * Math.min(1, dt * 6);
      const k = this.doorGlow[hero];
      const X = (d.x - 0.15) * s;
      const Y = (d.y - 0.95) * s;
      const W = 1.3 * s;
      const H = 1.95 * s;
      const col = hero === "chori" ? "#ff5a3a" : "#3aa8ff";
      // Marco tallado.
      g.fillStyle = "#4e4834";
      g.beginPath();
      g.roundRect(X - s * 0.1, Y - s * 0.1, W + s * 0.2, H + s * 0.1, [s * 0.6, s * 0.6, 0, 0]);
      g.fill();
      // Hueco: se ilumina cuando su dueño esta parado adelante.
      const grad = g.createLinearGradient(0, Y, 0, Y + H);
      grad.addColorStop(0, hero === "chori" ? `rgba(255,120,60,${0.25 + k * 0.6})` : `rgba(80,170,255,${0.25 + k * 0.6})`);
      grad.addColorStop(1, "#120e08");
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(X, Y, W, H, [s * 0.5, s * 0.5, 0, 0]);
      g.fill();
      // Simbolo del dueño.
      g.save();
      g.globalAlpha = 0.7 + 0.3 * Math.sin(time * 3);
      g.fillStyle = col;
      if (hero === "chori") {
        g.beginPath();
        g.roundRect(X + W / 2 - s * 0.12, Y + s * 0.35, s * 0.24, s * 0.62, s * 0.12);
        g.fill();
      } else {
        g.beginPath();
        g.ellipse(X + W / 2, Y + s * 0.7, s * 0.28, s * 0.22, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      if (k > 0.05) {
        g.save();
        g.globalCompositeOperation = "lighter";
        const halo = g.createRadialGradient(X + W / 2, Y + H * 0.5, 0, X + W / 2, Y + H * 0.5, s * 2);
        halo.addColorStop(0, hero === "chori" ? `rgba(255,110,50,${0.35 * k})` : `rgba(70,160,255,${0.35 * k})`);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = halo;
        g.fillRect(X - s * 2, Y - s, W + s * 4, H + s * 2);
        g.restore();
      }
    }
  }

  private drawGems(g: CanvasRenderingContext2D, world: World, time: number): void {
    const s = this.s;
    world.level.gems.forEach((gem, i) => {
      if (!world.gemsLeft.has(i)) return;
      const cx = (gem.x + 0.5) * s;
      const cy = (gem.y + 0.5) * s + Math.sin(time * 2.5 + i) * s * 0.06;
      g.save();
      g.translate(cx, cy);
      g.scale(1.45, 1.45);
      g.translate(-cx, -cy);
      g.save();
      g.globalCompositeOperation = "lighter";
      const halo = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.7);
      halo.addColorStop(0, gem.hero === "chori" ? "rgba(255,80,40,0.35)" : "rgba(120,200,255,0.35)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo;
      g.fillRect(cx - s, cy - s, s * 2, s * 2);
      g.restore();
      if (gem.hero === "chori") {
        // Aji: cuerpo curvo rojo y cabito verde.
        g.fillStyle = "#e0281a";
        g.beginPath();
        g.moveTo(cx - s * 0.15, cy - s * 0.18);
        g.quadraticCurveTo(cx + s * 0.32, cy - s * 0.12, cx + s * 0.12, cy + s * 0.3);
        g.quadraticCurveTo(cx - s * 0.02, cy - s * 0.02, cx - s * 0.2, cy - s * 0.08);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,200,180,0.6)";
        g.beginPath();
        g.ellipse(cx + s * 0.02, cy - s * 0.08, s * 0.08, s * 0.03, 0.4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#3a8a2a";
        g.lineWidth = Math.max(1.5, s * 0.07);
        g.beginPath();
        g.moveTo(cx - s * 0.16, cy - s * 0.14);
        g.quadraticCurveTo(cx - s * 0.28, cy - s * 0.28, cx - s * 0.18, cy - s * 0.34);
        g.stroke();
      } else {
        // Cubito: cuadrado redondeado translucido con brillo.
        g.fillStyle = "rgba(170,225,255,0.85)";
        g.beginPath();
        g.roundRect(cx - s * 0.2, cy - s * 0.2, s * 0.4, s * 0.4, s * 0.08);
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = Math.max(1, s * 0.04);
        g.stroke();
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.fillRect(cx - s * 0.12, cy - s * 0.13, s * 0.1, s * 0.05);
      }
      g.restore();
      // Destello que gira: llama la atencion de lejos.
      const tw = (time * 1.3 + i * 0.7) % 3;
      if (tw < 0.5) {
        const k = Math.sin((tw / 0.5) * Math.PI);
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = `rgba(255,255,240,${0.8 * k})`;
        g.lineWidth = Math.max(1, s * 0.04);
        g.beginPath();
        g.moveTo(cx - s * 0.35 * k, cy - s * 0.2);
        g.lineTo(cx + s * 0.35 * k, cy - s * 0.2);
        g.moveTo(cx + s * 0.2, cy - s * 0.55 * k);
        g.lineTo(cx + s * 0.2, cy + s * 0.15 * k);
        g.stroke();
        g.restore();
      }
    });
  }

  private drawPlates(g: CanvasRenderingContext2D, world: World): void {
    const s = this.s;
    for (const p of world.plates) {
      const X = (p.def.x + 0.05) * s;
      const Y = (p.def.y + 1) * s;
      const down = p.pressed ? 0.07 : 0.2;
      g.fillStyle = "#4e4834";
      g.beginPath();
      g.roundRect(X - s * 0.05, Y - s * 0.12, s, s * 0.12, [s * 0.05, s * 0.05, 0, 0]);
      g.fill();
      g.fillStyle = chColor(p.def.ch);
      g.beginPath();
      g.roundRect(X + s * 0.08, Y - s * 0.12 - down * s, s * 0.74, down * s, [s * 0.08, s * 0.08, 0, 0]);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(X + s * 0.14, Y - s * 0.12 - down * s + 1, s * 0.62, Math.max(1, s * 0.04));
      if (p.pressed) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.fillStyle = chColor(p.def.ch) + "55";
        g.fillRect(X - s * 0.1, Y - s * 0.5, s * 1.04, s * 0.5);
        g.restore();
      }
    }
  }

  private drawLevers(g: CanvasRenderingContext2D, world: World): void {
    const s = this.s;
    for (const l of world.levers) {
      const bx = (l.def.x + 0.5) * s;
      const by = (l.def.y + 1) * s;
      const ang = l.on ? 0.65 : -0.65;
      g.save();
      g.translate(bx, by - s * 0.15);
      g.rotate(ang);
      g.strokeStyle = "#7a5228";
      g.lineWidth = Math.max(2, s * 0.09);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -s * 0.7);
      g.stroke();
      g.fillStyle = chColor(l.def.ch);
      g.beginPath();
      g.arc(0, -s * 0.72, s * 0.13, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.fillStyle = "#5a5440";
      g.beginPath();
      g.ellipse(bx, by, s * 0.4, s * 0.24, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = chColor(l.def.ch);
      g.fillRect(bx - s * 0.25, by - s * 0.05, s * 0.5, s * 0.05);
    }
  }

  private drawGates(g: CanvasRenderingContext2D, world: World): void {
    const s = this.s;
    for (const gt of world.gates) {
      const r = gt.rect;
      if (r.w < 0.01 || r.h < 0.01) continue;
      const X = r.x * s;
      const Y = r.y * s;
      const W = r.w * s;
      const H = r.h * s;
      g.fillStyle = "#5a5440";
      g.fillRect(X, Y, W, H);
      g.fillStyle = "rgba(0,0,0,0.25)";
      for (let yy = Y + s * 0.5; yy < Y + H; yy += s) g.fillRect(X, yy, W, 1);
      // Franja del canal.
      g.fillStyle = chColor(gt.def.ch);
      const vertical = gt.def.h >= gt.def.w;
      if (vertical) g.fillRect(X + W * 0.4, Y, W * 0.2, H);
      else g.fillRect(X, Y + H * 0.4, W, H * 0.2);
      g.strokeStyle = "#2e2a1c";
      g.lineWidth = 1;
      g.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
    }
  }

  private drawLifts(g: CanvasRenderingContext2D, world: World): void {
    const s = this.s;
    for (const l of world.lifts) {
      const r = l.rect;
      const X = r.x * s;
      const Y = r.y * s;
      const W = r.w * s;
      // Cadenas hasta el techo.
      let ceil = Math.floor(r.y) - 1;
      while (ceil > 0 && world.tileAt(Math.floor(r.x + 0.2), ceil) !== "solid") ceil--;
      g.strokeStyle = "rgba(160,150,120,0.6)";
      g.lineWidth = Math.max(1, s * 0.04);
      g.setLineDash([s * 0.12, s * 0.08]);
      for (const cx of [X + s * 0.2, X + W - s * 0.2]) {
        g.beginPath();
        g.moveTo(cx, (ceil + 1) * s);
        g.lineTo(cx, Y);
        g.stroke();
      }
      g.setLineDash([]);
      g.fillStyle = "#6f6a4c";
      g.fillRect(X, Y, W, r.h * s);
      g.fillStyle = STONE_LIGHT;
      g.fillRect(X, Y, W, Math.max(2, s * 0.08));
      g.fillStyle = chColor(l.def.ch);
      g.fillRect(X + s * 0.15, Y + r.h * s * 0.45, W - s * 0.3, Math.max(2, s * 0.08));
    }
  }

  private drawBoxes(g: CanvasRenderingContext2D, world: World): void {
    const s = this.s;
    for (const b of world.boxes) {
      const X = b.x * s;
      const Y = b.y * s;
      const W = b.w * s;
      g.fillStyle = "#8a5a2a";
      g.fillRect(X, Y, W, W);
      g.strokeStyle = "#5a3614";
      g.lineWidth = Math.max(1.5, s * 0.07);
      g.strokeRect(X + g.lineWidth / 2, Y + g.lineWidth / 2, W - g.lineWidth, W - g.lineWidth);
      g.beginPath();
      g.moveTo(X + s * 0.1, Y + s * 0.1);
      g.lineTo(X + W - s * 0.1, Y + W - s * 0.1);
      g.moveTo(X + W - s * 0.1, Y + s * 0.1);
      g.lineTo(X + s * 0.1, Y + W - s * 0.1);
      g.stroke();
      g.fillStyle = "rgba(255,220,160,0.15)";
      g.fillRect(X, Y, W, Math.max(1, s * 0.06));
    }
  }

  private drawFans(g: CanvasRenderingContext2D, world: World, time: number, _dt: number): void {
    const s = this.s;
    for (const f of world.fans) {
      const on = !f.ch || world.channel(f.ch);
      const X = f.x * s;
      const base = (f.y + f.h) * s;
      if (on) {
        // Columna de aire: un velo que sube y se desvanece arriba.
        const grad = g.createLinearGradient(0, f.y * s, 0, base);
        grad.addColorStop(0, "rgba(200,220,255,0)");
        grad.addColorStop(1, "rgba(200,220,255,0.12)");
        g.fillStyle = grad;
        g.fillRect(X + s * 0.1, f.y * s, f.w * s - s * 0.2, f.h * s);
        g.strokeStyle = "rgba(220,235,255,0.35)";
        g.lineWidth = Math.max(1, s * 0.035);
        for (let k = 0; k < f.w * 3; k++) {
          const lx = X + ((k + 0.5) / (f.w * 3)) * f.w * s;
          const ph = (time * 2.2 + k * 0.37) % 1;
          const ly = base - ph * f.h * s;
          g.beginPath();
          g.moveTo(lx, ly);
          g.lineTo(lx, ly - s * 0.7);
          g.stroke();
        }
      }
      g.fillStyle = "#3e3a28";
      g.fillRect(X - s * 0.1, base - s * 0.34, f.w * s + s * 0.2, s * 0.34);
      g.fillStyle = "#2a2618";
      for (let i = 0; i < f.w * 4; i++) g.fillRect(X + (i + 0.3) * (s / 4), base - s * 0.3, s * 0.08, s * 0.26);
      g.strokeStyle = f.ch ? chColor(f.ch) : "#a59d72";
      g.lineWidth = Math.max(1.5, s * 0.07);
      const spin = on ? time * 18 : 0;
      for (let i = 0; i < f.w; i++) {
        const cx = X + (i + 0.5) * s;
        g.beginPath();
        g.ellipse(cx, base - s * 0.38, Math.abs(Math.cos(spin + i)) * s * 0.4 + 1, s * 0.06, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  private drawHero(g: CanvasRenderingContext2D, h: HeroBody, time: number, dt: number, ghost: boolean): void {
    const a = this.anim[h.hero];
    if (h.alive) a.deadT = 0;
    else a.deadT = Math.min(1, a.deadT + dt * 1.6);
    const moving = Math.abs(h.vx) > 0.5 && h.onGround;
    a.walk += moving ? dt * Math.abs(h.vx) * 2.2 : 0;
    if (!moving) a.walk += (Math.round(a.walk / Math.PI) * Math.PI - a.walk) * Math.min(1, dt * 12);
    a.squash += (0 - a.squash) * Math.min(1, dt * 9);
    const air = h.onGround ? 0 : h.vy < 0 ? Math.min(0.6, -h.vy / 30) : -Math.min(0.2, h.vy / 60);
    const pose = {
      hero: h.hero,
      x: (h.x + h.w / 2) * this.s,
      y: (h.y + h.h) * this.s,
      s: this.s * 1.14,
      face: h.face,
      walk: a.walk,
      stretch: Math.max(-1, Math.min(1, a.squash + air)),
      dead: a.deadT,
      time,
      happy: h.inDoor,
      alpha: ghost ? 0.45 : 1,
    };
    // Sombra de contacto.
    if (h.onGround) {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.ellipse(pose.x, pose.y, this.s * 0.4, this.s * 0.08, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (h.hero === "chori") {
      drawChori(g, pose);
      // Esta caliente: humea un poco.
      if (h.alive && Math.random() < dt * 6) this.puff(h.x + h.w / 2 + (Math.random() - 0.5) * 0.3, h.y + 0.1, (Math.random() - 0.5) * 0.3, -0.8, 1, 0.07, "rgba(200,190,180,0.25)", -0.3, false);
    } else drawPan(g, pose);
  }

  private drawParticles(g: CanvasRenderingContext2D, dt: number): void {
    const s = this.s;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      g.save();
      if (p.glow) g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, k * 1.5);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x * s, p.y * s, Math.max(1, p.size * s * (p.glow ? 1 : 1 + (1 - k))), 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
}
