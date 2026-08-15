import {
  GRID_COLS,
  GRID_ROWS,
  CELL,
  VIEW_WIDTH,
  VIEW_HEIGHT,
  START_LENGTH,
  STEP_INITIAL,
  STEP_MIN,
  STEP_DECREMENT,
  MAX_DT,
  TURN_EARLY_FRACTION,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  BEST_KEY,
  COLOR_BG_LIGHT,
  COLOR_BG_DARK,
  COLOR_SNAKE,
  COLOR_APPLE,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "dead";
interface Cell {
  x: number;
  y: number;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lastTime = 0;
  private deadFor = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private elapsed = 0;

  // Snake grid state (head at index 0).
  private cells: Cell[] = [];
  private prevCells: Cell[] = [];
  private food: Cell = { x: 0, y: 0 };
  private dir: Cell = { x: 1, y: 0 };
  private dirQueue: Cell[] = [];
  private stepInterval = STEP_INITIAL;
  private stepAccum = 0;
  private eatFlash = 0;

  // Pointer / swipe tracking.
  private pointerActive = false;
  private pointerX = 0;
  private pointerY = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.showScore(false);
    this.hud.showStart(this.best);

    this.room = initRoomMode("snake", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.bindInputs();
    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private bindInputs(): void {
    window.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          this.queueDir(0, -1);
          break;
        case "ArrowDown":
        case "s":
        case "S":
          this.queueDir(0, 1);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          this.queueDir(-1, 0);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          this.queueDir(1, 0);
          break;
        case "Enter":
          this.onAction();
          break;
      }
    });

    // Swipe / drag controls: while playing, a movement past the threshold in the
    // dominant axis queues a turn and resets the anchor so a drag can chain turns.
    this.canvas.addEventListener("pointerdown", (e) => {
      this.pointerActive = true;
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      if (this.state === "ready" || this.state === "dead") this.onAction();
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.pointerActive || this.state !== "playing") return;
      const dx = e.clientX - this.pointerX;
      const dy = e.clientY - this.pointerY;
      const threshold = 24;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      if (Math.abs(dx) > Math.abs(dy)) this.queueDir(Math.sign(dx), 0);
      else this.queueDir(0, Math.sign(dy));
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
    });
    const endPointer = () => {
      this.pointerActive = false;
    };
    this.canvas.addEventListener("pointerup", endPointer);
    this.canvas.addEventListener("pointercancel", endPointer);
    this.canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  /** Queue a direction change, rejecting reversals and duplicates (buffers up to 2). */
  private queueDir(x: number, y: number): void {
    if (this.state !== "playing") return;
    const last = this.dirQueue.length ? this.dirQueue[this.dirQueue.length - 1] : this.dir;
    if (x === -last.x && y === -last.y) return;
    if (x === last.x && y === last.y) return;
    if (this.dirQueue.length < 2) {
      this.dirQueue.push({ x, y });
      SoundEffects.playTurn();
      this.tryEarlyStep();
    }
  }

  /**
   * Adelanta el paso cuando el giro llega pasada la mitad del tick. Sin esto el giro
   * espera hasta el proximo borde de paso (hasta STEP_INITIAL = 140 ms al principio) y
   * eso es lo que se siente como delay en los controles. Solo aplica al giro que se
   * ejecuta en este paso (cola de 1); el segundo bufferado sigue siendo del paso que viene.
   */
  private tryEarlyStep(): void {
    if (this.dirQueue.length !== 1) return;
    if (this.stepAccum < this.stepInterval * TURN_EARLY_FRACTION) return;
    this.stepAccum = 0;
    this.stepSnake();
  }

  private onAction(): void {
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;
      case "dead":
        if (this.room) return;
        if (this.deadFor > 0.6) this.beginCountdown();
        break;
    }
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.resetRun();
    this.hud.showScore(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private resetRun(): void {
    this.score = 0;
    this.stepInterval = STEP_INITIAL;
    this.stepAccum = 0;
    this.eatFlash = 0;
    this.dir = { x: 1, y: 0 };
    this.dirQueue = [];
    const cy = Math.floor(GRID_ROWS / 2);
    const cx = Math.floor(GRID_COLS / 2);
    this.cells = [];
    for (let i = 0; i < START_LENGTH; i++) {
      this.cells.push({ x: cx - i, y: cy });
    }
    this.prevCells = this.cells.map((c) => ({ ...c }));
    this.spawnFood();
  }

  private start(): void {
    this.state = "playing";
    this.hud.setScore(0);
    this.hud.showScore(true);
    this.hud.hide();
    this.hud.showCountdown(null);
    this.stepAccum = 0;
  }

  private spawnFood(): void {
    const occupied = new Set(this.cells.map((c) => `${c.x},${c.y}`));
    const free: Cell[] = [];
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        if (!occupied.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    if (free.length === 0) return; // board full: win-ish, just leave food where it was
    this.food = free[Math.floor(Math.random() * free.length)];
  }

  private die(): void {
    if (this.state === "dead") return;
    this.state = "dead";
    this.deadFor = 0;
    SoundEffects.playLose();
    this.hud.showScore(false);

    const isNewBest = this.score > this.best;
    if (isNewBest) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }

    this.hud.showGameOver(this.score, this.best, isNewBest);

    if (this.room) {
      this.room.reportScore(this.score);
    } else {
      this.hud.showRanking("snake", this.score);
    }
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.elapsed += dt;

    this.update(dt);
    this.render();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "playing") {
      this.updatePlaying(dt);
    } else if (this.state === "countdown") {
      this.updateCountdown(dt);
    } else if (this.state === "dead") {
      this.deadFor += dt;
    }
    if (this.eatFlash > 0) this.eatFlash = Math.max(0, this.eatFlash - dt * 3);
  }

  private updatePlaying(dt: number): void {
    this.stepAccum += dt;
    let guard = 0;
    while (this.stepAccum >= this.stepInterval && this.state === "playing") {
      this.stepAccum -= this.stepInterval;
      this.stepSnake();
      if (++guard > 4) {
        this.stepAccum = 0;
        break;
      }
    }
  }

  private stepSnake(): void {
    if (this.dirQueue.length) this.dir = this.dirQueue.shift()!;

    const head = this.cells[0];
    const nx = head.x + this.dir.x;
    const ny = head.y + this.dir.y;

    // Wall collision.
    if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) {
      this.die();
      return;
    }

    const eating = nx === this.food.x && ny === this.food.y;

    // Self collision (the tail cell frees up unless we grow this step).
    for (let i = 0; i < this.cells.length; i++) {
      if (i === this.cells.length - 1 && !eating) continue; // tail moves away
      if (this.cells[i].x === nx && this.cells[i].y === ny) {
        this.die();
        return;
      }
    }

    this.prevCells = this.cells.map((c) => ({ ...c }));
    this.cells.unshift({ x: nx, y: ny });

    if (eating) {
      // Tail stays; new tail segment "emerges" from its own cell (prev == current).
      this.prevCells.push({ ...this.cells[this.cells.length - 1] });
      this.score++;
      this.hud.setScore(this.score);
      this.eatFlash = 1;
      SoundEffects.playEat();
      this.stepInterval = Math.max(STEP_MIN, this.stepInterval - STEP_DECREMENT);
      this.spawnFood();
    } else {
      this.cells.pop();
    }
  }

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) this.start();
    else if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private render(): void {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);

    ctx.beginPath();
    ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.clip();

    this.drawBoard();

    if (this.state === "playing" || this.state === "countdown" || this.state === "dead") {
      this.drawFood();
      this.drawSnake();
    }

    ctx.restore();
  }

  private drawBoard(): void {
    const { ctx } = this;
    // Damero verde de dos tonos, estilo clasico.
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? COLOR_BG_LIGHT : COLOR_BG_DARK;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  private drawFood(): void {
    const { ctx } = this;
    const cx = (this.food.x + 0.5) * CELL;
    const cy = (this.food.y + 0.5) * CELL;
    const r = CELL * 0.34;

    // Sombra debajo.
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.95, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cuerpo de la manzana.
    ctx.fillStyle = COLOR_APPLE;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Brillo.
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.35, cy - r * 0.32, r * 0.24, r * 0.16, -0.6, 0, Math.PI * 2);
    ctx.fill();

    // Tallo.
    ctx.strokeStyle = "#7a4a1e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.8);
    ctx.lineTo(cx + 1, cy - r * 1.3);
    ctx.stroke();

    // Hoja.
    ctx.save();
    ctx.translate(cx + r * 0.32, cy - r * 1.08);
    ctx.rotate(-0.5);
    ctx.fillStyle = "#5aa02c";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.45, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSnake(): void {
    const { ctx } = this;
    // Fuera de "playing" la interpolacion se congela al final del paso (t = 1): al morir
    // el paso no se aplica, y un t = 0 dibujaria prevCells (la vibora retrocede una celda).
    const t = this.state === "playing" ? Math.min(this.stepAccum / this.stepInterval, 1) : 1;
    const n = this.cells.length;

    // Centros interpolados de cabeza a cola.
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const cur = this.cells[i];
      const prev = this.prevCells[i] ?? cur;
      const gx = prev.x + (cur.x - prev.x) * t;
      const gy = prev.y + (cur.y - prev.y) * t;
      pts.push({ x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL });
    }

    // Cuerpo continuo tipo tubo (una sola linea gruesa con uniones redondas).
    const thickness = CELL * 0.82;
    ctx.strokeStyle = COLOR_SNAKE;
    ctx.fillStyle = COLOR_SNAKE;
    ctx.lineWidth = thickness;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    ctx.stroke();

    // Cabeza un poco mas grande y redonda.
    const head = pts[0];
    ctx.beginPath();
    ctx.arc(head.x, head.y, thickness * 0.55, 0, Math.PI * 2);
    ctx.fill();

    this.drawEyes(head.x, head.y);
  }

  private drawEyes(cx: number, cy: number): void {
    const { ctx } = this;
    const dir = this.dir;
    // Perpendicular para separar los dos ojos.
    const perpX = dir.y;
    const perpY = dir.x;
    const forward = CELL * 0.05;
    const side = CELL * 0.26;
    const eyeR = CELL * 0.17;

    for (const s of [-1, 1]) {
      const ex = cx + dir.x * forward + perpX * side * s;
      const ey = cy + dir.y * forward + perpY * side * s;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      // Pupila mirando hacia adelante.
      ctx.fillStyle = "#1a1f4a";
      ctx.beginPath();
      ctx.arc(ex + dir.x * eyeR * 0.4, ey + dir.y * eyeR * 0.4, eyeR * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fosas nasales.
    ctx.fillStyle = "rgba(20, 25, 70, 0.6)";
    const nf = CELL * 0.34;
    const ns = CELL * 0.1;
    const nr = CELL * 0.035;
    for (const s of [-1, 1]) {
      const nx = cx + dir.x * nf + perpX * ns * s;
      const ny = cy + dir.y * nf + perpY * ns * s;
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    const fit = Math.min(w / VIEW_WIDTH, h / VIEW_HEIGHT);
    this.scale = fit * dpr;
    this.offsetX = (w / fit - VIEW_WIDTH) / 2;
    this.offsetY = (h / fit - VIEW_HEIGHT) / 2;
  };
}
