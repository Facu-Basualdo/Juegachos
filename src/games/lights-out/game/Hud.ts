import { BEST_KEY_PREFIX } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { formatClock } from "../../../shared/scoring";

export class Hud {
  private readonly container: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  // Elements
  private hudBar!: HTMLDivElement;
  private movesIndicator!: HTMLDivElement;
  private timeIndicator!: HTMLDivElement;
  private sizeIndicator!: HTMLDivElement;

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

  // Una celda por posicion (row * size + col)
  private cellElements: HTMLDivElement[] = [];

  private currentGridSize = 4;
  private currentSizeCallback?: (size: number) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildMarkup();
  }

  private buildMarkup(): void {
    // 1. Top HUD Bar
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.movesIndicator = document.createElement("div");
    this.movesIndicator.className = "hud-bar__moves";
    this.movesIndicator.textContent = "MOVIMIENTOS: 0";

    this.sizeIndicator = document.createElement("div");
    this.sizeIndicator.className = "hud-bar__size";
    this.sizeIndicator.textContent = "TABLERO: 4x4";

    this.timeIndicator = document.createElement("div");
    this.timeIndicator.className = "hud-bar__time";
    this.timeIndicator.textContent = "TIEMPO: 0:00.00";

    this.hudBar.append(this.movesIndicator, this.sizeIndicator, this.timeIndicator);

    // 2. Board wrapper & container
    const boardWrapper = document.createElement("div");
    boardWrapper.className = "board-wrapper";

    this.boardContainer = document.createElement("div");
    this.boardContainer.className = "lights-board";
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

    this.titleEl.textContent = "LIGHTS OUT";
    this.subtitleEl.textContent =
      "Apaga todas las luces. Cada toque invierte esa celda y sus vecinas.";

    this.statsLineEl.style.display = "none";
    this.ratingEl.style.display = "none";

    // Create Grid Size selector buttons
    this.sizeSelectorContainer.innerHTML = "";
    this.sizeSelectorContainer.style.display = "flex";

    const sizes = [3, 4, 5];
    sizes.forEach((size) => {
      const btn = document.createElement("button");
      btn.className = `size-btn ${size === this.currentGridSize ? "active" : ""}`;
      btn.textContent = `${size}x${size}`;
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
    const bestMovesStr = localStorage.getItem(`${BEST_KEY_PREFIX}${size}_moves`);
    const bestTimeStr = localStorage.getItem(`${BEST_KEY_PREFIX}${size}_time`);

    if (bestMovesStr && bestTimeStr) {
      const moves = parseInt(bestMovesStr, 10);
      const seconds = parseFloat(bestTimeStr);
      this.bestScoresEl.innerHTML = `MEJOR RECORD (${size}x${size}):<br>${moves} movimientos en ${this.formatTime(seconds)}`;
      this.bestScoresEl.style.display = "block";
    } else {
      this.bestScoresEl.innerHTML = `SIN RECORD AUN (${size}x${size})`;
      this.bestScoresEl.style.display = "block";
    }
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

  setupBoard(size: number, onCellClick: (row: number, col: number) => void): void {
    this.boardContainer.innerHTML = "";
    this.boardContainer.style.setProperty("--grid-size", size.toString());
    this.cellElements = [];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.createElement("div");
        cell.className = "light-cell";

        const inner = document.createElement("div");
        inner.className = "light-cell-inner";
        cell.append(inner);

        cell.addEventListener("pointerdown", (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          onCellClick(r, c);
        });

        this.cellElements.push(cell);
        this.boardContainer.append(cell);
      }
    }

    this.sizeIndicator.textContent = `TABLERO: ${size}x${size}`;
    this.updateStats(0, 0);
  }

  renderBoard(grid: boolean[][], size: number, cursorRow: number, cursorCol: number): void {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = this.cellElements[r * size + c];
        if (!cell) continue;
        cell.classList.toggle("is-on", grid[r][c]);
        cell.classList.toggle("is-cursor", r === cursorRow && c === cursorCol);
      }
    }
  }

  updateStats(moves: number, timeSeconds: number): void {
    this.movesIndicator.textContent = `MOVIMIENTOS: ${moves}`;
    this.timeIndicator.textContent = `TIEMPO: ${this.formatTime(timeSeconds)}`;
  }

  showVictory(
    moves: number,
    timeSeconds: number,
    isNewBestMoves: boolean,
    isNewBestTime: boolean,
    bestMoves: number,
    bestTime: number,
    size: number
  ): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardContainer.classList.add("hidden");

    const recordTitle = isNewBestMoves || isNewBestTime;
    this.titleEl.textContent = recordTitle ? "¡NUEVO RECORD!" : "¡APAGADO TOTAL!";
    this.subtitleEl.textContent = `Apagaste el tablero de ${size}x${size}.`;

    this.statsLineEl.style.display = "block";
    this.statsLineEl.innerHTML = `Movimientos: ${moves}<br>Tiempo: ${this.formatTime(timeSeconds)}`;

    const rating = this.getRatingLabel(moves, size);
    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = rating;
    this.ratingEl.className = `overlay__rating rating-${this.getRatingClass(moves, size)}`;

    this.sizeSelectorContainer.style.display = "none";

    this.bestScoresEl.style.display = "block";
    this.bestScoresEl.innerHTML = `MEJOR RECORD (${size}x${size}):<br>${bestMoves} movimientos en ${this.formatTime(bestTime)}`;

    this.hintEl.textContent = "tocá la pantalla o presioná ENTER para volver a jugar";
  }

  /** "M:SS.CC" con centesimas, igual formato que el ranking (formatClock). */
  private formatTime(totalSeconds: number): string {
    return formatClock(totalSeconds * 100);
  }

  private getRatingLabel(moves: number, size: number): string {
    const scale = (size * size) / 16;
    if (moves <= 8 * scale) return "Electricista Zen";
    if (moves <= 16 * scale) return "Corte Maestro";
    if (moves <= 30 * scale) return "Buen Pulso";
    return "A Tientas";
  }

  private getRatingClass(moves: number, size: number): string {
    const scale = (size * size) / 16;
    if (moves <= 8 * scale) return "divine";
    if (moves <= 16 * scale) return "ultra";
    if (moves <= 30 * scale) return "fast";
    return "average";
  }
}
