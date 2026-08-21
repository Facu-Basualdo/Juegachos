import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  START_TIME,
  MAX_TIME,
  HIT_BONUS,
  MISS_PENALTY,
  MIN_GRID,
  MAX_GRID,
  LEVELS_PER_SIZE,
  START_DELTA,
  DELTA_STEP,
  MIN_DELTA,
  BASE_SATURATION,
  BASE_LIGHTNESS,
  GAME_OVER_REVEAL_MS,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameOver";

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best: number | null = null;

  private timeLeft = START_TIME;
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private oddIndex = -1;
  private lastTime = 0;
  /**
   * True solo cuando el overlay de inicio / fin esta realmente en pantalla. Al
   * perder, el estado pasa a "gameOver" pero el overlay aparece
   * `GAME_OVER_REVEAL_MS` despues (revelado de la ficha distinta): sin este guard
   * un Enter en esa ventana reinicia la partida, y el setTimeout del revelado
   * (que quedaba huerfano) disparaba igual y tapaba el juego nuevo con la pantalla
   * de fin y el tablero borrado. Nunca se mostraba el puntaje.
   */
  private menuVisible = true;
  /** Timer del revelado -> overlay de fin (para poder cancelarlo). */
  private overTimer: number | null = null;

  constructor(container: HTMLElement) {
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) this.best = parseInt(savedBest, 10);

    this.hud = new Hud(container);
    this.hud.showStart(this.best);
    this.hud.updateBest(this.best);

    // Parcial por timeout: los aciertos acumulados de la partida en curso.
    this.room = initRoomMode("odd-one-out", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    this.hud.overlay.addEventListener("pointerdown", this.handleOverlayTap);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter") return;
    this.tryStart();
  };

  private handleOverlayTap = (e: Event): void => {
    // El panel de ranking dentro del overlay es interactivo: no arrancar
    // una partida cuando el toque cae sobre el.
    const target = e.target as HTMLElement;
    if (target !== this.hud.overlay && target.closest("input, button, form")) return;
    this.tryStart();
  };

  private tryStart(): void {
    // Solo se arranca con el overlay realmente en pantalla, nunca durante el
    // revelado de fin (estado "gameOver" pero overlay aun oculto).
    if (!this.menuVisible) return;
    if (this.state === "ready") {
      this.beginCountdown();
    } else if (this.state === "gameOver") {
      // En modo sala se juega una sola partida por ronda: sin reintento.
      if (this.room) return;
      this.beginCountdown();
    }
  }

  private beginCountdown(): void {
    if (this.overTimer !== null) {
      window.clearTimeout(this.overTimer);
      this.overTimer = null;
    }
    this.menuVisible = false;
    this.state = "countdown";
    this.score = 0;
    this.timeLeft = START_TIME;
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.hud.updateScore(0);
    this.hud.updateTime(1);
    this.hud.clearBoard();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startRun(): void {
    this.state = "playing";
    this.nextRound();
  }

  private nextRound(): void {
    const size = Math.min(MAX_GRID, MIN_GRID + Math.floor(this.score / LEVELS_PER_SIZE));
    const delta = Math.max(MIN_DELTA, START_DELTA - this.score * DELTA_STEP);

    const hue = Math.floor(Math.random() * 360);
    // El signo del offset es aleatorio: la ficha distinta puede ser mas clara
    // o mas oscura, siempre dentro del rango visible de luminosidad.
    const sign = Math.random() < 0.5 ? -1 : 1;
    let oddLightness = BASE_LIGHTNESS + sign * delta;
    if (oddLightness < 12 || oddLightness > 90) {
      oddLightness = BASE_LIGHTNESS - sign * delta;
    }

    const baseColor = `hsl(${hue}, ${BASE_SATURATION}%, ${BASE_LIGHTNESS}%)`;
    const oddColor = `hsl(${hue}, ${BASE_SATURATION}%, ${oddLightness}%)`;
    this.oddIndex = Math.floor(Math.random() * size * size);

    this.hud.renderBoard(size, baseColor, oddColor, this.oddIndex, this.handlePick);
  }

  private handlePick = (index: number, tile: HTMLButtonElement): void => {
    if (this.state !== "playing") return;

    if (index === this.oddIndex) {
      this.score++;
      this.timeLeft = Math.min(MAX_TIME, this.timeLeft + HIT_BONUS);
      this.hud.updateScore(this.score);
      SoundEffects.playCorrect(this.score);
      this.nextRound();
    } else {
      this.timeLeft -= MISS_PENALTY;
      this.hud.markMiss(tile);
      SoundEffects.playWrong();
      if (this.timeLeft <= 0) this.endGame();
    }
  };

  private endGame(): void {
    this.state = "gameOver";
    SoundEffects.playGameOver();
    this.timeLeft = 0;
    this.hud.updateTime(0);
    // Revela cual era la ficha distinta antes de tapar el tablero con el overlay.
    this.hud.revealOdd(this.oddIndex);

    let isNewBest = false;
    if (this.best === null || this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      isNewBest = true;
    }
    this.hud.updateBest(this.best);

    this.overTimer = window.setTimeout(() => {
      this.overTimer = null;
      this.menuVisible = true;
      this.hud.clearBoard();
      this.hud.showGameOver(this.score, isNewBest, this.best!, this.room !== null);

      if (this.room) this.room.reportScore(this.score);
      else this.hud.showRanking("odd-one-out", this.score);
    }, GAME_OVER_REVEAL_MS);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt);

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);

      if (index >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.startRun();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "playing") {
      this.timeLeft -= dt;
      this.hud.updateTime(this.timeLeft / MAX_TIME);
      if (this.timeLeft <= 0) this.endGame();
    }
  }

  dispose(): void {
    if (this.overTimer !== null) window.clearTimeout(this.overTimer);
    window.removeEventListener("keydown", this.handleKeyDown);
    this.hud.overlay.removeEventListener("pointerdown", this.handleOverlayTap);
  }
}
