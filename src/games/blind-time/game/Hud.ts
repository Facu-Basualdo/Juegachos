import { TOTAL_ROUNDS } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export type RoundStatus = "empty" | "success" | "foul";

export class Hud {
  private readonly mainCard: HTMLDivElement;
  private readonly statusText: HTMLDivElement;
  private readonly subStatusText: HTMLDivElement;
  private readonly targetContainer: HTMLDivElement;
  private readonly targetLabel: HTMLSpanElement;
  private readonly targetTimeEl: HTMLSpanElement;

  // SVG Progress Ring
  private readonly svgRingContainer: HTMLDivElement;
  private readonly ringCircle: SVGCircleElement;
  private readonly ringTrack: SVGCircleElement;

  // HUD top bar elements
  private readonly hudBar: HTMLDivElement;
  private readonly roundIndicator: HTMLDivElement;
  private readonly averageIndicator: HTMLDivElement;
  private readonly dotsContainer: HTMLDivElement;

  // Overlays
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
    // Create main card
    this.mainCard = document.createElement("div");
    this.mainCard.className = "reaction-card state-idle";

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "reaction-card__content";

    // SVG Progress Ring
    this.svgRingContainer = document.createElement("div");
    this.svgRingContainer.className = "progress-ring-container";
    
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "280");
    svg.setAttribute("height", "280");
    svg.setAttribute("viewBox", "0 0 280 280");
    svg.setAttribute("class", "progress-ring");

    // Circle track (grey background)
    this.ringTrack = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    this.ringTrack.setAttribute("cx", "140");
    this.ringTrack.setAttribute("cy", "140");
    this.ringTrack.setAttribute("r", "120");
    this.ringTrack.setAttribute("stroke", "rgba(255, 255, 255, 0.05)");
    this.ringTrack.setAttribute("stroke-width", "8");
    this.ringTrack.setAttribute("fill", "transparent");

    // Glowing golden circle
    this.ringCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    this.ringCircle.setAttribute("cx", "140");
    this.ringCircle.setAttribute("cy", "140");
    this.ringCircle.setAttribute("r", "120");
    this.ringCircle.setAttribute("stroke", "#ffdd53");
    this.ringCircle.setAttribute("stroke-width", "8");
    this.ringCircle.setAttribute("fill", "transparent");
    // Circumference = 2 * Math.PI * 120 = ~753.98
    const circumference = 2 * Math.PI * 120;
    this.ringCircle.setAttribute("stroke-dasharray", `${circumference}`);
    this.ringCircle.setAttribute("stroke-dashoffset", `${circumference}`);
    this.ringCircle.setAttribute("transform", "rotate(-90 140 140)");
    
    svg.append(this.ringTrack, this.ringCircle);
    this.svgRingContainer.append(svg);

    // Centered stack inside the ring, holding the stopwatch time + hint
    const ringCenter = document.createElement("div");
    ringCenter.className = "ring-center";

    // Stopwatch digital digits
    this.statusText = document.createElement("div");
    this.statusText.className = "reaction-card__status";
    this.statusText.textContent = "Crono Ciego";

    this.subStatusText = document.createElement("div");
    this.subStatusText.className = "reaction-card__substatus";
    this.subStatusText.textContent = "presiona ENTER o haz clic para comenzar";

    ringCenter.append(this.statusText, this.subStatusText);
    this.svgRingContainer.append(ringCenter);

    // Target Time Box (shows during round)
    this.targetContainer = document.createElement("div");
    this.targetContainer.className = "target-time-box hidden";
    
    this.targetLabel = document.createElement("span");
    this.targetLabel.className = "target-time-box__label";
    this.targetLabel.textContent = "OBJETIVO: ";
    
    this.targetTimeEl = document.createElement("span");
    this.targetTimeEl.className = "target-time-box__time";
    
    this.targetContainer.append(this.targetLabel, this.targetTimeEl);

    contentWrapper.append(this.svgRingContainer, this.targetContainer);
    this.mainCard.append(contentWrapper);

    // Create HUD top bar (visible during gameplay)
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.roundIndicator = document.createElement("div");
    this.roundIndicator.className = "hud-bar__round";
    this.roundIndicator.textContent = "RONDA 1 DE 5";

    this.dotsContainer = document.createElement("div");
    this.dotsContainer.className = "hud-bar__dots";
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      const dot = document.createElement("div");
      dot.className = "hud-bar__dot is-empty";
      this.dotsContainer.append(dot);
    }

    this.averageIndicator = document.createElement("div");
    this.averageIndicator.className = "hud-bar__average";
    this.averageIndicator.textContent = "DESVIACIÓN: -- ms";

    this.hudBar.append(this.roundIndicator, this.dotsContainer, this.averageIndicator);

    // Create full screen overlay (start / gameover)
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
      this.hintEl
    );
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("blind-time").follow(this.leaderboard);
    this.leaderboard.clear();

    // Create countdown overlay
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    // Assemble container
    container.append(this.mainCard, this.hudBar, this.overlayEl, this.countdownEl);
  }

  showStart(bestScore: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.targetContainer.classList.add("hidden");
    this.setRingOffset(0);

    this.titleEl.textContent = "CRONO CIEGO";
    this.subtitleEl.textContent =
      "Te mostraremos un tiempo objetivo (entre 3 y 12 segundos). El reloj comenzará a contar y a los 1.5 segundos desaparecerá la pantalla. ¡Detenlo lo más cerca posible del objetivo!";

    if (bestScore !== null) {
      this.scoreLineEl.textContent = `MEJOR DESVIACIÓN: ${bestScore.toFixed(0)} ms`;
      this.scoreLineEl.style.display = "block";
    } else {
      this.scoreLineEl.textContent = "";
      this.scoreLineEl.style.display = "none";
    }

    this.ratingEl.textContent = "";
    this.ratingEl.style.display = "none";
    this.tableContainerEl.innerHTML = "";
    this.tableContainerEl.style.display = "none";

    this.hintEl.textContent = "presiona ENTER o haz clic en cualquier lugar para comenzar";

    // Reset card
    this.mainCard.className = "reaction-card state-idle";
    this.statusText.textContent = "Crono Ciego";
    this.subStatusText.textContent = "presiona ENTER o haz clic para comenzar";

    this.leaderboard.clear();
  }

  showRanking(gameId: string, averageMs: number): void {
    void this.leaderboard.render(gameId, { score: averageMs });
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
    void this.countdownEl.offsetWidth; // Reflow
    this.countdownEl.classList.add("is-shown");
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showWaitingState(roundNum: number, targetSec: number, currentAverage: number | null): void {
    this.hudBar.classList.remove("hidden");
    this.targetContainer.classList.remove("hidden");
    
    this.mainCard.className = "reaction-card state-wait";
    this.statusText.textContent = "Preparado...";
    this.subStatusText.textContent = "espera al inicio";
    
    this.targetTimeEl.textContent = `${targetSec.toFixed(1)}s`;

    this.roundIndicator.textContent = `RONDA ${roundNum} DE ${TOTAL_ROUNDS}`;
    this.updateAverageDisplay(currentAverage);
    this.setRingOffset(0);
    this.svgRingContainer.classList.remove("blind-ring");
  }

  showActiveState(currentTime: number): void {
    this.mainCard.className = "reaction-card state-running";
    this.statusText.textContent = `${currentTime.toFixed(2)}s`;
    this.subStatusText.textContent = "¡CUIDADO!";
  }

  showBlindState(): void {
    this.mainCard.className = "reaction-card state-blind";
    this.statusText.textContent = "CIEGO";
    this.subStatusText.textContent = "¡DETÉN EL RELOJ AHORA!";
    this.svgRingContainer.classList.add("blind-ring");
  }

  showResultState(stoppedTime: number, targetTime: number, diffMs: number): void {
    this.mainCard.className = "reaction-card state-result";
    
    const sign = diffMs >= 0 ? "+" : "-";
    const absoluteDiff = Math.abs(diffMs);
    
    this.statusText.textContent = `${stoppedTime.toFixed(3)}s`;
    this.subStatusText.textContent = `Objetivo: ${targetTime.toFixed(1)}s (${sign}${absoluteDiff.toFixed(0)} ms). Presiona ENTER para continuar`;
  }

  showEarlyClickState(): void {
    this.mainCard.className = "reaction-card state-early";
    this.statusText.textContent = "Fallo";
    this.subStatusText.textContent = "¡Demasiado pronto! Presiona ENTER para reintentar la ronda";
    this.setRingOffset(0);
  }

  showGameOver(
    roundsData: { target: number; stopped: number; diff: number; foul: boolean }[],
    average: number,
    isNewBest: boolean,
    bestAverage: number
  ): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.targetContainer.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "¡NUEVO RÉCORD!" : "RESULTADOS";
    this.subtitleEl.textContent = "Aquí tienes el desglose de tu precisión de tiempo:";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `DESVIACIÓN PROMEDIO: ${average.toFixed(1)} ms`;

    // Rating display
    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = this.getRatingLabel(average);
    this.ratingEl.className = `overlay__rating rating-${this.getRatingClass(average)}`;

    // Build rounds table
    this.tableContainerEl.style.display = "block";
    this.tableContainerEl.innerHTML = "";

    const table = document.createElement("table");
    table.className = "results-table";

    // Header
    const trHead = document.createElement("tr");
    const th1 = document.createElement("th");
    th1.textContent = "Ronda";
    const th2 = document.createElement("th");
    th2.textContent = "Objetivo";
    const th3 = document.createElement("th");
    th3.textContent = "Detenido";
    const th4 = document.createElement("th");
    th4.textContent = "Error";
    trHead.append(th1, th2, th3, th4);
    table.append(trHead);

    // Rows
    roundsData.forEach((round, index) => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = `Ronda ${index + 1}`;
      
      const td2 = document.createElement("td");
      td2.textContent = `${round.target.toFixed(1)}s`;
      
      const td3 = document.createElement("td");
      td3.textContent = round.foul ? "Fallo" : `${round.stopped.toFixed(2)}s`;
      
      const td4 = document.createElement("td");
      if (round.foul) {
        td4.textContent = "Penalización";
        td4.style.color = "#ef4444";
      } else {
        const sign = round.diff >= 0 ? "+" : "";
        td4.textContent = `${sign}${round.diff.toFixed(0)} ms`;
        td4.style.color = Math.abs(round.diff) < 150 ? "#10b981" : "#f59e0b";
      }
      
      tr.append(td1, td2, td3, td4);
      table.append(tr);
    });

    this.tableContainerEl.append(table);

    // Hint text
    this.hintEl.textContent = `presiona ENTER o haz clic para volver a jugar · mejor desviación: ${bestAverage.toFixed(0)} ms`;

    // Reset card
    this.mainCard.className = "reaction-card state-idle";
  }

  updateRoundProgress(roundNum: number, statuses: RoundStatus[]): void {
    const dots = this.dotsContainer.children;
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      const dot = dots[i] as HTMLDivElement;
      const status = statuses[i] || "empty";

      dot.className = "hud-bar__dot";
      if (status === "empty") {
        dot.classList.add("is-empty");
      } else if (status === "success") {
        dot.classList.add("is-success");
      } else if (status === "foul") {
        dot.classList.add("is-foul");
      }

      if (i === roundNum - 1 && status === "empty") {
        dot.classList.add("is-active");
      }
    }
  }

  private updateAverageDisplay(average: number | null): void {
    if (average === null) {
      this.averageIndicator.textContent = "DESVIACIÓN: -- ms";
    } else {
      this.averageIndicator.textContent = `DESVIACIÓN: ${average.toFixed(0)} ms`;
    }
  }

  /**
   * Sets progress offset on the SVG ring.
   * @param ratio value between 0 and 1
   */
  setRingOffset(ratio: number): void {
    const circumference = 2 * Math.PI * 120;
    const clamped = Math.max(0, Math.min(1, ratio));
    const offset = circumference * (1 - clamped);
    this.ringCircle.setAttribute("stroke-dashoffset", `${offset}`);
  }

  private getRatingLabel(average: number): string {
    if (average < 50) return "Reloj Suizo";
    if (average < 150) return "Cronometrador Maestro";
    if (average < 300) return "Excelente";
    if (average < 600) return "Aceptable";
    return "Descalibrado";
  }

  private getRatingClass(average: number): string {
    if (average < 50) return "divine";
    if (average < 150) return "ultra";
    if (average < 300) return "fast";
    if (average < 600) return "average";
    return "slow";
  }
}
