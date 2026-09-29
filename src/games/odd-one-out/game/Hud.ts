import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export class Hud {
  // HUD top bar
  private readonly hudBar: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly timeFillEl: HTMLDivElement;

  // Board
  private readonly boardEl: HTMLDivElement;

  // Overlay (start / game over)
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  // Countdown
  private readonly countdownEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    // Top bar
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud-bar__score";
    this.scoreEl.textContent = "PUNTOS: 0";

    const timeTrack = document.createElement("div");
    timeTrack.className = "hud-bar__time";
    this.timeFillEl = document.createElement("div");
    this.timeFillEl.className = "hud-bar__time-fill";
    timeTrack.append(this.timeFillEl);

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud-bar__best";
    this.bestEl.textContent = "MEJOR: --";

    this.hudBar.append(this.scoreEl, timeTrack, this.bestEl);

    // Board
    this.boardEl = document.createElement("div");
    this.boardEl.className = "board";

    // Overlay
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
    new HowToPanel("odd-one-out").follow(this.leaderboard);
    this.leaderboard.clear();

    // Countdown
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(this.boardEl, this.hudBar, this.overlayEl, this.countdownEl);
  }

  get overlay(): HTMLDivElement {
    return this.overlayEl;
  }

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");

    this.titleEl.textContent = "ODD ONE OUT";
    this.subtitleEl.textContent =
      "Una ficha tiene un tono distinto al resto. Tocala antes de que se acabe el tiempo: cada acierto suma y recarga el reloj, la grilla crece y la diferencia se achica.";

    if (best !== null) {
      this.scoreLineEl.textContent = `MEJOR PUNTAJE: ${best}`;
      this.scoreLineEl.style.display = "block";
    } else {
      this.scoreLineEl.textContent = "";
      this.scoreLineEl.style.display = "none";
    }

    this.hintEl.textContent = "presiona ENTER o toca para comenzar";
    this.leaderboard.clear();
  }

  showGameOver(score: number, isNewBest: boolean, best: number, roomMode: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "NUEVO RECORD" : "SE ACABO EL TIEMPO";
    this.subtitleEl.textContent = "El ojo se entrena: la proxima llegas mas lejos.";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `PUNTAJE: ${score}`;

    this.hintEl.textContent = roomMode
      ? `mejor puntaje: ${best}`
      : `presiona ENTER o toca para volver a jugar - mejor puntaje: ${best}`;
  }

  /** Muestra el ranking global (mayor puntaje = mejor) al terminar. */
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
    // Trigger reflow to restart animation
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  /** Renderiza la grilla de la ronda; onPick recibe el indice de la ficha tocada. */
  renderBoard(
    size: number,
    baseColor: string,
    oddColor: string,
    oddIndex: number,
    onPick: (index: number, tile: HTMLButtonElement) => void
  ): void {
    this.boardEl.innerHTML = "";
    this.boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

    const total = size * size;
    for (let i = 0; i < total; i++) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.style.background = i === oddIndex ? oddColor : baseColor;
      tile.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        onPick(i, tile);
      });
      this.boardEl.append(tile);
    }
  }

  clearBoard(): void {
    this.boardEl.classList.remove("is-revealing");
    this.boardEl.innerHTML = "";
  }

  /** Al perder, resalta la ficha distinta y atenua el resto para revelar cual era. */
  revealOdd(oddIndex: number): void {
    this.boardEl.classList.add("is-revealing");
    const tile = this.boardEl.children[oddIndex] as HTMLElement | undefined;
    if (tile) tile.classList.add("is-odd");
  }

  /** Marca visualmente una ficha equivocada (sacudida breve). */
  markMiss(tile: HTMLButtonElement): void {
    tile.classList.remove("is-miss");
    void tile.offsetWidth;
    tile.classList.add("is-miss");
  }

  updateScore(score: number): void {
    this.scoreEl.textContent = `PUNTOS: ${score}`;
  }

  updateBest(best: number | null): void {
    this.bestEl.textContent = best !== null ? `MEJOR: ${best}` : "MEJOR: --";
  }

  /** ratio en [0, 1]; cambia a rojo cuando queda poco. */
  updateTime(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.timeFillEl.style.width = `${clamped * 100}%`;
    this.timeFillEl.classList.toggle("is-low", clamped < 0.3);
  }
}
