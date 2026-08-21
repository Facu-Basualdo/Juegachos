import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { ANSWER_URGENT_MS, MODES, type Mode } from "./constants";

export interface Handlers {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onPickMode: (mode: Mode) => void;
}

/**
 * Capa DOM del juego: barra superior (modo / nivel / record), el "escenario"
 * donde aparece y se esfuma el numero, la grilla de ingreso, el teclado, el
 * countdown y el overlay de inicio / fin (selector de modo + ranking global).
 */
export class Hud {
  private readonly hudBar: HTMLDivElement;
  private readonly modeChip: HTMLDivElement;
  private readonly levelEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;

  private readonly stage: HTMLDivElement;
  private readonly numberEl: HTMLDivElement;
  private readonly entryEl: HTMLDivElement;
  private readonly feedbackEl: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  private readonly timerFillEl: HTMLDivElement;
  private readonly timerTextEl: HTMLDivElement;

  private readonly keypad: HTMLDivElement;

  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly modesEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly modeButtons = new Map<Mode, { best: HTMLElement }>();

  private readonly countdownEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  // Para reajustar el tamaño al rotar / cambiar de tamaño la ventana.
  private shownLen = 0;
  private entryDigits = 0;

  constructor(container: HTMLElement, handlers: Handlers) {
    // Barra superior
    this.hudBar = el("div", "nm-hud hidden");
    this.modeChip = el("div", "nm-hud__mode");
    this.levelEl = el("div", "nm-hud__level");
    this.bestEl = el("div", "nm-hud__best");
    this.hudBar.append(this.modeChip, this.levelEl, this.bestEl);

    // Escenario
    this.stage = el("div", "nm-stage hidden");
    this.numberEl = el("div", "nm-number");
    this.entryEl = el("div", "nm-entry");
    this.feedbackEl = el("div", "nm-feedback");

    // Reloj de la respuesta: mecha que se consume + segundos restantes.
    this.timerEl = el("div", "nm-timer");
    this.timerFillEl = el("div", "nm-timer__fill");
    this.timerTextEl = el("div", "nm-timer__text");
    const timerTrack = el("div", "nm-timer__track");
    timerTrack.append(this.timerFillEl);
    this.timerEl.append(timerTrack, this.timerTextEl);

    this.stage.append(this.numberEl, this.entryEl, this.timerEl, this.feedbackEl);

    // Teclado en pantalla (layout calculadora)
    this.keypad = el("div", "nm-keypad hidden");
    const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "back", "0", "ok"];
    for (const k of keys) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (k === "back") {
        btn.className = "nm-key nm-key--back";
        btn.setAttribute("aria-label", "Borrar");
        btn.innerHTML = backIcon();
        btn.addEventListener("click", () => handlers.onBackspace());
      } else if (k === "ok") {
        btn.className = "nm-key nm-key--ok";
        btn.textContent = "OK";
        btn.addEventListener("click", () => handlers.onSubmit());
      } else {
        btn.className = "nm-key";
        btn.textContent = k;
        btn.addEventListener("click", () => handlers.onDigit(k));
      }
      this.keypad.append(btn);
    }

    // Countdown
    this.countdownEl = el("div", "countdown");

    // Overlay inicio / fin
    this.overlayEl = el("div", "overlay");
    this.titleEl = el("div", "overlay__title");
    this.subtitleEl = el("div", "overlay__subtitle");
    this.modesEl = el("div", "nm-modes");
    this.hintEl = el("div", "overlay__hint");

    for (const m of MODES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `nm-mode nm-mode--${m.id}`;
      btn.innerHTML = `
        <span class="nm-mode__icon">${modeIcon(m.id)}</span>
        <span class="nm-mode__body">
          <span class="nm-mode__label">${m.label}</span>
          <span class="nm-mode__tag">${m.tagline}</span>
        </span>
        <span class="nm-mode__best">RÉCORD<b>—</b></span>
      `;
      btn.addEventListener("click", () => handlers.onPickMode(m.id));
      this.modesEl.append(btn);
      this.modeButtons.set(m.id, { best: btn.querySelector(".nm-mode__best b")! });
    }

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.modesEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    container.append(this.hudBar, this.stage, this.keypad, this.countdownEl, this.overlayEl);

    window.addEventListener("resize", this.onResize);
  }

  private onResize = (): void => {
    if (this.shownLen > 0 && this.numberEl.textContent) this.fitNumber(this.shownLen);
    if (this.entryDigits > 0) {
      this.entryEl.style.setProperty("--nm-slot", `${this.slotSizeFor(this.entryDigits)}px`);
    }
  };

  /** Achica el número para que N dígitos entren a lo ancho (no se salga de los bordes). */
  private fitNumber(len: number): void {
    this.shownLen = len;
    const avail = Math.min(window.innerWidth * 0.9, 720);
    let size = avail / (len * 0.72);
    size = Math.max(22, Math.min(size, 108));
    this.numberEl.style.fontSize = `${size}px`;
    this.numberEl.style.letterSpacing = `${Math.max(1, size * 0.09)}px`;
  }

  /** Tamaño de cada slot para que entren en una fila (o hagan wrap si no caben). */
  private slotSizeFor(count: number): number {
    const avail = Math.min(window.innerWidth * 0.92, 640);
    const gap = 10;
    const w = (avail - gap * (count - 1)) / count;
    return Math.max(24, Math.min(w, 58));
  }

  // ---------- Inicio / fin ----------

  showStart(bests: Record<Mode, number | null>): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");
    this.keypad.classList.add("hidden");
    this.timerEl.classList.remove("is-shown");

    this.titleEl.textContent = "NÚMERO FUGAZ";
    this.subtitleEl.textContent = "Memorizá el número, y cuando se esfume, escribilo. Elegí un modo:";
    this.modesEl.classList.remove("hidden");
    this.updateModeBests(bests);
    this.hintEl.textContent = "tocá un modo · o ENTER para el último";
    this.leaderboard.clear();
  }

  showGameOver(mode: Mode, score: number, bests: Record<Mode, number | null>, isNewBest: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");
    this.keypad.classList.add("hidden");
    this.timerEl.classList.remove("is-shown");

    const label = MODES.find((m) => m.id === mode)?.label ?? "";
    this.titleEl.textContent = isNewBest ? "¡NUEVO RÉCORD!" : "SE ESFUMÓ";
    this.subtitleEl.textContent =
      score > 0
        ? `${label}: recordaste ${score} dígito${score === 1 ? "" : "s"} de corrido.`
        : `${label}: no llegaste a ninguno esta vez.`;
    this.modesEl.classList.remove("hidden");
    this.updateModeBests(bests);
    this.hintEl.textContent = "elegí un modo para jugar de nuevo";
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  private updateModeBests(bests: Record<Mode, number | null>): void {
    for (const m of MODES) {
      const ref = this.modeButtons.get(m.id);
      if (ref) ref.best.textContent = bests[m.id] !== null ? String(bests[m.id]) : "—";
    }
  }

  /** Ranking global (mas digitos = mejor), por modo (variant). */
  showRanking(gameId: string, score: number, mode: Mode): void {
    void this.leaderboard.render(gameId, { score, variant: mode });
  }

  // ---------- Juego ----------

  startPlayUi(mode: Mode, digits: number, best: number | null): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.remove("hidden");
    this.stage.classList.remove("hidden");
    this.modeChip.textContent = MODES.find((m) => m.id === mode)?.label ?? "";
    this.setLevel(digits);
    this.setBest(best);
    this.numberEl.textContent = "";
    this.entryEl.innerHTML = "";
    this.feedbackEl.textContent = "";
    this.feedbackEl.className = "nm-feedback";
    this.keypad.classList.add("hidden");
    this.timerEl.classList.remove("is-shown");
  }

  setLevel(digits: number): void {
    this.levelEl.innerHTML = `DÍGITOS<b>${digits}</b>`;
  }

  setBest(best: number | null): void {
    this.bestEl.innerHTML = best !== null ? `RÉCORD<b>${best}</b>` : "RÉCORD<b>—</b>";
  }

  showNumber(numStr: string): void {
    this.feedbackEl.textContent = "";
    this.feedbackEl.className = "nm-feedback";
    this.entryEl.innerHTML = "";
    this.entryEl.classList.remove("is-shown");
    this.keypad.classList.add("hidden");
    this.timerEl.classList.remove("is-shown");

    this.numberEl.textContent = numStr;
    this.numberEl.className = "nm-number";
    this.fitNumber(numStr.length);
    void this.numberEl.offsetWidth;
    this.numberEl.classList.add("is-shown");
  }

  vanishNumber(): void {
    this.numberEl.classList.add("is-vanishing");
  }

  showEntry(digits: number): void {
    this.numberEl.className = "nm-number";
    this.numberEl.textContent = "";
    this.entryDigits = digits;
    this.entryEl.style.setProperty("--nm-slot", `${this.slotSizeFor(digits)}px`);
    this.renderEntry("", digits);
    this.entryEl.classList.add("is-shown");
    this.keypad.classList.remove("hidden");
    this.timerEl.classList.add("is-shown");
  }

  /** Reloj de la respuesta: `msLeft` de `totalMs`. Solo se ve en la fase de ingreso. */
  setAnswerTime(msLeft: number, totalMs: number): void {
    const frac = totalMs > 0 ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
    this.timerFillEl.style.width = `${frac * 100}%`;
    this.timerTextEl.textContent = `${Math.ceil(msLeft / 1000)}s`;
    this.timerEl.classList.toggle("is-urgent", msLeft <= ANSWER_URGENT_MS);
  }

  renderEntry(typed: string, digits: number): void {
    this.entryEl.innerHTML = "";
    for (let i = 0; i < digits; i++) {
      const slot = el("div", "nm-slot");
      if (i < typed.length) {
        slot.textContent = typed[i];
        slot.classList.add("is-filled");
      } else if (i === typed.length) {
        slot.classList.add("is-active");
      }
      this.entryEl.append(slot);
    }
  }

  showCorrect(numStr: string): void {
    this.keypad.classList.add("hidden");
    this.timerEl.classList.remove("is-shown");
    this.entryEl.classList.remove("is-shown");
    this.entryEl.innerHTML = "";
    this.numberEl.textContent = numStr;
    this.numberEl.className = "nm-number is-shown is-correct";
    this.fitNumber(numStr.length);
    this.feedbackEl.textContent = "¡Bien!";
    this.feedbackEl.className = "nm-feedback is-correct";
  }

  showWrong(target: string, typed: string): void {
    this.keypad.classList.add("hidden");
    this.timerEl.classList.remove("is-shown");
    this.entryEl.classList.remove("is-shown");
    this.entryEl.innerHTML = "";
    this.numberEl.textContent = target;
    this.numberEl.className = "nm-number is-shown is-wrong";
    this.fitNumber(target.length);
    this.feedbackEl.innerHTML = `era <b>${target}</b>${typed ? ` · pusiste <s>${typed}</s>` : ""}`;
    this.feedbackEl.className = "nm-feedback is-wrong";
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

function backIcon(): string {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 6 L3 12 L9 18 H20 a1 1 0 0 0 1 -1 V7 a1 1 0 0 0 -1 -1 Z" />
    <line x1="12" y1="10" x2="16" y2="14" /><line x1="16" y1="10" x2="12" y2="14" />
  </svg>`;
}

function modeIcon(mode: Mode): string {
  if (mode === "escalera") {
    // Escalones ascendentes.
    return `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      <rect x="3" y="16" width="5" height="5" rx="1" />
      <rect x="9.5" y="11" width="5" height="10" rx="1" />
      <rect x="16" y="6" width="5" height="15" rx="1" />
    </svg>`;
  }
  // Dado (aleatorio).
  return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="15" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="9" cy="15" r="1.4" fill="currentColor" stroke="none" />
  </svg>`;
}
