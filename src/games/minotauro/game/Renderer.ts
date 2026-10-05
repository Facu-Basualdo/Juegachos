import { DIRS, E, N, S, W, mulberry32, type Maze } from "./Maze";
import type { Minotaur } from "./Minotaur";
import type { Player } from "./Player";
import { drawDoll, facingOf, type DollLook, type Facing } from "./Doll";
import { DollStage } from "./Doll3D";

/** Paleta (DESIGN.md "Losa de Creta"). */
const C = {
  floor: "#6b4a2b",
  floorDark: "#5a3c22",
  floorLight: "#7d5733",
  wallTop: "#b07a45",
  wallMid: "#8f5c30",
  wallLo: "#6e4322",
  wallHi: "#e6b47c",
  wallShadow: "rgba(26, 13, 4, 0.55)",
  frame: "#4b2f19",
  frameHi: "#e2b07a",
  frameLo: "#2a190c",
  thread: "#b8231b",
  gold: "#e8b64a",
  eye: "#ff3a1f",
};

/** Lo que el Renderer necesita saber del cuadro. */
export interface Scene {
  maze: Maze;
  player: Player;
  mino: Minotaur;
  /** Radio de la luz en celdas (con el titileo ya aplicado). */
  light: number;
  /** Anforas que quedan. */
  amphorae: { x: number; y: number }[];
  /** 0-1 del vistazo al bajar (la losa se ve entera y se talla); 1 = ya oscuro. */
  reveal: number;
  /** Cercania del Minotauro 0-1 (pulso rojo en los bordes). */
  dread: number;
  /** Fase del latido 0-1, para que el pulso vaya con el sonido. */
  beat: number;
  /** Temblor de pantalla en px. */
  shake: number;
  /** Como se ve Teseo (el color de su asiento en la sala; en solo, el 0). */
  look: DollLook;
  /** Otros jugadores de la sala en este mismo nivel. */
  rivals: { x: number; y: number; name: string; alive: boolean; look: DollLook }[];
  /** Mostrar al jugador (no despues de que lo atrapan). */
  showPlayer: boolean;
  time: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  kind: "ember" | "dust" | "gold" | "breath" | "smoke";
}

