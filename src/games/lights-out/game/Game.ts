import {
  DEFAULT_GRID_SIZE,
  BEST_KEY_PREFIX,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  SCRAMBLE_PRESSES,
  MIN_LIT_RATIO,
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
  grid: boolean[][];
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
  /** true = luz encendida. Objetivo: todo apagado. */
  private grid: boolean[][] = [];

  // Keyboard cursor
  private cursorRow = 0;
  private cursorCol = 0;

  // Game stats
  private moves = 0;
  private elapsedTime = 0;
  private lastTime = 0;
  /** Epoch ms del arranque de la partida. Solo en sala (ver `update`). */
  private startedAt = 0;

  // Timers
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.hud = new Hud(container);
    this.hud.showStart(this.handleSelectSize);

    // Parcial por timeout: tiempo + movimientos codificados (points.ts sabe que
    // un parcial "lower" sin resolver no es comparable con una victoria).
    this.room = initRoomMode("lights-out", {
      getScore: () => encodeTimeMoves(this.elapsedTime, this.moves),
      onStart: () => this.beginCountdown(),
    });
    if (this.room) {
      // En sala todos juegan el mismo tamano: fijo, sin selector.
      this.size = parseInt(ROOM_VARIANTS["lights-out"], 10);
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
        return;
      }
    }
    if (this.state !== "playing") return;

    switch (e.key) {
      case "ArrowRight":
      case "d":
      case "D":
        this.moveCursor(0, 1);
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        this.moveCursor(0, -1);
        break;
      case "ArrowDown":
      case "s":
      case "S":
        this.moveCursor(1, 0);
        break;
      case "ArrowUp":
      case "w":
      case "W":
        this.moveCursor(-1, 0);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        this.pressCell(this.cursorRow, this.cursorCol);
        break;
    }
  };

  private moveCursor(dr: number, dc: number): void {
    this.cursorRow = Math.min(this.size - 1, Math.max(0, this.cursorRow + dr));
    this.cursorCol = Math.min(this.size - 1, Math.max(0, this.cursorCol + dc));
    this.hud.renderBoard(this.grid, this.size, this.cursorRow, this.cursorCol);
  }

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

    this.hud.setupBoard(this.size, this.handleCellClick);
    this.initBoard();
    this.scrambleBoard();
    this.cursorRow = Math.floor(this.size / 2);
    this.cursorCol = Math.floor(this.size / 2);
    this.hud.renderBoard(this.grid, this.size, this.cursorRow, this.cursorCol);
  }

  /**
   * Retoma la partida guardada de esta ronda tras un reload. Devuelve false si no
   * hay nada guardado (o no cuadra con el tamano de la sala) y hay que empezar.
   */
  private resumeSavedRun(): boolean {
    const saved = loadRoomRun<SavedRun>(this.room!, "lights-out");
    if (!saved || saved.size !== this.size) return false;
    if (!Array.isArray(saved.grid) || saved.grid.length !== this.size) return false;
    if (saved.grid.some((row) => !Array.isArray(row) || row.length !== this.size)) return false;
    if (!Number.isFinite(saved.startedAt) || !Number.isFinite(saved.moves)) return false;

    this.grid = saved.grid.map((row) => row.map(Boolean));
    this.moves = saved.moves;
    this.startedAt = saved.startedAt;
    this.elapsedTime = elapsedSince(saved.startedAt);
    this.cursorRow = Math.floor(this.size / 2);
    this.cursorCol = Math.floor(this.size / 2);

    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.hideOverlay();
    this.hud.setupBoard(this.size, this.handleCellClick);
    this.hud.renderBoard(this.grid, this.size, this.cursorRow, this.cursorCol);
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
    saveRoomRun(this.room, "lights-out", data);
  }

  private initBoard(): void {
    this.grid = [];
    for (let r = 0; r < this.size; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.size; c++) {
        this.grid[r][c] = false;
      }
    }
  }

  /** Invierte la celda y sus vecinas ortogonales. */
  private toggleAt(row: number, col: number): void {
    const flips = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [dr, dc] of flips) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < this.size && c >= 0 && c < this.size) {
        this.grid[r][c] = !this.grid[r][c];
      }
    }
  }

  private scrambleBoard(): void {
    // Aplicar pulsaciones aleatorias desde el estado apagado garantiza que el
    // tablero siempre sea resoluble (deshaciendo esas mismas pulsaciones).
    // Se repite si quedan demasiado pocas luces encendidas (tablero trivial).
    const presses = SCRAMBLE_PRESSES[this.size] ?? 6;
    const minLit = Math.ceil(this.size * this.size * MIN_LIT_RATIO);

    for (let attempt = 0; attempt < 20; attempt++) {
      this.initBoard();
      const cells: number[] = [];
      for (let i = 0; i < this.size * this.size; i++) cells.push(i);
      // Pulsaciones en celdas distintas: presionar dos veces la misma se anula.
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      for (const idx of cells.slice(0, presses)) {
        this.toggleAt(Math.floor(idx / this.size), idx % this.size);
      }

      let lit = 0;
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (this.grid[r][c]) lit++;
        }
      }
      if (lit >= minLit) return;
    }
  }

  private handleCellClick = (row: number, col: number): void => {
    if (this.state !== "playing") return;
    this.cursorRow = row;
    this.cursorCol = col;
    this.pressCell(row, col);
  };

  private pressCell(row: number, col: number): void {
    if (this.state !== "playing") return;

    this.toggleAt(row, col);
    this.moves++;
    SoundEffects.playToggle(this.grid[row][col]);
    this.hud.renderBoard(this.grid, this.size, this.cursorRow, this.cursorCol);
    this.hud.updateStats(this.moves, this.elapsedTime);
    this.saveRun();

    if (this.checkWin()) {
      this.handleVictory();
    }
  }

  private checkWin(): boolean {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.grid[r][c]) return false;
      }
    }
    return true;
  }

  private handleVictory(): void {
    this.state = "victory";
    SoundEffects.playVictory();
    // La partida de la ronda termino: un reload ya no debe retomarla.
    if (this.room) clearRoomRun(this.room, "lights-out");

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
    else this.hud.showRanking("lights-out", rankedScore, this.size);
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
