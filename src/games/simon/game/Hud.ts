import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { PAD_COUNT } from "./constants";

export class Hud {
  // HUD top bar
  private readonly hudBar: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;

  // Board
  private readonly boardEl: HTMLDivElement;
  private readonly pads: HTMLButtonElement[] = [];
  private readonly litTimers: number[] = [];

  // Overlay (start / game over)
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  // Countdown
  private readonly countdownEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    // Top bar
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud-bar__score";
    this.scoreEl.textContent = "RONDA: 0";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "hud-bar__status";
    this.statusEl.textContent = "";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud-bar__best";
    this.bestEl.textContent = "MEJOR: --";

    this.hudBar.append(this.scoreEl, this.statusEl, this.bestEl);

    // Board: 4 pads en grilla 2x2.
    this.boardEl = document.createElement("div");
    this.boardEl.className = "board is-locked";
    for (let i = 0; i < PAD_COUNT; i++) {
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = `pad pad--${i}`;
      pad.dataset.pad = String(i);
      this.pads.push(pad);
      this.litTimers.push(0);
      this.boardEl.append(pad);
    }

    // Overlay
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

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("simon").follow(this.leaderboard);
    this.leaderboard.clear();

    // Countdown
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(this.boardEl, this.hudBar, this.overlayEl, this.countdownEl);
  }

  get overlay(): HTMLDivElement {
    return this.overlayEl;
  }

  /** Registra el handler de toque de cada pad; recibe el indice del pad. */
  bindPads(onPress: (index: number) => void): void {
    this.pads.forEach((pad, i) => {
      pad.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        onPress(i);
      });
    });
  }

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");

    this.titleEl.textContent = "SIMON";
    this.subtitleEl.textContent =
      "Memoriza la secuencia de colores y repetila. Cada ronda suma un paso mas: gana quien aguanta mas lejos.";

    if (best !== null) {
      this.scoreLineEl.textContent = `MEJOR RONDA: ${best}`;
      this.scoreLineEl.style.display = "block";
    } else {
      this.scoreLineEl.textContent = "";
      this.scoreLineEl.style.display = "none";
    }

    this.hintEl.textContent = "presiona ENTER o toca para comenzar";
    this.leaderboard.clear();
  }

  showGameOver(score: number, isNewBest: boolean, best: number, roomMode: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "NUEVO RECORD" : "TE CONFUNDISTE";
    this.subtitleEl.textContent = "La memoria se entrena: la proxima llegas mas lejos.";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `RONDAS: ${score}`;

    this.hintEl.textContent = roomMode
      ? `mejor ronda: ${best}`
      : `presiona ENTER o toca para volver a jugar - mejor ronda: ${best}`;
  }

  /** Muestra el ranking global (mayor ronda = mejor) al terminar. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.remove("hidden");
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
    // Trigger reflow to restart animation
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  /** Ilumina un pad durante durationMs (secuencia y feedback de entrada). */
  flashPad(index: number, durationMs: number): void {
    const pad = this.pads[index];
    if (!pad) return;
    window.clearTimeout(this.litTimers[index]);
    pad.classList.add("is-lit");
    this.litTimers[index] = window.setTimeout(() => {
      pad.classList.remove("is-lit");
    }, durationMs);
  }

  /** Habilita o bloquea el toque de los pads (bloqueado mientras se muestra). */
  setInputEnabled(enabled: boolean): void {
    this.boardEl.classList.toggle("is-locked", !enabled);
  }

  /** Al perder, resalta el pad correcto y marca el equivocado. */
  revealMistake(correct: number, pressed: number): void {
    window.clearTimeout(this.litTimers[correct]);
    this.pads[correct]?.classList.add("is-lit", "is-correct");
    if (pressed !== correct) this.pads[pressed]?.classList.add("is-wrong");
  }

  clearBoard(): void {
    this.pads.forEach((pad, i) => {
      window.clearTimeout(this.litTimers[i]);
      pad.classList.remove("is-lit", "is-correct", "is-wrong");
    });
    this.boardEl.classList.add("is-locked");
  }

  updateScore(score: number): void {
    this.scoreEl.textContent = `RONDA: ${score}`;
  }

  updateBest(best: number | null): void {
    this.bestEl.textContent = best !== null ? `MEJOR: ${best}` : "MEJOR: --";
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}