/**
 * Dibujo de Minotauro (canvas 2D). La losa (marco con greca, piso de arenisca y muros
 * levantados) se pinta UNA vez por nivel en un canvas aparte; cada cuadro se dibujan
 * encima el hilo, las anforas, el ovillo, el Minotauro, y despues la
 * oscuridad.
 *
 * La oscuridad es lo que hace el juego (DESIGN.md):
 *  - La luz de la antorcha NO atraviesa paredes: solo alumbra las celdas a las que se
 *    llega caminando dentro de su radio (BFS limitado), con caida radial suave. Asi
 *    no se ve el pasillo de al lado a traves del muro, que es lo que hace funcionar el
 *    sigilo: si no lo ves, el tampoco te ve.
 *  - Lo ya alumbrado queda en la memoria, tenue y con bordes suaves: una textura de
 *    1 px por celda estirada con suavizado.
 *  - Despues de la oscuridad va lo que se ve igual: el brillo del oro, los
 *    ojos del Minotauro despierto y cerca, las brasas.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly slab = document.createElement("canvas");
  private readonly dark = document.createElement("canvas");
  private readonly lightCv = document.createElement("canvas");
  private readonly memory = document.createElement("canvas");
  private readonly reach = document.createElement("canvas");
  private memData: Uint8ClampedArray | null = null;
  private forgetAcc = 0;
  private readonly particles: Particle[] = [];
  private maze: Maze | null = null;
  private dpr = 1;
  private w = 0;
  private h = 0;
  /** Losa completa (marco incluido) e interior, en px CSS. */
  board = { x: 0, y: 0, size: 100 };
  inner = { x: 0, y: 0, size: 100 };
  cell = 10;
  /** Espacio que el HUD deja libre a los costados / arriba / abajo. */
  private margins = { left: 0, right: 0, top: 0, bottom: 0 };
  /** Paso y orientacion de cada muñeco ("" = el propio), derivados de cuanto se movio. */
  private readonly gait = new Map<string, { x: number; y: number; phase: number; stride: number; facing: Facing; yaw: number }>();
  /** Muñecos en 3D (Three.js); null si no hay WebGL, y entonces van en 2D. */
  private dolls: DollStage | null | undefined;
  /** Punta de la antorcha propia en celdas (de ahi salen las brasas). */
  private torch = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    // Medidas desde el arranque: sin esto el primer nivel se pintaba con un marco de
    // ancho 0 y la greca (unidad 0) se quedaba en un bucle infinito.
    this.resize();
  }

  setMargins(m: { left: number; right: number; top: number; bottom: number }): void {
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
    const availW = this.w - m.left - m.right;
    const availH = this.h - m.top - m.bottom;
    const size = Math.max(160, Math.min(availW, availH));
    this.board = { x: m.left + (availW - size) / 2, y: m.top + (availH - size) / 2, size };
    const frame = Math.round(size * 0.05);
    this.inner = { x: this.board.x + frame, y: this.board.y + frame, size: size - frame * 2 };
    if (this.maze) this.setMaze(this.maze);
  }

  /** Nivel nuevo: repinta la losa y borra la memoria. */
  setMaze(maze: Maze): void {
    const fresh = this.maze !== maze;
    this.maze = maze;
    this.cell = this.inner.size / maze.w;
    this.paintSlab(maze);
    for (const cv of [this.dark, this.lightCv]) {
      cv.width = Math.round(this.inner.size * this.dpr);
      cv.height = Math.round(this.inner.size * this.dpr);
    }
    if (fresh || !this.memData) {
      this.memory.width = maze.w;
      this.memory.height = maze.h;
      this.reach.width = maze.w;
      this.reach.height = maze.h;
      this.memData = new Uint8ClampedArray(maze.w * maze.h * 4);
    }
  }

  /** Borra de a poco la memoria de lo recorrido (`amount` = fraccion de 0 a 1 por llamada). */
  forget(amount: number): void {
    const mem = this.memData;
    if (!mem) return;
    // La memoria es de 8 bits: se acumula la fraccion para que el ritmo no dependa de los fps.
    this.forgetAcc += amount * 255;
    const d = Math.floor(this.forgetAcc);
    if (d < 1) return;
    this.forgetAcc -= d;
    for (let i = 3; i < mem.length; i += 4) if (mem[i] > 0) mem[i] = Math.max(0, mem[i] - d);
  }

  /** Celda (x, y) a px CSS del centro. */
  px(x: number): number {
    return this.inner.x + (x + 0.5) * this.cell;
  }

  py(y: number): number {
    return this.inner.y + (y + 0.5) * this.cell;
  }

  // ---------- Particulas ----------

  burst(kind: Particle["kind"], x: number, y: number, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      const life = kind === "gold" ? 0.9 + Math.random() * 0.6 : 0.6 + Math.random() * 0.5;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (kind === "gold" ? speed * 0.4 : 0), life, max: life, size: 0.04 + Math.random() * 0.05, kind });
    }
  }

  private emit(s: Scene, dt: number): void {
    // Brasas que suben de la antorcha.
    if (s.showPlayer && Math.random() < dt * 14) {
      this.particles.push({
        x: this.torch.x + (Math.random() - 0.5) * 0.08,
        y: this.torch.y - 0.05,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -0.5 - Math.random() * 0.5,
        life: 0.7 + Math.random() * 0.6,
        max: 1.3,
        size: 0.025 + Math.random() * 0.025,
        kind: "ember",
      });
    }
    // Aliento del Minotauro cuando persigue.
    if (s.mino.state === "chase" && Math.random() < dt * 9) {
      const hx = Math.cos(s.mino.heading);
      const hy = Math.sin(s.mino.heading);
      this.particles.push({
        x: s.mino.fx + hx * 0.42,
        y: s.mino.fy + hy * 0.42,
        vx: hx * 0.5 + (Math.random() - 0.5) * 0.3,
        vy: hy * 0.5 + (Math.random() - 0.5) * 0.3,
        life: 0.6,
        max: 0.6,
        size: 0.07 + Math.random() * 0.05,
        kind: "breath",
      });
    }
  }

  /** Polvo bajo las pezuñas (lo llama el juego en cada paso del Minotauro). */
  dust(x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      this.particles.push({ x: x + (Math.random() - 0.5) * 0.4, y: y + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, life: 0.5, max: 0.5, size: 0.06 + Math.random() * 0.06, kind: "dust" });
    }
  }

  // ---------- Cuadro ----------

  draw(s: Scene, dt: number): void {
    const ctx = this.ctx;
    const maze = s.maze;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const sx = s.shake ? (Math.random() - 0.5) * s.shake : 0;
    const sy = s.shake ? (Math.random() - 0.5) * s.shake : 0;
    ctx.translate(sx, sy);

    // Sombra de la losa sobre el fondo.
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 26;
    ctx.fillStyle = "#000";
    ctx.fillRect(this.board.x, this.board.y, this.board.size, this.board.size);
    ctx.restore();
    ctx.drawImage(this.slab, this.board.x, this.board.y, this.board.size, this.board.size);

    this.emit(s, dt);
    this.stepParticles(dt);

    // ---- Mundo (lo tapa la oscuridad) ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.inner.x, this.inner.y, this.inner.size, this.inner.size);
    ctx.clip();
    this.drawThread(s);
    for (const a of s.amphorae) this.drawAmphora(a.x, a.y, s.time);
    this.drawSpool(maze.exit.x, maze.exit.y, s.time);
    this.drawParticles(["dust", "breath"]);
    if (s.reveal >= 1 || s.mino.awake) this.drawMinotaur(s.mino, s.time, { x: s.player.fx, y: s.player.fy });

    // ---- Oscuridad ----
    const lit = this.lightCells(s);
    if (s.reveal < 1) {
      // Vistazo al bajar: se ve la losa entera y se va oscureciendo.
      const a = smooth(Math.max(0, (s.reveal - 0.55) / 0.45));
      this.drawDarkness(s, lit, a);
    } else {
      this.drawDarkness(s, lit, 1);
    }

    // ---- Lo que se ve igual en la oscuridad ----
    this.drawGlints(s);
    this.drawEyes(s);
    this.drawParticles(["ember", "gold", "smoke"]);
    ctx.restore();

    // Los muñecos van afuera del recorte: en la primera fila la cabeza y la antorcha
    // asoman sobre el marco (es una vista en tres cuartos), y cortadas quedaban rotas.
    for (const r of s.rivals) this.drawRival(r, s.time, dt);
    if (s.showPlayer) {
      const h = s.player.heading;
      const tip = this.drawTheseus("", s.player.fx, s.player.fy, s.look, s.time, dt, facingOf(Math.cos(h), Math.sin(h), "s"));
      this.torch = { x: (tip.x - this.inner.x) / this.cell - 0.5, y: (tip.y - this.inner.y) / this.cell - 0.5 };
      this.drawFlame(tip.x, tip.y, s.time, s.light, 1);
    }

    // Pulso rojo en los bordes cuando el Minotauro esta cerca, al ritmo del latido.
    if (s.dread > 0.05) {
      const pulse = 0.55 + 0.45 * Math.pow(1 - s.beat, 3);
      const g = ctx.createRadialGradient(
        this.board.x + this.board.size / 2,
        this.board.y + this.board.size / 2,
        this.board.size * 0.3,
        this.board.x + this.board.size / 2,
        this.board.y + this.board.size / 2,
        this.board.size * 0.75,
      );
      g.addColorStop(0, "rgba(120, 10, 4, 0)");
      g.addColorStop(1, `rgba(150, 14, 6, ${0.42 * s.dread * pulse})`);
      ctx.fillStyle = g;
      ctx.fillRect(this.board.x, this.board.y, this.board.size, this.board.size);
    }
  }

  // ---------- Luz y memoria ----------

  /**
   * Celdas que alumbra la antorcha: BFS desde la celda del jugador hasta la distancia
   * de la luz. Devuelve la intensidad 0-1 de cada celda (0 si no llega).
   */
  private lightCells(s: Scene): Float32Array {
    const maze = s.maze;
    const out = new Float32Array(maze.w * maze.h);
    const cx = s.player.cx;
    const cy = s.player.cy;
    const R = s.light;
    const dist = new Int16Array(maze.w * maze.h).fill(-1);
    const q = [maze.index(cx, cy)];
    dist[q[0]] = 0;
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      const x = i % maze.w;
      const y = Math.floor(i / maze.w);
      const e = Math.hypot(x - s.player.fx, y - s.player.fy);
      out[i] = Math.max(0, 1 - Math.pow(Math.min(1, e / (R + 0.35)), 2));
      if (dist[i] >= Math.ceil(R) + 1) continue;
      for (let d = 0; d < 4; d++) {
        if (!maze.open(x, y, d)) continue;
        const j = maze.index(x + DIRS[d].dx, y + DIRS[d].dy);
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    // A la memoria va lo bien alumbrado.
    const mem = this.memData!;
    for (let i = 0; i < out.length; i++) {
      const v = Math.min(255, Math.round(out[i] * 1.6 * 255));
      if (v > mem[i * 4 + 3]) {
        mem[i * 4] = mem[i * 4 + 1] = mem[i * 4 + 2] = 255;
        mem[i * 4 + 3] = v;
      }
    }
    return out;
  }

  private drawDarkness(s: Scene, lit: Float32Array, amount: number): void {
    if (amount <= 0.001) return;
    const maze = s.maze;
    const k = this.dpr;
    const size = this.inner.size;
    // Memoria (1 px por celda, estirada con suavizado).
    const memCtx = this.memory.getContext("2d")!;
    memCtx.putImageData(new ImageData(this.memData!.slice(), maze.w, maze.h), 0, 0);
    // Alcance de la luz (1 px por celda): limita la luz radial a las celdas alcanzables.
    const reachCtx = this.reach.getContext("2d")!;
    const rd = new Uint8ClampedArray(maze.w * maze.h * 4);
    for (let i = 0; i < lit.length; i++) {
      rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = 255;
      rd[i * 4 + 3] = lit[i] > 0 ? 255 : 0;
    }
    reachCtx.putImageData(new ImageData(rd, maze.w, maze.h), 0, 0);

    // Luz: degrade radial recortado a las celdas alcanzables.
    const lc = this.lightCv.getContext("2d")!;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "source-over";
    lc.clearRect(0, 0, this.lightCv.width, this.lightCv.height);
    const lx = (s.player.fx + 0.5) * this.cell * k;
    const ly = (s.player.fy + 0.5) * this.cell * k;
    const R = (s.light + 0.6) * this.cell * k;
    const g = lc.createRadialGradient(lx, ly, 0, lx, ly, R);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.92)");
    g.addColorStop(0.8, "rgba(255,255,255,0.4)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    lc.fillStyle = g;
    lc.fillRect(0, 0, this.lightCv.width, this.lightCv.height);
    lc.globalCompositeOperation = "destination-in";
    lc.imageSmoothingEnabled = true;
    lc.drawImage(this.reach, 0, 0, this.lightCv.width, this.lightCv.height);

    // Oscuridad: casi negra, menos lo recordado y menos la luz.
    const dc = this.dark.getContext("2d")!;
    dc.setTransform(1, 0, 0, 1, 0, 0);
    dc.globalCompositeOperation = "source-over";
    dc.clearRect(0, 0, this.dark.width, this.dark.height);
    dc.fillStyle = `rgba(9, 5, 2, ${0.985 * amount})`;
    dc.fillRect(0, 0, this.dark.width, this.dark.height);
    dc.globalCompositeOperation = "destination-out";
    dc.imageSmoothingEnabled = true;
    dc.globalAlpha = 0.26;
    dc.drawImage(this.memory, 0, 0, this.dark.width, this.dark.height);
    dc.globalAlpha = 1;
    dc.drawImage(this.lightCv, 0, 0);
    dc.globalCompositeOperation = "source-over";

    const ctx = this.ctx;
    ctx.drawImage(this.dark, this.inner.x, this.inner.y, size, size);

    // Calor de la antorcha sobre la piedra.
    if (s.showPlayer) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const cx = this.px(s.player.fx);
      const cy = this.py(s.player.fy);
      const rr = (s.light + 0.4) * this.cell;
      const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      warm.addColorStop(0, "rgba(255, 150, 60, 0.22)");
      warm.addColorStop(0.5, "rgba(220, 110, 40, 0.08)");
      warm.addColorStop(1, "rgba(200, 90, 30, 0)");
      ctx.fillStyle = warm;
      ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      ctx.restore();
    }
  }

  // ---------- Losa (fija por nivel) ----------

  private paintSlab(maze: Maze): void {
    const k = this.dpr;
    const size = this.board.size;
    const cv = this.slab;
    cv.width = Math.round(size * k);
    cv.height = Math.round(size * k);
    const g = cv.getContext("2d")!;
    g.setTransform(k, 0, 0, k, 0, 0);
    const rand = mulberry32(maze.w * 977 + maze.exit.x * 31 + maze.exit.y);

    // Marco de piedra.
    const fr = (size - this.inner.size) / 2;
    const frameGrad = g.createLinearGradient(0, 0, size, size);
    frameGrad.addColorStop(0, "#5a3a20");
    frameGrad.addColorStop(0.5, C.frame);
    frameGrad.addColorStop(1, "#33200f");
    g.fillStyle = frameGrad;
    g.fillRect(0, 0, size, size);
    mottle(g, 0, 0, size, size, rand, "rgba(0,0,0,0.12)", "rgba(255,210,160,0.05)", Math.round(size * 0.4));
    // Biseles del marco.
    g.strokeStyle = "rgba(255, 214, 160, 0.35)";
    g.lineWidth = 1.5;
    g.strokeRect(1.5, 1.5, size - 3, size - 3);
    g.strokeStyle = "rgba(0, 0, 0, 0.6)";
    g.strokeRect(fr - 1.5, fr - 1.5, this.inner.size + 3, this.inner.size + 3);
    // Greca alrededor.
    meander(g, fr * 0.22, fr * 0.56, size, fr);
    // Rosetas en las esquinas.
    for (const [x, y] of [[fr / 2, fr / 2], [size - fr / 2, fr / 2], [fr / 2, size - fr / 2], [size - fr / 2, size - fr / 2]]) {
      rosette(g, x, y, fr * 0.36);
    }

    // Piso de arenisca.
    const ix = fr;
    const isz = this.inner.size;
    const floorGrad = g.createRadialGradient(ix + isz * 0.5, ix + isz * 0.45, isz * 0.1, ix + isz * 0.5, ix + isz * 0.5, isz * 0.75);
    floorGrad.addColorStop(0, C.floorLight);
    floorGrad.addColorStop(1, C.floorDark);
    g.fillStyle = floorGrad;
    g.fillRect(ix, ix, isz, isz);
    mottle(g, ix, ix, isz, isz, rand, "rgba(40, 20, 6, 0.10)", "rgba(255, 220, 170, 0.06)", Math.round(isz * 0.9));
    grain(g, ix, ix, isz, isz, rand, Math.round(isz * isz * 0.012));
    // Juntas de las baldosas, apenas marcadas.
    const cs = isz / maze.w;
    g.strokeStyle = "rgba(30, 14, 4, 0.16)";
    g.lineWidth = 1;
    for (let i = 1; i < maze.w; i++) {
      g.beginPath();
      g.moveTo(ix + i * cs, ix);
      g.lineTo(ix + i * cs, ix + isz);
      g.moveTo(ix, ix + i * cs);
      g.lineTo(ix + isz, ix + i * cs);
      g.stroke();
    }
    // Ovillo de salida: un circulo grabado en el piso donde esta.
    g.strokeStyle = "rgba(232, 182, 74, 0.35)";
    g.lineWidth = Math.max(1, cs * 0.04);
    g.beginPath();
    g.arc(ix + (maze.exit.x + 0.5) * cs, ix + (maze.exit.y + 0.5) * cs, cs * 0.38, 0, Math.PI * 2);
    g.stroke();
    // Largada: una espiral grabada.
    g.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.2) {
      const r = (a / (Math.PI * 5)) * cs * 0.32;
      const x = ix + (maze.start.x + 0.5) * cs + Math.cos(a) * r;
      const y = ix + (maze.start.y + 0.5) * cs + Math.sin(a) * r;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = "rgba(30, 14, 4, 0.35)";
    g.stroke();

    // Muros: segmentos levantados con sombra, cara superior y biseles.
    const t = Math.max(3, cs * 0.24);
    const segs: [number, number, number, number][] = [];
    for (let y = 0; y < maze.h; y++) {
      for (let x = 0; x < maze.w; x++) {
        const wv = maze.walls[maze.index(x, y)];
        const x0 = ix + x * cs;
        const y0 = ix + y * cs;
        if (wv & N) segs.push([x0 - t / 2, y0 - t / 2, cs + t, t]);
        if (wv & W) segs.push([x0 - t / 2, y0 - t / 2, t, cs + t]);
        if (y === maze.h - 1 && wv & S) segs.push([x0 - t / 2, y0 + cs - t / 2, cs + t, t]);
        if (x === maze.w - 1 && wv & E) segs.push([x0 + cs - t / 2, y0 - t / 2, t, cs + t]);
      }
    }
    g.save();
    g.beginPath();
    g.rect(ix, ix, isz, isz);
    g.clip();
    // Sombra corta hacia abajo a la derecha.
    g.fillStyle = C.wallShadow;
    const so = t * 0.45;
    for (const [x, y, w, h] of segs) g.fillRect(x + so, y + so, w, h);
    g.restore();
    const wallGrad = g.createLinearGradient(ix, ix, ix + isz, ix + isz);
    wallGrad.addColorStop(0, "#c08a50");
    wallGrad.addColorStop(1, C.wallMid);
    g.fillStyle = wallGrad;
    for (const [x, y, w, h] of segs) g.fillRect(x, y, w, h);
    // Cara superior moteada: la textura del bloque.
    g.save();
    g.beginPath();
    for (const [x, y, w, h] of segs) g.rect(x, y, w, h);
    g.clip();
    mottle(g, ix - t, ix - t, isz + t * 2, isz + t * 2, rand, "rgba(60, 30, 8, 0.16)", "rgba(255, 220, 170, 0.10)", Math.round(isz * 0.6));
    g.restore();
    // Biseles: luz arriba a la izquierda, sombra abajo a la derecha.
    // Biseles: luz arriba a la izquierda, sombra abajo a la derecha. Cada segmento
    // marca solo sus bordes LARGOS: con los cuatro bordes, en cada union quedaba una
    // costura clara cruzando el muro.
    g.lineWidth = Math.max(1, t * 0.14);
    g.strokeStyle = "rgba(255, 222, 170, 0.5)";
    g.beginPath();
    for (const [x, y, w, h] of segs) {
      if (w >= h) {
        g.moveTo(x, y + 0.5);
        g.lineTo(x + w, y + 0.5);
      } else {
        g.moveTo(x + 0.5, y);
        g.lineTo(x + 0.5, y + h);
      }
    }
    g.stroke();
    g.strokeStyle = "rgba(40, 18, 4, 0.5)";
    g.beginPath();
    for (const [x, y, w, h] of segs) {
      if (w >= h) {
        g.moveTo(x, y + h - 0.5);
        g.lineTo(x + w, y + h - 0.5);
      } else {
        g.moveTo(x + w - 0.5, y);
        g.lineTo(x + w - 0.5, y + h);
      }
    }
    g.stroke();
  }

  // ---------- Piezas ----------

  private drawThread(s: Scene): void {
    const pts = s.player.thread.map((c) => [this.px(c.x), this.py(c.y)] as [number, number]);
    if (s.showPlayer) pts.push([this.px(s.player.fx), this.py(s.player.fy)]);
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const wob = this.cell * 0.07;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        // Comba de lana: el punto medio se corre un poco hacia un costado.
        const mx = (x0 + x1) / 2 + Math.sin(i * 1.7) * wob;
        const my = (y0 + y1) / 2 + Math.cos(i * 2.3) * wob;
        ctx.quadraticCurveTo(mx, my, x1, y1);
      }
    };
    path();
    ctx.strokeStyle = "rgba(20, 6, 2, 0.45)";
    ctx.lineWidth = Math.max(2, this.cell * 0.09);
    ctx.translate(this.cell * 0.03, this.cell * 0.04);
    ctx.stroke();
    ctx.translate(-this.cell * 0.03, -this.cell * 0.04);
    path();
    ctx.strokeStyle = C.thread;
    ctx.lineWidth = Math.max(1.5, this.cell * 0.06);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 120, 100, 0.35)";
    ctx.lineWidth = Math.max(0.6, this.cell * 0.018);
    ctx.stroke();
    ctx.restore();
  }

  private drawAmphora(cx: number, cy: number, time: number): void {
    const ctx = this.ctx;
    const x = this.px(cx);
    const y = this.py(cy) + Math.sin(time * 2 + cx) * this.cell * 0.02;
    const s = this.cell * 0.34;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(20, 8, 2, 0.4)";
    ctx.beginPath();
    ctx.ellipse(s * 0.15, s * 0.95, s * 0.7, s * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createLinearGradient(-s, 0, s, 0);
    body.addColorStop(0, "#7a2e12");
    body.addColorStop(0.4, "#c8642c");
    body.addColorStop(1, "#5e220c");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.85);
    ctx.quadraticCurveTo(-s * 0.9, -s * 0.35, -s * 0.55, s * 0.55);
    ctx.quadraticCurveTo(0, s * 1.1, s * 0.55, s * 0.55);
    ctx.quadraticCurveTo(s * 0.9, -s * 0.35, s * 0.22, -s * 0.85);
    ctx.closePath();
    ctx.fill();
    // Banda negra con la greca chiquita, como una figura negra.
    ctx.fillStyle = "#1c0d06";
    ctx.fillRect(-s * 0.62, -s * 0.12, s * 1.24, s * 0.24);
    ctx.strokeStyle = "#c8642c";
    ctx.lineWidth = Math.max(0.6, s * 0.06);
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(i * s * 0.22 - s * 0.06, s * 0.06);
      ctx.lineTo(i * s * 0.22 - s * 0.06, -s * 0.05);
      ctx.lineTo(i * s * 0.22 + s * 0.06, -s * 0.05);
    }
    ctx.stroke();
    // Boca y asas.
    ctx.fillStyle = "#3a1608";
    ctx.fillRect(-s * 0.26, -s * 1.0, s * 0.52, s * 0.18);
    ctx.strokeStyle = "#8a3816";
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    ctx.arc(-s * 0.42, -s * 0.55, s * 0.2, Math.PI * 0.5, Math.PI * 1.5);
    ctx.moveTo(s * 0.42, -s * 0.75);
    ctx.arc(s * 0.42, -s * 0.55, s * 0.2, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 210, 150, 0.35)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.25, -s * 0.35, s * 0.08, s * 0.25, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSpool(cx: number, cy: number, time: number): void {
    const ctx = this.ctx;
    const x = this.px(cx);
    const y = this.py(cy);
    const s = this.cell * 0.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.fillStyle = "rgba(20, 8, 2, 0.4)";
    ctx.beginPath();
    ctx.ellipse(s * 0.2, s * 0.6, s * 1.1, s * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ovillo: cuerpo de hilo dorado con vueltas.
    const body = ctx.createLinearGradient(0, -s, 0, s);
    body.addColorStop(0, "#f6d9a8");
    body.addColorStop(0.45, C.gold);
    body.addColorStop(1, "#9d5a26");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(-s * 0.85, -s * 0.6, s * 1.7, s * 1.2, s * 0.25);
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 60, 20, 0.6)";
    ctx.lineWidth = Math.max(0.6, s * 0.06);
    for (let i = -3; i <= 3; i++) {
      const xx = i * s * 0.22 + Math.sin(time * 1.5 + i) * s * 0.02;
      ctx.beginPath();
      ctx.moveTo(xx - s * 0.08, -s * 0.58);
      ctx.lineTo(xx + s * 0.08, s * 0.58);
      ctx.stroke();
    }
    // Tapas de madera.
    ctx.fillStyle = "#5a3418";
    ctx.fillRect(-s * 1.05, -s * 0.78, s * 0.22, s * 1.56);
    ctx.fillRect(s * 0.83, -s * 0.78, s * 0.22, s * 1.56);
    // Brillo que recorre el oro.
    const sheen = ((time * 0.5) % 1) * 2 - 1;
    ctx.fillStyle = "rgba(255, 245, 210, 0.45)";
    ctx.beginPath();
    ctx.ellipse(sheen * s * 0.7, -s * 0.2, s * 0.12, s * 0.42, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMinotaur(m: Minotaur, time: number, lightFrom: { x: number; y: number }): void {
    const ctx = this.ctx;
    const x = this.px(m.fx);
    const y = this.py(m.fy);
    const s = this.cell * 0.52;
    // Respira: un pulso lento del lomo, mas rapido cuando persigue.
    const breathe = 1 + Math.sin(time * (m.state === "chase" ? 7 : 2.2)) * 0.03;
    const moving = m.prog < 1;
    const bob = moving ? Math.sin(m.prog * Math.PI * 2) * s * 0.05 : Math.sin(time * 1.4) * s * 0.02;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(m.heading);
    // Sombra.
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.ellipse(s * 0.05, s * 0.12, s * 1.05, s * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pezuñas: cuatro, alternando con el paso.
    const step = moving ? Math.sin(m.prog * Math.PI * 2) : 0;
    ctx.fillStyle = "#120904";
    for (const [lx, ly, ph] of [[0.55, -0.42, 1], [0.55, 0.42, -1], [-0.55, -0.42, -1], [-0.55, 0.42, 1]] as const) {
      ctx.beginPath();
      ctx.ellipse((lx + step * ph * 0.12) * s, ly * s, s * 0.16, s * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Lomo: oscuro, con el pelo hacia atras.
    const body = ctx.createRadialGradient(-s * 0.1, -s * 0.15, s * 0.1, 0, 0, s);
    body.addColorStop(0, "#3a2414");
    body.addColorStop(0.7, "#1f120a");
    body.addColorStop(1, "#0e0703");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-s * 0.08, 0, s * 0.82 * breathe, s * 0.6 * breathe, 0, 0, Math.PI * 2);
    ctx.fill();
    // Borde de luz del lado de la antorcha: sin esto era una mancha negra sin forma.
    const la = Math.atan2(this.py(lightFrom.y) - y, this.px(lightFrom.x) - x) - m.heading;
    ctx.strokeStyle = "rgba(255, 150, 70, 0.55)";
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.beginPath();
    ctx.ellipse(-s * 0.08, 0, s * 0.82 * breathe, s * 0.6 * breathe, 0, la - 0.9, la + 0.9);
    ctx.stroke();
    ctx.strokeStyle = "rgba(90, 55, 30, 0.5)";
    ctx.lineWidth = Math.max(0.6, s * 0.04);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(s * (0.3 - i * 0.18), -s * 0.32);
      ctx.quadraticCurveTo(s * (0.18 - i * 0.18), 0, s * (0.3 - i * 0.18), s * 0.32);
      ctx.stroke();
    }
    // Cabeza adelante.
    ctx.fillStyle = "#170c06";
    ctx.beginPath();
    ctx.ellipse(s * 0.78, 0, s * 0.34, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Cuernos: dos curvas de hueso hacia adelante.
    ctx.strokeStyle = "#d9c7a0";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.4, s * 0.12);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.72, side * s * 0.22);
      ctx.quadraticCurveTo(s * 0.68, side * s * 0.62, s * 1.12, side * s * 0.58);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(80, 60, 40, 0.6)";
    ctx.lineWidth = Math.max(0.6, s * 0.04);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.72, side * s * 0.22);
      ctx.quadraticCurveTo(s * 0.68, side * s * 0.62, s * 1.12, side * s * 0.58);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Ojos del Minotauro: se ven en la oscuridad si esta despierto y cerca. */
  private drawEyes(s: Scene): void {
    const m = s.mino;
    if (!m.awake) return;
    const d = Math.hypot(m.fx - s.player.fx, m.fy - s.player.fy);
    const show = m.state === "chase" ? 1 : Math.max(0, 1 - (d - 3) / 4);
    if (show <= 0.02) return;
    const ctx = this.ctx;
    const x = this.px(m.fx);
    const y = this.py(m.fy);
    const sz = this.cell * 0.52;
    const hx = Math.cos(m.heading);
    const hy = Math.sin(m.heading);
    const blink = Math.sin(s.time * 0.9) > 0.985 ? 0.15 : 1;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const side of [-1, 1]) {
      const ex = x + hx * sz * 0.88 - hy * side * sz * 0.16;
      const ey = y + hy * sz * 0.88 + hx * side * sz * 0.16;
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, sz * 0.38);
      g.addColorStop(0, `rgba(255, 90, 40, ${0.95 * show * blink})`);
      g.addColorStop(0.25, `rgba(255, 40, 20, ${0.5 * show * blink})`);
      g.addColorStop(1, "rgba(255, 30, 10, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(ex - sz * 0.4, ey - sz * 0.4, sz * 0.8, sz * 0.8);
      ctx.fillStyle = `rgba(255, 220, 180, ${show * blink})`;
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(0.8, sz * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** El oro se ve un poco aunque este lejos de la luz (si ya se lo vio, o esta cerca). */
  private drawGlints(s: Scene): void {
    const ctx = this.ctx;
    const mem = this.memData!;
    const items: { x: number; y: number; big: boolean }[] = [
      { x: s.maze.exit.x, y: s.maze.exit.y, big: true },
      ...s.amphorae.map((a) => ({ ...a, big: false })),
    ];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const it of items) {
      const seen = mem[s.maze.index(it.x, it.y) * 4 + 3] > 40;
      const d = Math.hypot(it.x - s.player.fx, it.y - s.player.fy);
      const a = seen ? 0.55 : Math.max(0, 1 - d / (s.light * 2.4)) * 0.6;
      if (a <= 0.02) continue;
      const tw = 0.7 + 0.3 * Math.sin(s.time * (it.big ? 2.2 : 3.1) + it.x);
      const x = this.px(it.x);
      const y = this.py(it.y);
      const r = this.cell * (it.big ? 0.75 : 0.45);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255, 210, 120, ${a * tw * (it.big ? 0.55 : 0.35)})`);
      g.addColorStop(1, "rgba(255, 180, 80, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // Destello en cruz, como una chispa de oro.
      if (it.big) {
        ctx.strokeStyle = `rgba(255, 240, 200, ${a * tw * 0.7})`;
        ctx.lineWidth = Math.max(0.8, this.cell * 0.025);
        const l = this.cell * 0.28 * tw;
        ctx.beginPath();
        ctx.moveTo(x - l, y);
        ctx.lineTo(x + l, y);
        ctx.moveTo(x, y - l);
        ctx.lineTo(x, y + l);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Un muñeco con su antorcha. La orientacion de los rivales sale de hacia donde se
   * movieron (no viaja en el mensaje); la del propio, de `heading`, que tambien gira al
   * chocar una pared. El paso avanza con la distancia: un paso por celda.
   */
  private drawTheseus(key: string, fx: number, fy: number, look: DollLook, time: number, dt: number, facing?: Facing): { x: number; y: number } {
    let g = this.gait.get(key);
    if (!g) {
      g = { x: fx, y: fy, phase: 0, stride: 0, facing: "s", yaw: 0 };
      this.gait.set(key, g);
    }
    const dx = fx - g.x;
    const dy = fy - g.y;
    const dist = Math.hypot(dx, dy);
    // Un salto grande es una bajada de nivel o un rival que reaparece: no se camina.
    const moved = dist > 0.0005 && dist < 0.5;
    if (moved) g.phase += dist * Math.PI;
    const speed = dt > 0 ? dist / dt : 0;
    const target = moved ? Math.min(1, speed / 3) : 0;
    g.stride += (target - g.stride) * Math.min(1, dt * 14);
    if (target === 0 && g.stride < 0.05) g.phase = 0;
    const walking = dist > 0.004 && dist < 0.5;
    g.facing = facing ?? (walking ? facingOf(dx, dy, g.facing) : g.facing);
    // Giro continuo (3D): hacia donde mira o hacia donde se mueve, por el camino corto.
    const want = facing ? { n: Math.PI, e: Math.PI / 2, s: 0, w: -Math.PI / 2 }[facing] : walking ? Math.atan2(dx, dy) : g.yaw;
    let turn = want - g.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    g.yaw += turn * Math.min(1, dt * 16);
    g.x = fx;
    g.y = fy;
    const x = this.px(fx);
    const y = this.py(fy) + this.cell * 0.22;
    if (this.dolls === undefined) {
      try {
        this.dolls = new DollStage();
      } catch {
        this.dolls = null;
      }
    }
    if (!this.dolls) {
      return drawDoll(this.ctx, x, y, this.cell * 0.072, look, { facing: g.facing, phase: g.phase, stride: g.stride, time });
    }
    // Sombra de contacto en el piso (el sprite 3D no trae piso).
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(x, y, this.cell * 0.2, this.cell * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return this.dolls.draw(ctx, key, look, x, y, this.cell, this.dpr, { yaw: g.yaw, phase: g.phase, stride: g.stride, time });
  }

  /** Otro Teseo de la sala, con el color de su asiento y su propia antorcha. */
  private drawRival(r: { x: number; y: number; name: string; alive: boolean; look: DollLook }, time: number, dt: number): void {
    if (!r.alive) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.9;
    const tip = this.drawTheseus(`r:${r.name}`, r.x, r.y, r.look, time + r.x * 3, dt);
    ctx.restore();
    this.drawFlame(tip.x, tip.y, time + r.x, 2.2, 0.75);
    ctx.save();
    ctx.font = `600 ${Math.max(9, this.cell * 0.22)}px Cinzel, Georgia, serif`;
    ctx.textAlign = "center";
    const x = this.px(r.x);
    // En la primera fila el nombre arriba quedaria recortado por el borde de la losa.
    const below = r.y < 0.6;
    const y = below ? this.py(r.y) + this.cell * 0.62 : tip.y - this.cell * 0.3;
    ctx.textBaseline = below ? "top" : "alphabetic";
    const label = r.name.toUpperCase();
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillText(label, x + 1, y + 1);
    ctx.fillStyle = r.look.shirt;
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  /** Llama de antorcha en px; `scale` < 1 para la de los rivales. */
  private drawFlame(x: number, y: number, time: number, light: number, scale: number): void {
    const ctx = this.ctx;
    const s = this.cell * 0.19 * scale * (0.75 + 0.25 * Math.min(1, light / 3));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, y, 0, x, y, s * 5);
    halo.addColorStop(0, `rgba(255, 190, 90, ${0.55 * scale})`);
    halo.addColorStop(0.4, `rgba(255, 130, 50, ${0.16 * scale})`);
    halo.addColorStop(1, "rgba(255, 100, 30, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - s * 5, y - s * 5, s * 10, s * 10);
    ctx.restore();
    ctx.save();
    // Tres capas: borde rojo, cuerpo naranja, corazon blanco.
    flamePath(ctx, x, y, s * 1.15, time);
    ctx.fillStyle = "rgba(232, 89, 42, 0.95)";
    ctx.fill();
    flamePath(ctx, x, y + s * 0.08, s * 0.85, time + 0.3);
    ctx.fillStyle = "#ffb347";
    ctx.fill();
    flamePath(ctx, x, y + s * 0.2, s * 0.45, time + 0.6);
    ctx.fillStyle = "#fff2c4";
    ctx.fill();
    ctx.restore();
  }

  // ---------- Particulas ----------

  private stepParticles(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.kind === "gold") p.vy += 1.4 * dt;
      p.vx *= 1 - dt * 1.5;
      p.vy *= p.kind === "gold" ? 1 : 1 - dt * 1.2;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i].life <= 0) this.particles.splice(i, 1);
  }

  private drawParticles(kinds: Particle["kind"][]): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      if (!kinds.includes(p.kind)) continue;
      const a = Math.max(0, p.life / p.max);
      const x = this.px(p.x);
      const y = this.py(p.y);
      const r = p.size * this.cell * (p.kind === "breath" || p.kind === "dust" ? 1 + (1 - a) * 1.5 : 1);
      ctx.save();
      if (p.kind === "ember" || p.kind === "gold") ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle =
        p.kind === "ember"
          ? `rgba(255, ${140 + Math.round(a * 80)}, 60, ${a})`
          : p.kind === "gold"
            ? `rgba(255, 215, 120, ${a})`
            : p.kind === "breath"
              ? `rgba(200, 180, 160, ${a * 0.28})`
              : p.kind === "smoke"
                ? `rgba(60, 50, 45, ${a * 0.5})`
                : `rgba(140, 100, 60, ${a * 0.35})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** Forma de llama (gota que titila). */
function flamePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number): void {
  const sway = Math.sin(t * 9.1) * s * 0.18 + Math.sin(t * 13.7) * s * 0.08;
  const tall = 1 + Math.sin(t * 11.3) * 0.08;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.55);
  ctx.bezierCurveTo(x - s * 0.75, y + s * 0.45, x - s * 0.55, y - s * 0.4, x + sway, y - s * 1.35 * tall);
  ctx.bezierCurveTo(x + s * 0.55, y - s * 0.4, x + s * 0.75, y + s * 0.45, x, y + s * 0.55);
  ctx.closePath();
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Manchas suaves (moteado de piedra). */
function mottle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number, dark: string, light: string, n: number): void {
  for (let i = 0; i < n; i++) {
    const r = 2 + rand() * Math.min(w, h) * 0.05;
    g.fillStyle = rand() < 0.55 ? dark : light;
    g.beginPath();
    g.ellipse(x + rand() * w, y + rand() * h, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
}

/** Grano fino. */
function grain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? "rgba(30, 14, 4, 0.18)" : "rgba(255, 225, 180, 0.10)";
    g.fillRect(x + rand() * w, y + rand() * h, 1, 1);
  }
}

/** Greca (meandro) tallada alrededor del marco. */
function meander(g: CanvasRenderingContext2D, inset: number, band: number, size: number, frame: number): void {
  const unit = band;
  if (!(unit > 0.5)) return;
  const draw = (color: string, off: number, lw: number) => {
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.lineCap = "square";
    g.beginPath();
    const along = (len: number, place: (s: number, d: number) => [number, number]) => {
      const count = Math.floor((len - frame * 1.2) / (unit * 1.25));
      const start = (len - count * unit * 1.25) / 2;
      for (let i = 0; i < count; i++) {
        const s0 = start + i * unit * 1.25;
        // Una vuelta de greca: L con gancho hacia adentro.
        const pts: [number, number][] = [
          [s0, unit],
          [s0, 0],
          [s0 + unit, 0],
          [s0 + unit, unit * 0.75],
          [s0 + unit * 0.3, unit * 0.75],
          [s0 + unit * 0.3, unit * 0.3],
          [s0 + unit * 0.65, unit * 0.3],
        ];
        pts.forEach(([a, b], k) => {
          const [px, py] = place(a, b);
          if (k === 0) g.moveTo(px + off, py + off);
          else g.lineTo(px + off, py + off);
        });
      }
    };
    along(size, (s, d) => [s, inset + d]);
    along(size, (s, d) => [s, size - inset - d]);
    along(size, (s, d) => [inset + d, s]);
    along(size, (s, d) => [size - inset - d, s]);
    g.stroke();
  };
  const lw = Math.max(1, unit * 0.13);
  draw("rgba(20, 8, 2, 0.7)", lw * 0.8, lw);
  draw("#e2b07a", 0, lw);
}

function rosette(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = "#2a190c";
  g.beginPath();
  g.arc(r * 0.06, r * 0.08, r, 0, Math.PI * 2);
  g.fill();
  const grad = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, "#f0c890");
  grad.addColorStop(1, "#9d5a26");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(60, 28, 8, 0.55)";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.3, r * 0.12, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#f6d9a8";
  g.beginPath();
  g.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
