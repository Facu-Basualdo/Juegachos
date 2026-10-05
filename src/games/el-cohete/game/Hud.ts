import { HowToPanel } from "../../../shared/HowToPanel";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { CHIP_VALUES, MIN_BET } from "./constants";
import { seatColor } from "./Parachute";

export type MainMode = "bet" | "cancel" | "cash" | "wait" | "off";
export type MultTone = "pad" | "flight" | "cashed" | "boom";
export type StepState = "active" | "done" | "off";

/** El numero gigante mientras se vuela con fichas arriba (el paño se va). */
export interface LiveView {
  big: string;
  sub: string;
  hint: string;
  tone: "wait" | "cash" | "won";
}

export interface RivalRow {
  name: string;
  seat: number;
  chips: number;
  /** "apostó" (antes del despegue), "arriba" (sigue en vuelo), "x2.40" (se bajo), "boom" (exploto), "" (no apostó). */
  status: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");
export const fmtMult = (m: number) => `x${(Math.floor(m * 100) / 100).toFixed(2)}`;

/**
 * HUD de El Cohete (DESIGN.md "Neón Atómico"): mobiliario de casino. Marquesina con
 * bombitas para el multiplicador, paño verde con las fichas y el boton-ficha, fichitas
 * del historial y la lista de la sala. Las tablas de inicio y final llevan el ranking.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly multEl: HTMLElement;
  private readonly marquee: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly flightEl: HTMLElement;
  private readonly bankEl: HTMLElement;
  private readonly betBox: HTMLElement;
  private readonly winEl: HTMLElement;
  private readonly amountEl: HTMLInputElement;
  private readonly goBox: HTMLElement;
  private readonly goTitle: HTMLElement;
  private readonly betTitle: HTMLElement;
  private readonly mainBtn: HTMLButtonElement;
  private readonly mainLabel: HTMLElement;
  private readonly mainSub: HTMLElement;
  private readonly historyEl: HTMLElement;
  private readonly sideEl: HTMLElement;
  private readonly toastEl: HTMLDivElement;
  private readonly liveEl: HTMLDivElement;
  private readonly liveBig: HTMLElement;
  private readonly liveSub: HTMLElement;
  private readonly liveHint: HTMLElement;
  private readonly flashEl: HTMLDivElement;
  private readonly fadeEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly overlayBody: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();
  private sig: Record<string, string> = {};
  private toastTimer = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "ck";
    // Las fichas FIJAN la apuesta (no suman): tocar 250 es apostar 250. La ultima es "todo".
    const chips = [...CHIP_VALUES.map((v, i) => `<button type="button" class="ck-chip ck-chip--${i}" data-chip="${v}" aria-label="Apostar ${v}"><span>${v}</span></button>`), `<button type="button" class="ck-chip ck-chip--all" data-chip="all" aria-label="Apostar todo"><span>TODO</span></button>`].join("");
    this.root.innerHTML = `
      <div class="ck-marquee" data-tone="pad">
        <div class="ck-marquee__flight" data-k="flight">VUELO 1 / 10</div>
        <div class="ck-marquee__mult" data-k="mult">x1.00</div>
        <div class="ck-marquee__phase" data-k="phase">Hagan sus apuestas</div>
      </div>
      <div class="ck-history" aria-label="Últimos vuelos"><span class="ck-label">Historial</span><ol data-k="history"></ol></div>
      <aside class="ck-side" data-k="side"></aside>
      <div class="ck-table">
        <div class="ck-bank"><span class="ck-label">Tus fichas</span><b data-k="bank">1.000</b></div>
        <div class="ck-step ck-step--bet" data-k="betbox" data-state="active">
          <div class="ck-step__head"><span class="ck-step__n">1</span><span class="ck-step__t" data-k="bettitle">Elegí cuánto apostar</span></div>
          <div class="ck-chips">${chips}</div>
          <label class="ck-amount"><span>u otro monto</span><input type="number" inputmode="numeric" min="${MIN_BET}" step="1" placeholder="${MIN_BET}" aria-label="Monto a apostar" data-k="amount" /></label>
          <div class="ck-win" data-k="win"></div>
        </div>
        <div class="ck-step ck-step--go" data-k="gobox" data-state="active">
          <div class="ck-step__head"><span class="ck-step__n">2</span><span class="ck-step__t" data-k="gotitle">Apostá</span></div>
          <button type="button" class="ck-main" data-mode="bet"><span class="ck-main__label">Apostar</span><span class="ck-main__sub">100</span></button>
        </div>
      </div>
    `;
    const one = (k: string) => this.root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    this.multEl = one("mult");
    this.marquee = this.root.querySelector(".ck-marquee")!;
    this.phaseEl = one("phase");
    this.flightEl = one("flight");
    this.bankEl = one("bank");
    this.betBox = one("betbox");
    this.winEl = one("win");
    this.amountEl = one("amount") as HTMLInputElement;
    this.goBox = one("gobox");
    this.goTitle = one("gotitle");
    this.betTitle = one("bettitle");
    this.historyEl = one("history");
    this.sideEl = one("side");
    this.mainBtn = this.root.querySelector(".ck-main")!;
    this.mainLabel = this.root.querySelector(".ck-main__label")!;
    this.mainSub = this.root.querySelector(".ck-main__sub")!;

    this.toastEl = document.createElement("div");
    this.toastEl.className = "ck-toast";
    this.liveEl = document.createElement("div");
    this.liveEl.className = "ck-live";
    this.liveEl.innerHTML = `<div class="ck-live__big"></div><div class="ck-live__sub"></div><div class="ck-live__hint"></div>`;
    this.liveBig = this.liveEl.querySelector(".ck-live__big")!;
    this.liveSub = this.liveEl.querySelector(".ck-live__sub")!;
    this.liveHint = this.liveEl.querySelector(".ck-live__hint")!;
    this.flashEl = document.createElement("div");
    this.flashEl.className = "ck-flash";
    this.fadeEl = document.createElement("div");
    this.fadeEl.className = "ck-fade";
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "ck-overlay";
    const card = document.createElement("div");
    card.className = "ck-card";
    this.overlayBody = document.createElement("div");
    this.overlayBody.className = "ck-card__body";
    card.append(this.overlayBody);
    this.leaderboard.mount(card);
    new HowToPanel("el-cohete").follow(this.leaderboard);
    this.leaderboard.clear();
    this.overlayEl.append(card);

    // Los controles del paño no arrancan nada ni llegan al listener del container.
    this.root.querySelector(".ck-table")!.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.root.append(this.liveEl);
    container.append(this.root, this.toastEl, this.countdownEl, this.flashEl, this.fadeEl, this.overlayEl);
  }

  // ---------- Eventos del paño ----------

  /** Ficha tocada: su valor, o `Infinity` para "todo". */
  onChip(cb: (value: number) => void): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>("[data-chip]")) {
      b.addEventListener("click", () => cb(b.dataset.chip === "all" ? Infinity : Number(b.dataset.chip)));
    }
  }

  /**
   * Monto escrito a mano: cualquier numero entre la minima y las fichas. Mientras se
   * escribe se avisa cada valor (los intermedios, "2" y "25" camino a "250", tambien
   * valen: el juego los acota). Al salir del campo se reescribe acotado.
   */
  onAmount(cb: (value: number) => void): void {
    const read = () => Math.floor(Number(this.amountEl.value));
    this.amountEl.addEventListener("input", () => {
      const v = read();
      if (Number.isFinite(v) && v > 0) cb(v);
    });
    // Al salir se repinta acotado (o con la apuesta de antes si quedo vacio): -1 = sin cambio.
    this.amountEl.addEventListener("blur", () => {
      this.sig.bet = "";
      const v = read();
      cb(Number.isFinite(v) && v > 0 ? v : -1);
    });
  }

  /** Saca el foco del campo (en el celu cierra el teclado al apostar). */
  blurAmount(): void {
    if (document.activeElement === this.amountEl) this.amountEl.blur();
  }

  /** El boton principal va por pointerdown: bajarse tiene que ser instantaneo. */
  onMain(cb: (at: number) => void): void {
    this.mainBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cb(e.timeStamp);
    });
    // Teclado / lector de pantalla (Enter sobre el boton enfocado).
    this.mainBtn.addEventListener("click", (e) => {
      if (e.detail === 0) cb(e.timeStamp);
    });
  }

  // ---------- Estado ----------

  setPlaying(on: boolean): void {
    this.root.classList.toggle("ck--playing", on);
  }

  private text(key: string, value: string, el: HTMLElement): void {
    if (this.sig[key] === value) return;
    this.sig[key] = value;
    el.textContent = value;
  }

  /** Cartel grande: el multiplicador, o un texto (la cuenta para el despegue). */
  setMult(m: number | string, tone: MultTone): void {
    this.text("mult", typeof m === "string" ? m : fmtMult(m), this.multEl);
    if (typeof m === "string") m = 1;
    if (this.sig.tone !== tone) {
      this.sig.tone = tone;
      this.marquee.dataset.tone = tone;
    }
    // La marquesina se enciende mas cuanto mas alto va.
    const heat = Math.min(1, Math.log(Math.max(1, m)) / Math.log(10));
    const q = String(Math.round(heat * 20));
    if (this.sig.heat !== q) {
      this.sig.heat = q;
      this.marquee.style.setProperty("--heat", String(heat));
    }
  }

  setPhase(text: string): void {
    this.text("phase", text, this.phaseEl);
  }

  setFlight(i: number, n: number): void {
    this.text("flight", `VUELO ${i} / ${n}`, this.flightEl);
  }

  setBank(chips: number): void {
    this.text("bank", fmt(chips), this.bankEl);
  }

  /**
   * La apuesta elegida: marca la ficha que corresponde, apaga las que no alcanzan y
   * escribe lo que se gana en un ejemplo (lo que hace entender el juego de un vistazo).
   */
  setBet(amount: number, chips: number, editable: boolean): void {
    const s = `${amount}|${chips}|${editable}`;
    if (this.sig.bet === s) return;
    this.sig.bet = s;
    for (const b of this.betBox.querySelectorAll<HTMLButtonElement>("[data-chip]")) {
      const v = b.dataset.chip === "all" ? chips : Number(b.dataset.chip);
      const picked = b.dataset.chip === "all" ? amount === chips && !CHIP_VALUES.includes(amount as (typeof CHIP_VALUES)[number]) : amount === v;
      b.classList.toggle("is-picked", picked && amount > 0);
      b.disabled = !editable || v > chips || chips <= 0;
    }
    // El campo muestra la apuesta, salvo mientras se esta escribiendo en el.
    this.amountEl.disabled = !editable || chips <= 0;
    this.amountEl.max = String(Math.max(MIN_BET, chips));
    if (document.activeElement !== this.amountEl) this.amountEl.value = amount > 0 ? String(amount) : "";
    // El ejemplo explica el juego mientras se elige; despues de apostar ya no hace falta.
    this.winEl.innerHTML = amount > 0 && editable ? `Si cobrás en <b>x2</b> te llevás <b>${fmt(amount * 2)}</b>` : "";
  }

  /** Estado de cada paso del paño y el titulo del paso 2. */
  setSteps(bet: StepState, go: StepState, goTitle: string, betTitle = "Elegí cuánto apostar"): void {
    if (this.betBox.dataset.state !== bet) this.betBox.dataset.state = bet;
    if (this.goBox.dataset.state !== go) this.goBox.dataset.state = go;
    this.text("gotitle", goTitle, this.goTitle);
    this.text("bettitle", betTitle, this.betTitle);
  }

  setMain(mode: MainMode, label: string, sub: string): void {
    const s = `${mode}|${label}|${sub}`;
    if (this.sig.main === s) return;
    this.sig.main = s;
    this.mainBtn.dataset.mode = mode;
    this.mainBtn.disabled = mode === "off" || mode === "wait";
    this.mainLabel.textContent = label;
    this.mainSub.textContent = sub;
  }

  /**
   * Con fichas arriba: se va el paño (y la marquesina) y queda el numero gigante. `null`
   * lo saca y vuelve el paño.
   */
  setLive(v: LiveView | null): void {
    const on = v !== null;
    if (this.sig.live !== String(on)) {
      this.sig.live = String(on);
      this.root.classList.toggle("ck--flying", on);
    }
    if (!v) return;
    this.text("lbig", v.big, this.liveBig);
    this.text("lsub", v.sub, this.liveSub);
    this.text("lhint", v.hint, this.liveHint);
    if (this.liveEl.dataset.tone !== v.tone) this.liveEl.dataset.tone = v.tone;
  }

  pushHistory(crash: number): void {
    const li = document.createElement("li");
    li.className = crash < 1.2 ? "is-low" : crash < 2 ? "is-mid" : crash < 10 ? "is-high" : "is-gold";
    li.textContent = fmtMult(crash);
    this.historyEl.prepend(li);
    while (this.historyEl.children.length > 10) this.historyEl.lastElementChild?.remove();
  }

  clearHistory(): void {
    this.historyEl.innerHTML = "";
  }

  setBest(best: number | null): void {
    if (this.sig.side === "rivals") return;
    this.sideEl.innerHTML = `<span class="ck-label">Récord</span><b>${best === null ? "—" : fmt(best)}</b>`;
    this.sig.side = "best";
  }

  setRivals(rows: RivalRow[], me: { name: string; seat: number; chips: number; status: string } | null): void {
    const all = me ? [...rows, { ...me, me: true }] : rows;
    all.sort((a, b) => b.chips - a.chips);
    const sig = all.map((r) => `${r.name}:${r.chips}:${r.status}`).join("|");
    if (this.sig.rivals === sig) return;
    this.sig.rivals = sig;
    this.sig.side = "rivals";
    this.sideEl.innerHTML = `<span class="ck-label">La mesa</span><ol class="ck-rivals">${all
      .map((r) => {
        const st = r.status === "boom" ? `<i class="is-boom">BOOM</i>` : r.status === "arriba" || r.status === "apostó" ? `<i class="is-up">${r.status}</i>` : r.status ? `<i class="is-cash">${r.status}</i>` : "<i></i>";
        const mine = "me" in r ? " is-me" : "";
        return `<li class="${mine}"><span class="ck-dot" style="background:${seatColor(r.seat)}"></span><span class="ck-rivals__name">${escapeHtml(r.name)}</span>${st}<b>${fmt(r.chips)}</b></li>`;
      })
      .join("")}</ol>`;
  }

  toast(text: string, tone: "gold" | "danger" | "info" = "info"): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `ck-toast ck-toast--${tone}`;
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("is-shown");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("is-shown"), 1500);
  }

  flash(): void {
    this.flashEl.classList.remove("is-on");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("is-on");
  }

  /** Fundido a negro y vuelta (para volver de la altura a la plataforma). */
  fade(): void {
    this.fadeEl.classList.remove("is-on");
    void this.fadeEl.offsetWidth;
    this.fadeEl.classList.add("is-on");
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
    this.overlayBody.innerHTML = `
      <p class="ck-eyebrow">Casino · desde 1957</p>
      <h1 class="ck-logo">El Cohete</h1>
      <p class="ck-tagline">Apostá, mirá cómo sube y cobrá antes de que explote.</p>
      <ol class="ck-rules">
        <li><b>1</b><span>Elegí cuánto apostar (una ficha o el monto que quieras) y tocá <i>APOSTAR</i>. El cohete no sale hasta que apostás.</span></li>
        <li><b>2</b><span>El cohete despega y tu premio se multiplica: x1.5, x2, x5…</span></li>
        <li><b>3</b><span>Tocá la pantalla para <i>COBRAR</i> cuando quieras. Si explota antes, perdés lo apostado.</span></li>
      </ol>
      ${best !== null ? `<p class="ck-best">Récord · ${fmt(best)} fichas</p>` : ""}
      <p class="ck-hint">presioná ENTER o tocá para entrar a la mesa</p>
    `;
    this.leaderboard.clear();
  }

  showGameOver(o: { chips: number; start: number; best: number | null; isBest: boolean; bestFlight: number; room: boolean; broke: boolean }): void {
    this.overlayEl.classList.remove("hidden");
    const diff = o.chips - o.start;
    this.overlayBody.innerHTML = `
      <p class="ck-eyebrow">${o.isBest ? "Nuevo récord" : o.broke ? "Te fundiste" : "Se cierra la mesa"}</p>
      <h1 class="ck-logo ck-logo--small">${o.chips >= o.start * 3 ? "¡Saltó la banca!" : o.chips > o.start ? "Le ganaste a la casa" : o.chips === 0 ? "Sin fichas" : "La casa gana"}</h1>
      <div class="ck-final">
        <div><span class="ck-label">Fichas</span><b>${fmt(o.chips)}</b></div>
        <div><span class="ck-label">Ganancia</span><b class="${diff >= 0 ? "is-up" : "is-down"}">${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff))}</b></div>
        <div><span class="ck-label">Mejor salto</span><b>${o.bestFlight > 0 ? fmtMult(o.bestFlight) : "—"}</b></div>
      </div>
      ${o.room ? "" : `<p class="ck-hint">presioná ENTER o tocá para volver a la mesa${o.best !== null ? ` · récord ${fmt(o.best)}` : ""}</p>`}
    `;
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showRanking(score: number): void {
    void this.leaderboard.render("el-cohete", { score });
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
