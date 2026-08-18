import {
  BEST_KEY,
  BOMB_CHANCE,
  COLS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  DISGUISED_CHANCE,
  GOLDEN_CHANCE,
  HOLD_DURATION_BASE,
  HOLD_DURATION_MIN,
  HOLE_RX,
  HOLE_RY,
  INITIAL_LIVES,
  MAX_DT,
  MISS_PENALTY,
  MOLE_RADIUS,
  RAMP_SEC,
  ROWS,
  SPAWN_INTERVAL_BASE,
  SPAWN_INTERVAL_MIN,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type MoleType,
} from "./constants";
import { Hud } from "./Hud";
import { Mole } from "./Mole";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameover";

interface Hole {
  cx: number;
  cy: number;
}

interface Swing {
  x: number;
  y: number;
  t: number;
  hit: boolean;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;

  private readonly holes: Hole[] = [];
  private moles: Mole[] = [];

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lives = INITIAL_LIVES;

  /** Fin de la ronda en salas segun el tope que fijo el host; null = sin tope. */
  private roomDeadline: Date | null = null;
  private elapsed = 0;
  private spawnTimer = 0;

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = 0;

  private swing: Swing | null = null;

  // ── Modo sala (multijugador): activo solo con ?room= en la URL ────
  private readonly room: RoomMode | null;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.buildHoles();

    this.hud = new Hud(container, () => this.onPrimary());


    // En movil no hay Enter: el toque tiene que poder arrancar desde cualquier

    // parte de la pantalla, no solo desde el boton del cartel. Va sobre el

    // container (el overlay de inicio tapa al canvas) y se ignoran los <button>,

    // que ya tienen su propio handler, para no arrancar dos veces.

    container.addEventListener("pointerdown", (e) => {

      if ((e.target as HTMLElement).closest("button")) return;

      this.onPrimary();

    });
    this.hud.setBest(this.best);
    this.hud.showStart();
    this.hud.mountPopupCanvas(this.canvas);

