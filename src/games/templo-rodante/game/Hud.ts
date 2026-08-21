import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/** Overlay DOM: contador de vigas, pantallas de inicio / fin y la cuenta regresiva. */
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
    this.scoreEl.textContent = "0";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    hud.append(this.scoreEl, this.bestEl);

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
    this.hintEl.innerHTML =
      '<span class="legend"><span class="legend__chip legend__chip--low"></span>' +
      "viga rasante: SALTALA (flecha arriba / W / mitad de arriba)</span>" +
      '<span class="legend"><span class="legend__chip legend__chip--high"></span>' +
      "viga alta: AGACHATE (flecha abajo / S / mitad de abajo)</span>";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.spectateEl = document.createElement("div");
    this.spectateEl.className = "spectate";

    container.append(hud, this.overlayEl, this.countdownEl, this.spectateEl);
  }

  /** Muestra una etiqueta de la cuenta ("3" / "2" / "1" / "YA"), o la oculta con null. */
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

  setScore(beams: number): void {
    this.scoreEl.textContent = String(beams);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best} VIGAS` : "";
  }

  showScore(visible: boolean): void {
    this.scoreEl.style.visibility = visible ? "visible" : "hidden";
  }

  showStart(): void {
    this.titleEl.textContent = "TEMPLO RODANTE";
    this.subtitleEl.textContent = "presiona ENTER o toca la pantalla para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "flex";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "TE LLEVO PUESTO";
    this.subtitleEl.textContent = "presiona ENTER o toca la pantalla para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `ESQUIVASTE ${score} VIGAS — ¡NUEVO RECORD!`
        : `ESQUIVASTE ${score} VIGAS  ·  MEJOR: ${best}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  /** Modo sala: al caer se sigue viendo el templo, con esta banda al pie. */
  showSpectate(score: number): void {
    this.overlayEl.classList.add("hidden");
    this.spectateEl.textContent = `CAISTE CON ${score} VIGAS · mirando a los demas`;
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
