import { TOTAL_ROUNDS } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { type HSV, hsvCss, textToneFor } from "./color";

export interface HudHandlers {
  onStart: () => void;
  onConfirm: () => void;
  onNext: () => void;
}

interface RoundResult {
  target: HSV;
  guess: HSV;
  pct: number;
}

type Phase = "idle" | "countdown" | "memorize" | "guess" | "reveal" | "gameover";

const TARGET_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';
const ARROW_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

export class Hud {
  private readonly handlers: HudHandlers;

  private readonly card: HTMLDivElement;
  private readonly counter: HTMLDivElement;
  private readonly brandTop: HTMLDivElement;
  private readonly brandBottom: HTMLDivElement;

  private readonly bignum: HTMLDivElement;
  private readonly bignumValue: HTMLDivElement;
  private readonly bignumLabel: HTMLDivElement;
  private readonly bignumSub: HTMLDivElement;

  private readonly slidersEl: HTMLDivElement;
  private readonly hInput: HTMLInputElement;
  private readonly sInput: HTMLInputElement;
  private readonly vInput: HTMLInputElement;

  private readonly revealBottom: HTMLDivElement;
  private readonly readoutSel: HTMLDivElement;
  private readonly readoutSelVal: HTMLDivElement;
  private readonly readoutOrig: HTMLDivElement;
  private readonly readoutOrigVal: HTMLDivElement;

  private readonly fab: HTMLButtonElement;

  private readonly countdownEl: HTMLDivElement;

  // Start
  private readonly startEl: HTMLDivElement;
  private readonly startBest: HTMLDivElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly startHint: HTMLDivElement;

  // Game over
  private readonly overEl: HTMLDivElement;
  private readonly overKicker: HTMLDivElement;
  private readonly overBig: HTMLDivElement;
  private readonly overSub: HTMLDivElement;
  private readonly overTable: HTMLDivElement;
  private readonly overBtn: HTMLButtonElement;
  private readonly overBest: HTMLDivElement;
  private readonly leaderboardMount: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();
  private guess: HSV = { h: 180, s: 60, v: 60 };

