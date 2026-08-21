import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  PAD_COUNT,
  START_DELAY_MS,
  BASE_STEP_MS,
  STEP_DECAY_MS,
  MIN_STEP_MS,
  FLASH_RATIO,
  INPUT_FLASH_MS,
  ROUND_GAP_MS,
  GAME_OVER_REVEAL_MS,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "showing" | "input" | "gameOver";

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best: number | null = null;

  private sequence: number[] = [];
  private inputIndex = 0;

  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private lastTime = 0;

  /** Tokens de setTimeout de la reproduccion en curso, para cancelarlos. */
  private pending: number[] = [];
  /** Se incrementa en cada partida: los timeouts viejos se descartan. */
  private runId = 0;
  /**
   * True solo cuando el overlay de inicio / fin esta realmente en pantalla. Al
   * perder, el estado pasa a "gameOver" pero el overlay aparece
   * `GAME_OVER_REVEAL_MS` despues (revelado del error): sin este guard un Enter en
   * esa ventana reiniciaba la partida y el setTimeout del revelado (crudo, que ni
   * el runId cubria) disparaba igual, tapando el juego nuevo. Nunca se mostraba el
   * puntaje.
   */
  private menuVisible = true;

  constructor(container: HTMLElement) {
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) this.best = parseInt(savedBest, 10);

    this.hud = new Hud(container);
    this.hud.bindPads(this.handlePad);
    this.hud.showStart(this.best);
    this.hud.updateBest(this.best);

    // Parcial por timeout: las rondas completadas de la partida en curso.
    this.room = initRoomMode("simon", {
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
    // revelado del error (estado "gameOver" pero overlay aun oculto).
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
    this.cancelPending();
    this.menuVisible = false;
    this.state = "countdown";
    this.score = 0;
    this.sequence = [];
    this.inputIndex = 0;
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.hud.clearBoard();
    this.hud.updateScore(0);
    this.hud.setStatus("");
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startRun(): void {
    this.nextRound();
  }

  private nextRound(): void {
    this.sequence.push(Math.floor(Math.random() * PAD_COUNT));
    this.playSequence();
  }

  private playSequence(): void {
    this.state = "showing";
    this.inputIndex = 0;
    this.hud.setInputEnabled(false);
    this.hud.setStatus("MEMORIZA");

    // La secuencia se acelera a medida que crece, subiendo la tension.
    const step = Math.max(MIN_STEP_MS, BASE_STEP_MS - (this.sequence.length - 1) * STEP_DECAY_MS);
    const litMs = step * FLASH_RATIO;

    this.sequence.forEach((pad, i) => {
      this.schedule(() => {
        this.hud.flashPad(pad, litMs);
        SoundEffects.playPad(pad);
      }, START_DELAY_MS + i * step);
    });

    this.schedule(() => {
      this.state = "input";
      this.inputIndex = 0;
      this.hud.setInputEnabled(true);
      this.hud.setStatus("TU TURNO");
    }, START_DELAY_MS + this.sequence.length * step);
  }

  private handlePad = (index: number): void => {
    if (this.state !== "input") return;

    const expected = this.sequence[this.inputIndex];
    if (index !== expected) {
      this.endGame(expected, index);
      return;
    }

    this.hud.flashPad(index, INPUT_FLASH_MS);
    SoundEffects.playPad(index);
    this.inputIndex++;

    if (this.inputIndex >= this.sequence.length) {
      // Ronda completada: el puntaje es la longitud de la secuencia repetida.
      this.score = this.sequence.length;
      this.hud.updateScore(this.score);
      this.state = "showing";
      this.hud.setInputEnabled(false);
      this.hud.setStatus("");
      this.schedule(() => this.nextRound(), ROUND_GAP_MS);
    }
  };

  private endGame(correct: number, pressed: number): void {
    this.cancelPending();
    this.state = "gameOver";
    this.hud.setInputEnabled(false);
    this.hud.setStatus("");
    SoundEffects.playWrong();
    this.hud.revealMistake(correct, pressed);

    let isNewBest = false;
    if (this.best === null || this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      isNewBest = true;
    }
    this.hud.updateBest(this.best);

    // Via schedule() (ligado al runId) para que un reinicio lo cancele en vez de
    // dispararse huerfano sobre la partida nueva.
    this.schedule(() => {
      this.menuVisible = true;
      SoundEffects.playGameOver();
      this.hud.clearBoard();
      this.hud.showGameOver(this.score, isNewBest, this.best!, this.room !== null);

      if (this.room) this.room.reportScore(this.score);
      else this.hud.showRanking("simon", this.score);
    }, GAME_OVER_REVEAL_MS);
  }

  /** setTimeout ligado al runId actual: se ignora si la partida ya cambio. */
  private schedule(fn: () => void, delayMs: number): void {
    const id = this.runId;
    const handle = window.setTimeout(() => {
      if (id !== this.runId) return;
      fn();
    }, delayMs);
    this.pending.push(handle);
  }

  private cancelPending(): void {
    this.runId++;
    this.pending.forEach((h) => window.clearTimeout(h));
    this.pending = [];
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

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
    }

    requestAnimationFrame(this.tick);
  };

  dispose(): void {
    this.cancelPending();
    window.removeEventListener("keydown", this.handleKeyDown);
    this.hud.overlay.removeEventListener("pointerdown", this.handleOverlayTap);
  }
}
