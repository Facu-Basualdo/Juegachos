import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/** Formats survival time as seconds + hundredths, e.g. "12.34 s". */
export function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

/** DOM overlay: live clock, best, start / game-over screens and the countdown label. */
export class Hud {
  private readonly timeEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onActivate: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.timeEl = document.createElement("div");
    this.timeEl.className = "hud__time";
    this.timeEl.textContent = formatTime(0);

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    hud.append(this.timeEl, this.bestEl);

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
    this.hintEl.textContent = "← → / A D / tocá cada lado para caminar y no caerte";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.overlayEl, this.countdownEl);

    this.overlayEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onActivate();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "Enter") onActivate();
    });
  }

  setTime(seconds: number): void {
    this.timeEl.textContent = formatTime(seconds);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${formatTime(best)}` : "";
  }

  showTime(visible: boolean): void {
    this.timeEl.style.visibility = visible ? "visible" : "hidden";
  }

  /** Shows a countdown label ("3" / "2" / "1" / "YA"), or hides it when null. */
  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    // Force reflow so re-adding the class restarts the pop animation.
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  showStart(best: number): void {
    this.titleEl.textContent = "MACACO TILT";
    this.subtitleEl.textContent = "presioná ENTER o tocá para empezar";
    this.scoreLineEl.textContent = best > 0 ? `MEJOR: ${formatTime(best)}` : "";
    this.hintEl.style.display = "block";
    this.showTime(false);
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  /** Muestra el ranking global del juego en la pantalla de game-over. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "A BAÑARSE MUGRIENTO!";
    this.subtitleEl.textContent = "presioná ENTER o tocá para reintentar";
    this.scoreLineEl.textContent =
      score >= best
        ? `${formatTime(score)} — ¡NUEVO RÉCORD!`
        : `${formatTime(score)}  ·  MEJOR: ${formatTime(best)}`;
    this.hintEl.style.display = "none";
    this.showTime(false);
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
