import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import type { LegSide } from "./Creature";
import type { StepGrade } from "./StepController";

const GRADE_TEXT: Record<StepGrade, string> = {
  apurado: "APURADO",
  bien: "BIEN",
  perfecto: "PERFECTO",
  tarde: "TARDE",
};

export class Hud {
  private readonly rootEl: HTMLDivElement;
  private readonly distanceEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly gradeEl: HTMLDivElement;
  private readonly legsEl: HTMLDivElement;
  private readonly legDots: [HTMLSpanElement, HTMLSpanElement];
  private readonly timingEl: HTMLDivElement;
  private readonly timingFillEl: HTMLSpanElement;
  private readonly toastEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  private gradeTimer: number | null = null;
  private toastTimer: number | null = null;

  constructor(container: HTMLElement) {
    const hud = document.createElement("div");
    hud.className = "hud";
    this.rootEl = hud;

    this.distanceEl = document.createElement("div");
    this.distanceEl.className = "hud__distance";
    this.distanceEl.textContent = "0 m";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    this.gradeEl = document.createElement("div");
    this.gradeEl.className = "hud__grade";

    this.legsEl = document.createElement("div");
    this.legsEl.className = "hud__legs";
    const left = document.createElement("span");
    const right = document.createElement("span");
    left.className = right.className = "hud__leg";
    this.legsEl.append(left, right);
    this.legDots = [left, right];

    this.timingEl = document.createElement("div");
    this.timingEl.className = "hud__timing";
    this.timingFillEl = document.createElement("span");
    this.timingFillEl.className = "hud__timing-fill";
    const zone = document.createElement("span");
    zone.className = "hud__timing-zone";
    this.timingEl.append(zone, this.timingFillEl);
    this.legsEl.append(this.timingEl);

    this.toastEl = document.createElement("div");
    this.toastEl.className = "hud__toast";

    hud.append(this.distanceEl, this.bestEl, this.gradeEl, this.legsEl, this.toastEl);

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
      "Un toque = un paso, y las patas alternan siempre: izquierda, derecha, izquierda.<br />" +
      "Si tocas antes de tiempo la pata queda corta; si tardas, el cuerpo ya se te fue de largo.";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.overlayEl, this.countdownEl);
  }

  setDistance(meters: number): void {
    this.distanceEl.textContent = `${meters} m`;
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `RECORD ${best} m` : "";
  }

  /** Marca cual pata sale en el proximo toque. */
  setNextLeg(side: LegSide): void {
    this.legDots[0].classList.toggle("is-next", side === 0);
    this.legDots[1].classList.toggle("is-next", side === 1);
  }

  /**
   * Barra de tiempo del paso: cuanto se paso el cuerpo del pie apoyado (0..1).
   * Sin ella el jugador no tiene de donde leer el timing — el bicho se cae y
   * no queda claro si fue por apurado o por tarde.
   */
  setTiming(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.timingFillEl.style.width = `${clamped * 100}%`;
    this.timingEl.classList.toggle("is-hot", clamped > 0.9);
  }

  setLegsVisible(visible: boolean): void {
    this.legsEl.classList.toggle("is-hidden", !visible);
  }

  flashGrade(grade: StepGrade, streak: number): void {
    this.gradeEl.textContent =
      grade === "perfecto" && streak > 2 ? `${GRADE_TEXT[grade]} x${streak}` : GRADE_TEXT[grade];
    this.gradeEl.dataset.grade = grade;
    this.gradeEl.classList.remove("is-shown");
    void this.gradeEl.offsetWidth;
    this.gradeEl.classList.add("is-shown");
    if (this.gradeTimer !== null) window.clearTimeout(this.gradeTimer);
    this.gradeTimer = window.setTimeout(() => this.gradeEl.classList.remove("is-shown"), 620);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove("is-shown");
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("is-shown");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("is-shown"), 1800);
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
    // Reflow forzado para que la animacion vuelva a arrancar.
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  showStart(): void {
    this.titleEl.textContent = "PATAS LARGAS";
    this.subtitleEl.textContent = "toca la pantalla o presiona ENTER para arrancar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.add("is-start");
    this.overlayEl.classList.remove("hidden");
    this.rootEl.classList.add("is-dim");
  }

  showGameOver(meters: number, best: number, steps: number): void {
    const record = meters >= best && meters > 0;
    this.titleEl.textContent = record ? "NUEVO RECORD" : "TE FUISTE AL PISO";
    this.subtitleEl.textContent = "toca la pantalla o presiona ENTER para reintentar";
    this.scoreLineEl.textContent = record
      ? `${meters} m en ${steps} pasos`
      : `${meters} m en ${steps} pasos  ·  RECORD ${best} m`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("is-start");
    this.overlayEl.classList.remove("hidden");
    this.rootEl.classList.add("is-dim");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
    this.rootEl.classList.remove("is-dim");
  }
}