    this.room = initRoomMode("whack-a-mole", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.canvas.addEventListener("pointerdown", this.handlePointer);
    window.addEventListener("keydown", this.handleKeyDown);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private buildHoles(): void {
    // Filas ubicadas dejando aire arriba (HUD/titulo) y abajo (pasto).
    const rowY = [190, 330, 470];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.holes.push({
          cx: (VIEW_WIDTH * (c + 0.5)) / COLS,
          cy: rowY[r],
        });
      }
    }
  }

  // ── Sizing ────────────────────────────────────────────────────────
  private resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const scale = Math.min(parent.clientWidth / VIEW_WIDTH, parent.clientHeight / VIEW_HEIGHT, 1);
    this.canvas.style.width = `${VIEW_WIDTH * scale}px`;
    this.canvas.style.height = `${VIEW_HEIGHT * scale}px`;
    this.hud.syncPopupSize(this.canvas);
  };

  // ── Input ─────────────────────────────────────────────────────────
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.onPrimary();
    }
  };

  private handlePointer = (e: PointerEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (VIEW_WIDTH / rect.width);
    const y = (e.clientY - rect.top) * (VIEW_HEIGHT / rect.height);

    if (this.state === "playing") {
      this.swingAt(x, y);
    } else {
      this.onPrimary();
    }
  };

  private onPrimary(): void {
    // En modo sala el inicio lo dispara RoomMode (onStart) y no hay reintento:
    // una sola partida por ronda.
    if (this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    }
  }

  // ── Flujo de juego ────────────────────────────────────────────────
  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.moles = [];
    this.elapsed = 0;
    this.spawnTimer = 0;
    // Salas: la ronda tiene el tope que declara el juego en su meta.ts
    // (roomTimeLimitSec = 120). Lo tomamos del deadline que fijo la sala.
    // En solo no hay tope de tiempo.
    this.roomDeadline = this.room ? this.room.deadline() : null;
    this.swing = null;

    this.hud.setScore(0);
    this.hud.setLives(INITIAL_LIVES);
    this.hud.setTimer(this.roomRemaining());
    this.hud.hide();

    this.lastCountdownIndex = -1;
    this.countdownTime = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
  }

  private startGameplay(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
  }

  private swingAt(x: number, y: number): void {
    // Prioriza el topo mas "arriba" (mayor offset) bajo el click.
    let target: Mole | null = null;
    for (const m of this.moles) {
      if (m.whackable && m.hitTest(x, y)) {
        if (!target || m.offset > target.offset) target = m;
      }
    }

    this.swing = { x, y, t: 0, hit: target !== null };

    if (!target) {
      // Martillazo al vacio: penaliza para que apuntar tenga costo.
      this.score = Math.max(0, this.score - MISS_PENALTY);
      this.hud.setScore(this.score);
      this.hud.addPopup(`-${MISS_PENALTY}`, x, y - 30, "#ff9a9a");
      SoundEffects.playMiss();
      return;
    }

    target.whack();

    if (target.type === "bomb" || target.type === "disguised") {
      // En solo y en salas la bomba (y la bomba disfrazada) cuesta una vida.
      SoundEffects.playBomb();
      this.lives--;
      this.hud.setLives(this.lives);
      this.hud.addPopup("-1 vida", x, y - 30, "#ff5a5a");
      if (this.lives <= 0) this.gameOver();
      return;
    }

    this.score += target.points;
    this.hud.setScore(this.score);
    if (target.type === "golden") {
      this.hud.addPopup(`+${target.points}`, x, y - 30, "#ffd54a");
      SoundEffects.playGolden();
    } else {
      this.hud.addPopup(`+${target.points}`, x, y - 30, "#eafff0");
      SoundEffects.playWhack();
    }
  }

  private gameOver(): void {
    this.state = "gameover";
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    SoundEffects.playGameOver();
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("whack-a-mole", this.score);
  }

  /** Segundos restantes de la ronda en salas, o null si no hay tope de tiempo. */
  private roomRemaining(): number | null {
    if (!this.room || !this.roomDeadline) return null;
    return Math.max(0, (this.roomDeadline.getTime() - Date.now()) / 1000);
  }

  // ── Spawner ───────────────────────────────────────────────────────
  /** Progreso de dificultad 0..1 segun el tiempo transcurrido. */
  private get difficulty(): number {
    return Math.min(1, this.elapsed / RAMP_SEC);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private spawnMole(): void {
    const occupied = new Set(this.moles.filter((m) => !m.done).map((m) => m.hole));
    const free: number[] = [];
    for (let i = 0; i < this.holes.length; i++) {
      if (!occupied.has(i)) free.push(i);
    }
    if (free.length === 0) return;

    const hole = free[Math.floor(Math.random() * free.length)];
    const roll = Math.random();
    let type: MoleType = "normal";
    if (roll < BOMB_CHANCE) type = "bomb";
    else if (roll < BOMB_CHANCE + GOLDEN_CHANCE) type = "golden";
    else if (roll < BOMB_CHANCE + GOLDEN_CHANCE + DISGUISED_CHANCE) type = "disguised";

    const hold = this.lerp(HOLD_DURATION_BASE, HOLD_DURATION_MIN, this.difficulty);
    const h = this.holes[hole];
    this.moles.push(new Mole(hole, h.cx, h.cy, type, hold));
  }

  // ── Loop ──────────────────────────────────────────────────────────
  private tick = (now: number): void => {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    this.hud.updatePopups(dt);
    if (this.swing) {
      this.swing.t += dt;
      if (this.swing.t > 0.22) this.swing = null;
    }

    if (this.state === "countdown") {
      this.countdownTime -= dt;
      if (this.countdownTime <= 0) {
        this.startGameplay();
      } else {
        const total = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
        const idx = Math.floor((total - this.countdownTime) / COUNTDOWN_STEP);
        const clamped = Math.max(0, Math.min(COUNTDOWN_LABELS.length - 1, idx));
        if (clamped !== this.lastCountdownIndex) {
          this.lastCountdownIndex = clamped;
          SoundEffects.playCountdownTick();
        }
        this.hud.showCountdown(COUNTDOWN_LABELS[clamped]);
      }
      return;
    }

    if (this.state === "playing") {
      this.elapsed += dt;

      // Salas: al vencer el deadline se corta la ronda (tope de seguridad ademas
      // de las vidas).
      if (this.room && this.roomDeadline) {
        const rem = this.roomRemaining();
        this.hud.setTimer(rem);
        if (rem !== null && rem <= 0) {
          this.gameOver();
          return;
        }
      }

      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnMole();
        this.spawnTimer = this.lerp(SPAWN_INTERVAL_BASE, SPAWN_INTERVAL_MIN, this.difficulty);
      }

      for (const m of this.moles) m.update(dt);
      this.moles = this.moles.filter((m) => !m.done);
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  private draw(): void {
    const ctx = this.ctx;
    this.drawBackground(ctx);

    if (this.state === "playing" || this.state === "gameover" || this.state === "countdown") {
      // Algoritmo del pintor: fila por fila de atras (arriba) hacia adelante
      // (abajo). Cada fila dibuja su fondo, sus topos y su borde frontal juntos,
      // asi una fila mas cercana tapa a los topos de las filas de atras (un topo
      // de la 2da/3ra fila que asoma queda por delante de los agujeros de la 1ra).
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) this.drawHoleBack(ctx, this.holes[r * COLS + c]);
        for (const m of this.moles) {
          if (Math.floor(m.hole / COLS) === r) this.drawMole(ctx, m);
        }
        for (let c = 0; c < COLS; c++) this.drawHoleFront(ctx, this.holes[r * COLS + c]);
      }
    }

    if (this.swing) this.drawMallet(ctx, this.swing);

    this.hud.drawPopups();
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
    sky.addColorStop(0, "#8fd3ff");
    sky.addColorStop(0.45, "#bfe9c8");
    sky.addColorStop(1, "#6bbf5e");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    // Bandas de pasto suaves
    ctx.fillStyle = "rgba(60, 150, 70, 0.35)";
    for (let y = 130; y < VIEW_HEIGHT; y += 140) {
      ctx.beginPath();
      ctx.ellipse(VIEW_WIDTH / 2, y + 60, VIEW_WIDTH, 46, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHoleBack(ctx: CanvasRenderingContext2D, h: Hole): void {
    // Monticulo de tierra alrededor
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(h.cx, h.cy + 10, HOLE_RX + 18, HOLE_RY + 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#a9713f";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(h.cx, h.cy + 6, HOLE_RX + 8, HOLE_RY + 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#8a5a2b";
    ctx.fill();
    // Abertura
    const grad = ctx.createRadialGradient(h.cx, h.cy, 4, h.cx, h.cy, HOLE_RX);
    grad.addColorStop(0, "#1c1109");
    grad.addColorStop(1, "#3a2413");
    ctx.beginPath();
    ctx.ellipse(h.cx, h.cy, HOLE_RX, HOLE_RY, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  private drawHoleFront(ctx: CanvasRenderingContext2D, h: Hole): void {
    // Mitad delantera del borde del agujero, tapando la base del topo.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(h.cx, h.cy, HOLE_RX + 6, HOLE_RY + 6, 0, 0, Math.PI);
    ctx.fillStyle = "#7a4e26";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(h.cx, h.cy, HOLE_RX + 6, HOLE_RY + 6, 0, Math.PI * 0.08, Math.PI * 0.92);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.stroke();
    ctx.restore();
  }

  private drawMole(ctx: CanvasRenderingContext2D, m: Mole): void {
    const groundY = m.cy;
    const cy = m.centerY();

    ctx.save();
    // Recorta por encima del suelo: el topo asoma desde el agujero.
    ctx.beginPath();
    ctx.rect(m.cx - (HOLE_RX + 6), 0, (HOLE_RX + 6) * 2, groundY);
    ctx.clip();

    if (m.type === "bomb") {
      this.drawBomb(ctx, m.cx, cy, m.hitFlash);
    } else if (m.type === "disguised") {
      // Durante la finta parece un topo comun; al subir de verdad se revela la
      // bomba con orejas de topo.
      if (m.feinting) this.drawCreature(ctx, m.cx, cy, "normal", false, 0);
      else this.drawDisguisedBomb(ctx, m.cx, cy, m.whacked, m.hitFlash);
    } else {
      this.drawCreature(ctx, m.cx, cy, m.type, m.whacked, m.hitFlash);
    }

    ctx.restore();
  }

  private drawCreature(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    type: MoleType,
    whacked: boolean,
    flash: number,
  ): void {
    const r = MOLE_RADIUS;
    const fur = type === "golden" ? "#f2c14e" : "#8a5a2b";
    const furDark = type === "golden" ? "#d69a2a" : "#6b4420";
    const belly = type === "golden" ? "#fff0c0" : "#d8b98a";

    // Cuerpo
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.92, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = fur;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = furDark;
    ctx.stroke();

    // Orejas
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * r * 0.62, cy - r * 0.62, r * 0.24, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fillStyle = furDark;
      ctx.fill();
    }

    // Panza
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.28, r * 0.5, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = belly;
    ctx.fill();

    // Ojos
    if (whacked) {
      ctx.strokeStyle = "#3a2413";
      ctx.lineWidth = 4;
      for (const side of [-1, 1]) {
        const ex = cx + side * r * 0.34;
        const ey = cy - r * 0.28;
        ctx.beginPath();
        ctx.moveTo(ex - 7, ey - 7);
        ctx.lineTo(ex + 7, ey + 7);
        ctx.moveTo(ex + 7, ey - 7);
        ctx.lineTo(ex - 7, ey + 7);
        ctx.stroke();
      }
    } else {
      for (const side of [-1, 1]) {
        const ex = cx + side * r * 0.34;
        const ey = cy - r * 0.28;
        ctx.beginPath();
        ctx.ellipse(ex, ey, 9, 11, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(ex + side * 2, ey + 1, 4.5, 5.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#241a10";
        ctx.fill();
      }
    }

    // Nariz
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.02, 10, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#e06a8a";
    ctx.fill();

    // Brillo del dorado
    if (type === "golden") {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = "#fffbe6";
      for (const [dx, dy, s] of [[-r * 0.5, -r * 0.6, 5], [r * 0.55, -r * 0.2, 4]] as const) {
        this.drawSparkle(ctx, cx + dx, cy + dy, s);
      }
      ctx.restore();
    }

    // Destello al golpear
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.7;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.05, r * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawBomb(ctx: CanvasRenderingContext2D, cx: number, cy: number, flash: number): void {
    const r = MOLE_RADIUS * 0.86;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, r, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#26262e";
    ctx.fill();
    // Brillo
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.32, cy - r * 0.3, r * 0.22, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fill();
    // Mecha
    ctx.strokeStyle = "#7a5a30";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r + 4);
    ctx.quadraticCurveTo(cx + 16, cy - r - 16, cx + 6, cy - r - 26);
    ctx.stroke();
    // Chispa
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy - r - 28, 5, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffb040";
    ctx.fill();

    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.8;
      ctx.fillStyle = "#ff8a3a";
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.2, r * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Bomba "vestida de topo": cuerpo de bomba oscuro con orejas de topo, panza,
   * nariz y una mecha encendida como pista sutil de que en realidad es una bomba.
   */
  private drawDisguisedBomb(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    whacked: boolean,
    flash: number,
  ): void {
    const r = MOLE_RADIUS;
    const furDark = "#6b4420";

    // Orejas de topo (por detras del cuerpo, como en drawCreature).
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * r * 0.62, cy - r * 0.62, r * 0.24, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fillStyle = furDark;
      ctx.fill();
    }

    // Mecha encendida (la pista): sale por arriba antes del cuerpo.
    ctx.strokeStyle = "#7a5a30";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.9);
    ctx.quadraticCurveTo(cx + 16, cy - r - 14, cx + 6, cy - r - 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy - r - 26, 5, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffb040";
    ctx.fill();

    // Cuerpo de bomba
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.92, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#2c2c34";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#14141a";
    ctx.stroke();
    // Brillo metalico
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.34, cy - r * 0.4, r * 0.22, r * 0.15, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fill();

    // Panza clara (parte del disfraz de topo)
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.28, r * 0.5, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#4a4a56";
    ctx.fill();

    // Ojos
    if (whacked) {
      ctx.strokeStyle = "#dfe4ff";
      ctx.lineWidth = 4;
      for (const side of [-1, 1]) {
        const ex = cx + side * r * 0.34;
        const ey = cy - r * 0.28;
        ctx.beginPath();
        ctx.moveTo(ex - 7, ey - 7);
        ctx.lineTo(ex + 7, ey + 7);
        ctx.moveTo(ex + 7, ey - 7);
        ctx.lineTo(ex - 7, ey + 7);
        ctx.stroke();
      }
    } else {
      for (const side of [-1, 1]) {
        const ex = cx + side * r * 0.34;
        const ey = cy - r * 0.28;
        ctx.beginPath();
        ctx.ellipse(ex, ey, 9, 11, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(ex + side * 2, ey + 1, 4.5, 5.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#241a10";
        ctx.fill();
      }
    }

    // Nariz (remata el disfraz)
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.02, 10, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#e06a8a";
    ctx.fill();

    // Destello al golpear (naranja como la bomba)
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.8;
      ctx.fillStyle = "#ff8a3a";
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.15, r * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.35, y - s * 0.35);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x + s * 0.35, y + s * 0.35);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.35, y + s * 0.35);
    ctx.lineTo(x - s, y);
    ctx.lineTo(x - s * 0.35, y - s * 0.35);
    ctx.closePath();
    ctx.fill();
  }

  private drawMallet(ctx: CanvasRenderingContext2D, s: Swing): void {
    // Balanceo: baja rapido y vuelve. angle 0 = golpeando.
    const p = s.t / 0.22;
    const angle = -1.1 * Math.sin(Math.min(1, p * Math.PI));
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    // Mango
    ctx.fillStyle = "#7a4a22";
    ctx.fillRect(-6, 0, 12, 70);
    // Cabeza
    ctx.fillStyle = "#c94f4f";
    this.roundRect(ctx, -34, -34, 68, 40, 8);
    ctx.fill();
    ctx.fillStyle = "#e56b6b";
    this.roundRect(ctx, -34, -34, 68, 12, 6);
    ctx.fill();
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
