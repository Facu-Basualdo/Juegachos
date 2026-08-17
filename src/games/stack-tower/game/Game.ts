import { MAX_DT, VIEW_HEIGHT, VIEW_WIDTH } from "./constants";
import { Tower } from "./Tower";
import { Renderer } from "./Renderer";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "dead";

const BEST_KEY = "stack-tower:best";

/** Countdown before a run starts: one label shown per COUNTDOWN_STEP seconds. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** Orchestrates canvas, state machine and the fixed-view game loop. */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tower = new Tower();
  private readonly renderer = new Renderer();
  private readonly hud: Hud;
  private readonly input: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lastTime = 0;
  /** Delay before a drop can restart after dying, avoids an instant retry. */
  private deadFor = 0;
  /** Elapsed time in the pre-run countdown. */
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.showScore(false);
    this.hud.showStart();

    this.room = initRoomMode("stack-tower", {
      getScore: () => this.tower.score,
      onStart: () => this.beginCountdown(),
    });

    this.tower.reset();

    // El target es el container, no el canvas: la pantalla de inicio / game over
    // es un overlay que tapa el canvas, asi que en movil (donde no hay Enter) un
    // toque sobre el cartel no llegaba nunca a arrancar la partida. El panel de
    // ranking corta la propagacion de sus propios pointerdown.
    this.input = new InputController(container, () => this.onDrop());

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private onDrop(): void {
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;
      case "playing":
        this.place();
        break;
      case "dead":
        // En modo sala se juega una sola partida por ronda: sin reintento.
        if (this.room) return;
        if (this.deadFor > 0.5) this.beginCountdown();
        break;
    }
  }

  /** Resets the tower and runs the 3-2-1-YA countdown before play begins. */
  private beginCountdown(): void {
    this.tower.reset();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.showScore(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private place(): void {
    const result = this.tower.drop();
    if (result === "miss") {
      this.die();
      return;
    }
    if (result === "perfect") SoundEffects.playPerfect();
    else SoundEffects.playPlace(this.tower.score);
    this.hud.setScore(this.tower.score);
  }

  private start(): void {
    this.state = "playing";
    this.hud.setScore(0);
    this.hud.showScore(true);
    this.hud.hide();
    this.hud.showCountdown(null);
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

  private die(): void {
    this.state = "dead";
    this.deadFor = 0;
    SoundEffects.playMiss();
    this.hud.showScore(false);
    const score = this.tower.score;
    if (score > this.best) {
      this.best = score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(score, this.best);
    if (this.room) this.room.reportScore(score);
    else this.hud.showRanking("stack-tower", score);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    if (this.state === "dead") this.deadFor += dt;
    else if (this.state === "countdown") this.updateCountdown(dt);
    this.tower.update(dt);
    this.render();

    requestAnimationFrame(this.tick);
  };

  private render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);
    // Clip to the fixed view box so blocks/slivers outside it don't paint into
    // the letterbox side bars on wide windows.
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.clip();
    this.renderer.draw(ctx, this.tower);
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
