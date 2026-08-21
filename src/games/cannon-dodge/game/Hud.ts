import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/** DOM overlay: live survival time plus start / game-over screens + countdown. */
export class Hud {
  private readonly timeEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly spectateEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.timeEl = document.createElement("div");
    this.timeEl.className = "hud__time";
    this.timeEl.textContent = "0.0";

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
    this.hintEl.textContent = "WASD o flechas para moverte · esquivá las balas de cañón";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.spectateEl = document.createElement("div");
    this.spectateEl.className = "spectate";

    container.append(hud, this.overlayEl, this.countdownEl, this.spectateEl);
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
    void this.countdownEl.offsetWidth; // reflow to restart the pop animation
    this.countdownEl.classList.add("is-shown");
  }

  setTime(seconds: number): void {
    this.timeEl.textContent = seconds.toFixed(1);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best.toFixed(1)} s` : "";
  }

  showTime(visible: boolean): void {
    this.timeEl.style.visibility = visible ? "visible" : "hidden";
  }

  showStart(): void {
    this.titleEl.textContent = "CANNON DODGE";
    this.subtitleEl.textContent = "presiona ENTER o toca para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "¡TE HUNDIERON!";
    this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `AGUANTASTE ${score.toFixed(1)} s — ¡NUEVO RÉCORD!`
        : `AGUANTASTE ${score.toFixed(1)} s  ·  MEJOR: ${best.toFixed(1)} s`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  /** Modo sala: al hundirte se sigue viendo la isla, con esta banda al pie. */
  showSpectate(score: number): void {
    this.overlayEl.classList.add("hidden");
    this.spectateEl.textContent =
      `TE HUNDIERON A LOS ${score.toFixed(1)} s · mirando a los demás`;
    this.spectateEl.classList.add("is-shown");
  }

  hideSpectate(): void {
    this.spectateEl.classList.remove("is-shown");
  }

  /** Muestra el ranking global del juego en la pantalla de game-over. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
