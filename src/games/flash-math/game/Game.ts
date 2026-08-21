import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  GAP_MS,
  FIRST_DELAY_MS,
  FEEDBACK_MS,
  ANSWER_TIME_MS,
  ROOM_COUNT,
  ROOM_SHOW_MS,
  ROOM_MAX_VAL,
  ROOM_PENALTY,
  soloRoundConfig,
  roundPoints,
  buildSequence,
  mulberry32,
  hashSeed,
  type RoundConfig,
  type Sequence,
} from "./constants";
import { Hud, type KeyInput } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "showing" | "input" | "feedback" | "gameOver";

const MAX_ANSWER_DIGITS = 6;

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private state: State = "ready";

  private score = 0; // puntos acumulados (solitario)
  private round = 1;
  private roundsCleared = 0;
  private best: number | null = null;

  private config: RoundConfig = { count: 3, showMs: 1000, maxVal: 9 };
  private sequence: Sequence = { terms: [], total: 0 };
  private answer = "";

  // Puntaje de la ronda de sala (0 hasta responder; usado como parcial por timeout).
  private roomScore = 0;

  // Fase "showing"
  private showIndex = -1;
  private showBlank = true;
  private phaseMs = 0;

  // Countdown
  private countdownTime = 0;
  private lastCountdownIndex = -1;

  // Feedback entre rondas
  private feedbackMs = 0;

  /** Fin del tope para responder (performance.now()), valido en estado "input". */
  private answerDeadline = 0;

  private lastTime = 0;
  private readonly containerEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.containerEl = container;

    const saved = localStorage.getItem(BEST_KEY);
    if (saved) this.best = parseFloat(saved);

    this.hud = new Hud(container, { onKey: (k) => this.handleKey(k) });
    this.hud.showStart(this.best);

    this.room = initRoomMode("flash-math", {
      getScore: () => this.roomScore,
      onStart: () => this.beginCountdown(),
    });

    this.bindInputs();
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private bindInputs(): void {
    this.containerEl.addEventListener("mousedown", this.handlePointer);
    this.containerEl.addEventListener("touchstart", this.handleTouch, { passive: false });
    window.addEventListener("keydown", this.handleKeyDown);
  }

  private handleTouch = (e: TouchEvent): void => {
    e.preventDefault();
    this.onAction();
  };

  private handlePointer = (e: MouseEvent): void => {
    if (e.button === 0) this.onAction();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Durante la respuesta, el teclado alimenta el numero (no arranca ni reinicia).
    if (this.state === "input") {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        this.handleKey(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        this.handleKey("del");
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.handleKey("ok");
      }
      return;
    }
    if (e.key === "Enter") this.onAction();
  };

  /** Clic / toque / Enter fuera de la fase de respuesta. */
  private onAction(): void {
    switch (this.state) {
      case "ready":
        if (this.room) return; // en sala el arranque lo dispara onStart
        this.beginCountdown();
        break;
      case "gameOver":
        if (this.room) return; // una sola partida por ronda
        this.beginCountdown();
        break;
      // Durante countdown / showing / feedback no hace nada.
    }
  }

  // ---------- Teclado numerico ----------

  private handleKey(key: KeyInput): void {
    if (this.state !== "input") return;
    if (key === "ok") {
      this.submitAnswer();
      return;
    }
    if (key === "del") {
      this.answer = this.answer.slice(0, -1);
      this.hud.updateAnswer(this.answer);
      SoundEffects.playKey();
      return;
    }
    // Digito
    if (this.answer.length >= MAX_ANSWER_DIGITS) return;
    if (this.answer === "" && key === "0") return; // sin ceros a la izquierda
    this.answer += key;
    this.hud.updateAnswer(this.answer);
    SoundEffects.playKey();
  }

  // ---------- Flujo de partida ----------

  private beginCountdown(): void {
    this.score = 0;
    this.round = 1;
    this.roundsCleared = 0;
    this.roomScore = 0;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hideOverlay();
    this.hud.showTopBar(this.round, this.score, !!this.room);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startRound(round: number): void {
    this.round = round;
    this.answer = "";
    this.hud.showTopBar(this.round, this.score, !!this.room);

    if (this.room) {
      this.config = { count: ROOM_COUNT, showMs: ROOM_SHOW_MS, maxVal: ROOM_MAX_VAL };
      // Semilla compartida: todos los jugadores ven la misma secuencia.
      const rng = mulberry32(hashSeed(`${this.room.code}:${this.room.round()}:flash-math`));
      this.sequence = buildSequence(this.config, rng);
    } else {
      this.config = soloRoundConfig(round);
      this.sequence = buildSequence(this.config, Math.random);
    }

    // Entra a "showing" arrancando con el hueco inicial (que muestra "Ronda N").
    this.state = "showing";
    this.showIndex = -1;
    this.showBlank = true;
    this.phaseMs = 0;
    this.hud.showBanner(this.room ? "¡Memorizá!" : `Ronda ${round}`);
  }

  private enterInput(): void {
    this.state = "input";
    this.answer = "";
    this.answerDeadline = performance.now() + ANSWER_TIME_MS;
    this.hud.showInput();
    this.hud.setAnswerTime(ANSWER_TIME_MS, ANSWER_TIME_MS);
  }

  /** Reloj de la respuesta. Al vencer se envia lo tipeado (aunque este vacio). */
  private updateInput(): void {
    const left = this.answerDeadline - performance.now();
    this.hud.setAnswerTime(Math.max(0, left), ANSWER_TIME_MS);
    if (left <= 0) this.submitAnswer();
  }

  private submitAnswer(): void {
    const value = this.answer === "" ? null : parseInt(this.answer, 10);
    const correct = this.sequence.total;

    if (this.room) {
      const error = value === null ? Infinity : Math.abs(value - correct);
      this.roomScore = value === null ? 0 : Math.max(0, 1000 - error * ROOM_PENALTY);
      this.state = "gameOver";
      this.hud.showRoomResult(value, correct, this.roomScore);
      if (value === correct) SoundEffects.playCorrect();
      else SoundEffects.playWrong();
      this.room.reportScore(this.roomScore);
      return;
    }

    if (value === correct) {
      const delta = roundPoints(this.config);
      this.score += delta;
      this.roundsCleared += 1;
      SoundEffects.playCorrect();
      this.hud.showTopBar(this.round, this.score, false);
      this.state = "feedback";
      this.feedbackMs = 0;
      this.hud.showFeedback(true, delta);
    } else {
      SoundEffects.playWrong();
      this.endGame(value, correct);
    }
  }

  private endGame(yourAnswer: number | null, correct: number): void {
    this.state = "gameOver";
    let isNewBest = false;
    if (this.best === null || this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.score));
      isNewBest = this.score > 0;
    }
    this.hud.showGameOver(
      this.score,
      this.roundsCleared,
      correct,
      yourAnswer,
      isNewBest,
      this.best,
    );
    this.hud.showRanking("flash-math", this.score);
  }

  // ---------- Loop ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt);
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "countdown") {
      this.updateCountdown(dt);
    } else if (this.state === "showing") {
      this.updateShowing(dt);
    } else if (this.state === "input") {
      this.updateInput();
    } else if (this.state === "feedback") {
      this.feedbackMs += dt * 1000;
      if (this.feedbackMs >= FEEDBACK_MS) {
        this.startRound(this.round + 1);
      }
    }
  }

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index === this.lastCountdownIndex) return;
    this.lastCountdownIndex = index;
    if (index >= COUNTDOWN_LABELS.length) {
      SoundEffects.playStart();
      this.hud.showCountdown(null);
      this.startRound(1);
    } else {
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private updateShowing(dt: number): void {
    this.phaseMs += dt * 1000;
    const terms = this.sequence.terms;

    if (this.showBlank) {
      const threshold = this.showIndex < 0 ? FIRST_DELAY_MS : GAP_MS;
      if (this.phaseMs >= threshold) {
        this.phaseMs = 0;
        this.showIndex += 1;
        this.showBlank = false;
        this.hud.showTerm(terms[this.showIndex], this.showIndex === 0);
        SoundEffects.playTerm();
      }
    } else {
      if (this.phaseMs >= this.config.showMs) {
        this.phaseMs = 0;
        this.hud.showTerm(null, false);
        if (this.showIndex >= terms.length - 1) {
          this.enterInput();
        } else {
          this.showBlank = true;
        }
      }
    }
  }

  dispose(): void {
    this.containerEl.removeEventListener("mousedown", this.handlePointer);
    this.containerEl.removeEventListener("touchstart", this.handleTouch);
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
