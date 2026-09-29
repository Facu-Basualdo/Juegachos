import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly bestLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    hud.append(this.scoreEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.bestLineEl = document.createElement("div");
    this.bestLineEl.className = "overlay__best";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.bestLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("ring-runner").follow(this.leaderboard);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.overlayEl, this.countdownEl);
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
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  showScore(visible: boolean): void {
    this.scoreEl.style.visibility = visible ? "visible" : "hidden";
  }

  showStart(best: number): void {
    this.titleEl.textContent = "RING RUNNER";
    this.subtitleEl.textContent = "toca justo cuando el punto pase por la zona negra";
    this.scoreLineEl.textContent = best > 0 ? `MEJOR: ${best}` : "";
    this.scoreLineEl.style.display = best > 0 ? "block" : "none";
    this.bestLineEl.textContent = "";
    this.bestLineEl.style.display = "none";
    this.hintEl.textContent = "presiona ESPACIO o toca para empezar";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showGameOver(score: number, best: number, isNewBest: boolean): void {
    this.titleEl.textContent = isNewBest ? "NUEVO RECORD!" : "GAME OVER";
    this.subtitleEl.textContent = "presiona ESPACIO o toca para reintentar";
    this.scoreLineEl.textContent = `PUNTAJE: ${score}`;
    this.scoreLineEl.style.display = "block";
    this.bestLineEl.textContent = isNewBest ? "NUEVO MEJOR!" : `MEJOR: ${best}`;
    this.bestLineEl.style.display = "block";
    this.hintEl.textContent = "";
    this.overlayEl.classList.remove("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
