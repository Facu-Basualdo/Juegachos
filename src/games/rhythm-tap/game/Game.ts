import {
  GOOD_HEAL,
  GOOD_SCORE,
  COMBO_BONUS,
  COMBO_BONUS_CAP,
  LANE_COUNT,
  MAX_DT,
  MAX_HEALTH,
  MISS_DAMAGE,
  PERFECT_HEAL,
  PERFECT_SCORE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./constants";
import { NoteField, type Judgment } from "./NoteField";
import { Renderer } from "./Renderer";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "dead";

const BEST_KEY = "rhythm-tap:best";
/** Seconds a lane stays lit after a tap. */
const LANE_FLASH_TIME = 0.18;
/** Countdown before a run starts: one label shown per COUNTDOWN_STEP seconds. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** Orchestrates canvas, state machine and the fixed-view game loop. */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly notes = new NoteField();
  private readonly renderer = new Renderer();
  private readonly hud: Hud;
  private readonly input: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private combo = 0;
  private health = MAX_HEALTH;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lastTime = 0;
  /** Delay before a tap can restart after dying, avoids an instant retry. */
  private deadFor = 0;
  /** Elapsed time in the pre-run countdown. */
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private readonly laneFlash = new Array<number>(LANE_COUNT).fill(0);

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.setHealth(this.health);
    this.hud.showHud(false);
    this.hud.showStart();

    this.room = initRoomMode("rhythm-tap", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    // El target es el container, no el canvas: las pantallas de inicio y game
    // over son un overlay que lo tapa, asi que en movil (donde no hay Enter) el
    // toque sobre el cartel no llegaba a arrancar la partida. El panel de ranking
    // corta la propagacion de sus propios pointerdown.
    this.input = new InputController(
      container,
      (figure) => this.onFigure(figure),
      (lane) => this.onLane(lane),
      (clientX) => this.toViewX(clientX),
      () => this.requestStart(),
    );

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  /** Figure-key press: judged by the piece's figure, in any column. */
  private onFigure(figure: number): void {
    if (!this.beginInput()) return;
    const judgment = this.notes.tapFigure(figure);
    // Light up the column of the note that was actually cleared, if any.
    if (this.notes.lastHitLane >= 0) this.laneFlash[this.notes.lastHitLane] = LANE_FLASH_TIME;
    this.applyJudgment(judgment ?? "miss");
  }

  /** Touch/click on a column: judged by the note in that column. */
  private onLane(lane: number): void {
    if (!this.beginInput()) return;
    this.laneFlash[lane] = LANE_FLASH_TIME;
    this.applyJudgment(this.notes.tapLane(lane) ?? "miss");
  }

  /** Resolves start/restart transitions. Returns true only while playing, when
   *  a gameplay tap should actually be judged. Any tap on a non-playing screen
   *  just kicks off the countdown instead. */
  private beginInput(): boolean {
    if (this.state === "playing") return true;
    this.requestStart();
    return false;
  }

  /** Enter or a tap on a start / game-over screen begins the countdown. */
  private requestStart(): void {
    if (this.state === "ready") this.beginCountdown();
    // En modo sala se juega una sola partida por ronda: sin reintento.
    else if (this.state === "dead" && !this.room && this.deadFor > 0.6) this.beginCountdown();
  }

  /** Resets the notes and runs the 3-2-1-YA countdown before play begins. */
  private beginCountdown(): void {
    this.notes.reset();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.showHud(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  /** Advances the countdown, updating the label and starting play when done. */
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

  private applyJudgment(judgment: Judgment): void {
    if (judgment === "miss") {
      this.combo = 0;
      this.health -= MISS_DAMAGE;
      this.hud.setCombo(this.combo);
      this.hud.setHealth(this.health);
      this.hud.flashJudgment("miss");
      SoundEffects.playMiss();
      if (this.health <= 0) this.die();
      return;
    }

    const base = judgment === "perfect" ? PERFECT_SCORE : GOOD_SCORE;
    const bonus = Math.min(this.combo * COMBO_BONUS, COMBO_BONUS_CAP);
    this.score += base + bonus;
    this.combo += 1;
    if (judgment === "perfect") SoundEffects.playPerfect(this.combo);
    else SoundEffects.playGood(this.combo);
    this.health = Math.min(MAX_HEALTH, this.health + (judgment === "perfect" ? PERFECT_HEAL : GOOD_HEAL));

    this.hud.setScore(this.score);
    this.hud.setCombo(this.combo);
    this.hud.setHealth(this.health);
    this.hud.flashJudgment(judgment);
  }

  private start(): void {
    this.state = "playing";
    this.score = 0;
    this.combo = 0;
    this.health = MAX_HEALTH;
    this.notes.reset();
    this.hud.setScore(0);
    this.hud.setCombo(0);
    this.hud.setHealth(this.health);
    this.hud.showHud(true);
    this.hud.hide();
    this.hud.showCountdown(null);
  }

  private die(): void {
    this.state = "dead";
    this.deadFor = 0;
    SoundEffects.playGameOver();
    this.health = 0;
    this.hud.setHealth(0);
    this.hud.showHud(false);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("rhythm-tap", this.score);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    for (let i = 0; i < this.laneFlash.length; i++) {
      if (this.laneFlash[i] > 0) this.laneFlash[i] = Math.max(0, this.laneFlash[i] - dt);
    }

    // Advance the post-death delay so a tap can restart after the guard window.
    if (this.state === "dead") this.deadFor += dt;
    else if (this.state === "countdown") this.updateCountdown(dt);

    if (this.state !== "playing") return;

    const autoMissed = this.notes.update(dt, this.score);
    if (autoMissed > 0) {
      this.combo = 0;
      this.health -= MISS_DAMAGE * autoMissed;
      this.hud.setCombo(0);
      this.hud.setHealth(this.health);
      this.hud.flashJudgment("miss");
      SoundEffects.playMiss();
      if (this.health <= 0) this.die();
    }
  }

  private render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.clip();
    this.renderer.draw(ctx, this.notes.notes, this.laneFlash);
    ctx.restore();
  }

  // --- Canvas scaling: fit the fixed VIEW box into the window, letterboxed. ---
  private scale = 1;
  private fit = 1;
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

    this.fit = Math.min(w / VIEW_WIDTH, h / VIEW_HEIGHT);
    this.scale = this.fit * dpr;
    this.offsetX = (w / this.fit - VIEW_WIDTH) / 2;
    this.offsetY = (h / this.fit - VIEW_HEIGHT) / 2;
  };

  /** Maps a pointer's client X back into view-space X (inverse of render). */
  private toViewX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    return (clientX - rect.left) / this.fit - this.offsetX;
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
  }
}
