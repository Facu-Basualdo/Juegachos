import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/**
 * Overlay DOM del juego: puntaje, racha, el medidor de peligro (que tan cerca
 * estas del pozo), el countdown compartido, el flash rojo y la pantalla de
 * start / game-over con el ranking global.
 */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly gaugeEl: HTMLDivElement;
  private readonly gaugeFillEl: HTMLDivElement;
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

    this.comboEl = document.createElement("div");
    this.comboEl.className = "hud__combo";

    hud.append(this.scoreEl, this.bestEl, this.comboEl);

    // Medidor de peligro: la altura que te queda antes de las puas.
    this.gaugeEl = document.createElement("div");
    this.gaugeEl.className = "gauge";
    this.gaugeFillEl = document.createElement("div");
    this.gaugeFillEl.className = "gauge__fill";
    const gaugeLabel = document.createElement("div");
    gaugeLabel.className = "gauge__label";
    gaugeLabel.textContent = "ALTURA";
    this.gaugeEl.append(this.gaugeFillEl, gaugeLabel);

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
    this.hintEl.textContent =
      "Segui las flechas del cartel: cada acierto te sube un escalon, cada error te tira al pozo";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.gaugeEl, this.flashEl, this.overlayEl, this.countdownEl);

    const activate = (e: Event): void => {
      e.preventDefault();
      onActivate();
    };
    this.overlayEl.addEventListener("pointerdown", activate);
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
    this.scoreEl.style.transform = "scale(1.18)";
    setTimeout(() => {
      this.scoreEl.style.transform = "scale(1)";
    }, 100);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best}` : "";
  }

  setCombo(combo: number): void {
    this.comboEl.textContent = combo >= 3 ? `RACHA x${combo}` : "";
  }

  /** `height` en [0, 1]: 1 = arriba del todo, 0 = las puas. */
  setDanger(height: number): void {
    const h = Math.max(0, Math.min(1, height));
    this.gaugeFillEl.style.height = `${h * 100}%`;
    this.gaugeFillEl.classList.toggle("is-critical", h < 0.28);
  }

  setHudVisible(visible: boolean): void {
    this.scoreEl.style.opacity = visible ? "1" : "0";
    this.bestEl.style.opacity = visible ? "0.85" : "0";
    this.comboEl.style.opacity = visible ? "1" : "0";
    this.gaugeEl.style.opacity = visible ? "1" : "0";
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
    this.titleEl.textContent = "LA ESCALERA";
    this.subtitleEl.textContent = "presioná ENTER o tocá para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
    this.setHudVisible(false);
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "TE COMIERON LAS PÚAS";
    this.subtitleEl.textContent = "presioná ENTER o tocá para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `ESCALONES: ${score} — ¡NUEVO MEJOR!`
        : `ESCALONES: ${score}  ·  MEJOR: ${best}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
    this.setHudVisible(false);
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
    this.setHudVisible(true);
  }
}
