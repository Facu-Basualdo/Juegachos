import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/**
 * DOM overlay: population count (the score is habitantes, not points), a balance
 * meter, the current building progress, and the shared start / game-over /
 * countdown screens.
 */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly scoreLabelEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly buildingEl: HTMLDivElement;
  private readonly balanceEl: HTMLDivElement;
  private readonly balanceMarkerEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    this.scoreLabelEl = document.createElement("div");
    this.scoreLabelEl.className = "hud__score-label";
    this.scoreLabelEl.textContent = "HABITANTES";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    this.buildingEl = document.createElement("div");
    this.buildingEl.className = "hud__building";

    this.balanceEl = document.createElement("div");
    this.balanceEl.className = "hud__balance";
    this.balanceMarkerEl = document.createElement("div");
    this.balanceMarkerEl.className = "hud__balance-marker";
    this.balanceEl.append(this.balanceMarkerEl);

    hud.append(this.scoreEl, this.scoreLabelEl, this.bestEl, this.buildingEl, this.balanceEl);

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
    this.hintEl.textContent = "espacio / clic / toca para soltar el piso";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.flashEl = document.createElement("div");
    this.flashEl.className = "perfect-flash";

    container.append(hud, this.overlayEl, this.countdownEl, this.flashEl);
  }

  /** Flashes a big centered message (perfect combo, roof complete, life lost). */
  flash(text: string, tone: "gold" | "cyan" | "red" = "gold"): void {
    this.flashEl.textContent = text;
    this.flashEl.dataset.tone = tone;
    this.flashEl.classList.remove("is-shown");
    void this.flashEl.offsetWidth; // reflow to restart the pop
    this.flashEl.classList.add("is-shown");
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
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  setScore(pop: number): void {
    this.scoreEl.textContent = pop.toLocaleString("es-AR");
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best.toLocaleString("es-AR")}` : "";
  }

  setBuilding(buildingNo: number, floor: number, cap: number): void {
    this.buildingEl.textContent = `EDIFICIO ${buildingNo}  ·  PISO ${floor}/${cap}`;
  }

  /** Positions the balance marker; ratio in [-1, 1], 0 = centered/stable. */
  setBalance(ratio: number): void {
    const pct = 50 + Math.max(-1, Math.min(1, ratio)) * 50;
    this.balanceMarkerEl.style.left = `${pct}%`;
    this.balanceEl.classList.toggle("is-danger", Math.abs(ratio) > 0.7);
  }

  /** Lights the combo state (extra glow on the score). */
  setCombo(active: boolean): void {
    this.scoreEl.classList.toggle("is-combo", active);
  }

  showScore(visible: boolean): void {
    const v = visible ? "visible" : "hidden";
    this.scoreEl.style.visibility = v;
    this.scoreLabelEl.style.visibility = v;
    this.buildingEl.style.visibility = v;
    this.balanceEl.style.visibility = v;
  }

  showStart(): void {
    this.titleEl.textContent = "SKYLINE";
    this.subtitleEl.textContent = "presiona ENTER o toca para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "SE DERRUMBO";
    this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `${score.toLocaleString("es-AR")} habitantes — ¡NUEVO MEJOR!`
        : `${score.toLocaleString("es-AR")} hab.  ·  MEJOR: ${best.toLocaleString("es-AR")}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  /** Muestra el ranking global del juego en la pantalla de game-over. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
