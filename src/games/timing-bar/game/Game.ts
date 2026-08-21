import {
  TOTAL_ROUNDS,
  BEST_KEY,
  BASE_SPEED,
  SPEED_STEP,
  RESULT_HOLD,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  scoreForDistance,
  ratingLabel,
} from "./constants";
import { Hud } from "./Hud";
import { Renderer } from "./Renderer";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "roundResult" | "gameOver";

export class Game {
  private readonly hud: Hud;
  private readonly renderer: Renderer;
  /** Room mode (multiplayer): active only with ?room= in the URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private currentRound = 0;
  private roundPoints: number[] = [];

  private bestAverage: number | null = null;

  // Marker sweep
  private pos = 0;
  private dir = 1;
  private speed = BASE_SPEED;
  private frozenPoints = 0;

  // Timers / animation
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private resultTime = 0;
  private flash = 0;

  private lastTime = 0;

  /** Se guarda solo para poder desenganchar el pointerdown en `dispose`. */
  private container: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) this.bestAverage = parseFloat(savedBest);

    this.hud = new Hud(container);
    this.hud.showStart(this.bestAverage);
    this.renderer = new Renderer(this.hud.getCanvas());

    // Timeout partial: average of the rounds completed so far.
    this.room = initRoomMode("timing-bar", {
      getScore: () => this.currentAverage() ?? 0,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    // Sobre el container y no sobre el canvas: la pantalla de inicio / game over
    // es un overlay que lo tapa, asi que en movil (donde no hay Enter) el toque
    // sobre el cartel no llegaba a arrancar. Un solo `pointerdown` cubre mouse y
    // dedo, y el panel de ranking corta la propagacion de los suyos.
    container.addEventListener("pointerdown", this.handlePointer);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      if (this.state === "ready" || this.state === "gameOver") this.onStartInput();
    } else if (e.key === " ") {
      e.preventDefault();
      if (this.state === "playing") this.stopMarker();
    }
  };

  private handlePointer = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.onTap();
  };

  /** A tap/click both starts (menus) and stops the marker (in play). */
  private onTap(): void {
    if (this.state === "ready" || this.state === "gameOver") this.onStartInput();
    else if (this.state === "playing") this.stopMarker();
  }

  private onStartInput(): void {
    // In room mode a single run per round is played: no self-restart.
    if (this.state === "gameOver" && this.room) return;
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.currentRound = 1;
    this.roundPoints = [];
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.flash = 0;

    this.hud.hideOverlay();
    this.hud.hideBanner();
    this.hud.resetDots();
    this.hud.showTopBar();
    this.hud.updateRound(this.currentRound, null);
    this.hud.setActiveDot(this.currentRound);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startRound(): void {
    this.state = "playing";
    this.speed = BASE_SPEED + (this.currentRound - 1) * SPEED_STEP;
    // Start the marker at a random edge, heading inward, so the timing differs.
    if (Math.random() < 0.5) {
      this.pos = 0;
      this.dir = 1;
    } else {
      this.pos = 1;
      this.dir = -1;
    }
    this.frozenPoints = 0;
    this.hud.hideBanner();
    this.hud.updateRound(this.currentRound, this.currentAverage());
    this.hud.setActiveDot(this.currentRound);
  }

  private stopMarker(): void {
    const dist = Math.abs(this.pos - 0.5) * 2; // 0 = center, 1 = edge
    const points = scoreForDistance(dist);
    this.frozenPoints = points;
    this.roundPoints.push(points);

    this.state = "roundResult";
    this.resultTime = 0;

    if (points >= 97) {
      this.flash = 0.0001; // kick off the flash animation
      SoundEffects.playPerfect();
    } else {
      SoundEffects.playStop(points);
    }

    this.hud.markDot(this.currentRound - 1, points, this.currentRound);
    this.hud.updateRound(this.currentRound, this.currentAverage());
    this.hud.showBanner(ratingLabel(points), points);
  }

  private advanceRound(): void {
    if (this.currentRound < TOTAL_ROUNDS) {
      this.currentRound++;
      this.startRound();
    } else {
      this.endGame();
    }
  }

  private endGame(): void {
    const average = this.currentAverage() ?? 0;

    let isNewBest = false;
    if (this.bestAverage === null || average > this.bestAverage) {
      this.bestAverage = average;
      localStorage.setItem(BEST_KEY, average.toString());
      isNewBest = true;
    }

    this.state = "gameOver";
    SoundEffects.playFinish();
    this.hud.showGameOver(this.roundPoints, average, isNewBest, this.bestAverage);
    if (this.room) this.room.reportScore(average);
    else this.hud.showRanking("timing-bar", average);
  }

  private currentAverage(): number | null {
    if (this.roundPoints.length === 0) return null;
    const sum = this.roundPoints.reduce((a, b) => a + b, 0);
    return sum / this.roundPoints.length;
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.flash > 0) {
      this.flash = Math.min(1, this.flash + dt / 0.6);
      if (this.flash >= 1) this.flash = 0;
    }

    if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.startRound();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "playing") {
      this.pos += this.dir * this.speed * dt;
      if (this.pos >= 1) {
        this.pos = 1;
        this.dir = -1;
      } else if (this.pos <= 0) {
        this.pos = 0;
        this.dir = 1;
      }
    } else if (this.state === "roundResult") {
      this.resultTime += dt;
      if (this.resultTime >= RESULT_HOLD) this.advanceRound();
    }
  }

  private render(): void {
    const inPlay = this.state === "playing" || this.state === "roundResult" || this.state === "countdown";
    this.renderer.draw({
      pos: this.pos,
      frozen: this.state === "roundResult",
      frozenPoints: this.frozenPoints,
      flash: this.flash,
      visible: inPlay,
    });
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    this.container?.removeEventListener("pointerdown", this.handlePointer);
    this.renderer.dispose();
  }
}
