import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

/**
 * Salpicadura de sangre sobre el "lente", dibujada a canvas una sola vez: gotas
 * gordas contra los bordes (el centro queda limpio para que se siga leyendo el
 * pozo) y unos chorreados verticales que arrancan de las mas grandes.
 */
function bloodSplatterDataUrl(): string {
  const w = 1024;
  const h = 640;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const blob = (x: number, y: number, r: number, alpha: number): void => {
    ctx.fillStyle = `rgba(86, 4, 11, ${alpha})`;
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = r * (0.72 + Math.sin(a * 3 + x) * 0.14 + Math.random() * 0.16);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };

  for (let i = 0; i < 46; i++) {
    // Sesgado a los bordes: el centro del cuadro queda jugable / legible.
    const edge = Math.random();
    const x = edge < 0.5 ? Math.random() * w * 0.3 : w - Math.random() * w * 0.3;
    const y = Math.random() * h;
    const r = 6 + Math.random() * 38;
    blob(x, y, r, 0.55 + Math.random() * 0.4);
    if (r > 24) {
      ctx.fillStyle = `rgba(66, 3, 9, ${0.5 + Math.random() * 0.3})`;
      ctx.fillRect(x - r * 0.16, y, r * 0.32, r * (1.5 + Math.random() * 3));
    }
  }
  for (let i = 0; i < 90; i++) {
    blob(Math.random() * w, Math.random() * h, 2 + Math.random() * 9, 0.35 + Math.random() * 0.5);
  }

  return canvas.toDataURL("image/png");
}

/**
 * Overlay DOM del juego: puntaje, racha, el medidor de peligro (que tan cerca
 * estas del pozo), el countdown compartido, el flash rojo y la pantalla de
 * start / game-over con el ranking global.
 */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly bloodEl: HTMLDivElement;
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

    this.flashEl = document.createElement("div");
    this.flashEl.className = "flash";

    // Salpicadura sobre la camara: se pinta una sola vez y se reusa.
    this.bloodEl = document.createElement("div");
    this.bloodEl.className = "blood";
    this.bloodEl.style.backgroundImage = `url(${bloodSplatterDataUrl()})`;

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

    container.append(hud, this.flashEl, this.bloodEl, this.overlayEl, this.countdownEl);

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

  setHudVisible(visible: boolean): void {
    this.scoreEl.style.opacity = visible ? "1" : "0";
    this.bestEl.style.opacity = visible ? "0.85" : "0";
    this.comboEl.style.opacity = visible ? "1" : "0";
  }

  /**
   * Sangre en el objetivo, al empalarse: la salpicadura aparece de golpe y
   * despues **chorrea hacia abajo** (los hilos se generan aca y bajan por CSS).
   * Queda hasta la proxima partida.
   */
  showBlood(): void {
    this.bloodEl.replaceChildren();
    for (let i = 0; i < 14; i++) {
      const drip = document.createElement("div");
      drip.className = "blood__drip";
      drip.style.left = `${Math.random() * 100}%`;
      drip.style.top = `${Math.random() * 55}%`;
      drip.style.width = `${6 + Math.random() * 16}px`;
      drip.style.setProperty("--run", `${18 + Math.random() * 46}vh`);
      drip.style.animationDelay = `${Math.random() * 1.4}s`;
      drip.style.animationDuration = `${2.2 + Math.random() * 3.4}s`;
      this.bloodEl.append(drip);
    }
    this.bloodEl.classList.add("is-shown");
  }

  clearBlood(): void {
    this.bloodEl.classList.remove("is-shown");
    this.bloodEl.replaceChildren();
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
