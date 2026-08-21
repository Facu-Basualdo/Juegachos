import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { ANSWER_URGENT_MS } from "./constants";

export type KeyInput = string; // "0".."9" | "del" | "ok"

export interface HudHandlers {
  onKey: (key: KeyInput) => void;
}

const MINUS = "−"; // signo menos tipografico

export class Hud {
  private readonly stage: HTMLDivElement;
  private readonly termEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;

  // Top bar
  private readonly topBar: HTMLDivElement;
  private readonly roundEl: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;

  // Input (teclado + respuesta)
  private readonly inputPanel: HTMLDivElement;
  private readonly answerEl: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  private readonly timerFillEl: HTMLDivElement;
  private readonly timerTextEl: HTMLDivElement;

  // Overlays
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  private readonly countdownEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, handlers: HudHandlers) {
    // --- Top bar ---
    this.topBar = document.createElement("div");
    this.topBar.className = "fm-topbar hidden";
    this.roundEl = document.createElement("div");
    this.roundEl.className = "fm-topbar__round";
    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "fm-topbar__score";
    this.topBar.append(this.roundEl, this.scoreEl);

    // --- Escenario central ---
    this.stage = document.createElement("div");
    this.stage.className = "fm-stage";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "fm-banner";

    this.termEl = document.createElement("div");
    this.termEl.className = "fm-term";

    // --- Panel de entrada (respuesta + teclado) ---
    this.inputPanel = document.createElement("div");
    this.inputPanel.className = "fm-input hidden";

    const prompt = document.createElement("div");
    prompt.className = "fm-input__prompt";
    prompt.textContent = "¿Cuánto suma?";

    // Reloj de la respuesta: barra que se vacia + segundos restantes.
    this.timerEl = document.createElement("div");
    this.timerEl.className = "fm-timer";
    this.timerFillEl = document.createElement("div");
    this.timerFillEl.className = "fm-timer__fill";
    this.timerTextEl = document.createElement("div");
    this.timerTextEl.className = "fm-timer__text";
    const timerTrack = document.createElement("div");
    timerTrack.className = "fm-timer__track";
    timerTrack.append(this.timerFillEl);
    this.timerEl.append(timerTrack, this.timerTextEl);

    this.answerEl = document.createElement("div");
    this.answerEl.className = "fm-input__answer";
    this.answerEl.textContent = "";

    const pad = document.createElement("div");
    pad.className = "fm-pad";
    const keys: KeyInput[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
    for (const k of keys) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fm-key";
      if (k === "del") {
        btn.classList.add("fm-key--del");
        btn.textContent = "⌫";
        btn.setAttribute("aria-label", "Borrar");
      } else if (k === "ok") {
        btn.classList.add("fm-key--ok");
        btn.textContent = "OK";
      } else {
        btn.textContent = k;
      }
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // no robar foco
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.onKey(k);
      });
      pad.append(btn);
    }

    this.inputPanel.append(prompt, this.timerEl, this.answerEl, pad);
    this.stage.append(this.bannerEl, this.termEl, this.inputPanel);

    // --- Overlay (inicio / fin) ---
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "fm-overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "fm-overlay__title";
    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "fm-overlay__subtitle";
    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "fm-overlay__score";
    this.detailEl = document.createElement("div");
    this.detailEl.className = "fm-overlay__detail";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "fm-overlay__hint";

    this.overlayEl.append(
      this.titleEl,
      this.subtitleEl,
      this.scoreLineEl,
      this.detailEl,
      this.hintEl,
    );
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    // --- Countdown ---
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "fm-countdown";

    container.append(this.topBar, this.stage, this.overlayEl, this.countdownEl);
  }

  // ---------- Inicio ----------

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.topBar.classList.add("hidden");
    this.inputPanel.classList.add("hidden");
    this.termEl.textContent = "";
    this.bannerEl.textContent = "";

    this.titleEl.textContent = "Cálculo Flash";
    this.subtitleEl.textContent =
      "Aparecen numeros de a uno, sumandose y restandose. Memorizalos y, al final, escribi el resultado. Cada ronda trae mas numeros y menos tiempo.";

    if (best !== null) {
      this.scoreLineEl.style.display = "block";
      this.scoreLineEl.textContent = `Mejor puntaje: ${Math.round(best)} pts`;
    } else {
      this.scoreLineEl.style.display = "none";
    }
    this.detailEl.style.display = "none";
    this.detailEl.textContent = "";

    this.hintEl.textContent = "ENTER o toca para empezar";
    this.leaderboard.clear();
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  // ---------- Durante la partida ----------

  showTopBar(round: number, score: number, isRoom: boolean): void {
    this.topBar.classList.remove("hidden");
    this.roundEl.textContent = isRoom ? "Ronda única" : `Ronda ${round}`;
    this.scoreEl.textContent = `${score} pts`;
  }

  /** Cartel breve al arrancar cada ronda ("Ronda N"). */
  showBanner(text: string): void {
    this.inputPanel.classList.add("hidden");
    this.termEl.textContent = "";
    this.termEl.className = "fm-term";
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add("is-shown");
  }

  /** Muestra un termino de la secuencia, o null para el hueco en blanco. */
  showTerm(term: number | null, isFirst: boolean): void {
    this.bannerEl.classList.remove("is-shown");
    this.bannerEl.textContent = "";
    this.inputPanel.classList.add("hidden");
    if (term === null) {
      this.termEl.textContent = "";
      this.termEl.className = "fm-term";
      return;
    }
    let text: string;
    let cls = "fm-term is-shown";
    if (isFirst) {
      text = String(term);
    } else if (term >= 0) {
      text = `+${term}`;
      cls += " fm-term--plus";
    } else {
      text = `${MINUS}${Math.abs(term)}`;
      cls += " fm-term--minus";
    }
    this.termEl.textContent = text;
    // Reinicia la animacion de aparicion.
    this.termEl.className = "fm-term";
    void this.termEl.offsetWidth;
    this.termEl.className = cls;
  }

  showInput(): void {
    this.bannerEl.classList.remove("is-shown");
    this.bannerEl.textContent = "";
    this.termEl.textContent = "";
    this.termEl.className = "fm-term";
    this.answerEl.textContent = "";
    this.answerEl.classList.remove("is-error");
    this.inputPanel.classList.remove("hidden");
  }

  /** Reloj de la respuesta: `msLeft` de `totalMs`. El panel lo oculta al cerrarse. */
  setAnswerTime(msLeft: number, totalMs: number): void {
    const frac = totalMs > 0 ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
    this.timerFillEl.style.width = `${frac * 100}%`;
    this.timerTextEl.textContent = `${Math.ceil(msLeft / 1000)}s`;
    this.timerEl.classList.toggle("is-urgent", msLeft <= ANSWER_URGENT_MS);
  }

  updateAnswer(value: string): void {
    this.answerEl.textContent = value;
    this.answerEl.classList.remove("is-error");
  }

  /** Feedback breve entre rondas (solitario). */
  showFeedback(correct: boolean, deltaPts: number): void {
    this.inputPanel.classList.add("hidden");
    this.termEl.textContent = correct ? `+${deltaPts}` : "";
    this.termEl.className = correct ? "fm-term fm-term--correct is-shown" : "fm-term";
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

  // ---------- Fin de partida ----------

  showGameOver(
    score: number,
    roundsCleared: number,
    correctAnswer: number,
    yourAnswer: number | null,
    isNewBest: boolean,
    best: number | null,
  ): void {
    this.overlayEl.classList.remove("hidden");
    this.topBar.classList.add("hidden");
    this.inputPanel.classList.add("hidden");
    this.termEl.textContent = "";
    this.bannerEl.textContent = "";

    this.titleEl.textContent = isNewBest ? "¡Nuevo récord!" : "Fin";
    this.subtitleEl.textContent =
      roundsCleared > 0
        ? `Superaste ${roundsCleared} ${roundsCleared === 1 ? "ronda" : "rondas"}.`
        : "No superaste ninguna ronda. ¡De nuevo!";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `${Math.round(score)} pts`;

    this.detailEl.style.display = "block";
    const your = yourAnswer === null ? "—" : String(yourAnswer);
    this.detailEl.innerHTML = `Tu respuesta: <b>${your}</b> · Correcto: <b>${correctAnswer}</b>`;

    const bestTxt = best !== null ? ` · mejor: ${Math.round(best)} pts` : "";
    this.hintEl.textContent = `ENTER o toca para jugar de nuevo${bestTxt}`;
  }

  /** Fin de la ronda de sala: cercania al resultado. */
  showRoomResult(yourAnswer: number | null, correctAnswer: number, pts: number): void {
    this.overlayEl.classList.remove("hidden");
    this.topBar.classList.add("hidden");
    this.inputPanel.classList.add("hidden");
    this.termEl.textContent = "";
    this.bannerEl.textContent = "";

    const exact = yourAnswer === correctAnswer;
    this.titleEl.textContent = exact ? "¡Exacto!" : "¡Listo!";
    this.subtitleEl.textContent = exact
      ? "Clavaste el resultado."
      : "Cuanto mas cerca, mas puntos.";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `${Math.round(pts)} pts`;

    this.detailEl.style.display = "block";
    const your = yourAnswer === null ? "—" : String(yourAnswer);
    this.detailEl.innerHTML = `Tu respuesta: <b>${your}</b> · Correcto: <b>${correctAnswer}</b>`;

    this.hintEl.textContent = "Esperando a los demas...";
    this.leaderboard.clear();
  }
}
