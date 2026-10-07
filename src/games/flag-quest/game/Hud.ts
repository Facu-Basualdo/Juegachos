import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { ANSWER_URGENT_MS, SOLO_LIVES, type Question } from "./constants";
import { flagUrl } from "./flags";
import type { Country } from "./countries";
import { Friar, type FriarMood } from "./Friar";

export interface HudOptions {
  onPick: (code: string) => void;
  isRoom: boolean;
}

/** Rosa de los vientos de ocho puntas, el ornamento del atlas (SVG en linea, sin assets). */
function compassRose(cls: string): string {
  const long = "M50 4 L56 44 L50 50 L44 44 Z";
  const short = "M50 18 L54 46 L50 50 L46 46 Z";
  const rot = (d: string, deg: number) => `<path d="${d}" transform="rotate(${deg} 50 50)"/>`;
  const longs = [0, 90, 180, 270].map((a) => rot(long, a)).join("");
  const shorts = [45, 135, 225, 315].map((a) => rot(short, a)).join("");
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="0.6"/>
    <g class="rose-short" fill="currentColor" opacity="0.55">${shorts}</g>
    <g class="rose-long" fill="currentColor">${longs}</g>
    <circle cx="50" cy="50" r="3" fill="var(--paper)" stroke="currentColor" stroke-width="1.2"/>
  </svg>`;
}

const NUMERALS = ["I", "II", "III", "IV"];

export class Hud {
  private readonly topBar: HTMLDivElement;
  private readonly progressEl: HTMLDivElement;
  private readonly livesEl: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;

  private readonly stage: HTMLDivElement;
  private readonly plateEl: HTMLDivElement;
  private readonly friar = new Friar();
  private readonly flagImg: HTMLImageElement;
  private readonly stampEl: HTMLDivElement;
  private readonly scaleEl: HTMLDivElement;
  private readonly scaleSpentEl: HTMLDivElement;
  private readonly optionsEl: HTMLDivElement;
  private readonly optionBtns: HTMLButtonElement[] = [];
  private current: Question | null = null;

  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();
  private readonly isRoom: boolean;

  constructor(container: HTMLElement, opts: HudOptions) {
    this.isRoom = opts.isRoom;

    // --- Barra superior ---
    this.topBar = document.createElement("div");
    this.topBar.className = "fq-topbar hidden";
    this.progressEl = document.createElement("div");
    this.progressEl.className = "fq-topbar__progress";
    this.livesEl = document.createElement("div");
    this.livesEl.className = "fq-topbar__lives";
    this.livesEl.setAttribute("aria-label", "Vidas");
    for (let i = 0; i < SOLO_LIVES; i++) {
      const life = document.createElement("span");
      life.className = "fq-life";
      life.innerHTML = compassRose("fq-life__rose");
      this.livesEl.append(life);
    }
    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "fq-topbar__score";
    this.topBar.append(this.progressEl, this.livesEl, this.scoreEl);

    // --- Escenario: lamina con la bandera, escala del reloj y opciones ---
    this.stage = document.createElement("div");
    this.stage.className = "fq-stage hidden";

    this.plateEl = document.createElement("div");
    this.plateEl.className = "fq-plate";
    this.flagImg = document.createElement("img");
    this.flagImg.className = "fq-plate__flag";
    this.flagImg.alt = "Bandera a adivinar";
    this.flagImg.draggable = false;
    this.stampEl = document.createElement("div");
    this.stampEl.className = "fq-stamp";
    this.plateEl.append(this.flagImg, this.stampEl);

    this.scaleEl = document.createElement("div");
    this.scaleEl.className = "fq-scale";
    const track = document.createElement("div");
    track.className = "fq-scale__track";
    this.scaleSpentEl = document.createElement("div");
    this.scaleSpentEl.className = "fq-scale__spent";
    track.append(this.scaleSpentEl);
    const ticks = document.createElement("div");
    ticks.className = "fq-scale__ticks";
    for (let s = 0; s <= 5; s++) {
      const t = document.createElement("span");
      t.textContent = String(s);
      ticks.append(t);
    }
    this.scaleEl.append(track, ticks);

    this.optionsEl = document.createElement("div");
    this.optionsEl.className = "fq-options";
    for (let i = 0; i < 4; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fq-option";
      const num = document.createElement("span");
      num.className = "fq-option__num";
      num.textContent = NUMERALS[i];
      const name = document.createElement("span");
      name.className = "fq-option__name";
      btn.append(num, name);
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
      btn.addEventListener("click", () => {
        const code = btn.dataset.code;
        if (code) opts.onPick(code);
      });
      this.optionBtns.push(btn);
      this.optionsEl.append(btn);
    }

    // El fraile se dibuja en el margen de la lamina (al costado en compu, asomado
    // por arriba en el celu): va adentro de un contenedor posicionado con ella.
    const board = document.createElement("div");
    board.className = "fq-board";
    board.append(this.friar.el, this.plateEl);
    this.stage.append(board, this.scaleEl, this.optionsEl);

    // --- Overlay de inicio / fin ---
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "fq-overlay";
    const ornament = document.createElement("div");
    ornament.className = "fq-overlay__ornament";
    ornament.innerHTML = compassRose("fq-overlay__rose");
    this.titleEl = document.createElement("div");
    this.titleEl.className = "fq-overlay__title";
    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "fq-overlay__subtitle";
    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "fq-overlay__score";
    this.detailEl = document.createElement("div");
    this.detailEl.className = "fq-overlay__detail";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "fq-overlay__hint";
    this.overlayEl.append(
      ornament,
      this.titleEl,
      this.subtitleEl,
      this.scoreLineEl,
      this.detailEl,
      this.hintEl,
    );
    this.leaderboard.mount(this.overlayEl);
    new HowToPanel("flag-quest").follow(this.leaderboard);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "fq-countdown";

    container.append(this.topBar, this.stage, this.overlayEl, this.countdownEl);
  }

  // ---------- Pantallas ----------

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.topBar.classList.add("hidden");
    this.stage.classList.add("hidden");
    this.titleEl.textContent = "FlagQuest";
    this.subtitleEl.textContent = this.isRoom
      ? "Atlas de banderas del mundo. Quince láminas, las mismas para todos: cuatro nombres y cinco segundos para cada una."
      : "Atlas de banderas del mundo. Cuatro nombres y cinco segundos por lámina. Tres errores y se cierra el atlas.";
    if (best !== null && !this.isRoom) {
      this.scoreLineEl.style.display = "block";
      this.scoreLineEl.textContent = `Récord: ${Math.round(best)} pts`;
    } else {
      this.scoreLineEl.style.display = "none";
    }
    this.detailEl.style.display = "none";
    this.hintEl.textContent = this.isRoom
      ? "Esperando la ronda..."
      : "Tocá la pantalla o presioná ENTER";
    this.leaderboard.clear();
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showRanking(gameId: string, score: number, variant: string): void {
    void this.leaderboard.render(gameId, { score, variant });
  }

  showTopBar(progress: string, score: number, lives: number | null): void {
    this.topBar.classList.remove("hidden");
    this.progressEl.textContent = progress;
    this.scoreEl.textContent = `${score} pts`;
    this.livesEl.classList.toggle("hidden", lives === null);
    if (lives !== null) {
      [...this.livesEl.children].forEach((el, i) => el.classList.toggle("is-lost", i >= lives));
    }
  }

  clearQuestion(): void {
    this.stage.classList.add("hidden");
    this.current = null;
  }

  showQuestion(q: Question): void {
    this.current = q;
    this.stage.classList.remove("hidden");
    this.flagImg.src = flagUrl(q.answer.code);
    this.plateEl.classList.remove("is-revealed");
    this.stampEl.className = "fq-stamp";
    this.stampEl.textContent = "";
    // Reinicia la animacion de entrada de la lamina.
    this.plateEl.classList.remove("is-new");
    void this.plateEl.offsetWidth;
    this.plateEl.classList.add("is-new");

    q.options.forEach((c: Country, i) => {
      const btn = this.optionBtns[i];
      btn.dataset.code = c.code;
      btn.className = "fq-option";
      btn.disabled = false;
      (btn.lastElementChild as HTMLElement).textContent = c.name;
    });
    this.setTime(1, 1);
  }

  /** Escala del reloj: `msLeft` de `totalMs`. Lo gastado se cubre de derecha a izquierda. */
  setTime(msLeft: number, totalMs: number): void {
    const frac = Math.max(0, Math.min(1, msLeft / totalMs));
    this.scaleSpentEl.style.width = `${(1 - frac) * 100}%`;
    const urgent = msLeft <= ANSWER_URGENT_MS && msLeft < totalMs;
    this.scaleEl.classList.toggle("is-urgent", urgent);
    this.friar.setUrgent(urgent);
  }

  setFriar(mood: FriarMood): void {
    this.friar.setMood(mood);
  }

  /** Marca la correcta, tacha la elegida si era otra y sella la lamina. */
  showFeedback(q: Question, picked: string | null, gained: number): void {
    if (this.current !== q) this.showQuestion(q);
    const correct = picked === q.answer.code;
    for (const btn of this.optionBtns) {
      btn.disabled = true;
      const code = btn.dataset.code;
      if (code === q.answer.code) btn.classList.add("is-correct");
      else if (code === picked) btn.classList.add("is-wrong");
      else btn.classList.add("is-dim");
    }
    this.setTime(0, 1);
    this.scaleEl.classList.remove("is-urgent");
    this.plateEl.classList.add("is-revealed");
    this.stampEl.className = `fq-stamp is-shown ${correct ? "fq-stamp--ok" : "fq-stamp--bad"}`;
    if (correct) this.stampEl.textContent = gained > 0 ? `+${gained}` : "Bien";
    else this.stampEl.textContent = picked === null ? "Sin tiempo" : "Errado";
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

  // ---------- Fin ----------

  showGameOver(score: number, hits: number, total: number, isNewBest: boolean, best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.topBar.classList.add("hidden");
    this.stage.classList.add("hidden");
    this.titleEl.textContent = isNewBest ? "¡Nuevo récord!" : "Atlas cerrado";
    this.subtitleEl.textContent = `Reconociste ${hits} de ${total} ${total === 1 ? "bandera" : "banderas"}.`;
    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `${score} pts`;
    this.detailEl.style.display = "none";
    const bestTxt = best !== null ? ` · récord ${Math.round(best)} pts` : "";
    this.hintEl.textContent = `Tocá o ENTER para jugar de nuevo${bestTxt}`;
  }

  showRoomResult(score: number, hits: number, total: number): void {
    this.overlayEl.classList.remove("hidden");
    this.topBar.classList.add("hidden");
    this.stage.classList.add("hidden");
    this.titleEl.textContent = "Atlas completo";
    this.subtitleEl.textContent = `Reconociste ${hits} de ${total} banderas.`;
    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `${score} pts`;
    this.detailEl.style.display = "none";
    this.hintEl.textContent = "Esperando a los demás...";
    this.leaderboard.clear();
  }
}
