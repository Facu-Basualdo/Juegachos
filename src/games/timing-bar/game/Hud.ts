import { TOTAL_ROUNDS } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

export class Hud {
  private readonly canvas: HTMLCanvasElement;

  // Top bar
  private readonly hudBar: HTMLDivElement;
  private readonly roundIndicator: HTMLDivElement;
  private readonly averageIndicator: HTMLDivElement;
  private readonly dotsContainer: HTMLDivElement;

  // Mid-play result banner
  private readonly banner: HTMLDivElement;

  // Overlay (start / game over)
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly ratingEl: HTMLDivElement;
  private readonly tableContainerEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  // Countdown
  private readonly countdownEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    // Play area canvas (the ruler)
    const stage = document.createElement("div");
    stage.className = "stage";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "timing-canvas";
    stage.append(this.canvas);

    // Top bar
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.roundIndicator = document.createElement("div");
    this.roundIndicator.className = "hud-bar__round";
    this.roundIndicator.textContent = `RONDA 1 DE ${TOTAL_ROUNDS}`;

    this.dotsContainer = document.createElement("div");
    this.dotsContainer.className = "hud-bar__dots";
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      const dot = document.createElement("div");
      dot.className = "hud-bar__dot is-empty";
      this.dotsContainer.append(dot);
    }

    this.averageIndicator = document.createElement("div");
    this.averageIndicator.className = "hud-bar__average";
    this.averageIndicator.textContent = "PROMEDIO: --";

    this.hudBar.append(this.roundIndicator, this.dotsContainer, this.averageIndicator);

    // Mid-play result banner
    this.banner = document.createElement("div");
    this.banner.className = "result-banner";

    // Overlay
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.ratingEl = document.createElement("div");
    this.ratingEl.className = "overlay__rating";

    this.tableContainerEl = document.createElement("div");
    this.tableContainerEl.className = "overlay__table-container";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(
      this.titleEl,
      this.subtitleEl,
      this.scoreLineEl,
      this.ratingEl,
      this.tableContainerEl,
      this.hintEl,
    );
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    // Countdown
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(stage, this.hudBar, this.banner, this.overlayEl, this.countdownEl);
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.hideBanner();

    this.titleEl.textContent = "AL CENTRO";
    this.subtitleEl.textContent = "Frena la regla lo mas cerca del centro que puedas.";

    if (best !== null) {
      this.scoreLineEl.textContent = `MEJOR PROMEDIO: ${Math.round(best)} pts`;
      this.scoreLineEl.style.display = "block";
    } else {
      this.scoreLineEl.textContent = "";
      this.scoreLineEl.style.display = "none";
    }

    this.ratingEl.style.display = "none";
    this.tableContainerEl.innerHTML = "";
    this.tableContainerEl.style.display = "none";

    this.hintEl.textContent = "presiona ENTER o toca para comenzar";

    this.leaderboard.clear();
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showTopBar(): void {
    this.hudBar.classList.remove("hidden");
  }

  updateRound(round: number, average: number | null): void {
    this.roundIndicator.textContent = `RONDA ${round} DE ${TOTAL_ROUNDS}`;
    this.averageIndicator.textContent =
      average === null ? "PROMEDIO: --" : `PROMEDIO: ${Math.round(average)} pts`;
  }

  /** Fills the dot for a completed round, colored by score tier. */
  markDot(index: number, points: number, activeRound: number): void {
    const dot = this.dotsContainer.children[index] as HTMLDivElement;
    dot.className = "hud-bar__dot";
    if (points >= 82) dot.classList.add("is-great");
    else if (points >= 35) dot.classList.add("is-ok");
    else dot.classList.add("is-poor");

    this.setActiveDot(activeRound);
  }

  setActiveDot(round: number): void {
    const dots = this.dotsContainer.children;
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      (dots[i] as HTMLDivElement).classList.toggle("is-active", i === round - 1);
    }
  }

  resetDots(): void {
    const dots = this.dotsContainer.children;
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      (dots[i] as HTMLDivElement).className = "hud-bar__dot is-empty";
    }
  }

  showBanner(label: string, points: number): void {
    this.banner.textContent = `${label}  ·  +${points}`;
    this.banner.className = "result-banner is-shown";
    if (points >= 97) this.banner.classList.add("is-perfect");
    else if (points >= 60) this.banner.classList.add("is-good");
    else this.banner.classList.add("is-poor");
    void this.banner.offsetWidth;
    this.banner.classList.add("is-anim");
  }

  hideBanner(): void {
    this.banner.className = "result-banner";
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

  showGameOver(
    roundPoints: number[],
    average: number,
    isNewBest: boolean,
    best: number,
  ): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.hideBanner();

    this.titleEl.textContent = isNewBest ? "¡NUEVO RECORD!" : "RESULTADOS";
    this.subtitleEl.textContent = "Este es tu desglose ronda por ronda:";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `PROMEDIO FINAL: ${Math.round(average)} pts`;

    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = this.getRatingLabel(average);
    this.ratingEl.className = `overlay__rating rating-${this.getRatingClass(average)}`;

    this.tableContainerEl.style.display = "block";
    this.tableContainerEl.innerHTML = "";
    const table = document.createElement("table");
    table.className = "results-table";
    const trHead = document.createElement("tr");
    const th1 = document.createElement("th");
    th1.textContent = "Ronda";
    const th2 = document.createElement("th");
    th2.textContent = "Puntos";
    trHead.append(th1, th2);
    table.append(trHead);
    roundPoints.forEach((pts, i) => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = `Ronda ${i + 1}`;
      const td2 = document.createElement("td");
      td2.textContent = `${pts} pts`;
      tr.append(td1, td2);
      table.append(tr);
    });
    this.tableContainerEl.append(table);

    this.hintEl.textContent = `presiona ENTER o toca para volver a jugar · mejor: ${Math.round(best)} pts`;
  }

  /** Global ranking (higher average = better). */
  showRanking(gameId: string, average: number): void {
    void this.leaderboard.render(gameId, { score: average });
  }

  private getRatingLabel(average: number): string {
    if (average >= 90) return "Cirujano";
    if (average >= 75) return "Preciso";
    if (average >= 55) return "Firme";
    if (average >= 35) return "Tembloroso";
    return "A practicar";
  }

  private getRatingClass(average: number): string {
    if (average >= 90) return "divine";
    if (average >= 75) return "ultra";
    if (average >= 55) return "fast";
    if (average >= 35) return "average";
    return "slow";
  }
}
