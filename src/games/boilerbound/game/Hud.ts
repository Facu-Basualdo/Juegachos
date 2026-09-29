import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { formatClock } from "../../../shared/scoring-core";

/** DOM overlay: live survival clock plus start / game-over screens + countdown. */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onActivate: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0:00.00";

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
      "A D / ← → moverse · ESPACIO saltar · SHIFT dash · salto en pared";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("boilerbound").follow(this.leaderboard).hides(".overlay__hint");
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    // Transient centred banner (e.g. "¡SOBRECARGA!").
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "banner";

    container.append(hud, this.overlayEl, this.countdownEl, this.bannerEl);

    const activate = (e: Event): void => {
      e.preventDefault();
      onActivate();
    };
    this.overlayEl.addEventListener("pointerdown", activate);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Enter") onActivate();
    });
  }

  /** Live survival time (seconds) as a running clock. */
  setTime(seconds: number): void {
    this.scoreEl.textContent = formatClock(Math.round(seconds * 100));
  }

  setBest(centiseconds: number): void {
    this.bestEl.textContent = centiseconds > 0 ? `MEJOR: ${formatClock(centiseconds)}` : "";
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
    void this.countdownEl.offsetWidth; // reflow to restart the pop animation
    this.countdownEl.classList.add("is-shown");
  }

  /** Flashes a transient banner (overload warning). */
  flashBanner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove("is-shown");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("is-shown");
  }

  showLoading(): void {
    this.titleEl.textContent = "BOILERBOUND";
    this.subtitleEl.textContent = "calentando la caldera…";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "none";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showStart(): void {
    this.titleEl.textContent = "BOILERBOUND";
    this.subtitleEl.textContent = "presiona ENTER o toca para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(scoreCenti: number, bestCenti: number): void {
    this.titleEl.textContent = "TE COCINASTE";
    this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
    const isBest = scoreCenti >= bestCenti;
    this.scoreLineEl.textContent = isBest
      ? `AGUANTASTE ${formatClock(scoreCenti)} — ¡NUEVO RÉCORD!`
      : `AGUANTASTE ${formatClock(scoreCenti)}  ·  MEJOR: ${formatClock(bestCenti)}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
