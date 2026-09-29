import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import type { Cell, Player } from "./logic";

/** SVG neon de cada marca. El color lo pone el CSS segun la clase del jugador. */
const MARK_SVG: Record<Player, string> = {
  0: `<svg viewBox="0 0 100 100" aria-hidden="true"><line x1="22" y1="22" x2="78" y2="78"/><line x1="78" y1="22" x2="22" y2="78"/></svg>`,
  1: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="30"/></svg>`,
};

/** Colores por jugador del marcador de la sala (mismo orden que las marcas). */
const PLAYER_COLORS = ["#22d3ee", "#f472b6"];

export interface RenderOptions {
  /** Casilla que esta por desaparecer (la ficha mas vieja del que va a jugar). */
  removable?: number | null;
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
  private readonly cells: HTMLButtonElement[] = [];
  private readonly marks: HTMLDivElement[] = [];

  private overlayEl!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private scoreLineEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private countdownEl!: HTMLDivElement;

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
    this.boardEl.className = "ttt-board is-locked";
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.cell = String(i);

      const mark = document.createElement("div");
      mark.className = "cell__mark";
      cell.append(mark);

      this.cells.push(cell);
      this.marks.push(mark);
      this.boardEl.append(cell);
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
    new HowToPanel("tic-tac-toe").follow(this.leaderboard);
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

  /** Registra el handler de clic de cada casilla (recibe su indice 0-8). */
  bindCells(onPress: (index: number) => void): void {
    this.cells.forEach((cell, i) => {
      cell.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        onPress(i);
      });
    });
  }

  // ---------- Tablero ----------

  /** Dibuja el estado actual del tablero (marcas, ficha por eliminar, linea ganadora). */
  renderBoard(cells: Cell[], opts: RenderOptions = {}): void {
    const win = opts.winningLine ?? null;
    cells.forEach((owner, i) => {
      const cell = this.cells[i];
      const mark = this.marks[i];

      cell.classList.toggle("is-empty", owner === null);
      cell.classList.toggle("is-x", owner === 0);
      cell.classList.toggle("is-o", owner === 1);
      cell.classList.toggle("is-removable", opts.removable === i);
      cell.classList.toggle("is-win", win !== null && win.includes(i));

      const svg = owner === null ? "" : MARK_SVG[owner];
      if (mark.dataset.owner !== String(owner)) {
        mark.dataset.owner = String(owner);
        mark.innerHTML = svg;
      }
    });
  }

  /** Habilita o bloquea los clics del tablero (bloqueado fuera del turno propio). */
  setInteractive(enabled: boolean): void {
    this.boardEl.classList.toggle("is-locked", !enabled);
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

    this.titleEl.textContent = "TA-TE-TI";
    this.subtitleEl.textContent = roomMode
      ? "Ta-Te-Ti sin empates contra tu rival: al colocar tu cuarta ficha desaparece la primera. Gana quien arma una linea de 3."
      : "Ta-Te-Ti sin empates contra una IA dificil: al colocar tu cuarta ficha desaparece la primera. Cada victoria suma a tu racha.";

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
    this.subtitleEl.textContent = "La IA no perdona: pensa las dobles amenazas para llegar mas lejos.";

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