  constructor(container: HTMLElement, handlers: HudHandlers) {
    this.handlers = handlers;

    this.card = el("div", "cm-card");

    // Top row
    const top = el("div", "cm-top");
    this.counter = el("div", "cm-counter");
    this.counter.textContent = `1 / ${TOTAL_ROUNDS}`;
    this.brandTop = el("div", "cm-brand cm-brand--tr");
    this.brandTop.textContent = "Juegachos";
    top.append(this.counter, this.brandTop);

    // Big number (memorize countdown + reveal score)
    this.bignum = el("div", "cm-bignum");
    this.bignumValue = el("div", "cm-bignum__value");
    this.bignumLabel = el("div", "cm-bignum__label");
    this.bignumSub = el("div", "cm-bignum__sub");
    this.bignum.append(this.bignumValue, this.bignumLabel, this.bignumSub);

    // Sliders (H / S / B)
    this.slidersEl = el("div", "cm-sliders");
    this.hInput = this.buildSlider("cm-slider--h", 0, 360, "Matiz");
    this.sInput = this.buildSlider("cm-slider--s", 0, 100, "Saturación");
    this.vInput = this.buildSlider("cm-slider--v", 0, 100, "Brillo");
    this.slidersEl.append(
      wrapSlider(this.hInput),
      wrapSlider(this.sInput),
      wrapSlider(this.vInput),
    );

    // Reveal bottom panel (the original color)
    this.revealBottom = el("div", "cm-reveal-bottom");
    this.readoutOrig = el("div", "cm-readout cm-readout--orig");
    const origLabel = el("div", "cm-readout__label");
    origLabel.textContent = "Original";
    this.readoutOrigVal = el("div", "cm-readout__val");
    this.readoutOrig.append(origLabel, this.readoutOrigVal);
    this.revealBottom.append(this.readoutOrig);

    // Selection readout (your color) — sits in the top area
    this.readoutSel = el("div", "cm-readout cm-readout--sel");
    const selLabel = el("div", "cm-readout__label");
    selLabel.textContent = "Tu color";
    this.readoutSelVal = el("div", "cm-readout__val");
    this.readoutSel.append(selLabel, this.readoutSelVal);

    // Bottom-left brand (memorize)
    this.brandBottom = el("div", "cm-brand cm-brand--bl");
    this.brandBottom.textContent = "Juegachos";

    // Floating action button
    this.fab = document.createElement("button");
    this.fab.className = "cm-fab";
    this.fab.type = "button";
    this.fab.addEventListener("click", () => {
      if (this.phase === "guess") this.handlers.onConfirm();
      else if (this.phase === "reveal") this.handlers.onNext();
    });

    // Countdown
    this.countdownEl = el("div", "cm-countdown");

    // Start content
    this.startEl = el("div", "cm-start");
    const startKicker = el("div", "cm-kicker");
    startKicker.textContent = "Juego de memoria de color";
    const startTitle = el("h1", "cm-title");
    startTitle.textContent = "Memoria de Color";
    const startSub = el("p", "cm-lead");
    startSub.textContent =
      "Un color aparece unos segundos y desaparece. Recreálo de memoria con matiz, saturación y brillo. Tres rondas: tu puntaje es el promedio de aciertos.";
    this.startBest = el("div", "cm-best");
    this.startBtn = pill("Comenzar");
    this.startBtn.addEventListener("click", () => this.handlers.onStart());
    this.startHint = el("div", "cm-hint");
    this.startHint.textContent = "presioná ENTER o tocá Comenzar";
    this.startEl.append(startKicker, startTitle, startSub, this.startBest, this.startBtn, this.startHint);
    // Como se juega con iconos (el howTo del meta.ts). Va en la caja de inicio y no
    // siguiendo al ranking: aca el ranking vive en la caja del game over.
    new HowToPanel("color-memory").mount(this.startEl, this.startBtn);

    // Game over content
    this.overEl = el("div", "cm-gameover");
    this.overKicker = el("div", "cm-kicker");
    this.overBig = el("div", "cm-gameover__big");
    this.overSub = el("div", "cm-gameover__sub");
    this.overTable = el("div", "cm-gameover__table");
    this.overBest = el("div", "cm-best");
    this.overBtn = pill("Jugar de nuevo");
    this.overBtn.addEventListener("click", () => this.handlers.onStart());
    this.leaderboardMount = el("div", "cm-lb");
    this.overEl.append(
      this.overKicker,
      this.overBig,
      this.overSub,
      this.overTable,
      this.overBest,
      this.overBtn,
      this.leaderboardMount,
    );
    this.leaderboard.mount(this.leaderboardMount);
    this.leaderboard.clear();

    this.card.append(
      this.revealBottom,
      top,
      this.bignum,
      this.slidersEl,
      this.readoutSel,
      this.brandBottom,
      this.fab,
      this.countdownEl,
      this.startEl,
      this.overEl,
    );
    container.append(this.card);

    this.setPhase("idle");
  }

