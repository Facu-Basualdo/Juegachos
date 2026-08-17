import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  FAILED_ATTEMPTS,
  MAX_ATTEMPTS,
  MAX_DT,
  WORD_LENGTH,
  encodeScore,
  type LetterState,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import {
  evaluateGuess,
  isValidGuess,
  keyboardStates,
  normalize,
  randomSolution,
  solutionFor,
} from "./logic";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  clearRoomRun,
  elapsedSince,
  loadRoomRun,
  saveRoomRun,
} from "../../../shared/room/roomRun";

const GAME_ID = "wordle";

type State = "ready" | "countdown" | "playing" | "revealing" | "over";

/**
 * Partida en curso persistida en sala, para sobrevivir un F5 (ver roomRun.ts).
 * La solucion NO se guarda: se re-deriva de sala+ronda (regla de no guardar lo
 * que se puede derivar). El tiempo va como epoch, nunca acumulado, asi recargar
 * no pausa el reloj.
 */
interface SavedRun {
  guesses: string[];
  startedAt: number;
}

interface Best {
  attempts: number;
  seconds: number;
}

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;
  private state: State = "ready";

  private solution = "";
  /** Intentos ya confirmados, en orden. */
  private guesses: string[] = [];
  /** Fila en edicion (todavia sin confirmar). */
  private current = "";
  private solved = false;

  private elapsedTime = 0;
  private lastTime = 0;
  /** Epoch ms del arranque de la partida. Solo en sala (ver `update`). */
  private startedAt = 0;

  private countdownTime = 0;
  /** Ultimo indice del countdown que sono, para que cada numero suene una vez. */
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.hud = new Hud(container);
    this.hud.showStart();

    // Parcial por timeout: sin resolver. En un juego "lower" el parcial no es
    // comparable con una partida terminada y points.ts ya los empata detras.
    this.room = initRoomMode(GAME_ID, {
      getScore: () => this.currentScore(),
      onStart: () => this.beginCountdown(),
    });

    this.bindInputs(container);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private bindInputs(container: HTMLElement): void {
    window.addEventListener("keydown", this.handleKeyDown);
    // Arranque por toque: en movil no hay Enter fisico, y el teclado en pantalla
    // recien aparece con la partida ya empezada, asi que sin esto la pantalla de
    // inicio no tenia salida. Solo actua en ready / over, con lo cual los toques
    // sobre las teclas durante la partida no lo despiertan.
    container.addEventListener("pointerdown", this.handlePointerDown);
  }

  private handlePointerDown = (): void => {
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "over" && this.room) return;
    if (this.state === "ready" || this.state === "over") this.beginCountdown();
  };

  /** Mientras corre el reloj de la partida (el reveal cuenta: es parte del turno). */
  private isRunning(): boolean {
    return this.state === "playing" || this.state === "revealing";
  }

  private currentScore(): number {
    const attempts = this.solved ? this.guesses.length : FAILED_ATTEMPTS;
    return encodeScore(attempts, this.elapsedTime);
  }

  // ---------- Input ----------

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Enter") {
      // En modo sala se juega una sola partida por ronda: sin reintento.
      if (this.state === "over" && this.room) return;
      if (this.state === "ready" || this.state === "over") {
        this.beginCountdown();
        return;
      }
    }
    if (this.state !== "playing") return;

    if (e.key === "Enter") {
      e.preventDefault();
      this.submitGuess();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      this.deleteLetter();
      return;
    }
    // Solo teclas de un caracter: asi "Shift" / "Tab" no se cuelan como letra
    // despues de normalizar.
    if (e.key.length !== 1) return;
    const letter = normalize(e.key);
    if (letter.length === 1) this.addLetter(letter);
  };

  /** Teclado en pantalla. Recibe una letra suelta, "Enter" o "Backspace". */
  private handleVirtualKey = (key: string): void => {
    if (this.state !== "playing") return;
    if (key === "Enter") this.submitGuess();
    else if (key === "Backspace") this.deleteLetter();
    else this.addLetter(key);
  };

  private addLetter(letter: string): void {
    if (this.current.length >= WORD_LENGTH) return;
    this.current += letter;
    SoundEffects.playKey();
    this.renderCurrentRow();
  }

  private deleteLetter(): void {
    if (this.current.length === 0) return;
    this.current = this.current.slice(0, -1);
    SoundEffects.playDelete();
    this.renderCurrentRow();
  }

  private submitGuess(): void {
    if (this.current.length < WORD_LENGTH) {
      this.rejectGuess("FALTAN LETRAS");
      return;
    }
    if (!isValidGuess(this.current)) {
      this.rejectGuess("NO ESTÁ EN LA LISTA");
      return;
    }

    const row = this.guesses.length;
    const guess = this.current;
    const states = evaluateGuess(guess, this.solution);

    this.guesses.push(guess);
    this.current = "";
    // Se guarda apenas se confirma el intento, no al terminar el reveal: un F5
    // en el medio de la animacion no puede regalar un intento.
    this.saveRun();

    this.state = "revealing";
    this.hud.updateStats(this.guesses.length, this.elapsedTime);
    this.hud.revealRow(
      row,
      guess,
      states,
      (state: LetterState) => SoundEffects.playReveal(state),
      () => this.finishReveal(guess),
    );
  }

  private rejectGuess(message: string): void {
    SoundEffects.playInvalid();
    this.hud.shakeRow(this.guesses.length);
    this.hud.showToast(message);
  }

  /** Cierre del reveal: el resultado ya estaba decidido al confirmar el intento. */
  private finishReveal(guess: string): void {
    this.hud.setKeyStates(keyboardStates(this.guesses, this.solution));

    if (guess === this.solution) {
      this.finish(true);
      return;
    }
    if (this.guesses.length >= MAX_ATTEMPTS) {
      this.finish(false);
      return;
    }
    this.state = "playing";
  }

  // ---------- Ciclo de partida ----------

  private beginCountdown(): void {
    // En sala, un F5 vuelve a pasar por aca (la ronda sigue en "playing" y
    // RoomMode redispara onStart): si hay partida guardada se retoma tal cual,
    // sin countdown ni palabra nueva.
    if (this.room && this.resumeSavedRun()) return;

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;

    // En sala la palabra se deriva de sala+ronda: todos reciben la misma sin
    // que nadie tenga que repartirla por la red.
    this.solution = this.room
      ? solutionFor(this.room.code, this.room.round())
      : randomSolution();
    this.guesses = [];
    this.current = "";
    this.solved = false;

    this.hud.hideOverlay();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
    this.hud.setupBoard(this.handleVirtualKey);
    this.renderAll();
  }

  /**
   * Retoma la partida guardada de esta ronda tras un reload. Devuelve false si no
   * hay nada guardado (o el snapshot no cierra) y hay que empezar de cero.
   */
  private resumeSavedRun(): boolean {
    const saved = loadRoomRun<SavedRun>(this.room!, GAME_ID);
    if (!saved || !Array.isArray(saved.guesses)) return false;
    if (!Number.isFinite(saved.startedAt)) return false;
    if (saved.guesses.length > MAX_ATTEMPTS) return false;
    const guesses = saved.guesses.filter(
      (g) => typeof g === "string" && g.length === WORD_LENGTH && normalize(g) === g,
    );
    if (guesses.length !== saved.guesses.length) return false;

    this.solution = solutionFor(this.room!.code, this.room!.round());
    this.guesses = guesses;
    this.current = "";
    this.solved = false;
    this.startedAt = saved.startedAt;
    this.elapsedTime = elapsedSince(saved.startedAt);

    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.hideOverlay();
    this.hud.setupBoard(this.handleVirtualKey);
    this.renderAll();
    this.hud.updateStats(this.guesses.length, this.elapsedTime);

    // El F5 pudo caer entre el intento guardado y el cierre de la partida (el
    // reveal dura ~1.5s): si el snapshot ya es terminal, se cierra ahora en vez
    // de dejar al jugador tecleando sobre una partida que ya termino.
    const last = guesses[guesses.length - 1];
    if (last === this.solution) this.finish(true);
    else if (guesses.length >= MAX_ATTEMPTS) this.finish(false);
    return true;
  }

  /** Snapshot de la partida para sobrevivir un F5. No hace nada fuera de sala. */
  private saveRun(): void {
    if (!this.room) return;
    const data: SavedRun = { guesses: this.guesses, startedAt: this.startedAt };
    saveRoomRun(this.room, GAME_ID, data);
  }

  private finish(solved: boolean): void {
    this.state = "over";
    this.solved = solved;
    // La partida de la ronda termino: un reload ya no debe retomarla.
    if (this.room) clearRoomRun(this.room, GAME_ID);

    const attempts = solved ? this.guesses.length : FAILED_ATTEMPTS;
    const score = encodeScore(attempts, this.elapsedTime);
    const isNewBest = solved && this.saveBest(attempts, this.elapsedTime);

    if (solved) SoundEffects.playWin();
    else SoundEffects.playLose();

    this.hud.showGameOver({
      solved,
      solution: this.solution,
      attempts: this.guesses.length,
      timeSeconds: this.elapsedTime,
      isNewBest,
      inRoom: this.room !== null,
    });

    if (this.room) this.room.reportScore(score);
    else this.hud.showRanking(GAME_ID, score);
  }

  /** Guarda el record local. Mejor = menos intentos, y a igualdad, menos tiempo. */
  private saveBest(attempts: number, seconds: number): boolean {
    const prev = this.loadBest();
    if (prev && encodeScore(prev.attempts, prev.seconds) <= encodeScore(attempts, seconds)) {
      return false;
    }
    localStorage.setItem(BEST_KEY, JSON.stringify({ attempts, seconds } satisfies Best));
    return true;
  }

  private loadBest(): Best | null {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (!raw) return null;
      const best = JSON.parse(raw) as Best;
      if (!Number.isFinite(best?.attempts) || !Number.isFinite(best?.seconds)) return null;
      return best;
    } catch {
      return null;
    }
  }

  // ---------- Render ----------

  private renderCurrentRow(): void {
    this.hud.setRow(this.guesses.length, this.current, null);
  }

  /** Repinta todo desde los intentos (unica fuente de verdad de la partida). */
  private renderAll(): void {
    for (let row = 0; row < MAX_ATTEMPTS; row++) {
      const guess = this.guesses[row];
      if (guess) this.hud.setRow(row, guess, evaluateGuess(guess, this.solution));
      else if (row === this.guesses.length) this.hud.setRow(row, this.current, null);
      else this.hud.setRow(row, "", null);
    }
    this.hud.setKeyStates(keyboardStates(this.guesses, this.solution));
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
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);

      if (index >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.state = "playing";
        this.elapsedTime = 0;
        this.startedAt = Date.now();
        this.hud.hideOverlay();
        this.hud.updateStats(0, 0);
        this.saveRun();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.isRunning()) {
      // En sala el cronometro es el reloj de pared desde `startedAt`, no la suma
      // de dt: asi un F5 (o una pestana en segundo plano) no regala tiempo.
      this.elapsedTime = this.room ? elapsedSince(this.startedAt) : this.elapsedTime + dt;
      this.hud.updateStats(this.guesses.length, this.elapsedTime);
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
