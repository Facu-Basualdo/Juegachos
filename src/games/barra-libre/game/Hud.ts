import { MAX_MISSES } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export type FeedbackTone = "good" | "bad" | "gold";

/** DOM overlay: points counter and strike X marks in a top island, event
 *  popups, plus start / game-over screens and the leaderboard. */
export class Hud {
  private readonly islandEl: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly missesEl: HTMLDivElement;
  private readonly feedbackEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.islandEl = document.createElement("div");
    const island = this.islandEl;
    island.className = "hud__island";

    const pointsBox = document.createElement("div");
    pointsBox.className = "hud__stat";
    const pointsLabel = document.createElement("div");
    pointsLabel.className = "hud__stat-label";
    pointsLabel.textContent = "PUNTOS";
    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";
    pointsBox.append(pointsLabel, this.scoreEl);

    const divider = document.createElement("div");
    divider.className = "hud__divider";

    const missesBox = document.createElement("div");
    missesBox.className = "hud__stat";
    const missesLabel = document.createElement("div");
    missesLabel.className = "hud__stat-label";
    missesLabel.textContent = "FALLOS";
    this.missesEl = document.createElement("div");
    this.missesEl.className = "hud__misses";
    missesBox.append(missesLabel, this.missesEl);

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    island.append(pointsBox, divider, missesBox);

    this.feedbackEl = document.createElement("div");
    this.feedbackEl.className = "hud__feedback";

    hud.append(island, this.bestEl, this.feedbackEl);

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
    this.hintEl.textContent =
      "W/S o flechas para cambiar de barra  ·  mantén ESPACIO para llenar y suéltalo para servir  ·  ataja vasos y propinas";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("barra-libre").follow(this.leaderboard).hides(".overlay__hint");
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.overlayEl, this.countdownEl);
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
    // Force reflow so re-adding the class restarts the pop animation.
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best}` : "";
  }

  /** One X per strike, dimmed placeholders for the ones left. */
  setMisses(misses: number): void {
    this.missesEl.innerHTML = "";
    for (let i = 0; i < MAX_MISSES; i++) {
      const mark = document.createElement("span");
      mark.className = i < misses ? "hud__miss hud__miss--hit" : "hud__miss";
      mark.textContent = "X";
      this.missesEl.append(mark);
    }
  }

  /** Flashes an event label ("PROPINA +25", "VASO ROTO"...) with a tone. */
  flashFeedback(text: string, tone: FeedbackTone): void {
    this.feedbackEl.textContent = text;
    this.feedbackEl.className = `hud__feedback hud__feedback--${tone}`;
    // Force reflow so re-adding the same class restarts the animation.
    void this.feedbackEl.offsetWidth;
    this.feedbackEl.classList.add("is-shown");
  }

  showHud(visible: boolean): void {
    this.islandEl.style.visibility = visible ? "visible" : "hidden";
  }

  showStart(): void {
    this.titleEl.textContent = "BARRA LIBRE";
    this.subtitleEl.textContent = "presiona ENTER o toca para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  /** Muestra el ranking global del juego en la pantalla de game-over. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "SE ACABO LA NOCHE";
    this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `PUNTOS: ${score} — ¡NUEVO MEJOR!`
        : `PUNTOS: ${score}  ·  MEJOR: ${best}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
