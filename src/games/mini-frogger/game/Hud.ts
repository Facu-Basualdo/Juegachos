import { LIVES_START } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

export class Hud {
  private scoreEl!: HTMLElement;
  private bestEl!: HTMLElement;
  private livesContainerEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private overlayTitleEl!: HTMLElement;
  private overlaySubtitleEl!: HTMLElement;
  private overlayStat1ValEl!: HTMLElement;
  private overlayStat2ValEl!: HTMLElement;
  private overlayButtonEl!: HTMLElement;
  private mobileControlsEl!: HTMLElement;
  private countdownEl!: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  private onActionCallback?: () => void;
  private onMoveCallback?: (dx: number, dy: number) => void;

  constructor(container: HTMLElement, onAction: () => void, onMove: (dx: number, dy: number) => void) {
    this.onActionCallback = onAction;
    this.onMoveCallback = onMove;

    this.createHudElements(container);
    this.setupListeners();
  }

  private createHudElements(container: HTMLElement): void {
    // 1. HUD elements
    const hudContainer = document.createElement("div");
    hudContainer.className = "hud";
    hudContainer.innerHTML = `
      <div class="hud__top">
        <div class="hud__score-container">
          <span class="hud__label">Puntos</span>
          <span class="hud__score" id="frogger-score">0</span>
        </div>
        <div class="hud__best-container">
          <span class="hud__label">Récord</span>
          <span class="hud__best" id="frogger-best">0</span>
        </div>
      </div>
      <div class="hud__lives" id="frogger-lives">
        <!-- Rendered dynamically -->
      </div>
    `;
    container.append(hudContainer);

    this.scoreEl = hudContainer.querySelector("#frogger-score")!;
    this.bestEl = hudContainer.querySelector("#frogger-best")!;
    this.livesContainerEl = hudContainer.querySelector("#frogger-lives")!;

    // Initialize lives dots
    this.setLives(LIVES_START);

    // 2. Overlays
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";
    this.overlayEl.innerHTML = `
      <div class="overlay__card">
        <h1 class="overlay__title" id="overlay-title">CRUCE MORTAL</h1>
        <p class="overlay__subtitle" id="overlay-subtitle">Cruza calles y ríos saltando sobre los troncos flotantes. ¡Cuidado con el agua y los autos!</p>
        <div class="overlay__stats">
          <div class="overlay__stat">
            <span class="hud__label">Puntos</span>
            <span class="overlay__stat-val primary" id="overlay-stat-1">0</span>
          </div>
          <div class="overlay__stat">
            <span class="hud__label">Récord</span>
            <span class="overlay__stat-val secondary" id="overlay-stat-2">0</span>
          </div>
        </div>
        <button class="overlay__button" id="overlay-button">JUGAR</button>
        <div class="overlay__instructions">
          Usa las <b>Flechas</b> o <b>WASD</b> para moverte.<br>
          En móviles, usa el control direccional táctil.
        </div>
      </div>
    `;
    container.append(this.overlayEl);

    this.overlayTitleEl = this.overlayEl.querySelector("#overlay-title")!;
    this.overlaySubtitleEl = this.overlayEl.querySelector("#overlay-subtitle")!;
    this.overlayStat1ValEl = this.overlayEl.querySelector("#overlay-stat-1")!;
    this.overlayStat2ValEl = this.overlayEl.querySelector("#overlay-stat-2")!;
    this.overlayButtonEl = this.overlayEl.querySelector("#overlay-button")!;

    this.leaderboard.mount(this.overlayEl.querySelector(".overlay__card")!);
    this.leaderboard.clear();

    // 3. Mobile virtual D-Pad buttons
    this.mobileControlsEl = document.createElement("div");
    this.mobileControlsEl.className = "mobile-controls";
    this.mobileControlsEl.innerHTML = `
      <div class="mobile-btn mobile-btn--up" data-dir="up">▲</div>
      <div class="mobile-btn mobile-btn--left" data-dir="left">◀</div>
      <div class="mobile-btn mobile-btn--right" data-dir="right">▶</div>
      <div class="mobile-btn mobile-btn--down" data-dir="down">▼</div>
    `;
    container.append(this.mobileControlsEl);

    // Etiqueta del countdown 3 / 2 / 1 / YA (patron obligatorio del repo).
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";
    container.append(this.countdownEl);
  }

  private setupListeners(): void {
    // Action overlay button click
    this.overlayButtonEl.addEventListener("click", () => {
      if (this.onActionCallback) this.onActionCallback();
    });

    // Setup virtual buttons click/touch
    const buttons = this.mobileControlsEl.querySelectorAll(".mobile-btn");
    buttons.forEach((btn) => {
      const handlePress = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        
        const dir = (btn as HTMLElement).dataset.dir;
        if (!dir || !this.onMoveCallback) return;

        switch (dir) {
          case "up": this.onMoveCallback(0, -1); break;
          case "down": this.onMoveCallback(0, 1); break;
          case "left": this.onMoveCallback(-1, 0); break;
          case "right": this.onMoveCallback(1, 0); break;
        }
      };

      btn.addEventListener("touchstart", handlePress, { passive: false });
      btn.addEventListener("mousedown", handlePress);
    });
  }

  public setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  public setBest(best: number): void {
    this.bestEl.textContent = String(best);
  }

  public setLives(lives: number): void {
    this.livesContainerEl.innerHTML = "";
    for (let i = 0; i < LIVES_START; i++) {
      const dot = document.createElement("div");
      dot.className = `hud__life-dot ${i >= lives ? "lost" : ""}`;
      this.livesContainerEl.append(dot);
    }
  }

  public showStartScreen(best: number): void {
    this.overlayTitleEl.textContent = "CRUCE MORTAL";
    this.overlaySubtitleEl.textContent = "Cruza calles y ríos saltando sobre los troncos flotantes. ¡Cuidado con el agua y los autos!";
    this.overlayStat1ValEl.textContent = "0";
    this.overlayStat2ValEl.textContent = String(best);
    this.overlayButtonEl.textContent = "JUGAR";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  /** Muestra el ranking global del juego en la pantalla de game-over. */
  public showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  public showGameOver(score: number, best: number): void {
    this.overlayTitleEl.textContent = "FIN DE JUEGO";
    this.overlaySubtitleEl.textContent = score >= best && score > 0 ? "¡Nuevo Récord Personal! Has demostrado ser una rana experta." : "¡Oh no! Te has quedado sin vidas.";
    this.overlayStat1ValEl.textContent = String(score);
    this.overlayStat2ValEl.textContent = String(best);
    this.overlayButtonEl.textContent = "REINTENTAR";
    this.overlayEl.classList.remove("hidden");
  }

  /** Muestra una etiqueta del countdown, o la oculta con `null`. */
  public showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    // Reflow forzado para que al re-agregar la clase se reinicie el pop.
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  public hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }
}
