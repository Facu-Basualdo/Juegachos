import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { SHIELD_MAX } from "./constants";

/** DOM overlay: live score, shield cells, plus start/game-over screens. */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly shieldEl: HTMLDivElement;
  private readonly shieldCells: HTMLDivElement[] = [];
  
  private readonly bossEl: HTMLDivElement;
  private readonly bossFillEl: HTMLDivElement;

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

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    this.shieldEl = document.createElement("div");
    this.shieldEl.className = "hud__shield";
    for (let i = 0; i < SHIELD_MAX; i++) {
      const cell = document.createElement("div");
      cell.className = "hud__shield-cell active";
      this.shieldEl.appendChild(cell);
      this.shieldCells.push(cell);
    }

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    hud.append(this.scoreEl, this.shieldEl, this.bestEl);

    // Boss health bar (hidden unless a boss is active)
    this.bossEl = document.createElement("div");
    this.bossEl.className = "boss-bar hidden";
    const bossLabel = document.createElement("div");
    bossLabel.className = "boss-bar__label";
    bossLabel.textContent = "JEFE";
    const bossTrack = document.createElement("div");
    bossTrack.className = "boss-bar__track";
    this.bossFillEl = document.createElement("div");
    this.bossFillEl.className = "boss-bar__fill";
    bossTrack.appendChild(this.bossFillEl);
    this.bossEl.append(bossLabel, bossTrack);

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
    this.hintEl.innerHTML = "W A S D / FLECHAS / ARRASTRAR - Moverse<br>ESPACIO / CLICK / TAP - Disparar";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("trench-rush").follow(this.leaderboard).hides(".overlay__hint");
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.bossEl, this.overlayEl, this.countdownEl);

    const activate = (e: Event): void => {
      e.preventDefault();
      onActivate();
    };
    this.overlayEl.addEventListener("pointerdown", activate);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "Enter") onActivate();
    });
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best}` : "";
  }

  setShield(shield: number): void {
    for (let i = 0; i < SHIELD_MAX; i++) {
      if (i < shield) {
        this.shieldCells[i].classList.add("active");
      } else {
        this.shieldCells[i].classList.remove("active");
      }
    }
  }

  /** Reveals the boss health bar (full). */
  showBoss(): void {
    this.bossFillEl.style.width = "100%";
    this.bossEl.classList.remove("hidden");
  }

  /** Updates the boss health bar (frac 0..1). */
  setBossHealth(frac: number): void {
    this.bossFillEl.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  hideBoss(): void {
    this.bossEl.classList.add("hidden");
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

  showStart(): void {
    this.titleEl.textContent = "TRENCH RUSH";
    this.subtitleEl.textContent = "presiona ENTER o toca para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.hideBoss();
    this.overlayEl.classList.remove("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "GAME OVER";
    this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
    this.scoreLineEl.textContent = score >= best ? `PUNTAJE: ${score} — ¡NUEVO MEJOR!` : `PUNTAJE: ${score}  ·  MEJOR: ${best}`;
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
