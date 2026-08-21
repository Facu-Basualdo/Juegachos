import { BEST_KEY_PREFIX, ERROR_FLASH_MS, GRID_SIZES } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { formatClock } from "../../../shared/scoring";

export class Hud {
  private readonly container: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  // Elements
  private hudBar!: HTMLDivElement;
  private nextIndicator!: HTMLDivElement;
  private sizeIndicator!: HTMLDivElement;
  private timeIndicator!: HTMLDivElement;

  private boardContainer!: HTMLDivElement;

  private overlayEl!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private statsLineEl!: HTMLDivElement;
  private ratingEl!: HTMLDivElement;
  private sizeSelectorContainer!: HTMLDivElement;
  private bestScoresEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private countdownEl!: HTMLDivElement;

  /** Una celda por posicion del tablero (indice en el layout). */
  private cellElements: HTMLDivElement[] = [];
  /** Timers del flash de error por celda, para reiniciarlo si se repite. */
  private errorTimers = new Map<number, number>();

  private currentGridSize = 5;
  private currentSizeCallback?: (size: number) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildMarkup();
  }

  private buildMarkup(): void {
    // 1. Top HUD Bar
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.nextIndicator = document.createElement("div");
    this.nextIndicator.className = "hud-bar__next";
    this.nextIndicator.textContent = "PROXIMO: 1";

    this.sizeIndicator = document.createElement("div");
    this.sizeIndicator.className = "hud-bar__size";
    this.sizeIndicator.textContent = "TABLERO: 5x5";

    this.timeIndicator = document.createElement("div");
    this.timeIndicator.className = "hud-bar__time";
    this.timeIndicator.textContent = "TIEMPO: 0:00.00";

    this.hudBar.append(this.nextIndicator, this.sizeIndicator, this.timeIndicator);

    // 2. Board wrapper & container
    const boardWrapper = document.createElement("div");
    boardWrapper.className = "board-wrapper";

    this.boardContainer = document.createElement("div");
    this.boardContainer.className = "number-board";
    boardWrapper.append(this.boardContainer);

    // 3. Overlays
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.statsLineEl = document.createElement("div");
    this.statsLineEl.className = "overlay__score";

    this.ratingEl = document.createElement("div");
    this.ratingEl.className = "overlay__rating";

    this.sizeSelectorContainer = document.createElement("div");
    this.sizeSelectorContainer.className = "overlay__size-selector";

    this.bestScoresEl = document.createElement("div");
    this.bestScoresEl.className = "overlay__bests";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(
      this.titleEl,
      this.subtitleEl,
      this.statsLineEl,
      this.ratingEl,
      this.sizeSelectorContainer,
      this.bestScoresEl,
      this.hintEl
    );
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    // 4. Countdown Screen
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.container.append(this.hudBar, boardWrapper, this.overlayEl, this.countdownEl);
  }

  showStart(onSelectSize: (size: number) => void): void {
    this.currentSizeCallback = onSelectSize;
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardContainer.classList.add("hidden");

    this.titleEl.textContent = "CLICK THE NUMBER";
    this.subtitleEl.textContent =
      "Los numeros estan desordenados. Tocalos en orden, del 1 al ultimo, lo mas rapido que puedas.";

    this.statsLineEl.style.display = "none";
    this.ratingEl.style.display = "none";

    // Create Grid Size selector buttons
    this.sizeSelectorContainer.innerHTML = "";
    this.sizeSelectorContainer.style.display = "flex";

    GRID_SIZES.forEach((size) => {
      const btn = document.createElement("button");
      btn.className = `size-btn ${size === this.currentGridSize ? "active" : ""}`;
      btn.textContent = `1-${size * size}`;
      btn.addEventListener("click", () => {
        this.currentGridSize = size;

        const buttons = this.sizeSelectorContainer.querySelectorAll(".size-btn");
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        this.updateBestScoreDisplay(size);
        this.currentSizeCallback?.(size);
      });
      this.sizeSelectorContainer.append(btn);
    });

    this.updateBestScoreDisplay(this.currentGridSize);

    this.hintEl.textContent = "tocá la pantalla o presioná ENTER para comenzar";

    this.leaderboard.clear();
  }

  /** Muestra el ranking global (menor tiempo = mejor) por tamano de tablero. */
  showRanking(gameId: string, score: number, size: number): void {
    void this.leaderboard.render(gameId, { score, variant: String(size) });
  }

  private updateBestScoreDisplay(size: number): void {
    const bestTimeStr = localStorage.getItem(`${BEST_KEY_PREFIX}${size}_time`);

    if (bestTimeStr) {
      const seconds = parseFloat(bestTimeStr);
      this.bestScoresEl.innerHTML = `MEJOR TIEMPO (1-${size * size}):<br>${this.formatTime(seconds)}`;
    } else {
      this.bestScoresEl.innerHTML = `SIN RECORD AUN (1-${size * size})`;
    }
    this.bestScoresEl.style.display = "block";
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
    // Force DOM reflow to restart animation
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
    this.boardContainer.classList.remove("hidden");
    this.hudBar.classList.remove("hidden");
  }

  /** Dibuja la grilla. `layout[i]` es el numero que le toca a la celda i. */
  setupBoard(size: number, layout: number[], onCellClick: (index: number) => void): void {
    this.clearErrorTimers();
    this.boardContainer.innerHTML = "";
    this.boardContainer.style.setProperty("--grid-size", size.toString());
    this.cellElements = [];

    layout.forEach((value, index) => {
      const cell = document.createElement("div");
      cell.className = "number-cell";

      const inner = document.createElement("div");
      inner.className = "number-cell-inner";
      inner.textContent = String(value);
      cell.append(inner);

      cell.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        onCellClick(index);
      });

      this.cellElements.push(cell);
      this.boardContainer.append(cell);
    });

    this.sizeIndicator.textContent = `TABLERO: ${size}x${size}`;
  }

  /** Apaga las celdas ya cazadas (las menores al proximo numero buscado). */
  renderBoard(layout: number[], nextNumber: number): void {
    layout.forEach((value, index) => {
      const cell = this.cellElements[index];
      if (!cell) return;
      cell.classList.toggle("is-done", value < nextNumber);
    });
  }

  /** Flash rojo corto en la celda equivocada. */
  flashError(index: number): void {
    const cell = this.cellElements[index];
    if (!cell) return;

    const pending = this.errorTimers.get(index);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      cell.classList.remove("is-error");
      // Reflow para reiniciar la animacion si se vuelve a errar la misma celda.
      void cell.offsetWidth;
    }

    cell.classList.add("is-error");
    const timer = window.setTimeout(() => {
      cell.classList.remove("is-error");
      this.errorTimers.delete(index);
    }, ERROR_FLASH_MS);
    this.errorTimers.set(index, timer);
  }

  private clearErrorTimers(): void {
    for (const timer of this.errorTimers.values()) window.clearTimeout(timer);
    this.errorTimers.clear();
  }

  updateStats(nextNumber: number, total: number, timeSeconds: number): void {
    this.nextIndicator.textContent =
      nextNumber > total ? "PROXIMO: --" : `PROXIMO: ${nextNumber}`;
    this.timeIndicator.textContent = `TIEMPO: ${this.formatTime(timeSeconds)}`;
  }

  showVictory(
    timeSeconds: number,
    isNewBestTime: boolean,
    bestTime: number,
    size: number
  ): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardContainer.classList.add("hidden");

    this.titleEl.textContent = isNewBestTime ? "¡NUEVO RECORD!" : "¡GRILLA LIMPIA!";
    this.subtitleEl.textContent = `Cazaste los ${size * size} numeros en orden.`;

    this.statsLineEl.style.display = "block";
    this.statsLineEl.innerHTML = `Tiempo: ${this.formatTime(timeSeconds)}`;

    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = this.getRatingLabel(timeSeconds, size);
    this.ratingEl.className = `overlay__rating rating-${this.getRatingClass(timeSeconds, size)}`;

    this.sizeSelectorContainer.style.display = "none";

    this.bestScoresEl.style.display = "block";
    this.bestScoresEl.innerHTML = `MEJOR TIEMPO (1-${size * size}):<br>${this.formatTime(bestTime)}`;

    this.hintEl.textContent = "tocá la pantalla o presioná ENTER para volver a jugar";
  }

  /** "M:SS.CC" con centesimas, igual formato que el ranking (formatClock). */
  private formatTime(totalSeconds: number): string {
    return formatClock(totalSeconds * 100);
  }

  /**
   * El rating se mide en segundos por numero, asi que las tres grillas se
   * juzgan con la misma vara (un 5x5 tiene casi tres veces mas celdas que un 3x3).
   */
  private secondsPerCell(timeSeconds: number, size: number): number {
    return timeSeconds / (size * size);
  }

  private getRatingLabel(timeSeconds: number, size: number): string {
    const pace = this.secondsPerCell(timeSeconds, size);
    if (pace <= 0.5) return "Operador Zen";
    if (pace <= 0.8) return "Lectura Limpia";
    if (pace <= 1.2) return "Buen Pulso";
    return "A Tientas";
  }

  private getRatingClass(timeSeconds: number, size: number): string {
    const pace = this.secondsPerCell(timeSeconds, size);
    if (pace <= 0.5) return "divine";
    if (pace <= 0.8) return "ultra";
    if (pace <= 1.2) return "fast";
    return "average";
  }

  dispose(): void {
    this.clearErrorTimers();
  }
}
