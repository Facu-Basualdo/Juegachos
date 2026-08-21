import { BEST_KEY } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { formatClock } from "../../../shared/scoring-core";

export class Hud {
  private readonly container: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  private hudBar!: HTMLDivElement;
  private timeEl!: HTMLDivElement;
  private levelEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;

  private levelInfo!: HTMLDivElement;
  private levelTitleEl!: HTMLDivElement;
  private levelControlsEl!: HTMLDivElement;

  private stageEl!: HTMLDivElement;

  private overlayEl!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private scoreEl!: HTMLDivElement;
  private bestEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private countdownEl!: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.build();
  }

  private build(): void {
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";
    this.timeEl = document.createElement("div");
    this.timeEl.className = "hud-bar__time";
    this.timeEl.textContent = "TIEMPO 0:00.00";
    this.levelEl = document.createElement("div");
    this.levelEl.className = "hud-bar__level";
    this.levelEl.textContent = "FASE 1/3";
    this.statusEl = document.createElement("div");
    this.statusEl.className = "hud-bar__status";
    this.statusEl.textContent = "";
    this.hudBar.append(this.timeEl, this.levelEl, this.statusEl);

    this.levelInfo = document.createElement("div");
    this.levelInfo.className = "level-info hidden";
    this.levelTitleEl = document.createElement("div");
    this.levelTitleEl.className = "level-info__title";
    this.levelControlsEl = document.createElement("div");
    this.levelControlsEl.className = "level-info__controls";
    this.levelInfo.append(this.levelTitleEl, this.levelControlsEl);

    this.stageEl = document.createElement("div");
    this.stageEl.className = "hack-stage hidden";

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";
    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";
    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "overlay__score";
    this.bestEl = document.createElement("div");
    this.bestEl.className = "overlay__best";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";
    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreEl, this.bestEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.container.append(
      this.hudBar,
      this.levelInfo,
      this.stageEl,
      this.overlayEl,
      this.countdownEl
    );
  }

  getStage(): HTMLElement {
    return this.stageEl;
  }

  showStart(): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.levelInfo.classList.add("hidden");
    this.stageEl.classList.add("hidden");

    this.titleEl.textContent = "HACKERMAN";
    this.subtitleEl.innerHTML =
      "Tres intrusiones seguidas: cloná la huella, descifrá la secuencia y forzá la clave.<br>El reloj corre de punta a punta: sos tan rápido como tu peor nivel.";
    this.scoreEl.style.display = "none";

    const best = this.readBest();
    this.bestEl.style.display = "block";
    this.bestEl.textContent = best === null ? "SIN RECORD AUN" : `MEJOR TIEMPO: ${formatClock(best)}`;

    this.hintEl.textContent = "presiona ENTER para comenzar";
    this.leaderboard.clear();
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.add("hidden");
    this.levelInfo.classList.add("hidden");
    this.stageEl.classList.remove("hidden");
  }

  setLevel(index: number, total: number, title: string, controls: string): void {
    this.levelEl.textContent = `FASE ${index + 1}/${total}`;
    this.levelTitleEl.textContent = `FASE ${index + 1} · ${title}`;
    this.levelControlsEl.textContent = controls;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  /** Recibe el tiempo en centisegundos (mismo formato que el score). */
  updateTime(centis: number): void {
    this.timeEl.textContent = `TIEMPO ${formatClock(centis)}`;
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
    void this.countdownEl.offsetWidth; // reflow para reiniciar la animacion
    this.countdownEl.classList.add("is-shown");
  }

  showVictory(centis: number, best: number, isNewBest: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.levelInfo.classList.add("hidden");
    this.stageEl.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "ACCESO TOTAL — RECORD!" : "ACCESO TOTAL";
    this.subtitleEl.textContent = "Sistema comprometido. Los tres candados cayeron.";
    this.scoreEl.style.display = "block";
    this.scoreEl.textContent = `Tiempo: ${formatClock(centis)}`;
    this.bestEl.style.display = "block";
    this.bestEl.textContent = `MEJOR TIEMPO: ${formatClock(best)}`;
    this.hintEl.textContent = "presiona ENTER para volver a intentar";
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  private readBest(): number | null {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
}
