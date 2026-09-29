import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { INITIAL_LIVES } from "./constants";

export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  private readonly livesEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly btnEl: HTMLButtonElement;
  private readonly leaderboard = new LeaderboardPanel();

  // ── Popups flotantes de puntaje ───────────────────────────────────
  private popups: { text: string; x: number; y: number; timer: number; color: string }[] = [];
  private popupCanvas: HTMLCanvasElement | null = null;
  private popupCtx: CanvasRenderingContext2D | null = null;

  constructor(container: HTMLElement, onStartClick: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    this.timerEl = document.createElement("div");
    this.timerEl.className = "hud__timer";

    this.livesEl = document.createElement("div");
    this.livesEl.className = "hud__lives";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    hud.append(this.scoreEl, this.livesEl, this.timerEl, this.bestEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.btnEl = document.createElement("button");
    this.btnEl.className = "overlay__btn";
    this.btnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      onStartClick();
    });

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.btnEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("whack-a-mole").follow(this.leaderboard).hides(".overlay__hint");
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.overlayEl, this.countdownEl);
  }

  // ── Canvas de popups (sobre el canvas del juego) ──────────────────
  mountPopupCanvas(canvas: HTMLCanvasElement): void {
    this.popupCanvas = document.createElement("canvas");
    this.popupCanvas.className = "popup-canvas";
    this.popupCanvas.width = canvas.width;
    this.popupCanvas.height = canvas.height;
    this.popupCanvas.style.width = canvas.style.width;
    this.popupCanvas.style.height = canvas.style.height;
    this.popupCtx = this.popupCanvas.getContext("2d")!;
    canvas.parentElement?.append(this.popupCanvas);
  }

  syncPopupSize(canvas: HTMLCanvasElement): void {
    if (this.popupCanvas) {
      this.popupCanvas.style.width = canvas.style.width;
      this.popupCanvas.style.height = canvas.style.height;
    }
  }

  addPopup(text: string, x: number, y: number, color: string): void {
    this.popups.push({ text, x, y, timer: 0, color });
  }

  updatePopups(dt: number): void {
    for (const p of this.popups) {
      p.timer += dt;
      p.y -= 46 * dt;
    }
    this.popups = this.popups.filter((p) => p.timer < 0.8);
  }

  drawPopups(): void {
    if (!this.popupCtx || !this.popupCanvas) return;
    const ctx = this.popupCtx;
    ctx.clearRect(0, 0, this.popupCanvas.width, this.popupCanvas.height);

    for (const p of this.popups) {
      const alpha = 1 - p.timer / 0.8;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.fillStyle = p.color;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 4;
      ctx.textAlign = "center";
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  // ── HUD estandar ──────────────────────────────────────────────────
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

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `RECORD: ${best}` : "";
  }

  /** Tiempo restante de la ronda; null lo oculta (modo sala). */
  setTimer(seconds: number | null): void {
    this.timerEl.textContent = seconds === null ? "" : `${Math.ceil(seconds)}s`;
  }

  /** Vidas restantes (modo solo); -1 lo oculta (modo sala, no hay vidas). */
  setLives(lives: number): void {
    if (lives < 0) {
      this.livesEl.textContent = "";
      return;
    }
    let dots = "";
    for (let i = 0; i < INITIAL_LIVES; i++) dots += i < lives ? "●" : "○";
    this.livesEl.textContent = dots;
  }

  showStart(): void {
    this.titleEl.textContent = "TOPOS";
    this.subtitleEl.textContent = "APLASTA TODOS LOS QUE PUEDAS";
    this.scoreLineEl.textContent = "";
    this.btnEl.textContent = "Jugar";
    this.hintEl.innerHTML = `
      Controles:<br>
      <span class="overlay__hint-keys">Click</span> : Aplastar el topo<br>
      Los <span class="overlay__hint-gold">dorados</span> valen mas.<br>
      Tienes 3 vidas: pierdes una por cada
      <span class="overlay__hint-bomb">bomba</span> que golpees.
    `;
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number): void {
    this.titleEl.textContent = "FIN DE LA PARTIDA";
    this.subtitleEl.textContent = "TE QUEDASTE SIN VIDAS";

    if (score >= best && score > 0) {
      this.scoreLineEl.innerHTML = `¡NUEVO RECORD!<br><span class="overlay__score-big">${score}</span>`;
    } else {
      this.scoreLineEl.innerHTML = `PUNTAJE: ${score} · RECORD: ${best}`;
    }

    this.btnEl.textContent = "Reintentar";
    this.hintEl.innerHTML = "Haz click o presiona ENTER para volver a jugar";
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
