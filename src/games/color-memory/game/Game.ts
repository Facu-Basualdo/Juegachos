import {
  TOTAL_ROUNDS,
  MEMORIZE_MS,
  BEST_KEY,
  ACCURACY_POWER,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
} from "./constants";
import { Hud } from "./Hud";
import {
  type HSV,
  accuracy,
  randomTargetHsv,
  randomStartHsv,
} from "./color";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "memorize" | "guess" | "reveal" | "gameOver";

interface RoundResult {
  target: HSV;
  guess: HSV;
  pct: number;
}

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private currentRound = 0;
  private rounds: RoundResult[] = [];

  private best: number | null = null;
  private target: HSV = { h: 180, s: 60, v: 60 };

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private phaseTimer = 0; // ms
  private lastTime = 0;

  constructor(container: HTMLElement) {
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) this.best = parseFloat(savedBest);

    this.hud = new Hud(container, {
      onStart: () => this.onStartPressed(),
      onConfirm: () => this.onConfirm(),
      onNext: () => this.onNext(),
    });
    this.hud.showStart(this.best);

    // En movil no hay Enter: el toque tiene que poder arrancar desde cualquier
    // parte de la pantalla, no solo desde el boton Comenzar. Se ignoran los <button>, que
    // ya tienen su propio handler (y son los que eligen la opcion), para no
    // arrancar dos veces ni pisar la eleccion.
    container.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.onStartPressed();
    });

    this.room = initRoomMode("color-memory", {
      getScore: () => this.currentAverage() ?? 0,
      onStart: () => this.beginCountdown(),
    });
    if (this.room) this.hud.hideStartButton();

    window.addEventListener("keydown", this.onKeyDown);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter") return;
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;
      case "guess":
        this.onConfirm();
        break;
      case "reveal":
        this.onNext();
        break;
      case "gameOver":
        if (this.room) return;
        this.beginCountdown();
        break;
      default:
        break;
    }
  };

  private onStartPressed(): void {
    if (this.state === "ready" || this.state === "gameOver") this.beginCountdown();
  }

  private beginCountdown(): void {
    this.rounds = [];
    this.currentRound = 0;
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.state = "countdown";
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startRound(round: number): void {
    this.currentRound = round;
    this.target = randomTargetHsv();
    this.state = "memorize";
    this.phaseTimer = MEMORIZE_MS;
    this.hud.showMemorize(round, this.target);
    this.hud.setMemorizeCounter(MEMORIZE_MS);
  }

  private enterGuess(): void {
    this.state = "guess";
    SoundEffects.playVanish();
    this.hud.showGuess(randomStartHsv());
  }

  private onConfirm(): void {
    if (this.state !== "guess") return;
    const guess = this.hud.getGuess();
    const pct = accuracy(guess, this.target, ACCURACY_POWER);
    this.rounds.push({ target: this.target, guess, pct });

    this.state = "reveal";
    const isLast = this.currentRound >= TOTAL_ROUNDS;
    this.hud.showReveal(this.currentRound, guess, this.target, pct, isLast);
    SoundEffects.playConfirm();
    SoundEffects.playReveal(pct);
  }

  private onNext(): void {
    if (this.state !== "reveal") return;
    if (this.currentRound >= TOTAL_ROUNDS) this.endGame();
    else this.startRound(this.currentRound + 1);
  }

  private endGame(): void {
    const average = this.currentAverage() ?? 0;
    let isBest = false;
    if (this.best === null || average > this.best) {
      this.best = average;
      localStorage.setItem(BEST_KEY, average.toString());
      isBest = true;
    }
    this.state = "gameOver";
    this.hud.showGameOver(this.rounds, average, isBest, this.best);

    if (this.room) this.room.reportScore(average);
    else this.hud.showRanking("color-memory", average);
  }

  private currentAverage(): number | null {
    if (this.rounds.length === 0) return null;
    return this.rounds.reduce((a, r) => a + r.pct, 0) / this.rounds.length;
  }

  private tick = (now: number): void => {
    const dtMs = Math.min(now - this.lastTime, MAX_DT * 1000);
    this.lastTime = now;
    this.update(dtMs);
    requestAnimationFrame(this.tick);
  };

  private update(dtMs: number): void {
    if (this.state === "countdown") {
      this.countdownTime += dtMs / 1000;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        if (index >= COUNTDOWN_LABELS.length) {
          SoundEffects.playStart();
          this.hud.showCountdown(null);
          this.startRound(1);
        } else if (index >= 0) {
          SoundEffects.playCountdownTick();
          this.hud.showCountdown(COUNTDOWN_LABELS[index]);
        }
      }
    } else if (this.state === "memorize") {
      this.phaseTimer -= dtMs;
      this.hud.setMemorizeCounter(this.phaseTimer);
      if (this.phaseTimer <= 0) this.enterGuess();
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
