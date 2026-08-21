import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { formatClock } from "../../../shared/scoring-core";

export class Hud {
  private readonly timeEl: HTMLDivElement;
  private readonly crashEl: HTMLDivElement;
  private readonly levelEl: HTMLDivElement;
  private readonly readoutEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly bestLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly rankTabsEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();
  // Variantes ya enviadas en esta pantalla de fin (para no reenviar al re-ver una pestana).
  private readonly rankSubmitted = new Set<string>();
  // Variantes que se pueden enviar desde el game-over (el resto es solo lectura).
  private rankSubmittable = new Set<string>();

  constructor(container: HTMLElement) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.timeEl = document.createElement("div");
    this.timeEl.className = "hud__time";
    this.timeEl.textContent = "0:00.00";

    this.crashEl = document.createElement("div");
    this.crashEl.className = "hud__crash";
    this.crashEl.textContent = "CHOQUES: 0";

    this.levelEl = document.createElement("div");
    this.levelEl.className = "hud__level";
    this.levelEl.textContent = "NIVEL 1";

    // Grupo posicionable (por defecto arriba-centro via CSS; el juego puede anclarlo
    // sobre una celda del tablero con setReadoutPosition).
    this.readoutEl = document.createElement("div");
    this.readoutEl.className = "hud__readout";
    this.readoutEl.append(this.levelEl, this.timeEl, this.crashEl);
    hud.append(this.readoutEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.bestLineEl = document.createElement("div");
    this.bestLineEl.className = "overlay__best";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.rankTabsEl = document.createElement("div");
    this.rankTabsEl.className = "rank-tabs";
    this.rankTabsEl.style.display = "none";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.bestLineEl, this.hintEl);
    this.overlayEl.append(this.rankTabsEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "banner";

    container.append(hud, this.overlayEl, this.countdownEl, this.bannerEl);
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

  showBanner(text: string, color = "#ff5555"): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.bannerEl.classList.remove("is-shown");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("is-shown");
  }

  setTimer(seconds: number): void {
    this.timeEl.textContent = formatClock(Math.round(seconds * 100));
  }

  setCrashes(n: number): void {
    this.crashEl.textContent = `CHOQUES: ${n}`;
  }

  setLevel(index: number, count: number): void {
    this.levelEl.textContent = count > 1 ? `NIVEL ${index}/${count}` : `NIVEL ${index}`;
  }

  /** Ancla el grupo de lecturas (nivel/tiempo/choques) en un punto de pantalla (px CSS),
   *  centrado sobre el. `null` vuelve al comportamiento por defecto (arriba-centro). */
  setReadoutPosition(x: number | null, y = 0): void {
    const s = this.readoutEl.style;
    if (x === null) {
      s.position = "";
      s.left = "";
      s.top = "";
      s.transform = "";
      return;
    }
    s.position = "absolute";
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.transform = "translate(-50%, -50%)";
  }

  showHud(visible: boolean): void {
    const v = visible ? "visible" : "hidden";
    this.timeEl.style.visibility = v;
    this.crashEl.style.visibility = v;
    this.levelEl.style.visibility = v;
  }

  showStart(best: string | null): void {
    this.titleEl.textContent = "CIRCUIT BREAKER";
    this.subtitleEl.textContent =
      "lleva la senal desde el pad de origen hasta el conector destino sin tocar las paredes: si chocas, volves al inicio";
    this.scoreLineEl.textContent = best ? `MEJOR: ${best}` : "";
    this.scoreLineEl.style.display = best ? "block" : "none";
    this.bestLineEl.textContent = "";
    this.bestLineEl.style.display = "none";
    this.hintEl.textContent = "ENTER o toca para empezar - avanza sola, gira con flechas / WASD";
    this.rankTabsEl.style.display = "none";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showWin(seconds: number, crashes: number, best: string, isNewBest: boolean): void {
    this.titleEl.textContent = isNewBest ? "NUEVO RECORD!" : "CONECTADO!";
    this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
    this.scoreLineEl.textContent = `TIEMPO: ${formatClock(Math.round(seconds * 100))} - ${crashes} choques`;
    this.scoreLineEl.style.display = "block";
    this.bestLineEl.textContent = isNewBest ? "NUEVO MEJOR!" : `MEJOR: ${best}`;
    this.bestLineEl.style.display = "block";
    this.hintEl.textContent = "";
    this.overlayEl.classList.remove("hidden");
  }

  /**
   * Muestra el ranking con un selector de pestanas: "general" (los niveles juntos)
   * y una por cada nivel. `submittable` lista las variantes que se envian desde aca
   * (el general, que solo se conoce al final); las demas ya se enviaron al pasar el
   * nivel y se muestran de solo lectura. La pestana "general" va primera y por defecto.
   */
  showRankings(gameId: string, scores: Record<string, number>, submittable: string[] = []): void {
    this.rankSubmitted.clear();
    this.rankSubmittable = new Set(submittable);
    this.rankTabsEl.innerHTML = "";
    const variants = Object.keys(scores);
    for (const variant of variants) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "rank-tab";
      tab.textContent = this.rankTabLabel(variant);
      tab.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectRankTab(gameId, scores, variant);
      });
      this.rankTabsEl.append(tab);
    }
    this.rankTabsEl.style.display = variants.length > 1 ? "flex" : "none";
    this.selectRankTab(gameId, scores, variants[0]);
  }

  private selectRankTab(gameId: string, scores: Record<string, number>, variant: string): void {
    const tabs = Array.from(this.rankTabsEl.children) as HTMLButtonElement[];
    const variants = Object.keys(scores);
    tabs.forEach((t, i) => t.classList.toggle("is-active", variants[i] === variant));
    // Enviar solo las variantes marcadas como enviables, y una unica vez.
    const canSubmit = this.rankSubmittable.has(variant) && !this.rankSubmitted.has(variant);
    if (canSubmit) this.rankSubmitted.add(variant);
    void this.leaderboard.render(gameId, { variant, score: canSubmit ? scores[variant] : undefined });
  }

  private rankTabLabel(variant: string): string {
    if (variant === "general") return "General";
    const n = variant.split("-")[1];
    return n ? `Nivel ${n}` : variant;
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
