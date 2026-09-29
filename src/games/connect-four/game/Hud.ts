import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { COLS, ROWS, SIZE, idx, type Cell } from "./logic";

/** Colores por jugador (mismo orden que las fichas y el marcador de la sala). */
const PLAYER_COLORS = ["#22d3ee", "#f472b6"];

export interface RenderOptions {
  /** Linea ganadora a resaltar, o null. */
  winningLine?: readonly number[] | null;
}

/** Entrada del marcador por jugador (modo sala). */
export interface PlayerPanelEntry {
  player: string;
  markLabel: string;
  colorIdx: number;
  isTurn: boolean;
  isMe: boolean;
}

export class Hud {
  private readonly container: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  private hudBar!: HTMLDivElement;
  private scoreEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private bestEl!: HTMLDivElement;

  private playersPanel!: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private readonly columns: HTMLButtonElement[] = [];
  private readonly cells: HTMLDivElement[] = [];
  private readonly discs: HTMLDivElement[] = [];

  private overlayEl!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private scoreLineEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private countdownEl!: HTMLDivElement;

  /** Ultimo tablero dibujado (para calcular donde caeria el disco fantasma). */
  private currentCells: Cell[] = new Array<Cell>(SIZE).fill(null);
  /** Color del disco fantasma segun de quien es el turno, o null si no es el mio. */
  private previewColor: number | null = null;
  private hoverCol: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildMarkup();
  }

  private buildMarkup(): void {
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud-bar__score";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "hud-bar__status";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud-bar__best";

    this.hudBar.append(this.scoreEl, this.statusEl, this.bestEl);

    this.playersPanel = document.createElement("div");
    this.playersPanel.className = "players-panel hidden";

    this.boardEl = document.createElement("div");
    this.boardEl.className = "c4-board is-locked";
    for (let c = 0; c < COLS; c++) {
      const column = document.createElement("button");
      column.type = "button";
      column.className = "c4-col";
      column.dataset.col = String(c);

      for (let r = 0; r < ROWS; r++) {
        const cell = document.createElement("div");
        cell.className = "c4-cell";

        const disc = document.createElement("div");
        disc.className = "c4-disc";
        cell.append(disc);

        this.cells[idx(r, c)] = cell;
        this.discs[idx(r, c)] = disc;
        column.append(cell);
      }

      this.columns.push(column);
      this.boardEl.append(column);
    }

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("connect-four").follow(this.leaderboard);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.container.append(
      this.boardEl,
      this.hudBar,
      this.playersPanel,
      this.overlayEl,
      this.countdownEl,
    );
  }

  get overlay(): HTMLDivElement {
    return this.overlayEl;
  }

  /** Registra el handler de clic de cada columna (recibe su indice 0..COLS-1). */
  bindColumns(onPress: (col: number) => void): void {
    this.columns.forEach((column, c) => {
      column.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        onPress(c);
      });
      column.addEventListener("pointerenter", () => {
        this.hoverCol = c;
        this.updateGhost();
      });
      column.addEventListener("pointerleave", () => {
        if (this.hoverCol === c) this.hoverCol = null;
        this.updateGhost();
      });
    });
  }

  // ---------- Tablero ----------

  /** Dibuja el estado actual del tablero (fichas + linea ganadora). */
  renderBoard(cells: Cell[], opts: RenderOptions = {}): void {
    this.currentCells = cells;
    const win = opts.winningLine ?? null;

    cells.forEach((owner, i) => {
      const cell = this.cells[i];
      const disc = this.discs[i];

      cell.classList.toggle("is-empty", owner === null);
      cell.classList.toggle("is-p0", owner === 0);
      cell.classList.toggle("is-p1", owner === 1);
      cell.classList.toggle("is-win", win !== null && win.includes(i));

      // Anima la caida solo cuando la casilla pasa de vacia a ocupada.
      const key = owner === null ? "" : String(owner);
      if (disc.dataset.owner !== key) {
        const isDrop = disc.dataset.owner === "" && owner !== null;
        disc.dataset.owner = key;
        disc.classList.remove("is-ghost");
        if (isDrop) {
          disc.classList.remove("is-drop");
          void disc.offsetWidth; // reinicia la animacion
          disc.classList.add("is-drop");
        }
      }
    });

    this.updateGhost();
  }

  /** Habilita o bloquea los clics del tablero (bloqueado fuera del turno propio). */
  setInteractive(enabled: boolean): void {
    this.boardEl.classList.toggle("is-locked", !enabled);
    if (!enabled) {
      this.hoverCol = null;
      this.updateGhost();
    }
  }

  /** Color del disco fantasma de previsualizacion (el del jugador que puede soltar), o null. */
  setPreviewColor(colorIdx: number | null): void {
    this.previewColor = colorIdx;
    this.updateGhost();
  }

  /** Fila (0 = arriba) donde caeria una ficha en `col` segun el tablero dibujado. */
  private landingRow(col: number): number | null {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.currentCells[idx(r, col)] === null) return r;
    }
    return null;
  }

  /** Muestra/oculta el disco translucido en la casilla donde caeria la ficha. */
  private updateGhost(): void {
    for (const disc of this.discs) {
      if (disc.dataset.owner === "") disc.classList.remove("is-ghost");
    }
    if (this.previewColor === null || this.hoverCol === null) return;
    const row = this.landingRow(this.hoverCol);
    if (row === null) return;
    const disc = this.discs[idx(row, this.hoverCol)];
    disc.style.setProperty("--ghost-color", PLAYER_COLORS[this.previewColor % PLAYER_COLORS.length]);
    disc.classList.add("is-ghost");
  }

  // ---------- HUD superior ----------

  setScore(text: string): void {
    this.scoreEl.textContent = text;
  }

  setStatus(text: string, mine = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("is-mine", mine);
  }

  setBest(text: string): void {
    this.bestEl.textContent = text;
  }

  // ---------- Marcador de sala ----------

  showPlayers(entries: PlayerPanelEntry[] | null): void {
    if (!entries) {
      this.playersPanel.classList.add("hidden");
      return;
    }
    this.playersPanel.classList.remove("hidden");
    this.playersPanel.innerHTML = "";
    for (const entry of entries) {
      const chip = document.createElement("div");
      chip.className = "player-chip";
      chip.classList.toggle("is-turn", entry.isTurn);
      chip.style.setProperty(
        "--player-color",
        PLAYER_COLORS[entry.colorIdx % PLAYER_COLORS.length],
      );

      const mark = document.createElement("span");
      mark.className = "player-chip__mark";
      mark.textContent = entry.markLabel;

      const name = document.createElement("span");
      name.className = "player-chip__name";
      name.textContent = entry.isMe ? `${entry.player} (vos)` : entry.player;

      chip.append(mark, name);
      this.playersPanel.append(chip);
    }
  }

  // ---------- Overlays ----------

  showStart(best: number | null, roomMode: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.playersPanel.classList.add("hidden");

    this.titleEl.textContent = "CONECTA 4";
    this.subtitleEl.textContent = roomMode
      ? "Solta fichas por turnos y alinea 4 en fila, columna o diagonal antes que tu rival."
      : "Alinea 4 fichas contra una IA dificil: fila, columna o diagonal. Cada victoria suma a tu racha.";

    if (!roomMode && best !== null) {
      this.scoreLineEl.style.display = "block";
      this.scoreLineEl.textContent = `MEJOR RACHA: ${best}`;
    } else {
      this.scoreLineEl.style.display = "none";
    }

    this.hintEl.textContent = "presiona ENTER o toca para comenzar";
    this.leaderboard.clear();
  }

  /** Fin del modo solo: la racha lograda y su mejor marca. */
  showGameOver(streak: number, isNewBest: boolean, best: number): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "NUEVO RECORD" : "PERDISTE";
    this.subtitleEl.textContent = "La IA no perdona: cuida las diagonales para llegar mas lejos.";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `RACHA: ${streak}`;

    this.hintEl.textContent = `presiona ENTER o toca para volver a jugar - mejor racha: ${best}`;
  }

  /** Ranking global (mayor racha = mejor) al terminar el modo solo. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
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
    void this.countdownEl.offsetWidth; // reflow para reiniciar la animacion
    this.countdownEl.classList.add("is-shown");
  }
}
