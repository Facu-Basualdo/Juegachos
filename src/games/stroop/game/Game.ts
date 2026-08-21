import {
  COLORS,
  optionsFor,
  CONGRUENT_CHANCE,
  START_TIME,
  MAX_TIME,
  TIME_GAIN,
  TIME_PENALTY,
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  type ColorDef,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameOver";

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private improvedThisRun = false;

  private timeLeft = START_TIME;
  private inkHex = ""; // color correcto (la tinta)
  private current: ColorDef[] = []; // swatches en el orden mostrado (para el teclado)

  private lastTime = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.hud = new Hud(container, { onPick: (hex) => this.onPick(hex) });
    this.hud.showStart(this.best);

    this.room = initRoomMode("stroop", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("pointerdown", this.handlePointerDown);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ---------- Input ----------

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && (this.state === "ready" || this.state === "gameOver")) {
      this.startFromMenu();
      return;
    }
    if (this.state === "playing" && /^[1-9]$/.test(e.key)) {
      const i = parseInt(e.key, 10) - 1;
      if (i < this.current.length) this.onPick(this.current[i].hex);
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.state !== "ready" && this.state !== "gameOver") return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest(".mg-lb")) return;
    this.startFromMenu();
  };

  private startFromMenu(): void {
    if (this.room) return; // en sala el arranque lo dispara RoomMode
    this.beginCountdown();
  }

  private onPick(hex: string): void {
    if (this.state !== "playing") return;
    if (hex === this.inkHex) {
      this.score++;
      this.timeLeft = Math.min(MAX_TIME, this.timeLeft + TIME_GAIN);
      this.hud.setScore(this.score);
      SoundEffects.playCorrect();
      this.newPrompt();
    } else {
      this.timeLeft -= TIME_PENALTY;
      SoundEffects.playWrong();
      this.hud.flashWrong();
      if (this.timeLeft <= 0) this.endGame();
    }
  }

  // ---------- Flujo ----------

  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.timeLeft = START_TIME;
    this.improvedThisRun = false;
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.startPlayUi(this.best);
    this.hud.setTimer(1);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.score = 0;
    this.timeLeft = START_TIME;
    this.hud.setScore(0);
    this.hud.showCountdown(null);
    this.newPrompt();
  }

  /** Genera una palabra-color pintada con otra tinta, y los swatches de respuesta. */
  private newPrompt(): void {
    const n = optionsFor(this.score);
    const active = COLORS.slice(0, n);
    const ink = active[(Math.random() * active.length) | 0];
    let wordDef = ink;
    if (Math.random() >= CONGRUENT_CHANCE) {
      // Incongruente: la palabra dice un color distinto de la tinta.
      do {
        wordDef = active[(Math.random() * active.length) | 0];
      } while (wordDef === ink);
    }
    this.inkHex = ink.hex;
    this.current = shuffle(active.slice());
    this.hud.showWord(wordDef.name, ink.hex);
    this.hud.renderButtons(this.current);
  }

  private endGame(): void {
    this.state = "gameOver";
    SoundEffects.playFinish();
    if (this.score > this.best) {
      this.best = this.score;
      this.improvedThisRun = true;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.hud.showGameOver(this.score, this.best, this.improvedThisRun);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("stroop", this.score);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) this.start();
      else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "playing") {
      this.timeLeft -= dt;
      // La barra arranca LLENA (normaliza contra START_TIME). El tiempo puede
      // banquearse por encima hasta MAX_TIME: la barra se satura en lleno.
      this.hud.setTimer(this.timeLeft / START_TIME);
      if (this.timeLeft <= 0) this.endGame();
    }

    requestAnimationFrame(this.tick);
  };

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("pointerdown", this.handlePointerDown);
  }
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
