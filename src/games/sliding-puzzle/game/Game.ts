import { 
  DEFAULT_GRID_SIZE, 
  BEST_KEY_PREFIX, 
  COUNTDOWN_LABELS, 
  COUNTDOWN_STEP, 
  MAX_DT 
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, ROOM_VARIANTS, type RoomMode } from "../../../shared/room/roomMode";
import {
  clearRoomRun,
  elapsedSince,
  loadRoomRun,
  saveRoomRun,
} from "../../../shared/room/roomRun";
import { encodeTimeMoves } from "../../../shared/scoring";

type State = "ready" | "countdown" | "playing" | "victory";

/** Partida en curso persistida en sala, para sobrevivir un F5 (ver roomRun.ts). */
interface SavedRun {
  size: number;
  grid: number[][];
  moves: number;
  /** Epoch ms del arranque; el tiempo se recalcula contra el reloj de pared. */
  startedAt: number;
}

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;
  private state: State = "ready";
  
  // Grid parameters
  private size: number = DEFAULT_GRID_SIZE;
  private grid: number[][] = [];
  private emptyRow: number = 0;
  private emptyCol: number = 0;
  
  // Game stats
  private moves: number = 0;
  private elapsedTime: number = 0;
  private lastTime: number = 0;
  /** Epoch ms del arranque de la partida. Solo en sala (ver `update`). */
  private startedAt = 0;

  // Timers
  private countdownTime: number = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.hud = new Hud(container);
    this.hud.showStart(this.handleSelectSize);

    // Parcial por timeout: tiempo + movimientos codificados (points.ts sabe que
    // un parcial "lower" sin resolver no es comparable con una victoria).
    this.room = initRoomMode("sliding-puzzle", {
      getScore: () => encodeTimeMoves(this.elapsedTime, this.moves),
      onStart: () => this.beginCountdown(),
    });
    if (this.room) {
      // En sala todos juegan el mismo tablero: tamano fijo, sin selector.
      this.size = parseInt(ROOM_VARIANTS["sliding-puzzle"], 10);
      const selector = container.querySelector<HTMLElement>(".overlay__size-selector");
      if (selector) selector.style.display = "none";
    }

    this.bindInputs(container);
    
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private handleSelectSize = (size: number): void => {
    this.size = size;
  };

  private bindInputs(container: HTMLElement): void {
    window.addEventListener("keydown", this.handleKeyDown);
    // En movil no hay Enter: el toque tiene que poder arrancar. Va sobre el
    // container porque la pantalla de inicio es un overlay que tapa al resto,
    // y se exenta el selector (.overlay__size-selector), que sigue
    // siendo solo un selector para poder mirar el record de cada opcion antes
    // de jugar. El panel de ranking corta la propagacion de sus pointerdown.
    container.addEventListener("pointerdown", this.handlePointerDown);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest(".overlay__size-selector")) return;
    if (this.state === "victory" && this.room) return;
    if (this.state === "ready" || this.state === "victory") this.beginCountdown();
  };


  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      // En modo sala se juega una sola partida por ronda: sin reintento.
      if (this.state === "victory" && this.room) return;
      if (this.state === "ready" || this.state === "victory") {
        this.beginCountdown();
      }
    } else if (this.state === "playing") {
      // Keyboard sliding controls: slide adjacent tile into the empty slot
      // e.g. D/ArrowRight slides the tile on the left to the right (into the empty slot)
      switch (e.key) {
        case "ArrowRight":
        case "d":
        case "D":
          if (this.emptyCol > 0) {
            this.slideTile(this.emptyRow, this.emptyCol - 1);
          }
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          if (this.emptyCol < this.size - 1) {
            this.slideTile(this.emptyRow, this.emptyCol + 1);
          }
          break;
        case "ArrowDown":
        case "s":
        case "S":
          if (this.emptyRow > 0) {
            this.slideTile(this.emptyRow - 1, this.emptyCol);
          }
          break;
        case "ArrowUp":
        case "w":
        case "W":
          if (this.emptyRow < this.size - 1) {
            this.slideTile(this.emptyRow + 1, this.emptyCol);
          }
          break;
      }
    }
  };

  private beginCountdown(): void {
    // En sala, un F5 vuelve a pasar por aca (la ronda sigue en "playing" y
    // RoomMode redispara onStart): si hay partida guardada se retoma tal cual,
    // sin countdown ni tablero nuevo.
    if (this.room && this.resumeSavedRun()) return;

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hideOverlay();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);

    // Set up board elements in HUD (but don't show the full HUD bar/board yet)
    this.hud.setupBoard(this.size, this.handleTileClick);
    this.initBoard();
    this.scrambleBoard();
    this.hud.renderBoard(this.grid, this.size);
  }

  /**
   * Retoma la partida guardada de esta ronda tras un reload. Devuelve false si no
   * hay nada guardado (o no cuadra con el tamano de la sala) y hay que empezar.
   */
  private resumeSavedRun(): boolean {
    const saved = loadRoomRun<SavedRun>(this.room!, "sliding-puzzle");
    if (!saved || saved.size !== this.size) return false;
    if (!Array.isArray(saved.grid) || saved.grid.length !== this.size) return false;
    if (saved.grid.some((row) => !Array.isArray(row) || row.length !== this.size)) return false;
    if (!Number.isFinite(saved.startedAt) || !Number.isFinite(saved.moves)) return false;

    this.grid = saved.grid.map((row) => [...row]);
    // El hueco no se guarda: se deriva del tablero, que es la unica fuente.
    const emptyRow = this.grid.findIndex((row) => row.includes(0));
    if (emptyRow < 0) return false;
    this.emptyRow = emptyRow;
    this.emptyCol = this.grid[emptyRow].indexOf(0);

    this.moves = saved.moves;
    this.startedAt = saved.startedAt;
    this.elapsedTime = elapsedSince(saved.startedAt);

    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.hideOverlay();
    this.hud.setupBoard(this.size, this.handleTileClick);
    this.hud.renderBoard(this.grid, this.size);
    this.hud.updateStats(this.moves, this.elapsedTime);
    return true;
  }

  /** Snapshot de la partida para sobrevivir un F5. No hace nada fuera de sala. */
  private saveRun(): void {
    if (!this.room) return;
    const data: SavedRun = {
      size: this.size,
      grid: this.grid,
      moves: this.moves,
      startedAt: this.startedAt,
    };
    saveRoomRun(this.room, "sliding-puzzle", data);
  }

  private initBoard(): void {
    this.grid = [];
    for (let r = 0; r < this.size; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.size; c++) {
        this.grid[r][c] = r * this.size + c + 1;
      }
    }
    // Last cell is empty
    this.grid[this.size - 1][this.size - 1] = 0;
    this.emptyRow = this.size - 1;
    this.emptyCol = this.size - 1;
  }

  private scrambleBoard(): void {
    // Perform random valid moves from solved state to guarantee solvability
    // 3x3 needs about 100 moves, 4x4 needs 200, 5x5 needs 400.
    const movesCount = this.size === 3 ? 120 : this.size === 4 ? 240 : 400;
    let lastMovedVal = -1;

    for (let i = 0; i < movesCount; i++) {
      const adjacents: { r: number; c: number; val: number }[] = [];
      const dirs = [
        [-1, 0], // Up
        [1, 0],  // Down
        [0, -1], // Left
        [0, 1]   // Right
      ];

      for (const [dr, dc] of dirs) {
        const nr = this.emptyRow + dr;
        const nc = this.emptyCol + dc;
        if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
          const val = this.grid[nr][nc];
          if (val !== lastMovedVal) {
            adjacents.push({ r: nr, c: nc, val });
          }
        }
      }

      if (adjacents.length === 0) continue;

      // Pick one randomly
      const pick = adjacents[Math.floor(Math.random() * adjacents.length)];
      
      // Swap empty with pick
      this.grid[this.emptyRow][this.emptyCol] = pick.val;
      this.grid[pick.r][pick.c] = 0;
      
      this.emptyRow = pick.r;
      this.emptyCol = pick.c;
      lastMovedVal = pick.val;
    }
  }

  private handleTileClick = (row: number, col: number): void => {
    if (this.state !== "playing") return;
    this.slideTile(row, col);
  };

  private slideTile(row: number, col: number): void {
    // Ignore clicks on empty space or out of bounds
    if (row < 0 || row >= this.size || col < 0 || col >= this.size) return;
    if (this.grid[row][col] === 0) return;

    let moved = false;

    // Check if clicked tile is in the same row as the empty space
    if (row === this.emptyRow) {
      moved = true;
      if (col < this.emptyCol) {
        // Slide tiles to the right
        for (let c = this.emptyCol; c > col; c--) {
          this.grid[row][c] = this.grid[row][c - 1];
        }
      } else {
        // Slide tiles to the left
        for (let c = this.emptyCol; c < col; c++) {
          this.grid[row][c] = this.grid[row][c + 1];
        }
      }
      this.grid[row][col] = 0;
      this.emptyCol = col;
    }
    // Check if clicked tile is in the same column as the empty space
    else if (col === this.emptyCol) {
      moved = true;
      if (row < this.emptyRow) {
        // Slide tiles down
        for (let r = this.emptyRow; r > row; r--) {
          this.grid[r][col] = this.grid[r - 1][col];
        }
      } else {
        // Slide tiles up
        for (let r = this.emptyRow; r < row; r++) {
          this.grid[r][col] = this.grid[r + 1][col];
        }
      }
      this.grid[row][col] = 0;
      this.emptyRow = row;
    }

    if (moved) {
      this.moves++;
      SoundEffects.playSlide();
      this.hud.renderBoard(this.grid, this.size);
      this.hud.updateStats(this.moves, this.elapsedTime);
      this.saveRun();

      if (this.checkWin()) {
        this.handleVictory();
      }
    }
  }

  private checkWin(): boolean {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (r === this.size - 1 && c === this.size - 1) {
          if (this.grid[r][c] !== 0) return false;
        } else {
          const expected = r * this.size + c + 1;
          if (this.grid[r][c] !== expected) return false;
        }
      }
    }
    return true;
  }

  private handleVictory(): void {
    this.state = "victory";
    SoundEffects.playVictory();
    // La partida de la ronda termino: un reload ya no debe retomarla.
    if (this.room) clearRoomRun(this.room, "sliding-puzzle");

    // Save/check personal bests
    const movesKey = `${BEST_KEY_PREFIX}${this.size}_moves`;
    const timeKey = `${BEST_KEY_PREFIX}${this.size}_time`;
    
    const savedBestMoves = localStorage.getItem(movesKey);
    const savedBestTime = localStorage.getItem(timeKey);
    
    let isNewBestMoves = false;
    let isNewBestTime = false;
    
    let bestMoves = this.moves;
    let bestTime = this.elapsedTime;

    if (savedBestMoves === null || this.moves < parseInt(savedBestMoves, 10)) {
      localStorage.setItem(movesKey, this.moves.toString());
      isNewBestMoves = true;
    } else {
      bestMoves = parseInt(savedBestMoves, 10);
    }

    if (savedBestTime === null || this.elapsedTime < parseFloat(savedBestTime)) {
      localStorage.setItem(timeKey, this.elapsedTime.toString());
      isNewBestTime = true;
    } else {
      bestTime = parseFloat(savedBestTime);
    }

    this.hud.showVictory(
      this.moves,
      this.elapsedTime,
      isNewBestMoves,
      isNewBestTime,
      bestMoves,
      bestTime,
      this.size
    );
    // El ranking global se ordena por tiempo; el puntaje enviado codifica el
    // tiempo (orden) junto con los movimientos (desempate / se muestran al lado).
    const rankedScore = encodeTimeMoves(this.elapsedTime, this.moves);
    if (this.room) this.room.reportScore(rankedScore);
    else this.hud.showRanking("sliding-puzzle", rankedScore, this.size);
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
        this.state = "playing";
        this.moves = 0;
        this.elapsedTime = 0;
        this.startedAt = Date.now();
        this.hud.hideOverlay();
        this.hud.updateStats(this.moves, this.elapsedTime);
        this.saveRun();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "playing") {
      // En sala el cronometro es el reloj de pared desde `startedAt`, no la suma
      // de dt: asi un F5 (o una pestana en segundo plano) no regala tiempo.
      this.elapsedTime = this.room ? elapsedSince(this.startedAt) : this.elapsedTime + dt;
      this.hud.updateStats(this.moves, this.elapsedTime);
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
