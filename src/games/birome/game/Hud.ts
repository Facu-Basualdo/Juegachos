import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/** Capa DOM: puntaje en cm, pantallas de inicio / fin, countdown y banda de espectador. */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
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

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0 cm";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    hud.append(this.scoreEl, this.bestEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    const card = document.createElement("div");
    card.className = "overlay__card";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";
    this.hintEl.textContent =
      "mantené apretado para subir, soltá para bajar · no toques los tachones ni los márgenes";

    card.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(card);
    this.leaderboard.clear();
    this.overlayEl.append(card);

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.spectateEl = document.createElement("div");
    this.spectateEl.className = "spectate";

    container.append(hud, this.overlayEl, this.countdownEl, this.spectateEl);
  }

  /** Etiqueta de cuenta regresiva ("3" / "2" / "1" / "YA"), o la oculta con null. */
  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    void this.countdownEl.offsetWidth; // reflow para reiniciar el pop
    this.countdownEl.classList.add("is-shown");
  }

  setScore(cm: number): void {
    this.scoreEl.textContent = `${cm} cm`;
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `mejor: ${best} cm` : "";
  }

  showScore(visible: boolean): void {
    this.scoreEl.style.visibility = visible ? "visible" : "hidden";
  }

  showStart(): void {
    this.titleEl.textContent = "Birome";
    this.subtitleEl.textContent = "tocá la pantalla o presioná ENTER para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "¡Manchaste la hoja!";
    this.subtitleEl.textContent = "tocá la pantalla o presioná ENTER para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `${score} cm — ¡nuevo récord!`
        : `${score} cm · mejor: ${best} cm`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  /** Sala: al chocar se sigue viendo la hoja, con esta banda al pie. */
  showSpectate(score: number): void {
    this.overlayEl.classList.add("hidden");
    this.spectateEl.textContent = `manchaste a los ${score} cm · mirando a los demás`;
    this.spectateEl.classList.add("is-shown");
  }

  hideSpectate(): void {
    this.spectateEl.classList.remove("is-shown");
  }

  /** Ranking global del juego en la pantalla de game over. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
