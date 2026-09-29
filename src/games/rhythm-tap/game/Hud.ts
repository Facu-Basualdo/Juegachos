import { MAX_HEALTH } from "./constants";
import type { Judgment } from "./NoteField";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

const JUDGMENT_TEXT: Record<Judgment, string> = {
  perfect: "PERFECTO",
  good: "BIEN",
  miss: "FALLO",
};

/** DOM overlay: live score / combo / health plus start and game-over screens. */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly healthFillEl: HTMLDivElement;
  private readonly judgmentEl: HTMLDivElement;
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

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    this.comboEl = document.createElement("div");
    this.comboEl.className = "hud__combo";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    const healthBar = document.createElement("div");
    healthBar.className = "hud__health";
    this.healthFillEl = document.createElement("div");
    this.healthFillEl.className = "hud__health-fill";
    healthBar.append(this.healthFillEl);

    this.judgmentEl = document.createElement("div");
    this.judgmentEl.className = "hud__judgment";

    hud.append(this.scoreEl, this.comboEl, this.bestEl, healthBar, this.judgmentEl);

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
    this.hintEl.textContent = "flechas ← ↑ ↓ → segun la figura  ·  o toca la columna";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("rhythm-tap").follow(this.leaderboard).hides(".overlay__hint");
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

  setCombo(combo: number): void {
    this.comboEl.textContent = combo >= 2 ? `${combo} COMBO` : "";
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best}` : "";
  }

  setHealth(health: number): void {
    const pct = Math.max(0, Math.min(1, health / MAX_HEALTH));
    this.healthFillEl.style.width = `${pct * 100}%`;
    // Fade from green to red as health drops.
    const hue = pct * 120;
    this.healthFillEl.style.background = `hsl(${hue}, 85%, 55%)`;
  }

  /** Flashes the last judgment; retriggers the CSS pop animation. */
  flashJudgment(judgment: Judgment): void {
    this.judgmentEl.textContent = JUDGMENT_TEXT[judgment];
    this.judgmentEl.className = `hud__judgment hud__judgment--${judgment}`;
    // Force reflow so re-adding the same class restarts the animation.
    void this.judgmentEl.offsetWidth;
    this.judgmentEl.classList.add("is-shown");
  }

  showHud(visible: boolean): void {
    this.scoreEl.style.visibility = visible ? "visible" : "hidden";
    this.comboEl.style.visibility = visible ? "visible" : "hidden";
  }

  showStart(): void {
    this.titleEl.textContent = "BEAT FEVER";
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
    this.titleEl.textContent = "GAME OVER";
    this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
    this.scoreLineEl.textContent =
      score >= best && score > 0
        ? `PUNTAJE: ${score} — ¡NUEVO MEJOR!`
        : `PUNTAJE: ${score}  ·  MEJOR: ${best}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
