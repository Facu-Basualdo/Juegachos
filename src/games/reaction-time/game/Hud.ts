import { TOTAL_ROUNDS } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export type RoundStatus = "empty" | "success" | "foul";

export class Hud {
  private readonly mainCard: HTMLDivElement;
  private readonly statusText: HTMLDivElement;
  private readonly subStatusText: HTMLDivElement;
  
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
    // Create the main interactive reaction card
    this.mainCard = document.createElement("div");
    this.mainCard.className = "reaction-card state-idle";

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "reaction-card__content";

    this.statusText = document.createElement("div");
    this.statusText.className = "reaction-card__status";
    this.statusText.textContent = "Reflex";

    this.subStatusText = document.createElement("div");
    this.subStatusText.className = "reaction-card__substatus";
    this.subStatusText.textContent = "presiona ENTER o haz clic para comenzar";

    contentWrapper.append(this.statusText, this.subStatusText);
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
    this.averageIndicator.textContent = "PROMEDIO: -- ms";

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
    new HowToPanel("reaction-time").follow(this.leaderboard);
    this.leaderboard.clear();

    // Create countdown overlay
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    // Assemble container
    container.append(this.mainCard, this.hudBar, this.overlayEl, this.countdownEl);
  }

  showStart(bestAverage: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    
    this.titleEl.textContent = "REFLEX";
    this.subtitleEl.textContent = "Pon a prueba tus reflejos en 5 rondas.";
    
    if (bestAverage !== null) {
      this.scoreLineEl.textContent = `MEJOR PROMEDIO: ${bestAverage.toFixed(1)} ms`;
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
    
    // Reset main card classes
    this.mainCard.className = "reaction-card state-idle";
    this.statusText.textContent = "Reflex";
    this.subStatusText.textContent = "presiona ENTER o haz clic para comenzar";

    this.leaderboard.clear();
  }

  /** Muestra el ranking global (menor promedio ms = mejor) al terminar. */
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
    // Trigger reflow to restart animation
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showWaitingState(roundNum: number, currentAverage: number | null): void {
    this.hudBar.classList.remove("hidden");
    this.mainCard.className = "reaction-card state-wait";
    this.statusText.textContent = "Espera al cambio de color...";
    this.subStatusText.textContent = "no hagas clic todavía";

    this.roundIndicator.textContent = `RONDA ${roundNum} DE ${TOTAL_ROUNDS}`;
    this.updateAverageDisplay(currentAverage);
  }

  showTriggerState(): void {
    this.mainCard.className = "reaction-card state-trigger";
    this.statusText.textContent = "¡CLIC YA!";
    this.subStatusText.textContent = "¡toca o haz clic rápido!";
  }

  showEarlyClickState(): void {
    this.mainCard.className = "reaction-card state-early";
    this.statusText.textContent = "¡Demasiado pronto!";
    this.subStatusText.textContent = "toca o presiona ENTER para reintentar la ronda";
  }

  showResultState(timeMs: number): void {
    this.mainCard.className = "reaction-card state-result";
    this.statusText.textContent = `${timeMs} ms`;
    this.subStatusText.textContent = "buenos reflejos, toca o presiona ENTER para continuar";
  }

  showGameOver(
    roundTimes: number[],
    average: number,
    isNewBest: boolean,
    bestAverage: number
  ): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "¡NUEVO RECORD!" : "RESULTADOS";
    this.subtitleEl.textContent = "Aquí tienes el desglose de tu tiempo de reacción:";
    
    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `PROMEDIO FINAL: ${average.toFixed(1)} ms`;
    
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
    th2.textContent = "Tiempo de reacción";
    trHead.append(th1, th2);
    table.append(trHead);

    // Rows
    roundTimes.forEach((time, index) => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = `Ronda ${index + 1}`;
      const td2 = document.createElement("td");
      td2.textContent = `${time} ms`;
      tr.append(td1, td2);
      table.append(tr);
    });

    this.tableContainerEl.append(table);

    // Hint text
    this.hintEl.textContent = `presiona ENTER o haz clic para volver a jugar · mejor promedio: ${bestAverage.toFixed(1)} ms`;

    // Reset card class
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
      
      // Make current active dot animate/glow slightly
      if (i === roundNum - 1 && status === "empty") {
        dot.classList.add("is-active");
      }
    }
  }

  private updateAverageDisplay(average: number | null): void {
    if (average === null) {
      this.averageIndicator.textContent = "PROMEDIO: -- ms";
    } else {
      this.averageIndicator.textContent = `PROMEDIO: ${average.toFixed(0)} ms`;
    }
  }

  private getRatingLabel(average: number): string {
    if (average < 180) return "Reflejos Divinos";
    if (average < 240) return "Ultrarrápido";
    if (average < 300) return "Rápido";
    if (average < 400) return "Promedio";
    return "Lento";
  }

  private getRatingClass(average: number): string {
    if (average < 180) return "divine";
    if (average < 240) return "ultra";
    if (average < 300) return "fast";
    if (average < 400) return "average";
    return "slow";
  }
}
