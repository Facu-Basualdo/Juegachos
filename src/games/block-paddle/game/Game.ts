import {
  MAX_DT,
  MAX_SUBSTEP_DIST,
  PADDLE_WIDTH,
  PADDLE_WIDTH_MIN,
  PADDLE_SHRINK_PER_HIT,
  PADDLE_HEIGHT,
  PADDLE_BOTTOM_MARGIN,
  PLAYER_SPEED,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  BALL_RADIUS,
  BALL_SPEED_INITIAL,
  BALL_SPEED_INCREMENT,
  BALL_SPEED_MAX,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  BEST_KEY,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "dead";

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

  // Paddle
  private paddleX = VIEW_WIDTH / 2 - PADDLE_WIDTH / 2;
  private paddleWidth = PADDLE_WIDTH;

  // Ball
  private ballX = VIEW_WIDTH / 2;
  private ballY = VIEW_HEIGHT / 2;
  private ballVx = 0;
  private ballVy = 0;
  private ballSpeed = BALL_SPEED_INITIAL;

  // Input
  private moveDir = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.showScore(false);
    this.hud.showStart(this.best);

    this.room = initRoomMode("block-paddle", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.bindInputs(container);
    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private bindInputs(container: HTMLElement): void {
    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") this.moveDir = -1;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") this.moveDir = 1;
      if (e.key === "Enter") this.onAction();
    });
    window.addEventListener("keyup", (e) => {
      if (
        e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "a" || e.key === "A" || e.key === "d" || e.key === "D"
      ) this.moveDir = 0;
    });

    this.canvas.addEventListener("mousemove", (e) => {
      if (this.state !== "playing" && this.state !== "countdown") return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / this.cssScale - this.offsetX;
      this.paddleX = mx - this.paddleWidth / 2;
      this.clampPaddle();
    });

    this.canvas.addEventListener("touchmove", (e) => {
      if (this.state !== "playing" && this.state !== "countdown") return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const mx = (touch.clientX - rect.left) / this.cssScale - this.offsetX;
      this.paddleX = mx - this.paddleWidth / 2;
      this.clampPaddle();
    }, { passive: false });

    // Arranque / reintento por toque. Va sobre el container y no sobre el canvas
    // porque la pantalla de inicio y la de game over son un overlay que lo tapa:
    // en movil (donde no hay Enter) el toque sobre el cartel moria ahi y no habia
    // forma de empezar. Es `pointerdown` (no `click` + `touchstart`) porque el
    // panel de ranking corta la propagacion de los pointerdown de su propia UI.
    container.addEventListener("pointerdown", (e) => {
      if (this.state === "ready" || this.state === "dead") {
        e.preventDefault();
        this.onAction();
      }
    });
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
    this.score = 0;
    this.paddleWidth = PADDLE_WIDTH;
    this.paddleX = VIEW_WIDTH / 2 - PADDLE_WIDTH / 2;
    this.ballX = VIEW_WIDTH / 2;
    this.ballY = VIEW_HEIGHT / 2;
    this.ballVx = 0;
    this.ballVy = 0;
    this.ballSpeed = BALL_SPEED_INITIAL;
    this.moveDir = 0;
    this.hud.showScore(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.score = 0;
    this.hud.setScore(0);
    this.hud.showScore(true);
    this.hud.hide();
    this.hud.showCountdown(null);
    this.launchBall();
  }

  private launchBall(): void {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
    this.ballVx = Math.cos(angle) * this.ballSpeed;
    this.ballVy = Math.sin(angle) * this.ballSpeed;
    this.ballX = VIEW_WIDTH / 2;
    this.ballY = VIEW_HEIGHT - PADDLE_BOTTOM_MARGIN - PADDLE_HEIGHT - BALL_RADIUS - 10;
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
      this.hud.showRanking("block-paddle", this.score);
    }
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

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
  }

  private updatePlaying(dt: number): void {
    this.paddleX += this.moveDir * PLAYER_SPEED * dt;
    this.clampPaddle();

    const steps = Math.max(1, Math.ceil((this.ballSpeed * dt) / MAX_SUBSTEP_DIST));
    const sub = dt / steps;
    for (let i = 0; i < steps && this.state === "playing"; i++) {
      this.stepBall(sub);
    }
  }

  private stepBall(dt: number): void {
    this.ballX += this.ballVx * dt;
    this.ballY += this.ballVy * dt;

    if (this.ballX - BALL_RADIUS <= 0) {
      this.ballX = BALL_RADIUS;
      this.ballVx = Math.abs(this.ballVx);
      SoundEffects.playWall();
    }
    if (this.ballX + BALL_RADIUS >= VIEW_WIDTH) {
      this.ballX = VIEW_WIDTH - BALL_RADIUS;
      this.ballVx = -Math.abs(this.ballVx);
      SoundEffects.playWall();
    }
    if (this.ballY - BALL_RADIUS <= 0) {
      this.ballY = BALL_RADIUS;
      this.ballVy = Math.abs(this.ballVy);
      SoundEffects.playWall();
    }

    if (this.ballY + BALL_RADIUS >= VIEW_HEIGHT) {
      this.die();
      return;
    }

    if (
      this.ballVy > 0 &&
      this.ballY + BALL_RADIUS >= VIEW_HEIGHT - PADDLE_BOTTOM_MARGIN - PADDLE_HEIGHT &&
      this.ballY - BALL_RADIUS <= VIEW_HEIGHT - PADDLE_BOTTOM_MARGIN &&
      this.ballX + BALL_RADIUS >= this.paddleX &&
      this.ballX - BALL_RADIUS <= this.paddleX + this.paddleWidth
    ) {
      const relX = (this.ballX - (this.paddleX + this.paddleWidth / 2)) / (this.paddleWidth / 2);
      const angle = -Math.PI / 2 + relX * 0.7;
      this.ballSpeed = Math.min(this.ballSpeed + BALL_SPEED_INCREMENT, BALL_SPEED_MAX);
      this.ballVx = Math.cos(angle) * this.ballSpeed;
      this.ballVy = Math.sin(angle) * this.ballSpeed;
      this.ballY = VIEW_HEIGHT - PADDLE_BOTTOM_MARGIN - PADDLE_HEIGHT - BALL_RADIUS;

      const center = this.paddleX + this.paddleWidth / 2;
      this.paddleWidth = Math.max(this.paddleWidth - PADDLE_SHRINK_PER_HIT, PADDLE_WIDTH_MIN);
      this.paddleX = center - this.paddleWidth / 2;
      this.clampPaddle();

      this.score++;
      this.hud.setScore(this.score);
      SoundEffects.playHit();
    }
  }

  private clampPaddle(): void {
    if (this.paddleX < 0) this.paddleX = 0;
    if (this.paddleX + this.paddleWidth > VIEW_WIDTH) this.paddleX = VIEW_WIDTH - this.paddleWidth;
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

    // Wall lines (subtle glow)
    ctx.strokeStyle = "rgba(100, 200, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, VIEW_WIDTH - 2, VIEW_HEIGHT - 2);

    // Paddle
    const paddleY = VIEW_HEIGHT - PADDLE_BOTTOM_MARGIN - PADDLE_HEIGHT;
    ctx.fillStyle = "#64c8ff";
    ctx.shadowColor = "#64c8ff";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.roundRect(this.paddleX, paddleY, this.paddleWidth, PADDLE_HEIGHT, 6);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ball
    ctx.fillStyle = "#64c8ff";
    ctx.shadowColor = "#64c8ff";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  private scale = 1;
  /** CSS pixels per view unit (scale without dpr), for mapping pointer input. */
  private cssScale = 1;
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
    this.cssScale = fit;
    this.offsetX = (w / fit - VIEW_WIDTH) / 2;
    this.offsetY = (h / fit - VIEW_HEIGHT) / 2;
  };
}
