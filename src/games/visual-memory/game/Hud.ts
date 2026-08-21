import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { LIVES } from "./constants";

export interface Handlers {
  onCell: (index: number) => void;
}

/**
 * Capa DOM: barra superior (nivel / vidas / record), la grilla de celdas, el
 * countdown y el overlay de inicio / fin con el ranking global.
 */
export class Hud {
  private readonly hudBar: HTMLDivElement;
  private readonly levelEl: HTMLDivElement;
  private readonly livesEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;

  private readonly board: HTMLDivElement;
  private cells: HTMLButtonElement[] = [];

  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  private readonly countdownEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();
  private readonly onCell: (index: number) => void;

  constructor(container: HTMLElement, handlers: Handlers) {
    this.onCell = handlers.onCell;

    this.hudBar = el("div", "vm-hud hidden");
    this.levelEl = el("div", "vm-hud__level");
    const sub = el("div", "vm-hud__sub");
    this.bestEl = el("div", "vm-hud__best");
    this.livesEl = el("div", "vm-hud__lives");
    for (let i = 0; i < LIVES; i++) this.livesEl.append(heartDot());
    sub.append(this.bestEl, this.livesEl);
    this.hudBar.append(this.levelEl, sub);

    this.board = el("div", "vm-board hidden");

    this.countdownEl = el("div", "countdown");

    this.overlayEl = el("div", "overlay");
    this.titleEl = el("div", "overlay__title");
    this.subtitleEl = el("div", "overlay__subtitle");
    this.scoreEl = el("div", "overlay__score");
    this.hintEl = el("div", "overlay__hint");
    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    container.append(this.hudBar, this.board, this.countdownEl, this.overlayEl);
  }

  // ---------- Inicio / fin ----------

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.board.classList.add("hidden");

    this.titleEl.textContent = "CONSTELACIÓN";
    this.subtitleEl.textContent = "Se encienden unas celdas: memorizá el patrón y volvé a marcarlas. Tenés 3 vidas.";
    if (best !== null) {
      this.scoreEl.style.display = "block";
      this.scoreEl.textContent = `RÉCORD: nivel ${best}`;
    } else {
      this.scoreEl.style.display = "none";
    }
    this.hintEl.textContent = "presioná ENTER o tocá para empezar";
    this.leaderboard.clear();
  }

  showGameOver(score: number, best: number, isNewBest: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.board.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "¡NUEVO RÉCORD!" : "SE APAGÓ";
    this.subtitleEl.textContent =
      score > 0 ? `Llegaste al nivel ${score}.` : "No completaste ningún nivel esta vez.";
    this.scoreEl.style.display = "block";
    this.scoreEl.textContent = `RÉCORD: nivel ${best}`;
    this.hintEl.textContent = "presioná ENTER o tocá para volver a jugar";
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  /** Ranking global (nivel mas alto = mejor). */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  // ---------- Juego ----------

  startPlayUi(best: number | null): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.remove("hidden");
    this.board.classList.remove("hidden");
    this.setBest(best);
    this.setLives(LIVES);
  }

  setLevel(level: number): void {
    this.levelEl.innerHTML = `<em>NIVEL</em><b>${level}</b>`;
  }

  setBest(best: number | null): void {
    this.bestEl.innerHTML = best !== null ? `RÉCORD <b>${best}</b>` : "RÉCORD <b>—</b>";
  }

  setLives(lives: number): void {
    const dots = this.livesEl.children;
    for (let i = 0; i < dots.length; i++) {
      (dots[i] as HTMLElement).classList.toggle("is-lost", i >= lives);
    }
  }

  /** Reconstruye la grilla NxN vacia y clickeable. */
  buildGrid(n: number): void {
    this.board.innerHTML = "";
    this.board.style.setProperty("--n", String(n));
    this.cells = [];
    for (let i = 0; i < n * n; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "vm-cell";
      cell.setAttribute("aria-label", `Celda ${i + 1}`);
      const index = i;
      cell.addEventListener("click", () => this.onCell(index));
      this.cells.push(cell);
      this.board.append(cell);
    }
  }

  /** Enciende el patron (con un pequeno stagger, como estrellas apareciendo). */
  showPattern(lit: number[]): void {
    lit.forEach((idx, k) => {
      const cell = this.cells[idx];
      if (!cell) return;
      cell.style.transitionDelay = `${Math.min(k * 40, 300)}ms`;
      cell.classList.add("is-lit");
    });
  }

  /** Apaga el patron y limpia los delays. */
  hidePattern(): void {
    for (const cell of this.cells) {
      cell.classList.remove("is-lit");
      cell.style.transitionDelay = "";
    }
  }

  markFound(index: number): void {
    this.cells[index]?.classList.add("is-found");
  }

  markWrong(index: number): void {
    this.cells[index]?.classList.add("is-wrong");
  }

  /** Al perder, revela tenues las celdas correctas que faltaron. */
  revealMissed(lit: number[]): void {
    for (const idx of lit) {
      const cell = this.cells[idx];
      if (cell && !cell.classList.contains("is-found")) cell.classList.add("is-missed");
    }
  }

  // ---------- Countdown ----------

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const node = document.createElement(tag) as HTMLDivElement;
  node.className = className;
  return node;
}

function heartDot(): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "vm-heart";
  s.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M12 21s-7.5-4.6-10-9.2C.4 8.6 2 5.5 5 5.5c1.9 0 3.2 1 4 2.2.8-1.2 2.1-2.2 4-2.2 3 0 4.6 3.1 3 6.3C19.5 16.4 12 21 12 21z"/>
  </svg>`;
  return s;
}
