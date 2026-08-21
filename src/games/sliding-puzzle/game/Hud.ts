import { BEST_KEY_PREFIX } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

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
  
  // State variables for UI
  private tileElements: Map<number, HTMLDivElement> = new Map();
  
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
    this.timeIndicator.textContent = "TIEMPO: 00:00";

    this.hudBar.append(this.movesIndicator, this.sizeIndicator, this.timeIndicator);

    // 2. Puzzle Board wrapper & container
    const boardWrapper = document.createElement("div");
    boardWrapper.className = "board-wrapper";
    
    this.boardContainer = document.createElement("div");
    this.boardContainer.className = "puzzle-board";
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

    // Append all elements to parent container
    this.container.append(this.hudBar, boardWrapper, this.overlayEl, this.countdownEl);
  }

  showStart(onSelectSize: (size: number) => void): void {
    this.currentSizeCallback = onSelectSize;
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardContainer.classList.add("hidden");
    
    this.titleEl.textContent = "NUMERIX";
    this.subtitleEl.textContent = "Ordena los numeros deslizando filas o columnas.";
    
    this.statsLineEl.style.display = "none";
    this.ratingEl.style.display = "none";
    
    // Create Grid Size selector buttons
    this.sizeSelectorContainer.innerHTML = "";
    this.sizeSelectorContainer.style.display = "flex";
    
    const sizes = [3, 4, 5];
    sizes.forEach(size => {
      const btn = document.createElement("button");
      btn.className = `size-btn ${size === this.currentGridSize ? "active" : ""}`;
      btn.textContent = `${size}x${size}`;
      btn.addEventListener("click", () => {
        this.currentGridSize = size;
        
        // Update active class on buttons
        const buttons = this.sizeSelectorContainer.querySelectorAll(".size-btn");
        buttons.forEach(b => b.classList.remove("active"));
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

  /** Muestra el ranking global (menos movimientos = mejor) por tamano de tablero. */
  showRanking(gameId: string, moves: number, size: number): void {
    void this.leaderboard.render(gameId, { score: moves, variant: String(size) });
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

  setupBoard(size: number, onTileClick: (row: number, col: number) => void): void {
    this.boardContainer.innerHTML = "";
    this.boardContainer.style.setProperty("--grid-size", size.toString());
    this.tileElements.clear();

    // Create background hint grids first
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const bgCell = document.createElement("div");
        bgCell.className = "board-bg-cell";
        bgCell.style.setProperty("--x", c.toString());
        bgCell.style.setProperty("--y", r.toString());
        
        // Show correct target number as faint background guide
        const targetVal = r * size + c + 1;
        if (targetVal < size * size) {
          bgCell.textContent = targetVal.toString();
        } else {
          bgCell.textContent = ""; // Empty space
        }
        
        this.boardContainer.append(bgCell);
      }
    }

    // Create moving tile elements (1 to size*size - 1)
    const totalTiles = size * size - 1;
    for (let i = 1; i <= totalTiles; i++) {
      const tile = document.createElement("div");
      tile.className = "puzzle-tile";
      
      const inner = document.createElement("div");
      inner.className = "puzzle-tile-inner";
      inner.textContent = i.toString();
      
      tile.append(inner);
      
      // Keep reference to position update
      this.tileElements.set(i, tile);
      this.boardContainer.append(tile);
    }

    // Set up click handlers on the board container (using event delegation to identify clicked row/col)
    // We bind mouse and touch events
    const handleInteraction = (clientX: number, clientY: number) => {
      const rect = this.boardContainer.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;

      if (relativeX >= 0 && relativeX <= rect.width && relativeY >= 0 && relativeY <= rect.height) {
        const col = Math.floor((relativeX / rect.width) * size);
        const row = Math.floor((relativeY / rect.height) * size);
        if (row >= 0 && row < size && col >= 0 && col < size) {
          onTileClick(row, col);
        }
      }
    };

    this.boardContainer.addEventListener("mousedown", (e) => {
      if (e.button === 0) { // Left click
        handleInteraction(e.clientX, e.clientY);
      }
    });

    this.boardContainer.addEventListener("touchstart", (e) => {
      if (e.touches.length > 0) {
        handleInteraction(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    this.sizeIndicator.textContent = `TABLERO: ${size}x${size}`;
    this.updateStats(0, 0);
  }

  renderBoard(grid: number[][], size: number): void {
    // Position tiles based on grid array
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const val = grid[r][c];
        if (val !== 0) {
          const tile = this.tileElements.get(val);
          if (tile) {
            tile.style.setProperty("--x", c.toString());
            tile.style.setProperty("--y", r.toString());
            
            // Check if tile is in its correct solved position
            const correctRow = Math.floor((val - 1) / size);
            const correctCol = (val - 1) % size;
            
            if (r === correctRow && c === correctCol) {
              tile.classList.add("is-correct");
            } else {
              tile.classList.remove("is-correct");
            }
          }
        }
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
    this.titleEl.textContent = recordTitle ? "¡NUEVO RECORD!" : "VICTORIA";
    this.subtitleEl.textContent = `¡Has resuelto el rompecabezas de ${size}x${size}!`;

    this.statsLineEl.style.display = "block";
    this.statsLineEl.innerHTML = `Movimientos: ${moves}<br>Tiempo: ${this.formatTime(timeSeconds)}`;

    // Get rating based on moves
    const rating = this.getRatingLabel(moves, size);
    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = rating;
    this.ratingEl.className = `overlay__rating rating-${this.getRatingClass(moves, size)}`;

    // Size Selector should be hidden
    this.sizeSelectorContainer.style.display = "none";

    // Best scores line
    this.bestScoresEl.style.display = "block";
    this.bestScoresEl.innerHTML = `MEJOR RECORD (${size}x${size}):<br>${bestMoves} movimientos en ${this.formatTime(bestTime)}`;

    this.hintEl.textContent = "tocá la pantalla o presioná ENTER para volver a jugar";
  }

  private formatTime(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const pad = (num: number) => num.toString().padStart(2, "0");
    return `${pad(mins)}:${pad(secs)}`;
  }

  private getRatingLabel(moves: number, size: number): string {
    const scale = (size * size) / 16;
    if (moves < 40 * scale) return "Cerebro Galáctico";
    if (moves < 80 * scale) return "Maestro del Orden";
    if (moves < 150 * scale) return "Veloz";
    return "Paciente";
  }

  private getRatingClass(moves: number, size: number): string {
    const scale = (size * size) / 16;
    if (moves < 40 * scale) return "divine";
    if (moves < 80 * scale) return "ultra";
    if (moves < 150 * scale) return "fast";
    return "average";
  }
}
