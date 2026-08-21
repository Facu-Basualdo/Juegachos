import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import type { ColorDef } from "./constants";

export interface Handlers {
  onPick: (hex: string) => void;
}

/**
 * Capa DOM: barra superior (score / record), la palabra-estimulo, la barra de
 * tiempo, los swatches de respuesta, el countdown y el overlay de inicio / fin.
 */
export class Hud {
  private readonly hudBar: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;

  private readonly stage: HTMLDivElement;
  private readonly wordEl: HTMLDivElement;
  private readonly timerWrap: HTMLDivElement;
  private readonly timerBar: HTMLDivElement;
  private readonly swatches: HTMLDivElement;

  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();
  private readonly onPick: (hex: string) => void;

  constructor(container: HTMLElement, handlers: Handlers) {
    this.onPick = handlers.onPick;

    this.hudBar = el("div", "st-hud hidden");
    this.scoreEl = el("div", "st-hud__score");
    this.bestEl = el("div", "st-hud__best");
    this.hudBar.append(this.scoreEl, this.bestEl);

    this.stage = el("div", "st-stage hidden");
    this.wordEl = el("div", "st-word");
    this.timerWrap = el("div", "st-timer");
    this.timerBar = el("div", "st-timer__bar");
    this.timerWrap.append(this.timerBar);
    this.swatches = el("div", "st-swatches");
    this.stage.append(this.wordEl, this.timerWrap, this.swatches);

    this.countdownEl = el("div", "countdown");

    this.overlayEl = el("div", "overlay");
    this.titleEl = el("div", "overlay__title");
    this.subtitleEl = el("div", "overlay__subtitle");
    this.scoreLineEl = el("div", "overlay__score");
    this.hintEl = el("div", "overlay__hint");
    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    container.append(this.hudBar, this.stage, this.countdownEl, this.overlayEl);
  }

  // ---------- Inicio / fin ----------

  showStart(best: number): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");

    this.titleEl.textContent = "TINTA";
    this.subtitleEl.textContent = "Tocá el color de la TINTA con que está pintada la palabra, no lo que dice.";
    this.scoreLineEl.textContent = best > 0 ? `RÉCORD: ${best}` : "";
    this.hintEl.textContent = "presioná ENTER o tocá para empezar";
    this.leaderboard.clear();
  }

  showGameOver(score: number, best: number, isNewBest: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "¡NUEVO RÉCORD!" : "SE ACABÓ";
    this.subtitleEl.textContent = score > 0 ? `Acertaste ${score} tinta${score === 1 ? "" : "s"}.` : "No acertaste ninguna esta vez.";
    this.scoreLineEl.textContent = `RÉCORD: ${best}`;
    this.hintEl.textContent = "presioná ENTER o tocá para volver a jugar";
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  // ---------- Juego ----------

  startPlayUi(best: number): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.remove("hidden");
    this.stage.classList.remove("hidden");
    this.setScore(0);
    this.setBest(best);
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `RÉCORD ${best}` : "";
  }

  /** Palabra `text` pintada con la tinta `inkHex`. */
  showWord(text: string, inkHex: string): void {
    this.wordEl.textContent = text;
    this.wordEl.style.color = inkHex;
    this.wordEl.classList.remove("st-word--pop");
    void this.wordEl.offsetWidth;
    this.wordEl.classList.add("st-word--pop");
  }

  /** Dibuja los swatches (colores) en el orden dado; sin texto (color puro). */
  renderButtons(colors: ColorDef[]): void {
    this.swatches.innerHTML = "";
    this.swatches.style.setProperty("--cols", String(colors.length <= 4 ? colors.length : 3));
    for (const c of colors) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "st-swatch";
      b.style.background = c.hex;
      b.setAttribute("aria-label", c.name);
      const hex = c.hex;
      b.addEventListener("click", () => this.onPick(hex));
      this.swatches.append(b);
    }
  }

  /** Barra de tiempo (0..1) con color segun cuanto queda. */
  setTimer(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    this.timerBar.style.transform = `scaleX(${f})`;
    this.timerBar.style.background = f > 0.5 ? "#3ee06a" : f > 0.25 ? "#ffd23d" : "#ff3b4e";
  }

  flashWrong(): void {
    this.stage.classList.remove("st-shake");
    void this.stage.offsetWidth;
    this.stage.classList.add("st-shake");
  }

  // ---------- Countdown ----------

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
}

function el(tag: string, className: string): HTMLDivElement {
  const node = document.createElement(tag) as HTMLDivElement;
  node.className = className;
  return node;
}
