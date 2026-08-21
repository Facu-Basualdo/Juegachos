import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HOLES_PER_ROUND } from "./constants";

export interface HoleResult {
  name: string;
  par: number;
  strokes: number;
}

/** DOM overlay: hole/stroke card, banners, start / game-over screens + countdown. */
export class Hud {
  private readonly holeEl: HTMLDivElement;
  private readonly strokesEl: HTMLDivElement;
  private readonly totalEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly hudEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly cardEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onActivate: () => void) {
    this.hudEl = document.createElement("div");
    this.hudEl.className = "hud";

    this.holeEl = document.createElement("div");
    this.holeEl.className = "hud__hole";
    this.strokesEl = document.createElement("div");
    this.strokesEl.className = "hud__strokes";
    this.totalEl = document.createElement("div");
    this.totalEl.className = "hud__total";
    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";
    this.hudEl.append(this.holeEl, this.strokesEl, this.totalEl, this.bestEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";
    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";
    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";
    this.cardEl = document.createElement("div");
    this.cardEl.className = "overlay__card";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";
    this.hintEl.textContent =
      "Arrastrá desde la pelota para apuntar y soltá para pegar. Arrastrá fuera de la pelota para girar la cámara, rueda para el zoom.";
    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.cardEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "banner";

    container.append(this.hudEl, this.overlayEl, this.countdownEl, this.bannerEl);

    this.overlayEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onActivate();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Enter") onActivate();
    });
  }

  setHole(index: number, name: string, par: number): void {
    this.holeEl.textContent = `HOYO ${index + 1}/${HOLES_PER_ROUND} · ${name.toUpperCase()} · PAR ${par}`;
  }

  setStrokes(strokes: number, total: number): void {
    this.strokesEl.textContent = `GOLPES: ${strokes}`;
    this.totalEl.textContent = `TOTAL: ${total}`;
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best} golpes` : "";
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

  flashBanner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove("is-shown");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("is-shown");
  }

  showLoading(): void {
    this.titleEl.textContent = "HOLE IN NONE";
    this.subtitleEl.textContent = "preparando el campo…";
    this.scoreLineEl.textContent = "";
    this.cardEl.innerHTML = "";
    this.hintEl.style.display = "none";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showStart(): void {
    this.titleEl.textContent = "HOLE IN NONE";
    this.subtitleEl.textContent = "presioná ENTER o tocá para empezar";
    this.scoreLineEl.textContent = "3 hoyos · gana el que menos golpes necesita";
    this.cardEl.innerHTML = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(results: HoleResult[], total: number, best: number, isRecord: boolean): void {
    this.titleEl.textContent = "TARJETA FINAL";
    this.subtitleEl.textContent = "presioná ENTER o tocá para jugar de nuevo";
    this.scoreLineEl.textContent = isRecord
      ? `${total} GOLPES — ¡NUEVO RÉCORD!`
      : `${total} GOLPES · MEJOR: ${best}`;
    this.cardEl.innerHTML = "";
    for (const r of results) {
      const row = document.createElement("div");
      row.className = "overlay__card-row";
      const diff = r.strokes - r.par;
      const diffText = diff === 0 ? "PAR" : diff > 0 ? `+${diff}` : `${diff}`;
      row.innerHTML = `<span>${r.name}</span><span>${r.strokes} (${diffText})</span>`;
      this.cardEl.append(row);
    }
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