  private phase: Phase = "idle";

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.card.className = `cm-card phase-${phase}`;
  }

  private buildSlider(cls: string, min: number, max: number, label: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.className = `cm-slider__input ${cls}`;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => this.onSliderInput());
    return input;
  }

  private onSliderInput(): void {
    this.guess = {
      h: Number(this.hInput.value),
      s: Number(this.sInput.value),
      v: Number(this.vInput.value),
    };
    this.paintGuess();
  }

  private paintGuess(): void {
    const { h, s, v } = this.guess;
    this.card.style.background = hsvCss(this.guess);
    this.card.dataset.tone = textToneFor(this.guess);
    // Saturation track: gray (S0) -> full color (S100) at current h,v.
    this.sInput.style.background = `linear-gradient(to top, ${hsvCss({ h, s: 0, v })}, ${hsvCss({ h, s: 100, v })})`;
    // Brightness track: black (V0) -> full (V100) at current h,s.
    this.vInput.style.background = `linear-gradient(to top, #000, ${hsvCss({ h, s, v: 100 })})`;
  }

  // ---------- Phases ----------

  showStart(best: number | null): void {
    this.setPhase("idle");
    this.card.style.background = "";
    this.card.dataset.tone = "dark";
    if (best !== null) {
      this.startBest.textContent = `Mejor precisión · ${best.toFixed(1)}%`;
      this.startBest.style.display = "";
    } else {
      this.startBest.style.display = "none";
    }
    this.leaderboard.clear();
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.phase !== "countdown") {
      this.setPhase("countdown");
      this.card.style.background = "";
      this.card.dataset.tone = "dark";
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  showMemorize(round: number, target: HSV): void {
    this.setPhase("memorize");
    this.counter.textContent = `${round} / ${TOTAL_ROUNDS}`;
    this.card.style.background = hsvCss(target);
    this.card.dataset.tone = textToneFor(target);
    this.bignumLabel.textContent = "ms para recordar";
    this.bignumSub.textContent = "";
  }

  setMemorizeCounter(msRemaining: number): void {
    this.bignumValue.textContent = String(Math.max(0, Math.ceil(msRemaining)));
  }

  showGuess(start: HSV): void {
    this.setPhase("guess");
    this.guess = { ...start };
    this.hInput.value = String(start.h);
    this.sInput.value = String(start.s);
    this.vInput.value = String(start.v);
    // Hue track: bottom = 0deg, top = 360deg, matching the slider value so the
    // color under the thumb equals the color the value produces.
    this.hInput.style.background =
      "linear-gradient(to top, #ff0000 0%, #ffff00 16.66%, #00ff00 33.33%, #00ffff 50%, #0000ff 66.66%, #ff00ff 83.33%, #ff0000 100%)";
    this.paintGuess();
    this.fab.innerHTML = TARGET_ICON;
  }

  showReveal(round: number, guess: HSV, target: HSV, pct: number, isLast: boolean): void {
    this.setPhase("reveal");
    this.counter.textContent = `${round} / ${TOTAL_ROUNDS}`;

    // Top area shows the guess; bottom panel shows the original.
    this.card.style.background = hsvCss(guess);
    this.card.dataset.tone = textToneFor(guess);
    this.revealBottom.style.background = hsvCss(target);
    this.revealBottom.dataset.tone = textToneFor(target);

    this.bignumValue.textContent = `${pct.toFixed(0)}%`;
    this.bignumLabel.textContent = "";
    this.bignumSub.textContent = wittyLine(pct);

    this.readoutSelVal.textContent = hsvLabel(guess);
    this.readoutOrigVal.textContent = hsvLabel(target);

    this.fab.innerHTML = ARROW_ICON;
    void isLast;
  }

  showGameOver(rounds: RoundResult[], average: number, isBest: boolean, best: number): void {
    this.setPhase("gameover");
    this.card.style.background = "";
    this.card.dataset.tone = "dark";

    this.overKicker.textContent = isBest ? "Nuevo récord" : "Resultados";
    this.overBig.textContent = `${average.toFixed(1)}%`;
    this.overSub.textContent = wittyAverage(average);

    this.overTable.innerHTML = "";
    rounds.forEach((r, i) => {
      const row = el("div", "cm-result");
      const idx = el("span", "cm-result__idx");
      idx.textContent = String(i + 1);
      const sw = el("div", "cm-result__swatches");
      sw.append(swatch(r.guess), swatch(r.target));
      const pct = el("span", "cm-result__pct");
      pct.textContent = `${r.pct.toFixed(1)}%`;
      pct.style.color = pctColor(r.pct);
      row.append(idx, sw, pct);
      this.overTable.append(row);
    });

    this.overBest.textContent = `Mejor precisión · ${best.toFixed(1)}%`;
  }

  showRanking(gameId: string, average: number): void {
    void this.leaderboard.render(gameId, { score: average });
  }

  getGuess(): HSV {
    return { ...this.guess };
  }

  /** Room mode: no local restart/start pill. */
  hideStartButton(): void {
    this.startBtn.style.display = "none";
    this.startHint.style.display = "none";
    this.overBtn.style.display = "none";
  }
}

// ---------- helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function pill(text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "cm-pill";
  b.type = "button";
  b.textContent = text;
  return b;
}

function wrapSlider(input: HTMLInputElement): HTMLDivElement {
  const wrap = el("div", "cm-slider");
  wrap.append(input);
  return wrap;
}

function hsvLabel({ h, s, v }: HSV): string {
  return `H${Math.round(h)} S${Math.round(s)} B${Math.round(v)}`;
}

function swatch(hsv: HSV): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "cm-swatch";
  s.style.background = hsvCss(hsv);
  return s;
}

function pctColor(pct: number): string {
  if (pct >= 85) return "#1f9d55";
  if (pct >= 60) return "#c98a1e";
  return "#c0392b";
}

function wittyLine(pct: number): string {
  if (pct >= 92) return "Tu retina merece un premio.";
  if (pct >= 78) return "Casi lo clavás. Casi.";
  if (pct >= 60) return "Te acordabas de algo parecido.";
  if (pct >= 40) return "La confianza de quien cree que la pegó.";
  return "Tu memoria de color se tomó el día.";
}

function wittyAverage(pct: number): string {
  if (pct >= 90) return "Ojo calibrado de fábrica.";
  if (pct >= 75) return "Tenés buen ojo, de verdad.";
  if (pct >= 55) return "Ni tan tan, ni muy muy.";
  if (pct >= 35) return "Tu memoria vio otro color.";
  return "Quizás sea hora de revisar la vista.";
}
