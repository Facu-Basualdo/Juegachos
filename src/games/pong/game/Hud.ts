import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly score2El: HTMLDivElement;
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

    this.score2El = document.createElement("div");
    this.score2El.className = "hud__score2";
    this.score2El.textContent = "0";

    hud.append(this.scoreEl, this.score2El);

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
    this.hintEl.textContent = "flechas / W S para mover";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.overlayEl, this.countdownEl);
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

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  showScore(visible: boolean): void {
    // Solo (1 jugador): un unico marcador centrado arriba.
    this.scoreEl.classList.remove("hud__score--room");
    this.scoreEl.style.visibility = visible ? "visible" : "hidden";
    this.score2El.style.visibility = "hidden";
  }

  showScoreRoom(s1: number, s2: number): void {
    // Sala (1v1): dos marcadores simetricos, izquierda (J1) y derecha (J2).
    this.scoreEl.textContent = String(s1);
    this.score2El.textContent = String(s2);
    this.scoreEl.classList.add("hud__score--room");
    this.scoreEl.style.visibility = "visible";
    this.score2El.style.visibility = "visible";
  }

  setHintText(text: string): void {
    this.hintEl.textContent = text;
  }

  showStart(): void {
    this.titleEl.textContent = "PONG";
    this.subtitleEl.textContent = "presiona ENTER o toca para empezar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  showGameOver(score: number, best: number, score2?: number, isRoom?: boolean): void {
    if (isRoom && score2 !== undefined) {
      this.titleEl.textContent =
        score > score2 ? "GANASTE" :
        score2 > score ? "PERDISTE" : "EMPATE";
      this.subtitleEl.textContent = "presiona ENTER o toca para continuar";
      this.scoreLineEl.textContent = `${score} - ${score2}`;
    } else {
      this.titleEl.textContent = "GAME OVER";
      this.subtitleEl.textContent = "presiona ENTER o toca para reintentar";
      this.scoreLineEl.textContent =
        score >= best && score > 0
          ? `PUNTAJE: ${score} — NUEVO MEJOR!`
          : `PUNTAJE: ${score}  ·  MEJOR: ${best}`;
    }
    this.hintEl.style.display = "none";
    this.overlayEl.classList.remove("hidden");
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
