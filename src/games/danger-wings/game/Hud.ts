import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onActivate: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    hud.append(this.scoreEl, this.bestEl);

    this.flashEl = document.createElement("div");
    this.flashEl.className = "flash";

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
    this.hintEl.textContent = "Espacio / clic / toque para aletear";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.flashEl, this.overlayEl, this.countdownEl);

    const activate = (e: Event): void => {
      e.preventDefault();
      onActivate();
    };
    this.overlayEl.addEventListener("pointerdown", activate);
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
    this.scoreEl.style.transform = "scale(1.2)";
    setTimeout(() => {
      this.scoreEl.style.transform = "scale(1)";
    }, 100);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best}` : "";
  }

  setScoreVisible(visible: boolean): void {
    this.scoreEl.style.opacity = visible ? "1" : "0";
    this.bestEl.style.opacity = visible ? "0.85" : "0";
  }

  flashHit(): void {
    this.flashEl.classList.remove("is-hit");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("is-hit");
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

  showStart(): void {
    this.titleEl.textContent = "DANGER WINGS";
    this.subtitleEl.textContent = "presioná ENTER o tocá para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
    this.setScoreVisible(false);
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "TE EMPALASTE";
    this.subtitleEl.textContent = "presioná ENTER o tocá para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `PUNTAJE: ${score} — ¡NUEVO MEJOR!`
        : `PUNTAJE: ${score}  ·  MEJOR: ${best}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
    this.setScoreVisible(false);
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
    this.setScoreVisible(true);
  }
}
