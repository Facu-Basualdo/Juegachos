import {
  BEST_KEY,
  FLIP_MS,
  KEYBOARD_ROWS,
  MAX_ATTEMPTS,
  REVEAL_STEP_MS,
  TOAST_MS,
  WORD_LENGTH,
  type LetterState,
} from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { formatClock } from "../../../shared/scoring";

/** Tecla especial del teclado en pantalla (el resto son letras sueltas). */
const ENTER_KEY = "Enter";
const DELETE_KEY = "Backspace";

export class Hud {
  private readonly container: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  private hudBar!: HTMLDivElement;
  private attemptsIndicator!: HTMLDivElement;
  private timeIndicator!: HTMLDivElement;

  private boardWrapper!: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;

  private keyboardEl!: HTMLDivElement;

  private overlayEl!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private answerEl!: HTMLDivElement;
  private statsLineEl!: HTMLDivElement;
  private bestEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private countdownEl!: HTMLDivElement;

  /** Una casilla por posicion (fila * WORD_LENGTH + columna). */
  private tiles: HTMLDivElement[] = [];
  /** Tecla por letra, para pintarlas segun lo ya descubierto. */
  private keyEls = new Map<string, HTMLButtonElement>();

  private toastTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildMarkup();
  }

  private buildMarkup(): void {
    // 1. Barra superior
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.attemptsIndicator = document.createElement("div");
    this.attemptsIndicator.className = "hud-bar__attempts";

    this.timeIndicator = document.createElement("div");
    this.timeIndicator.className = "hud-bar__time";

    this.hudBar.append(this.attemptsIndicator, this.timeIndicator);

    // 2. Tablero
    this.boardWrapper = document.createElement("div");
    this.boardWrapper.className = "board-wrapper hidden";

    this.boardEl = document.createElement("div");
    this.boardEl.className = "board";

    this.toastEl = document.createElement("div");
    this.toastEl.className = "toast";

    this.boardWrapper.append(this.toastEl, this.boardEl);

    // 3. Teclado en pantalla
    this.keyboardEl = document.createElement("div");
    this.keyboardEl.className = "keyboard hidden";

    // 4. Overlay de inicio / fin
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.answerEl = document.createElement("div");
    this.answerEl.className = "overlay__answer";

    this.statsLineEl = document.createElement("div");
    this.statsLineEl.className = "overlay__score";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "overlay__bests";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(
      this.titleEl,
      this.subtitleEl,
      this.answerEl,
      this.statsLineEl,
      this.bestEl,
      this.hintEl,
    );
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    // 5. Countdown
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.container.append(
      this.hudBar,
      this.boardWrapper,
      this.keyboardEl,
      this.overlayEl,
      this.countdownEl,
    );
  }

  /** Arma las 30 casillas y el teclado. Idempotente: se puede rellamar por partida. */
  setupBoard(onKey: (key: string) => void): void {
    this.boardEl.innerHTML = "";
    this.tiles = [];
    for (let row = 0; row < MAX_ATTEMPTS; row++) {
      const rowEl = document.createElement("div");
      rowEl.className = "board__row";
      for (let col = 0; col < WORD_LENGTH; col++) {
        const tile = document.createElement("div");
        tile.className = "tile";

        // Dos caras: la de adelante muestra la letra cruda mientras se tipea y
        // la de atras el resultado; el giro pasa de una a la otra.
        const front = document.createElement("div");
        front.className = "tile__face tile__face--front";
        const back = document.createElement("div");
        back.className = "tile__face tile__face--back";
        tile.append(front, back);

        this.tiles.push(tile);
        rowEl.append(tile);
      }
      this.boardEl.append(rowEl);
    }

    this.buildKeyboard(onKey);
  }

  private buildKeyboard(onKey: (key: string) => void): void {
    this.keyboardEl.innerHTML = "";
    this.keyEls.clear();

    KEYBOARD_ROWS.forEach((letters, index) => {
      const rowEl = document.createElement("div");
      rowEl.className = "keyboard__row";

      // La ultima fila lleva las especiales a los costados.
      if (index === KEYBOARD_ROWS.length - 1) {
        rowEl.append(this.makeKey("ENTER", ENTER_KEY, onKey, "key--wide"));
      }

      for (const letter of letters) {
        const key = this.makeKey(letter.toUpperCase(), letter, onKey);
        this.keyEls.set(letter, key);
        rowEl.append(key);
      }

      if (index === KEYBOARD_ROWS.length - 1) {
        rowEl.append(this.makeKey("BORRAR", DELETE_KEY, onKey, "key--wide"));
      }

      this.keyboardEl.append(rowEl);
    });
  }

  private makeKey(
    label: string,
    value: string,
    onKey: (key: string) => void,
    extraClass = "",
  ): HTMLButtonElement {
    const key = document.createElement("button");
    key.type = "button";
    key.className = `key ${extraClass}`.trim();
    key.textContent = label;
    key.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Sin foco en la tecla: si no, el Enter fisico posterior la "reclickea"
      // en vez de llegar al handler del juego.
      e.preventDefault();
      onKey(value);
    });
    return key;
  }

  /** Pinta una fila. `states` en null = todavia sin evaluar (fila en edicion). */
  setRow(row: number, letters: string, states: LetterState[] | null): void {
    for (let col = 0; col < WORD_LENGTH; col++) {
      const tile = this.tiles[row * WORD_LENGTH + col];
      if (!tile) continue;
      const letter = letters[col] ?? "";
      this.setTileLetter(tile, letter);
      tile.classList.toggle("is-filled", letter !== "");
      this.setTileState(tile, states ? states[col] : null);
    }
  }

  private setTileLetter(tile: HTMLDivElement, letter: string): void {
    const text = letter.toUpperCase();
    const [front, back] = tile.children as unknown as HTMLDivElement[];
    front.textContent = text;
    back.textContent = text;
  }

  private setTileState(tile: HTMLDivElement, state: LetterState | null): void {
    tile.classList.toggle("is-exact", state === "exact");
    tile.classList.toggle("is-present", state === "present");
    tile.classList.toggle("is-absent", state === "absent");
    tile.classList.toggle("is-revealed", state !== null);
  }

  /**
   * Revela una fila girando las casillas en cascada y avisa al terminar. Lo usa
   * el juego para bloquear el input mientras dura (el resultado ya esta decidido:
   * la animacion no decide nada, solo lo cuenta).
   */
  revealRow(
    row: number,
    letters: string,
    states: LetterState[],
    onTile: (state: LetterState) => void,
    onDone: () => void,
  ): void {
    for (let col = 0; col < WORD_LENGTH; col++) {
      const tile = this.tiles[row * WORD_LENGTH + col];
      if (!tile) continue;
      this.setTileLetter(tile, letters[col]);
      window.setTimeout(() => {
        this.setTileState(tile, states[col]);
        onTile(states[col]);
      }, col * REVEAL_STEP_MS);
    }
    window.setTimeout(onDone, (WORD_LENGTH - 1) * REVEAL_STEP_MS + FLIP_MS);
  }

  /** Sacude una fila (palabra corta o fuera del diccionario). */
  shakeRow(row: number): void {
    const rowEl = this.boardEl.children[row] as HTMLElement | undefined;
    if (!rowEl) return;
    rowEl.classList.remove("is-shaking");
    void rowEl.offsetWidth; // reinicia la animacion
    rowEl.classList.add("is-shaking");
  }

  showToast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("is-shown");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove("is-shown");
    }, TOAST_MS);
  }

  /** Pinta cada tecla con lo mejor que se sepa de esa letra. */
  setKeyStates(states: Map<string, LetterState>): void {
    for (const [letter, key] of this.keyEls) {
      const state = states.get(letter) ?? null;
      key.classList.toggle("is-exact", state === "exact");
      key.classList.toggle("is-present", state === "present");
      key.classList.toggle("is-absent", state === "absent");
    }
  }

  showStart(): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardWrapper.classList.add("hidden");
    this.keyboardEl.classList.add("hidden");

    this.titleEl.textContent = "WORDLE";
    this.subtitleEl.textContent =
      "Adiviná la palabra de 5 letras en 6 intentos. Verde: letra en su lugar. Amarillo: está en la palabra, pero en otro lado.";

    this.answerEl.style.display = "none";
    this.statsLineEl.style.display = "none";

    this.updateBestDisplay();
    this.hintEl.textContent = "presioná ENTER para comenzar";

    this.leaderboard.clear();
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
    this.boardWrapper.classList.remove("hidden");
    this.keyboardEl.classList.remove("hidden");
    this.hudBar.classList.remove("hidden");
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    void this.countdownEl.offsetWidth; // reinicia la animacion
    this.countdownEl.classList.add("is-shown");
  }

  updateStats(attempts: number, timeSeconds: number): void {
    this.attemptsIndicator.textContent = `INTENTO: ${Math.min(attempts + 1, MAX_ATTEMPTS)}/${MAX_ATTEMPTS}`;
    this.timeIndicator.textContent = `TIEMPO: ${this.formatTime(timeSeconds)}`;
  }

  showGameOver(opts: {
    solved: boolean;
    solution: string;
    attempts: number;
    timeSeconds: number;
    isNewBest: boolean;
    inRoom: boolean;
  }): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.keyboardEl.classList.add("hidden");
    this.boardWrapper.classList.add("hidden");

    if (opts.solved) {
      this.titleEl.textContent = opts.isNewBest ? "¡NUEVO RECORD!" : "¡LA SACASTE!";
      this.subtitleEl.textContent = `La adivinaste en ${opts.attempts} ${
        opts.attempts === 1 ? "intento" : "intentos"
      }.`;
      this.answerEl.style.display = "none";
    } else {
      this.titleEl.textContent = "SIN INTENTOS";
      this.subtitleEl.textContent = "Te quedaste sin intentos. La palabra era:";
      this.answerEl.style.display = "block";
      this.answerEl.textContent = opts.solution.toUpperCase();
    }

    this.statsLineEl.style.display = "block";
    this.statsLineEl.innerHTML = `Intentos: ${opts.solved ? opts.attempts : MAX_ATTEMPTS}/${MAX_ATTEMPTS}<br>Tiempo: ${this.formatTime(opts.timeSeconds)}`;

    this.updateBestDisplay();
    // En sala se juega una sola partida por ronda: el overlay de la sala toma
    // la posta, asi que no se invita a reintentar.
    this.hintEl.textContent = opts.inRoom ? "" : "presioná ENTER para volver a jugar";
  }

  /** Ranking global (menos intentos = mejor, el tiempo desempata). */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  private updateBestDisplay(): void {
    const best = this.loadBest();
    this.bestEl.innerHTML = best
      ? `MEJOR RECORD:<br>${best.attempts}/${MAX_ATTEMPTS} en ${this.formatTime(best.seconds)}`
      : "SIN RECORD AUN";
    this.bestEl.style.display = "block";
  }

  private loadBest(): { attempts: number; seconds: number } | null {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (!raw) return null;
      const best = JSON.parse(raw) as { attempts: number; seconds: number };
      if (!Number.isFinite(best?.attempts) || !Number.isFinite(best?.seconds)) return null;
      return best;
    } catch {
      return null;
    }
  }

  /** "M:SS.CC", mismo formato que el ranking (formatClock). */
  private formatTime(totalSeconds: number): string {
    return formatClock(totalSeconds * 100);
  }
}
