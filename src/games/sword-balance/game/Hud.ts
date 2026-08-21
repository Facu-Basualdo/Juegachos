import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/** DOM overlay: survival time, best, a tilt meter, start/game-over + countdown. */
export class Hud {
  private readonly timeEl: HTMLSpanElement;
  private readonly unitEl: HTMLSpanElement;
  private readonly bestEl: HTMLDivElement;
  private readonly meterEl: HTMLDivElement;
  private readonly markerEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onActivate: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";

    const timeWrap = document.createElement("div");
    timeWrap.className = "hud__time";
    this.timeEl = document.createElement("span");
    this.timeEl.className = "hud__time-value";
    this.timeEl.textContent = "0.0";
    this.unitEl = document.createElement("span");
    this.unitEl.className = "hud__time-unit";
    this.unitEl.textContent = "s";
    timeWrap.append(this.timeEl, this.unitEl);

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    // Tilt meter: a horizontal track with a centre line and a moving marker.
    this.meterEl = document.createElement("div");
    this.meterEl.className = "hud__meter";
    const centre = document.createElement("div");
    centre.className = "hud__meter-centre";
    this.markerEl = document.createElement("div");
    this.markerEl.className = "hud__meter-marker";
    this.meterEl.append(centre, this.markerEl);

    hud.append(timeWrap, this.bestEl, this.meterEl);

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
    this.hintEl.textContent = "mantené ← → (o A/D), o cada lado de la pantalla, para equilibrar";
    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.overlayEl, this.countdownEl);

    const activate = (e: Event): void => {
      e.preventDefault();
      onActivate();
    };
    this.overlayEl.addEventListener("pointerdown", activate);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Enter") onActivate();
    });
  }

  setTime(seconds: number): void {
    this.timeEl.textContent = seconds.toFixed(1);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best.toFixed(1)} s` : "";
  }

  /** ratio in [-1, 1] (0 = upright). Marker slides and reddens near the edges. */
  setTilt(ratio: number): void {
    const r = Math.max(-1, Math.min(1, ratio));
    this.markerEl.style.left = `${(r * 0.5 + 0.5) * 100}%`;
    const danger = Math.abs(r);
    const hue = 150 - danger * 150; // 150 (green) -> 0 (red)
    this.markerEl.style.background = `hsl(${hue}, 90%, 55%)`;
    this.markerEl.style.boxShadow = `0 0 ${6 + danger * 18}px hsl(${hue}, 90%, 60%)`;
    this.meterEl.style.setProperty("--danger", String(danger));
  }

  showMeter(visible: boolean): void {
    this.meterEl.style.visibility = visible ? "visible" : "hidden";
    if (visible) this.setTilt(0);
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

  showStart(best: number): void {
    this.titleEl.textContent = "PULSO DE ACERO";
    this.subtitleEl.textContent = "presioná ENTER o tocá para empezar";
    this.scoreLineEl.textContent = best > 0 ? `MEJOR: ${best.toFixed(1)} s` : "";
    this.hintEl.style.display = "block";
    this.showMeter(false);
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "SE CAYÓ";
    this.subtitleEl.textContent = "presioná ENTER o tocá para reintentar";
    this.scoreLineEl.textContent =
      score >= best
        ? `AGUANTASTE ${score.toFixed(1)} s — ¡NUEVO MEJOR!`
        : `AGUANTASTE ${score.toFixed(1)} s  ·  MEJOR: ${best.toFixed(1)} s`;
    this.hintEl.style.display = "none";
    this.showMeter(false);
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
