import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/**
 * HUD de Dalgona (DESIGN.md: la voz del galpon). Arriba, el reloj digital rojo, la
 * figura, el avance del tallado y el medidor del crujido; abajo, el boton de lamer.
 * Nada tapa la galleta: todo vive en las franjas que el Renderer deja libres.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly shapeEl: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private readonly progressText: HTMLDivElement;
  private readonly stressFill: HTMLDivElement;
  private readonly stressBox: HTMLDivElement;
  private readonly lickBtn: HTMLButtonElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;

  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  private clockSig = "";
  private progressSig = -1;
  private stressSig = -1;
  private bannerSig = "";

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "dg";

    const top = document.createElement("div");
    top.className = "dg__top";
    this.clockEl = document.createElement("div");
    this.clockEl.className = "dg__clock";
    this.clockEl.textContent = "01:15";
    const info = document.createElement("div");
    info.className = "dg__info";
    this.shapeEl = document.createElement("div");
    this.shapeEl.className = "dg__shape";
    const bars = document.createElement("div");
    bars.className = "dg__bars";
    const progress = document.createElement("div");
    progress.className = "dg__meter";
    progress.innerHTML = `<span class="dg__meter-label">TALLADO</span>`;
    const progressTrack = document.createElement("div");
    progressTrack.className = "dg__track";
    this.progressFill = document.createElement("div");
    this.progressFill.className = "dg__fill dg__fill--carve";
    progressTrack.append(this.progressFill);
    this.progressText = document.createElement("div");
    this.progressText.className = "dg__meter-value";
    progress.append(progressTrack, this.progressText);
    this.stressBox = document.createElement("div");
    this.stressBox.className = "dg__meter";
    this.stressBox.innerHTML = `<span class="dg__meter-label">CRUJIDO</span>`;
    const stressTrack = document.createElement("div");
    stressTrack.className = "dg__track";
    this.stressFill = document.createElement("div");
    this.stressFill.className = "dg__fill dg__fill--stress";
    stressTrack.append(this.stressFill);
    this.stressBox.append(stressTrack);
    bars.append(progress, this.stressBox);
    info.append(this.shapeEl, bars);
    top.append(this.clockEl, info);

    const bottom = document.createElement("div");
    bottom.className = "dg__bottom";
    this.lickBtn = document.createElement("button");
    this.lickBtn.type = "button";
    this.lickBtn.className = "dg__lick";
    this.lickBtn.innerHTML = `LAMER<span class="dg__lick-key">mantener L</span>`;
    bottom.append(this.lickBtn);

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "dg__banner";
    this.bannerEl.hidden = true;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.root.append(top, bottom, this.bannerEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";
    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";
    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "overlay__score";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";
    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    container.append(this.root, this.countdownEl, this.overlayEl);
    this.showPlaying(false);
  }

  /** Mantener apretado LAMER: `down` al apoyar, `up` al soltar. */
  onLick(down: () => void, up: () => void): void {
    this.lickBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.lickBtn.setPointerCapture(e.pointerId);
      down();
    });
    const release = (e: PointerEvent) => {
      e.stopPropagation();
      up();
    };
    this.lickBtn.addEventListener("pointerup", release);
    this.lickBtn.addEventListener("pointercancel", release);
    this.lickBtn.addEventListener("lostpointercapture", () => up());
  }

  setLicking(on: boolean): void {
    this.lickBtn.classList.toggle("is-on", on);
  }

  showPlaying(on: boolean): void {
    this.root.classList.toggle("dg--playing", on);
  }

  /** Muestra el panel de arriba sin el boton de lamer (al elegir la lata). */
  showTop(on: boolean): void {
    this.root.classList.toggle("dg--top", on);
  }

  setShape(name: string): void {
    this.shapeEl.textContent = name;
  }

  setClock(seconds: number): void {
    const s = Math.max(0, Math.ceil(seconds));
    const text = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    if (text === this.clockSig) return;
    this.clockSig = text;
    this.clockEl.textContent = text;
    this.clockEl.classList.toggle("is-low", s <= 10);
  }

  setProgress(p: number): void {
    const q = Math.round(p * 100);
    if (q === this.progressSig) return;
    this.progressSig = q;
    this.progressFill.style.transform = `scaleX(${p})`;
    this.progressText.textContent = `${q}%`;
  }

  setStress(level: number): void {
    const q = Math.round(level * 50);
    if (q === this.stressSig) return;
    this.stressSig = q;
    this.stressFill.style.transform = `scaleX(${Math.min(1, level)})`;
    this.stressBox.classList.toggle("is-danger", level > 0.7);
  }

  banner(text: string | null, tone: "info" | "good" | "bad" = "info"): void {
    const sig = text === null ? "" : `${tone}:${text}`;
    if (sig === this.bannerSig) return;
    this.bannerSig = sig;
    if (text === null) {
      this.bannerEl.hidden = true;
      return;
    }
    this.bannerEl.hidden = false;
    this.bannerEl.className = `dg__banner dg__banner--${tone}`;
    this.bannerEl.textContent = text;
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

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.titleEl.textContent = "DALGONA";
    this.subtitleEl.textContent =
      "Elegí una lata a ciegas y sacá la figura del caramelo con la aguja, sin que se parta. Si vas rápido o te salís de la línea, cruje. Lamela para ablandarla.";
    this.scoreEl.textContent = best !== null ? `MEJOR: ${Math.round(best)} pts` : "";
    this.scoreEl.style.display = best !== null ? "block" : "none";
    this.hintEl.textContent = "presiona ENTER o toca la pantalla para comenzar";
    this.leaderboard.clear();
  }

  showGameOver(title: string, detail: string, score: number, best: number | null, room: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = detail;
    this.scoreEl.style.display = "block";
    this.scoreEl.textContent = `${Math.round(score)} pts`;
    this.hintEl.textContent = room
      ? ""
      : `presiona ENTER o toca para volver a jugar${best !== null ? ` · mejor: ${Math.round(best)} pts` : ""}`;
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }
}
