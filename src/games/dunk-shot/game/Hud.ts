import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly btnEl: HTMLButtonElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onStartClick: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";
    this.bestEl.textContent = "";

    hud.append(this.scoreEl, this.bestEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.btnEl = document.createElement("button");
    this.btnEl.className = "overlay__btn";
    this.btnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      onStartClick();
    });

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.btnEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("dunk-shot").follow(this.leaderboard).hides(".overlay__hint");
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
    void this.countdownEl.offsetWidth; // force reflow to restart the animation
    this.countdownEl.classList.add("is-shown");
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `RECORD: ${best}` : "";
  }

  showStart(): void {
    this.titleEl.textContent = "DUNK SHOT";
    this.subtitleEl.textContent = "LANZA LA PELOTA DE ARO EN ARO";
    this.scoreLineEl.textContent = "";
    this.btnEl.textContent = "Iniciar Juego";
    this.hintEl.innerHTML = `
      Controles:<br>
      <span class="overlay__hint-keys">Arrastrar</span> y soltar : Apuntar y lanzar<br>
      Encesta sin tocar el aro para encadenar canastas perfectas.<br>
      <span class="overlay__hint-keys">Enter</span> : Iniciar / Reintentar
    `;
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  /** Muestra el ranking global del juego en la pantalla de game-over. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "FIN DEL JUEGO";
    this.subtitleEl.textContent = "LA PELOTA SE FUE AL VACIO";

    if (score >= best && score > 0) {
      this.scoreLineEl.innerHTML = `¡NUEVA MARCA PERSONAL!<br><span class="overlay__score-big">${score}</span>`;
    } else {
      this.scoreLineEl.innerHTML = `PUNTAJE: ${score} · RECORD: ${best}`;
    }

    this.btnEl.textContent = "Reintentar";
    this.hintEl.innerHTML = "Presiona ENTER o toca el botón para volver a jugar";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
