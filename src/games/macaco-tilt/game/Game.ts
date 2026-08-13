import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  DANGER_ANGLE,
  FAIL_ANGLE,
  FALL_DURATION,
  MAX_DT,
  MONKEY_FOOT_HALF,
  PIVOT_X,
  PIVOT_Y,
  PLANK_THICKNESS,
  STRESS_WARN,
  TRIM_SHAKE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./constants";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { Monkey } from "./Monkey";
import { Particles } from "./Particles";
import { Plank } from "./Plank";
import { Renderer } from "./Renderer";
import { SoundEffects } from "./SoundEffects";
import { Wind } from "./Wind";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "falling" | "gameover";

/** Head height above the feet, for spawning sweat in the right place. */
const HEAD_OFFSET = 72;

/**
 * Orchestrates the canvas, the state machine and the fixed-view game loop.
 *
 * The physics coupling lives here and nowhere else: the monkey's position is the plank's
 * lever arm, and the plank's angle is what makes the monkey slide. `Plank` and `Monkey`
 * each own one half and neither imports the other.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly plank = new Plank();
  private readonly monkey = new Monkey();
  private readonly wind = new Wind();
  private readonly particles = new Particles();
  private readonly renderer = new Renderer();
  private readonly hud: Hud;
  private readonly input: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private elapsed = 0;
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;

  private lastTime = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private fallTime = 0;
  private shake = 0;
  private sweatTimer = 0;
  private leafTimer = 0;
  private windWasActive = false;
  /** Previous frame's peak fatigue, so the creak fires once per approach. */
  private lastPeakStress = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container, () => this.handleActivate());
    this.hud.setBest(this.best);
    this.hud.showStart(this.best);

    this.input = new InputController(container);

    this.room = initRoomMode("macaco-tilt", {
      getScore: () => (this.state === "playing" ? this.elapsed : this.score),
      onStart: () => this.beginCountdown(),
    });

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private handleActivate(): void {
    if (this.state === "playing" || this.state === "countdown" || this.state === "falling") return;
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.room && this.state === "gameover") return;
    this.beginCountdown();
  }

  /** Resets the world and runs the 3-2-1-YA countdown before play begins. */
  private beginCountdown(): void {
    this.plank.reset();
    this.monkey.reset();
    this.wind.reset();
    this.particles.clear();
    this.input.clear();
    this.elapsed = 0;
    this.shake = 0;
    this.sweatTimer = 0;
    this.leafTimer = 0;
    this.windWasActive = false;
    this.lastPeakStress = 0;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.setTime(0);
    this.hud.showTime(true);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.elapsed = 0;
    this.hud.showCountdown(null);
    this.hud.setTime(0);
  }

  /** The monkey has left the plank: detach it and play the tumble. */
  private beginFall(): void {
    this.state = "falling";
    this.score = this.elapsed;
    this.fallTime = 0;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    const feet = this.plankToWorld(this.monkey.pos, -PLANK_THICKNESS / 2);
    this.monkey.startFall(feet.x, feet.y, this.plank.angle);
    this.hud.showTime(false);
    SoundEffects.playFall();
  }

  /** Fall animation is over — show the result and report the score. */
  private finishRun(): void {
    this.state = "gameover";
    SoundEffects.playThud();
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("macaco-tilt", this.score);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    this.renderer.update(dt);
    this.particles.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);

    if (this.state === "playing") this.updatePlaying(dt);
    else if (this.state === "countdown") this.updateCountdown(dt);
    else if (this.state === "falling") this.updateFalling(dt);
    else this.monkey.phase += dt; // idle breathing on the start / game-over screens
  }

  private updatePlaying(dt: number): void {
    this.elapsed += dt;
    this.hud.setTime(this.elapsed);

    // Wind first: its acceleration feeds this frame's tilt. It reads the plank's reach
    // so a gust can never exceed what the player is able to answer (see GUST_AUTHORITY).
    const windAccel = this.wind.update(dt, this.elapsed, this.plank.halfLeft, this.plank.halfRight);
    if (this.wind.active && !this.windWasActive) SoundEffects.playGust();
    this.windWasActive = this.wind.active;

    this.monkey.update(dt, this.input.dir, this.plank.angle);
    this.plank.update(dt, this.monkey.pos, windAccel);

    // The plank breaks in stages, never smoothly.
    const trim = this.plank.stepTrim(dt);
    if (trim) {
      const at = this.plankToWorld(trim.at, 0);
      this.particles.splinters(at.x, at.y, trim.side);
      SoundEffects.playCrack();
      this.shake = TRIM_SHAKE;
    }

    // Fatigue: the bamboo gives way wherever the monkey parks. Bigger break than a
    // scheduled trim, so it gets more splinters and more shake.
    const snap = this.plank.stepStress(dt, this.monkey.pos);
    if (snap) {
      const at = this.plankToWorld(snap.at, 0);
      this.particles.splinters(at.x, at.y, snap.side, 28);
      SoundEffects.playCrack();
      this.shake = TRIM_SHAKE * 1.6;
    }
    // Creaking warning on the way up, once per approach.
    const peak = this.plank.peakStress;
    if (peak >= STRESS_WARN && this.lastPeakStress < STRESS_WARN) SoundEffects.playCreak();
    this.lastPeakStress = peak;

    this.spawnAmbient(dt);

    // Two ways to lose: walked off the shrinking plank, or tipped past saving.
    if (
      !this.plank.supports(this.monkey.pos, MONKEY_FOOT_HALF) ||
      Math.abs(this.plank.angle) >= FAIL_ANGLE
    ) {
      this.beginFall();
    }
  }

  /** Sweat while the tilt is dangerous, leaves while a gust is telegraphing. */
  private spawnAmbient(dt: number): void {
    const danger = Math.abs(this.plank.angle);
    if (danger > DANGER_ANGLE) {
      const rate = 3 + 14 * ((danger - DANGER_ANGLE) / (FAIL_ANGLE - DANGER_ANGLE));
      this.sweatTimer -= dt * rate;
      if (this.sweatTimer <= 0) {
        this.sweatTimer = 1;
        const head = this.plankToWorld(this.monkey.pos, -PLANK_THICKNESS / 2 - HEAD_OFFSET);
        this.particles.sweat(head.x, head.y);
      }
    }

    if (this.wind.active) {
      this.leafTimer -= dt * (14 + this.wind.intensity * 22);
      if (this.leafTimer <= 0) {
        this.leafTimer = 1;
        this.particles.windLeaf(this.wind.dir, VIEW_WIDTH, this.wind.intensity);
      }
    }
  }

  private updateCountdown(dt: number): void {
    this.monkey.phase += dt;
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) this.start();
    else if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private updateFalling(dt: number): void {
    this.fallTime += dt;
    this.monkey.updateFall(dt);
    // With the monkey gone the plank has no lever arm left, so it just settles.
    this.plank.update(dt, 0, 0);
    if (this.fallTime >= FALL_DURATION) this.finishRun();
  }

  /** Converts a plank-local point (x along the plank, y across it) to view space. */
  private plankToWorld(localX: number, localY: number): { x: number; y: number } {
    const cos = Math.cos(this.plank.angle);
    const sin = Math.sin(this.plank.angle);
    return {
      x: PIVOT_X + localX * cos - localY * sin,
      y: PIVOT_Y + localX * sin + localY * cos,
    };
  }

  private render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);

    // Shake the world, not the letterbox bars.
    if (this.shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * this.shake, (Math.random() * 2 - 1) * this.shake);
    }

    ctx.beginPath();
    ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.clip();
    this.renderer.draw(ctx, this.plank, this.monkey, this.particles, this.wind);
    ctx.restore();
  }

  // --- Canvas scaling: fit the fixed VIEW box into the window, letterboxed. ---
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

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
  }
}
