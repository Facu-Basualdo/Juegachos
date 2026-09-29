import { GAME_DURATION, VISIBLE_WORDS } from "./constants";
import type { TypingResult } from "./Game";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export class Hud {
  // HUD top bar
  private readonly hudBar: HTMLDivElement;
  private readonly timeEl: HTMLDivElement;
  private readonly wpmEl: HTMLDivElement;
  private readonly accuracyEl: HTMLDivElement;

  // Typing surface
  private readonly stage: HTMLDivElement;
  private readonly streamEl: HTMLDivElement;

  // Overlays
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly ratingEl: HTMLDivElement;
  private readonly tableContainerEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  // Countdown
  private readonly countdownEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    // --- HUD top bar ---
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.timeEl = document.createElement("div");
    this.timeEl.className = "hud-bar__stat hud-bar__time";

    this.wpmEl = document.createElement("div");
    this.wpmEl.className = "hud-bar__stat";

    this.accuracyEl = document.createElement("div");
    this.accuracyEl.className = "hud-bar__stat";

    this.hudBar.append(this.timeEl, this.wpmEl, this.accuracyEl);

    // --- Typing stage ---
    this.stage = document.createElement("div");
    this.stage.className = "type-stage hidden";

    this.streamEl = document.createElement("div");
    this.streamEl.className = "type-stream";
    this.stage.append(this.streamEl);

    // --- Overlay (start / game over) ---
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.ratingEl = document.createElement("div");
    this.ratingEl.className = "overlay__rating";

    this.tableContainerEl = document.createElement("div");
    this.tableContainerEl.className = "overlay__table-container";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(
      this.titleEl,
      this.subtitleEl,
      this.scoreLineEl,
      this.ratingEl,
      this.tableContainerEl,
      this.hintEl
    );
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("mecano").follow(this.leaderboard);
    this.leaderboard.clear();

    // --- Countdown ---
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(this.stage, this.hudBar, this.overlayEl, this.countdownEl);
  }

  showStart(bestWpm: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");

    this.titleEl.textContent = "MECANO";
    this.subtitleEl.textContent =
      "Escribi la mayor cantidad de palabras en 30 segundos. Se puntua por PPM (palabras por minuto).";

    if (bestWpm !== null) {
      this.scoreLineEl.textContent = `MEJOR: ${bestWpm} PPM`;
      this.scoreLineEl.style.display = "block";
    } else {
      this.scoreLineEl.textContent = "";
      this.scoreLineEl.style.display = "none";
    }

    this.ratingEl.style.display = "none";
    this.tableContainerEl.innerHTML = "";
    this.tableContainerEl.style.display = "none";

    this.hintEl.textContent = "presiona ENTER para comenzar";

    this.leaderboard.clear();
  }

  /** Muestra el ranking global (mayor PPM = mejor) al terminar. */
  showRanking(gameId: string, wpm: number): void {
    void this.leaderboard.render(gameId, { score: wpm });
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
    void this.countdownEl.offsetWidth; // reflow to restart animation
    this.countdownEl.classList.add("is-shown");
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showPlay(): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.remove("hidden");
    this.stage.classList.remove("hidden");
  }

  updateStats(timeLeft: number, wpm: number, accuracy: number): void {
    this.timeEl.textContent = `${Math.ceil(timeLeft)}s`;
    this.timeEl.classList.toggle("is-urgent", timeLeft <= 5);
    this.wpmEl.textContent = `${wpm} PPM`;
    this.accuracyEl.textContent = `${accuracy}% PRECISION`;
  }

  renderStream(words: string[], currentIndex: number, typedInput: string): void {
    this.streamEl.innerHTML = "";
    const end = Math.min(words.length, currentIndex + VISIBLE_WORDS);

    for (let wi = currentIndex; wi < end; wi++) {
      const word = words[wi];
      const wordEl = document.createElement("span");
      wordEl.className = "word";

      if (wi === currentIndex) {
        wordEl.classList.add("word--current");

        for (let j = 0; j < word.length; j++) {
          if (j === typedInput.length) wordEl.append(this.makeCaret());
          const ch = document.createElement("span");
          ch.className = "char";
          ch.textContent = word[j];
          if (j < typedInput.length) {
            ch.classList.add(typedInput[j] === word[j] ? "char--correct" : "char--incorrect");
          }
          wordEl.append(ch);
        }

        // Extra characters typed past the word length.
        for (let k = word.length; k < typedInput.length; k++) {
          const ch = document.createElement("span");
          ch.className = "char char--extra";
          ch.textContent = typedInput[k];
          wordEl.append(ch);
        }

        if (typedInput.length >= word.length) wordEl.append(this.makeCaret());
      } else {
        wordEl.textContent = word;
      }

      this.streamEl.append(wordEl);
      this.streamEl.append(document.createTextNode(" "));
    }
  }

  private makeCaret(): HTMLSpanElement {
    const caret = document.createElement("span");
    caret.className = "caret";
    return caret;
  }

  showGameOver(result: TypingResult, isNewBest: boolean, bestWpm: number): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "¡NUEVO RECORD!" : "RESULTADOS";
    this.subtitleEl.textContent = `Escribiste durante ${GAME_DURATION} segundos.`;

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `${result.wpm} PPM`;

    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = this.getRatingLabel(result.wpm);
    this.ratingEl.className = `overlay__rating rating-${this.getRatingClass(result.wpm)}`;

    // Summary table
    this.tableContainerEl.style.display = "block";
    this.tableContainerEl.innerHTML = "";
    const table = document.createElement("table");
    table.className = "results-table";
    const rows: [string, string][] = [
      ["Palabras por minuto", `${result.wpm} PPM`],
      ["Precision", `${result.accuracy}%`],
      ["Palabras correctas", `${result.correctWords}`],
    ];
    for (const [label, value] of rows) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = label;
      const td2 = document.createElement("td");
      td2.textContent = value;
      tr.append(td1, td2);
      table.append(tr);
    }
    this.tableContainerEl.append(table);

    this.hintEl.textContent = `presiona ENTER para volver a jugar · mejor: ${bestWpm} PPM`;
  }

  private getRatingLabel(wpm: number): string {
    if (wpm >= 80) return "Dedos de rayo";
    if (wpm >= 60) return "Veloz";
    if (wpm >= 40) return "Agil";
    if (wpm >= 20) return "En camino";
    return "Principiante";
  }

  private getRatingClass(wpm: number): string {
    if (wpm >= 80) return "divine";
    if (wpm >= 60) return "ultra";
    if (wpm >= 40) return "fast";
    if (wpm >= 20) return "average";
    return "slow";
  }
}
