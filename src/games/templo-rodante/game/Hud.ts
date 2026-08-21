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
  /** Sangre pegada al "lente" tras el reventon. */
  private readonly bloodEl: HTMLDivElement;
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

    this.bloodEl = document.createElement("div");
    this.bloodEl.className = "blood";

    // La sangre va DEBAJO del overlay de game over: el texto tiene que seguir
    // leyendose por encima de las manchas.
    container.append(hud, this.bloodEl, this.overlayEl, this.countdownEl, this.spectateEl);
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

  /**
   * Sangre en la camara al reventar: las manchas aparecen de golpe y despues
   * **chorrean hacia abajo** (los hilos se generan aca y bajan por CSS). Queda
   * hasta que arranca la partida siguiente.
   */
  showBlood(): void {
    this.bloodEl.replaceChildren();
    for (let i = 0; i < 16; i++) {
      const drip = document.createElement("div");
      drip.className = "blood__drip";
      drip.style.left = `${Math.random() * 100}%`;
      drip.style.top = `${Math.random() * 58}%`;
      drip.style.width = `${5 + Math.random() * 15}px`;
      drip.style.setProperty("--run", `${16 + Math.random() * 44}vh`);
      drip.style.animationDelay = `${Math.random() * 1.3}s`;
      drip.style.animationDuration = `${2 + Math.random() * 3.2}s`;
      this.bloodEl.append(drip);
    }
    for (let i = 0; i < 14; i++) {
      const spot = document.createElement("div");
      spot.className = "blood__spot";
      spot.style.left = `${Math.random() * 100}%`;
      spot.style.top = `${Math.random() * 80}%`;
      const d = 14 + Math.random() * 62;
      spot.style.width = `${d}px`;
      spot.style.height = `${d * (0.6 + Math.random() * 0.5)}px`;
      spot.style.transform = `rotate(${Math.random() * 360}deg)`;
      // Contorno irregular generado punto a punto. Con `border-radius` -- por
      // mas asimetrico que se lo escriba -- la forma sale siempre demasiado
      // suave y a este tamaño lee como una pelota, no como una salpicadura.
      const n = 13;
      const pts: string[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const r = 24 + Math.random() * 26;
        pts.push(`${(50 + Math.cos(a) * r).toFixed(1)}% ${(50 + Math.sin(a) * r).toFixed(1)}%`);
      }
      spot.style.clipPath = `polygon(${pts.join(",")})`;
      this.bloodEl.append(spot);
    }
    this.bloodEl.classList.add("is-shown");
  }

  clearBlood(): void {
    this.bloodEl.classList.remove("is-shown");
    this.bloodEl.replaceChildren();
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
