import {
  BALL_RADIUS,
  BEST_KEY,
  CAMERA_EASE,
  CAMERA_HOOP_VIEW_Y,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  GRAVITY,
  HOOP_MARGIN_X,
  HOOP_MAX_RISE,
  HOOP_MIN_RISE,
  HOOP_MOVE_AMP_MAX,
  HOOP_MOVE_AMP_MIN,
  HOOP_MOVE_RAMP,
  HOOP_MOVE_SPEED_MAX,
  HOOP_MOVE_SPEED_MIN,
  HOOP_MOVE_START,
  LAUNCH_POWER,
  MAX_DT,
  MAX_LAUNCH_SPEED,
  MIN_DRAG,
  RIM_END_RADIUS,
  RIM_RADIUS,
  RIM_RESTITUTION,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WALL_RESTITUTION,
} from "./constants";
import { drawHoopBack, drawHoopFront, leftRimX, rightRimX, type Hoop } from "./Hoop";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameover";
type BallState = "resting" | "flight";

interface FloatingText {
  x: number;
  y: number;
  text: string;
  life: number; // seconds remaining
}

const FLOAT_LIFE = 1.1;
const PHYSICS_STEP = 1 / 120; // substep to keep rim collisions stable at high speed
const TRAIL_MAX = 12; // flight trail samples kept
const STATIC_HOOP = { baseX: 0, amp: 0, speed: 0, phase: 0 };

interface Star {
  x: number;
  y: number;
  r: number;
  parallax: number; // fraction of camera movement applied (depth illusion)
  alpha: number;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private perfectStreak = 0;

  // World state (world y grows downward; the camera scrolls upward forever).
  private current: Hoop = { x: 0, y: 0, ...STATIC_HOOP }; // hoop the ball rests in
  private target: Hoop = { x: 0, y: 0, ...STATIC_HOOP }; // hoop to score into
  private ballX = 0;
  private ballY = 0;
  private velX = 0;
  private velY = 0;
  private ballState: BallState = "resting";
  private touchedRim = false; // set during a flight; breaks the perfect streak
  private cameraY = 0; // world y of the viewport top
  private baskets = 0; // hoops scored this run; drives the moving-hoop ramp
  private moveTime = 0; // clock for hoop oscillation
  private ballSpin = 0; // rendering-only rotation of the ball
  private trail: { x: number; y: number }[] = [];
  private readonly stars: Star[];

  // Slingshot aim (logical canvas coords; only the delta matters).
  private aimStart: { x: number; y: number } | null = null;
  private aimNow: { x: number; y: number } | null = null;

  private floaters: FloatingText[] = [];
  private countdownTime = 0;
  private lastTime = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.stars = Array.from({ length: 70 }, () => ({
      x: Math.random() * VIEW_WIDTH,
      y: Math.random() * VIEW_HEIGHT,
      r: 0.6 + Math.random() * 1.6,
      parallax: 0.15 + Math.random() * 0.35,
      alpha: 0.25 + Math.random() * 0.55,
    }));

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

