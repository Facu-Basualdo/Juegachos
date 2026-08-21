import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  IMPACT_ANGLE,
  KUNAIS_BASE,
  KUNAI_READY_TIP_Y,
  KUNAI_SPEED,
  LOG_CENTER_X,
  LOG_CENTER_Y,
  LOG_RADIUS,
  MAX_DT,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./constants";
import { Log } from "./Log";
import { drawKunai } from "./Kunai";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameover";

interface FailAnim {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly log = new Log();
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private level = 1;

  private levelTarget = KUNAIS_BASE;
  private kunaisLeft = KUNAIS_BASE; // ammo still available this level
  private flyingTipY: number | null = null; // tip Y of the in-flight kunai
  private failAnim: FailAnim | null = null;

  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private lastTime = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

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

    this.room = initRoomMode("kunai-throw", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    this.canvas.addEventListener("pointerdown", this.handlePointer);

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

  private handlePointer = (e: Event): void => {
    e.preventDefault();
    this.onPrimary();
  };

  /** Space / Enter / tap: start from the menus, or throw during play. */
  private onPrimary(): void {
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "gameover" && this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    } else if (this.state === "playing") {
      this.throwKunai();
    }
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.level = 1;
    this.levelTarget = KUNAIS_BASE;
    this.kunaisLeft = this.levelTarget;
    this.flyingTipY = null;
    this.failAnim = null;

    this.log.setLevel(1);
    this.hud.setScore(0);
    this.hud.setLevel(1);
    this.hud.hide();

    this.countdownTime = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
    this.lastCountdownIndex = -1;
  }

  private startGameplay(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
  }

  private throwKunai(): void {
    if (this.flyingTipY !== null) return; // one kunai in flight at a time
    if (this.kunaisLeft <= 0) return;
    this.flyingTipY = KUNAI_READY_TIP_Y;
    this.kunaisLeft--;
    SoundEffects.playThrow();
  }

  private resolveHit(): void {
    const rel = this.log.worldToRel(IMPACT_ANGLE);
    this.flyingTipY = null;

    if (this.log.canPlaceAt(rel)) {
      // Clean landing.
      this.log.addStuck(rel);
      this.score++;
      this.hud.setScore(this.score);
      SoundEffects.playStick();

      if (this.kunaisLeft <= 0) this.levelComplete();
    } else {
      // Struck another kunai: bounce the blade off and end the run.
      this.failAnim = {
        x: LOG_CENTER_X,
        y: LOG_CENTER_Y + LOG_RADIUS,
        vx: (Math.random() * 2 - 1) * 140,
        vy: -220,
        angle: -Math.PI / 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * 9,
      };
      SoundEffects.playClang();
      this.gameOver();
    }
  }

  private levelComplete(): void {
    this.level++;
    this.levelTarget = KUNAIS_BASE + (this.level - 1);
    this.kunaisLeft = this.levelTarget;
    this.log.setLevel(this.level);
    this.hud.setLevel(this.level);
    SoundEffects.playLevelUp();
  }

  private gameOver(): void {
    this.state = "gameover";
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("kunai-throw", this.score);
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
    if (this.state === "countdown") {
      this.log.update(dt);
      this.countdownTime -= dt;
      if (this.countdownTime <= 0) {
        this.startGameplay();
      } else {
        const total = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
        const idx = Math.floor((total - this.countdownTime) / COUNTDOWN_STEP);
        const index = Math.max(0, Math.min(COUNTDOWN_LABELS.length - 1, idx));
        if (index !== this.lastCountdownIndex) {
          this.lastCountdownIndex = index;
          SoundEffects.playCountdownTick();
        }
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
      return;
    }

    if (this.state === "playing") {
      this.log.update(dt);

      if (this.flyingTipY !== null) {
        this.flyingTipY -= KUNAI_SPEED * dt;
        if (this.flyingTipY <= LOG_CENTER_Y + LOG_RADIUS) {
          this.resolveHit();
        }
      }
    }

    // The failed kunai keeps tumbling off-screen even after game over.
    if (this.failAnim) {
      const f = this.failAnim;
      f.vy += 1500 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;
      if (f.y > VIEW_HEIGHT + 120) this.failAnim = null;
    }
  }

  private draw(): void {
    const ctx = this.ctx;

    // Background.
    const bg = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
    bg.addColorStop(0, "#14100c");
    bg.addColorStop(1, "#241a10");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    // Rotating log with its stuck kunais (drawn in menus, play and game over).
    if (this.state !== "ready") {
      this.log.draw(ctx, this.kunaisLeft);
    }

    // In-flight kunai (tip points up).
    if (this.state === "playing" && this.flyingTipY !== null) {
      drawKunai(ctx, LOG_CENTER_X, this.flyingTipY, -Math.PI / 2);
    }

    // Ready kunai waiting to be thrown.
    if (this.state === "playing" && this.flyingTipY === null && this.kunaisLeft > 0) {
      drawKunai(ctx, LOG_CENTER_X, KUNAI_READY_TIP_Y, -Math.PI / 2);
    }

    // Ammo counter under the ready kunai.
    if (this.state === "playing") {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "bold 22px 'Courier New', Courier, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`x ${this.kunaisLeft}`, LOG_CENTER_X, VIEW_HEIGHT - 46);
      ctx.restore();
    }

    // Failed kunai tumbling away.
    if (this.failAnim) {
      drawKunai(ctx, this.failAnim.x, this.failAnim.y, this.failAnim.angle);
    }
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
