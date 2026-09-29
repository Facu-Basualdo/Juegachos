import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly livesEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly btnEl: HTMLButtonElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onStartClick: () => void) {
    // Score & best score elements
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "00";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";
    this.bestEl.textContent = "";

    this.livesEl = document.createElement("div");
    this.livesEl.className = "hud__lives";

    hud.append(this.scoreEl, this.bestEl, this.livesEl);

    // Overlay (Start & Game Over screens)
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
    new HowToPanel("asteroids").follow(this.leaderboard).hides(".overlay__hint");
    this.leaderboard.clear();

    // Countdown element
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
    // Force reflow to trigger animation reset
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `RECORD: ${best}` : "";
  }

  setLives(lives: number): void {
    this.livesEl.innerHTML = "";
    for (let i = 0; i < lives; i++) {
      // Tiny vector ship SVG icon representing each remaining life
      const icon = document.createElement("div");
      icon.className = "hud__life-icon";
      icon.innerHTML = `
        <svg viewBox="0 0 20 20" width="100%" height="100%">
          <polygon points="10,2 3,18 10,14 17,18" fill="none" stroke="#00f3ff" stroke-width="2" style="filter: drop-shadow(0 0 3px rgba(0,243,255,0.7))"/>
        </svg>
      `;
      this.livesEl.appendChild(icon);
    }
  }

  showStart(): void {
    this.titleEl.textContent = "ASTEROIDES";
    this.subtitleEl.textContent = "DESTRUYE LAS ROCAS Y SOBREVIVE";
    this.scoreLineEl.textContent = "";
    this.btnEl.textContent = "Iniciar Juego";
    this.hintEl.innerHTML = `
      Controles:<br>
      <span class="overlay__hint-keys">Mouse</span> : Apuntar · <span class="overlay__hint-keys">Clic izq.</span> Disparar · <span class="overlay__hint-keys">Clic der.</span> Propulsión<br>
      <span class="overlay__hint-keys">&larr;</span> <span class="overlay__hint-keys">&rarr;</span> o <span class="overlay__hint-keys">A</span> <span class="overlay__hint-keys">D</span> : Rotar Nave<br>
      <span class="overlay__hint-keys">&uarr;</span> o <span class="overlay__hint-keys">W</span> : Propulsión (Inercia)<br>
      <span class="overlay__hint-keys">Espacio</span> : Disparar Láser<br>
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
    this.subtitleEl.textContent = "TU NAVE FUE DESTRUIDA";
    
    if (score >= best && score > 0) {
      this.scoreLineEl.innerHTML = `¡NUEVA MARCA PERSONAL!<br><span style="font-size: 28px; font-weight: bold; color: #00f3ff; text-shadow: 0 0 10px rgba(0,243,255,0.8);">${score}</span>`;
    } else {
      this.scoreLineEl.innerHTML = `PUNTAJE: ${score} · RECORD: ${best}`;
    }

    this.btnEl.textContent = "Reintentar";
    this.hintEl.innerHTML = "Presiona ENTER, Haz Clic o usa los controles táctiles para volver a jugar";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