    this.room = initRoomMode("dunk-shot", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const scale = Math.min(parent.clientWidth / VIEW_WIDTH, parent.clientHeight / VIEW_HEIGHT, 1);
    this.canvas.style.width = `${VIEW_WIDTH * scale}px`;
    this.canvas.style.height = `${VIEW_HEIGHT * scale}px`;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.onPrimary();
    }
  };

  /** Enter / overlay button: start from the start and game-over screens. */
  private onPrimary(): void {
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "gameover" && this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    }
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * VIEW_WIDTH) / rect.width,
      y: ((e.clientY - rect.top) * VIEW_HEIGHT) / rect.height,
    };
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.state !== "playing" || this.ballState !== "resting") return;
    e.preventDefault();
    this.aimStart = this.toLogical(e);
    this.aimNow = this.aimStart;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.aimStart) return;
    this.aimNow = this.toLogical(e);
  };

  private handlePointerUp = (): void => {
    if (!this.aimStart || !this.aimNow) {
      this.aimStart = this.aimNow = null;
      return;
    }
    const v = this.launchVelocity();
    this.aimStart = this.aimNow = null;
    if (!v) return; // drag too short: cancel

    if (this.state === "playing" && this.ballState === "resting") {
      this.velX = v.x;
      this.velY = v.y;
      this.ballState = "flight";
      this.touchedRim = false;
      SoundEffects.playLaunch();
    }
  };

  /** Slingshot: launch opposite to the drag, clamped; null if the drag is too short. */
  private launchVelocity(): { x: number; y: number } | null {
    if (!this.aimStart || !this.aimNow) return null;
    const dx = this.aimStart.x - this.aimNow.x;
    const dy = this.aimStart.y - this.aimNow.y;
    const len = Math.hypot(dx, dy);
    if (len < MIN_DRAG) return null;
    const speed = Math.min(len * LAUNCH_POWER, MAX_LAUNCH_SPEED);
    return { x: (dx / len) * speed, y: (dy / len) * speed };
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.perfectStreak = 0;
    this.floaters = [];
    this.aimStart = this.aimNow = null;
    this.baskets = 0;
    this.moveTime = 0;
    this.ballSpin = 0;
    this.trail = [];

    const startX = VIEW_WIDTH * 0.3;
    this.current = { x: startX, y: 0, ...STATIC_HOOP, baseX: startX };
    this.target = this.spawnTarget(this.current);
    this.restBall();
    this.cameraY = this.current.y - CAMERA_HOOP_VIEW_Y;

    this.hud.setScore(0);
    this.hud.hide();

    this.countdownTime = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
  }

  private startGameplay(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
  }

  private restBall(): void {
    this.ballState = "resting";
    this.ballX = this.current.x;
    this.ballY = this.current.y + 8;
    this.velX = this.velY = 0;
    this.trail = [];
  }

  /**
   * New target on the opposite half of the screen, somewhat higher up. From
   * HOOP_MOVE_START baskets on it oscillates horizontally, ramping amplitude
   * and speed over the next HOOP_MOVE_RAMP baskets.
   */
  private spawnTarget(from: Hoop): Hoop {
    const onLeft = from.baseX < VIEW_WIDTH / 2;
    const min = onLeft ? VIEW_WIDTH / 2 + 30 : HOOP_MARGIN_X;
    const max = onLeft ? VIEW_WIDTH - HOOP_MARGIN_X : VIEW_WIDTH / 2 - 30;
    const baseX = min + Math.random() * (max - min);

    let amp = 0;
    let speed = 0;
    if (this.baskets >= HOOP_MOVE_START) {
      const t = Math.min(1, (this.baskets - HOOP_MOVE_START) / HOOP_MOVE_RAMP);
      amp = HOOP_MOVE_AMP_MIN + t * (HOOP_MOVE_AMP_MAX - HOOP_MOVE_AMP_MIN);
      speed = HOOP_MOVE_SPEED_MIN + t * (HOOP_MOVE_SPEED_MAX - HOOP_MOVE_SPEED_MIN);
      // Keep the whole swing (rim included) inside the walls.
      amp = Math.max(0, Math.min(amp, baseX - RIM_RADIUS - 8, VIEW_WIDTH - RIM_RADIUS - 8 - baseX));
    }

    return {
      x: baseX,
      y: from.y - (HOOP_MIN_RISE + Math.random() * (HOOP_MAX_RISE - HOOP_MIN_RISE)),
      baseX,
      amp,
      speed,
      phase: Math.random() * Math.PI * 2,
    };
  }

  private tick = (now: number): void => {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    for (const f of this.floaters) f.life -= dt;
    this.floaters = this.floaters.filter((f) => f.life > 0);

    if (this.state === "countdown") {
      this.countdownTime -= dt;
      if (this.countdownTime <= 0) {
        this.startGameplay();
      } else {
        const total = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
        const idx = Math.floor((total - this.countdownTime) / COUNTDOWN_STEP);
        this.hud.showCountdown(COUNTDOWN_LABELS[Math.max(0, Math.min(COUNTDOWN_LABELS.length - 1, idx))]);
      }
      return;
    }

    if (this.state !== "playing" && this.state !== "gameover") return;

    // Camera eases so the current hoop sits near the bottom of the view.
    const camTarget = this.current.y - CAMERA_HOOP_VIEW_Y;
    this.cameraY += (camTarget - this.cameraY) * Math.min(1, dt * CAMERA_EASE);

    if (this.state !== "playing") return;

    // Moving hoops oscillate around baseX (amp = 0 keeps them static).
    this.moveTime += dt;
    for (const hoop of [this.current, this.target]) {
      if (hoop.amp > 0) hoop.x = hoop.baseX + Math.sin(this.moveTime * hoop.speed + hoop.phase) * hoop.amp;
    }

    if (this.ballState !== "flight") {
      // The resting ball rides its (possibly moving) hoop.
      this.ballX = this.current.x;
      return;
    }

    this.ballSpin += this.velX * dt * 0.02;
    this.trail.push({ x: this.ballX, y: this.ballY });
    if (this.trail.length > TRAIL_MAX) this.trail.shift();

    let remaining = dt;
    while (remaining > 0 && this.ballState === "flight") {
      const step = Math.min(PHYSICS_STEP, remaining);
      remaining -= step;
      this.stepPhysics(step);
    }

    // Ball fell below the view: run over.
    if (this.ballState === "flight" && this.ballY - this.cameraY > VIEW_HEIGHT + 80) {
      this.gameOver();
    }
  }

  private stepPhysics(dt: number): void {
    const prevY = this.ballY;
    this.velY += GRAVITY * dt;
    this.ballX += this.velX * dt;
    this.ballY += this.velY * dt;

    // Side walls.
    if (this.ballX < BALL_RADIUS) {
      this.ballX = BALL_RADIUS;
      this.velX = Math.abs(this.velX) * WALL_RESTITUTION;
      SoundEffects.playBounce();
    } else if (this.ballX > VIEW_WIDTH - BALL_RADIUS) {
      this.ballX = VIEW_WIDTH - BALL_RADIUS;
      this.velX = -Math.abs(this.velX) * WALL_RESTITUTION;
      SoundEffects.playBounce();
    }

    // Rim endpoints of both hoops are solid.
    for (const hoop of [this.current, this.target]) {
      this.collideRimEnd(leftRimX(hoop), hoop.y);
      this.collideRimEnd(rightRimX(hoop), hoop.y);
    }

    // Capture: crossing a rim line downward within the opening.
    if (this.velY > 0) {
      if (this.crossesHoop(prevY, this.target)) this.scoreBasket();
      else if (this.crossesHoop(prevY, this.current)) this.restBall(); // back into its own hoop: no score
    }
  }

  private collideRimEnd(rx: number, ry: number): void {
    const dx = this.ballX - rx;
    const dy = this.ballY - ry;
    const dist = Math.hypot(dx, dy);
    const minDist = BALL_RADIUS + RIM_END_RADIUS;
    if (dist >= minDist || dist === 0) return;

    const nx = dx / dist;
    const ny = dy / dist;
    this.ballX = rx + nx * minDist;
    this.ballY = ry + ny * minDist;

    const dot = this.velX * nx + this.velY * ny;
    if (dot < 0) {
      this.velX -= (1 + RIM_RESTITUTION) * dot * nx;
      this.velY -= (1 + RIM_RESTITUTION) * dot * ny;
      this.touchedRim = true;
      SoundEffects.playBounce();
    }
  }

  /**
   * True if the ball crossed the hoop's rim line downward this substep within
   * the opening. Substeps are short (1/120 s) so the ball's current x is a
   * good-enough stand-in for the exact crossing x.
   */
  private crossesHoop(prevY: number, hoop: Hoop): boolean {
    if (prevY > hoop.y || this.ballY < hoop.y) return false;
    return Math.abs(this.ballX - hoop.x) <= RIM_RADIUS - 12;
  }

  private scoreBasket(): void {
    const perfect = !this.touchedRim;
    let points: number;
    if (perfect) {
      this.perfectStreak++;
      points = 1 + this.perfectStreak;
      SoundEffects.playPerfect(this.perfectStreak);
      this.floaters.push({
        x: this.target.x,
        y: this.target.y - 40,
        text: this.perfectStreak > 1 ? `PERFECTO x${this.perfectStreak}  +${points}` : `PERFECTO  +${points}`,
        life: FLOAT_LIFE,
      });
    } else {
      this.perfectStreak = 0;
      points = 1;
      SoundEffects.playScore();
      this.floaters.push({ x: this.target.x, y: this.target.y - 40, text: "+1", life: FLOAT_LIFE });
    }

    this.score += points;
    this.hud.setScore(this.score);
    this.baskets++;

    this.current = this.target;
    this.target = this.spawnTarget(this.current);
    this.restBall();
  }

  private gameOver(): void {
    this.state = "gameover";
    SoundEffects.playMiss();
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("dunk-shot", this.score);
  }

  private draw(): void {
    const ctx = this.ctx;

    // Background.
    const bg = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
    bg.addColorStop(0, "#101623");
    bg.addColorStop(1, "#1c2233");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    // Stars in screen space with per-star parallax (wrap vertically forever).
    ctx.save();
    ctx.fillStyle = "#dfe7ff";
    for (const s of this.stars) {
      const sy = ((s.y - this.cameraY * s.parallax) % VIEW_HEIGHT + VIEW_HEIGHT) % VIEW_HEIGHT;
      ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      ctx.arc(s.x, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.state === "ready") return;

    ctx.save();
    ctx.translate(0, -this.cameraY);

    drawHoopBack(ctx, this.target);
    drawHoopBack(ctx, this.current);

    this.drawTrail(ctx);
    this.drawAimPreview(ctx);
    this.drawBall(ctx);

    drawHoopFront(ctx, this.target);
    drawHoopFront(ctx, this.current);

    // Floating score texts.
    for (const f of this.floaters) {
      const alpha = Math.min(1, f.life / FLOAT_LIFE + 0.2);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ffd27f";
      ctx.font = "bold 22px 'Courier New', Courier, monospace";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - (FLOAT_LIFE - f.life) * 40);
      ctx.restore();
    }

    ctx.restore();
  }

  /** Fading ghost circles along the recent flight path, drawn under the ball. */
  private drawTrail(ctx: CanvasRenderingContext2D): void {
    if (this.ballState !== "flight" || this.trail.length === 0) return;
    ctx.save();
    for (let i = 0; i < this.trail.length; i++) {
      const t = (i + 1) / this.trail.length;
      ctx.globalAlpha = t * 0.22;
      ctx.fillStyle = "#ffab5e";
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, BALL_RADIUS * (0.4 + t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBall(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    const grad = ctx.createRadialGradient(
      this.ballX - 6,
      this.ballY - 8,
      4,
      this.ballX,
      this.ballY,
      BALL_RADIUS,
    );
    grad.addColorStop(0, "#ffab5e");
    grad.addColorStop(1, "#e35b1e");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Basketball seams, rotated by the flight spin.
    ctx.translate(this.ballX, this.ballY);
    ctx.rotate(this.ballSpin);
    ctx.strokeStyle = "rgba(60, 20, 5, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.moveTo(-BALL_RADIUS, 0);
    ctx.lineTo(BALL_RADIUS, 0);
    ctx.moveTo(0, -BALL_RADIUS);
    ctx.lineTo(0, BALL_RADIUS);
    ctx.stroke();
    ctx.restore();
  }

  private drawAimPreview(ctx: CanvasRenderingContext2D): void {
    if (this.state !== "playing" || this.ballState !== "resting") return;
    const v = this.launchVelocity();
    if (!v) return;

    // Simulate the launch and plot dots along the arc.
    let px = this.ballX;
    let py = this.ballY;
    let vx = v.x;
    let vy = v.y;
    const step = 1 / 60;
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    for (let i = 0; i < 42; i++) {
      vy += GRAVITY * step;
      px += vx * step;
      py += vy * step;
      if (px < BALL_RADIUS || px > VIEW_WIDTH - BALL_RADIUS) {
        vx = -vx * WALL_RESTITUTION;
        px = Math.max(BALL_RADIUS, Math.min(VIEW_WIDTH - BALL_RADIUS, px));
      }
      if (py > this.ballY + 260) break;
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2, 5 - i * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
