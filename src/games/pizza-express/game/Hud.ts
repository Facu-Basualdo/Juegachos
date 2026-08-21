import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

// A pizza slice token (warm) and a shield token (cool, deliberately distinct so
// the one-time presentation shield reads apart from the miss pizzas).
const PIZZA_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 20a1.6 1.6 0 0 1-1.9 2.3L12 20 3.9 22.3A1.6 1.6 0 0 1 2 20Z" fill="#f2b134" stroke="#8a5a2b" stroke-width="1.6" stroke-linejoin="round"/><circle cx="9.5" cy="15.5" r="1.5" fill="#a8281c"/><circle cx="14" cy="17" r="1.4" fill="#a8281c"/><circle cx="12" cy="11.5" r="1.3" fill="#a8281c"/></svg>`;
const SHIELD_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 5v6c0 5-3.4 8.7-8 11-4.6-2.3-8-6-8-11V5Z" fill="#6fbfe8" stroke="#2c6f9e" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.5 12l2.4 2.4 4.6-4.8" fill="none" stroke="#effaff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// A little mailbox token (skipped-customer lives): arched box on a post, red flag up.
const MAILBOX_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="10.8" y="14" width="2.4" height="8" fill="#8a5a2b"/><path d="M4 15v-5.5C4 6.5 6.5 4 9.5 4h5C17.5 4 20 6.5 20 9.5V15Z" fill="#f2e4c4" stroke="#8a5a2b" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="1.7" fill="#d83a2b"/><path d="M18 4.5V1.5h3.6v2.6H18" fill="#d83a2b"/><path d="M18 1.5v6" stroke="#a8281c" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** DOM overlay: live score + combo, best, the miss-token strip (shield + pizzas),
 *  the tutorial thought bubble, start / game-over screens, countdown and the
 *  leaderboard. */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly tokensEl: HTMLDivElement;
  private readonly shieldTok: HTMLSpanElement;
  private readonly pizzaToks: HTMLSpanElement[] = [];
  private readonly mailToks: HTMLSpanElement[] = [];
  private readonly bubbleEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement, onActivate: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "hud__score";
    this.scoreEl.textContent = "0";

    this.comboEl = document.createElement("div");
    this.comboEl.className = "hud__combo";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "hud__best";

    hud.append(this.scoreEl, this.comboEl, this.bestEl);

    // Miss-token strip: shield + 3 pizzas (errant throws) + 5 mailboxes
    // (skipped customers).
    this.tokensEl = document.createElement("div");
    this.tokensEl.className = "tokens";
    this.shieldTok = document.createElement("span");
    this.shieldTok.className = "token token--shield";
    this.shieldTok.innerHTML = SHIELD_SVG;
    this.tokensEl.append(this.shieldTok);
    for (let i = 0; i < 3; i++) {
      const t = document.createElement("span");
      t.className = "token token--pizza";
      t.innerHTML = PIZZA_SVG;
      this.pizzaToks.push(t);
      this.tokensEl.append(t);
    }
    for (let i = 0; i < 5; i++) {
      const t = document.createElement("span");
      t.className = i === 0 ? "token token--mail token--divide" : "token token--mail";
      t.innerHTML = MAILBOX_SVG;
      this.mailToks.push(t);
      this.tokensEl.append(t);
    }

    // Character thought bubble (tutorial hints).
    this.bubbleEl = document.createElement("div");
    this.bubbleEl.className = "bubble";

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
    this.hintEl.innerHTML = "<b>&larr; &rarr;</b> / <b>A D</b> para esquivar &nbsp;·&nbsp; <b>ESPACIO</b> / <b>W</b> / <b>&uarr;</b> para lanzar la pizza";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    container.append(hud, this.tokensEl, this.bubbleEl, this.overlayEl, this.countdownEl);

    const activate = (e: Event): void => {
      e.preventDefault();
      onActivate();
    };
    this.overlayEl.addEventListener("pointerdown", activate);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "Enter") onActivate();
    });
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setCombo(combo: number): void {
    if (combo > 1) {
      this.comboEl.textContent = `COMBO x${combo}`;
      this.comboEl.classList.add("is-shown");
    } else {
      this.comboEl.classList.remove("is-shown");
    }
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `MEJOR: ${best}` : "";
  }

  /** Shows the miss allowances: the shield, pizzas (errant throws) remaining and
   *  mailboxes (skippable customers) remaining. */
  setTokens(shieldActive: boolean, pizzasLeft: number, customersLeft: number): void {
    this.shieldTok.classList.toggle("is-spent", !shieldActive);
    for (let i = 0; i < this.pizzaToks.length; i++) {
      this.pizzaToks[i].classList.toggle("is-spent", i >= pizzasLeft);
    }
    for (let i = 0; i < this.mailToks.length; i++) {
      this.mailToks[i].classList.toggle("is-spent", i >= customersLeft);
    }
  }

  showTokens(show: boolean): void {
    this.tokensEl.classList.toggle("hidden", !show);
  }

  /** Shows a tutorial thought bubble above the character, or hides it when null. */
  showBubble(text: string | null): void {
    if (text === null) {
      this.bubbleEl.classList.remove("is-shown");
      return;
    }
    if (this.bubbleEl.textContent === text && this.bubbleEl.classList.contains("is-shown")) return;
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.add("is-shown");
  }

  /** Shows a countdown label ("3" / "2" / "1" / "YA"), or hides it when null. */
  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    void this.countdownEl.offsetWidth; // reflow so the pop animation restarts
    this.countdownEl.classList.add("is-shown");
  }

  showStart(): void {
    this.titleEl.textContent = "PIZZA EXPRESS";
    this.subtitleEl.textContent = "presioná ENTER para arrancar";
    this.scoreLineEl.textContent = "";
    this.hintEl.style.display = "block";
    this.comboEl.classList.remove("is-shown");
    this.showTokens(false);
    this.showBubble(null);
    this.leaderboard.clear();
    this.overlayEl.classList.remove("hidden");
  }

  /** Global ranking on the game-over screen. */
  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  showGameOver(score: number, best: number, crashed: boolean): void {
    this.titleEl.textContent = crashed ? "¡TE ESTRELLASTE!" : "¡PERDISTE MUCHOS PEDIDOS!";
    this.subtitleEl.textContent = "presioná ENTER para repartir de nuevo";
    this.scoreLineEl.textContent = score >= best && score > 0 ? `PUNTAJE: ${score} — ¡NUEVO RÉCORD!` : `PUNTAJE: ${score}  ·  MEJOR: ${best}`;
    this.hintEl.style.display = "none";
    this.comboEl.classList.remove("is-shown");
    this.showTokens(false);
    this.showBubble(null);
    this.overlayEl.classList.remove("hidden");
  }

  hide(): void {
    this.overlayEl.classList.add("hidden");
  }
}
