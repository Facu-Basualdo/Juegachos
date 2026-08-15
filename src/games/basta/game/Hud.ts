import { CATEGORIES } from "./constants";
import type { BtCategoryId, BtCell, BtReject, BtState } from "./BastaTransport";

type Answers = Partial<Record<BtCategoryId, string>>;

/** Cruz de "tachar" dibujada (nada de emojis, regla del repo). */
const CROSS_SVG = `
  <svg class="bt__cross" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6 18 18M18 6 6 18"/>
  </svg>`;

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPE[c]);
}

/** Cuanto dura el cartel de transicion entre fases (sincronizado con `bt-wipe` en el CSS). */
export const TRANSITION_MS = 1400;

const STATUS_LABEL: Record<string, string> = {
  unique: "unica",
  repeated: "repetida",
  rejected: "tachada",
  empty: "vacia",
};

/**
 * Hud de Basta (estetica "hoja de cuaderno", ver DESIGN.md). Tres vistas segun la
 * fase que manda el server:
 *  - filling / grace: la hoja rayada con las 7 categorias como inputs + boton BASTA.
 *  - voting: las respuestas de todos, con un boton para tachar las ajenas. El tachado
 *    es LOCAL hasta que se confirma con el boton de accion; recien ahi viaja al server.
 *  - reveal: las mismas respuestas con su puntaje (100 / 50 / 0) y el subtotal.
 * Los estados de espera / resultados / tablero final los cubre el RoomOverlay por encima.
 *
 * Entre fase y fase se interpone un cartel de transicion (`showTransition`), para que
 * el salto de la hoja al tablero de votacion no sea un corte seco.
 */
export class Hud {
  private readonly stage: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly letterEl: HTMLElement;
  private readonly clockBar: HTMLElement;
  private readonly rosterEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly bastaBtn: HTMLButtonElement;
  private readonly wipeEl: HTMLElement;

  private fillChangeCb: () => void = () => {};
  private bastaCb: () => void = () => {};
  private voteSubmitCb: (rejects: BtReject[]) => void = () => {};

  private me = "";
  /** Que hay montado en el panel ahora, para no reconstruir los inputs en cada snapshot. */
  private panelMode: "none" | "sheet" | "voting" | "reveal" = "none";
  private sheetLetterIndex = -1;
  private votingLetterIndex = -1;
  private readonly inputs = new Map<BtCategoryId, HTMLInputElement>();

  /** Tachados marcados a mano y todavia NO enviados, como `${target}|${category}`. */
  private readonly pendingRejects = new Set<string>();
  /** Ya confirmo su voto en esta letra (el server ignora un segundo envio). */
  private voteSent = false;

  private wipeTimer = 0;

  private clockRaf = 0;
  private clockAnchor = 0;
  private clockMs = 0;
  private clockTotal = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "bt";
    wrap.innerHTML = `
      <div class="bt__stage" hidden>
        <div class="bt__topbar">
          <div class="bt__letter" aria-label="letra"></div>
          <div class="bt__clock"><div class="bt__clock-bar"></div></div>
          <div class="bt__roster"></div>
        </div>
        <div class="bt__banner" hidden></div>
        <div class="bt__panel"></div>
        <button class="bt__basta" type="button" disabled>BASTA</button>
      </div>
      <div class="bt__wipe" hidden>
        <div class="bt__wipe-card">
          <span class="bt__wipe-title"></span>
          <span class="bt__wipe-sub"></span>
        </div>
      </div>
      <div class="bt__overlay" hidden></div>
      <div class="bt__countdown" hidden></div>
    `;
    root.appendChild(wrap);

    this.stage = wrap.querySelector(".bt__stage")!;
    this.overlay = wrap.querySelector(".bt__overlay")!;
    this.countdownEl = wrap.querySelector(".bt__countdown")!;
    this.letterEl = wrap.querySelector(".bt__letter")!;
    this.clockBar = wrap.querySelector(".bt__clock-bar")!;
    this.rosterEl = wrap.querySelector(".bt__roster")!;
    this.bannerEl = wrap.querySelector(".bt__banner")!;
    this.panelEl = wrap.querySelector(".bt__panel")!;
    this.bastaBtn = wrap.querySelector(".bt__basta")!;
    this.wipeEl = wrap.querySelector(".bt__wipe")!;

    // Un solo boton de accion abajo: grita BASTA en el llenado y confirma el voto en
    // la votacion (la fase decide, ver `renderSheet` / `renderVoting`).
    this.bastaBtn.addEventListener("click", () => {
      if (this.bastaBtn.disabled) return;
      if (this.panelMode === "voting") this.submitVotes();
      else this.bastaCb();
    });
  }

  // ---------- Suscripciones ----------

  onFillChange(cb: () => void): void {
    this.fillChangeCb = cb;
  }
  onBasta(cb: () => void): void {
    this.bastaCb = cb;
  }
  /** Se dispara UNA vez por letra, al confirmar la hoja de tachados. */
  onVoteSubmit(cb: (rejects: BtReject[]) => void): void {
    this.voteSubmitCb = cb;
  }

  // ---------- Mensajes / countdown ----------

  showMessage(title: string, bodyHtml: string, action?: { label: string; onClick: () => void }): void {
    this.stage.hidden = true;
    this.overlay.hidden = false;
    this.overlay.innerHTML = `
      <div class="bt__card">
        <h1 class="bt__card-title">${title}</h1>
        <div class="bt__card-body">${bodyHtml}</div>
        ${action ? `<button class="bt__card-btn" type="button">${action.label}</button>` : ""}
      </div>`;
    if (action) {
      this.overlay
        .querySelector<HTMLButtonElement>(".bt__card-btn")!
        .addEventListener("click", action.onClick);
    }
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.hidden = true;
      return;
    }
    this.countdownEl.hidden = false;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-pop");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-pop");
  }

  showStage(): void {
    this.overlay.hidden = true;
    this.stage.hidden = false;
  }

  /**
   * Cartel de transicion entre fases (hoja -> votacion -> puntaje -> letra nueva).
   * Es puramente visual: no bloquea nada, la vista de abajo ya esta renderizada y el
   * cartel se corre solo. Se re-dispara pisando el anterior.
   */
  showTransition(title: string, sub: string): void {
    this.wipeEl.querySelector<HTMLElement>(".bt__wipe-title")!.textContent = title;
    this.wipeEl.querySelector<HTMLElement>(".bt__wipe-sub")!.textContent = sub;
    this.wipeEl.hidden = false;
    // Reinicia la animacion aunque ya estuviera corriendo.
    this.wipeEl.classList.remove("is-on");
    void this.wipeEl.offsetWidth;
    this.wipeEl.classList.add("is-on");
    if (this.wipeTimer !== 0) window.clearTimeout(this.wipeTimer);
    this.wipeTimer = window.setTimeout(() => {
      this.wipeTimer = 0;
      this.wipeEl.classList.remove("is-on");
      this.wipeEl.hidden = true;
    }, TRANSITION_MS);
  }

  // ---------- Render por fase ----------

  render(s: BtState, me: string): void {
    this.me = me;
    this.letterEl.textContent = s.letter ?? "";
    this.renderRoster(s);
    this.updateClock(s);

    if (s.phase === "filling" || s.phase === "grace") {
      this.renderSheet(s);
    } else if (s.phase === "voting") {
      this.renderVoting(s);
    } else if (s.phase === "reveal") {
      this.renderReveal(s);
    }
  }

  private renderRoster(s: BtState): void {
    const total = s.totalLetters;
    const idx = Math.min(s.letterIndex + 1, total);
    const chips = s.players
      .map((p) => {
        const cls = ["bt__chip"];
        if (!p.connected) cls.push("is-off");
        if (p.nickname === this.me) cls.push("is-me");
        if (p.nickname === s.bastaBy) cls.push("is-basta");
        const prog =
          s.phase === "filling" || s.phase === "grace"
            ? `<span class="bt__chip-prog">${p.filledCount}/${CATEGORIES.length}</span>`
            : `<span class="bt__chip-prog">${p.total}</span>`;
        return `<div class="${cls.join(" ")}"><span class="bt__chip-name">${esc(p.nickname)}</span>${prog}</div>`;
      })
      .join("");
    this.rosterEl.innerHTML = `<div class="bt__round">Letra ${idx}/${total}</div>${chips}`;
  }

  // ---------- Vista: hoja (filling / grace) ----------

  private renderSheet(s: BtState): void {
    const fresh = this.panelMode !== "sheet" || this.sheetLetterIndex !== s.letterIndex;
    if (fresh) {
      this.buildSheet();
      this.panelMode = "sheet";
      this.sheetLetterIndex = s.letterIndex;
    }
    // Banner de gracia cuando alguien grito BASTA.
    if (s.phase === "grace" && s.bastaBy) {
      this.bannerEl.hidden = false;
      this.bannerEl.textContent =
        s.bastaBy === this.me ? "Gritaste BASTA. Cerrando..." : `${s.bastaBy} grito BASTA. Cerrando...`;
    } else {
      this.bannerEl.hidden = true;
    }
    this.bastaBtn.hidden = false;
    this.bastaBtn.classList.remove("is-vote");
    this.bastaBtn.textContent = "BASTA";
    this.refreshBastaEnabled();
  }

  private buildSheet(): void {
    this.inputs.clear();
    this.panelEl.innerHTML = `
      <div class="bt__sheet">
        ${CATEGORIES.map(
          (c) => `
          <div class="bt__row">
            <label class="bt__cat" for="bt-${c.id}">${c.label}</label>
            <input class="bt__input" id="bt-${c.id}" data-cat="${c.id}" type="text"
                   autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="40" />
          </div>`,
        ).join("")}
      </div>`;
    for (const c of CATEGORIES) {
      const input = this.panelEl.querySelector<HTMLInputElement>(`#bt-${c.id}`)!;
      this.inputs.set(c.id, input);
      input.addEventListener("input", () => {
        this.refreshBastaEnabled();
        this.fillChangeCb();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (this.allFilled()) this.bastaCb();
        else this.focusNextEmpty(c.id);
      });
    }
    const first = this.inputs.get(CATEGORIES[0].id);
    first?.focus();
  }

  private focusNextEmpty(from: BtCategoryId): void {
    const order = CATEGORIES.map((c) => c.id);
    const start = order.indexOf(from);
    for (let k = 1; k <= order.length; k++) {
      const id = order[(start + k) % order.length];
      const input = this.inputs.get(id);
      if (input && input.value.trim() === "") {
        input.focus();
        return;
      }
    }
  }

  private allFilled(): boolean {
    return CATEGORIES.every((c) => (this.inputs.get(c.id)?.value.trim() ?? "") !== "");
  }

  private refreshBastaEnabled(): void {
    this.bastaBtn.disabled = !this.allFilled();
  }

  getAnswers(): Answers {
    const out: Answers = {};
    for (const c of CATEGORIES) out[c.id] = this.inputs.get(c.id)?.value ?? "";
    return out;
  }

  /** Rellena los inputs (recuperacion tras F5). Solo si la hoja esta montada. */
  setAnswers(answers: Answers): void {
    for (const c of CATEGORIES) {
      const input = this.inputs.get(c.id);
      if (input && !input.value) input.value = answers[c.id] ?? "";
    }
    this.refreshBastaEnabled();
  }

  // ---------- Vista: votacion ----------

  /**
   * El tablero de votacion se arma UNA vez por letra: los tachados son estado local
   * (`pendingRejects`) hasta que se confirman, asi que reconstruirlo en cada snapshot
   * ajeno haria saltar el scroll mientras el jugador revisa. Los snapshots siguientes
   * solo refrescan el banner de "listos" y el boton.
   */
  private renderVoting(s: BtState): void {
    const fresh = this.panelMode !== "voting" || this.votingLetterIndex !== s.letterIndex;
    if (fresh) {
      this.panelMode = "voting";
      this.votingLetterIndex = s.letterIndex;
      this.pendingRejects.clear();
      this.voteSent = false;
      this.buildVotingBoard(s);
    }
    this.bannerEl.hidden = false;
    this.refreshVoteUI(s);
  }

  private buildVotingBoard(s: BtState): void {
    const cells = s.cells ?? [];
    this.panelEl.innerHTML = `<div class="bt__board">${CATEGORIES.map((c) =>
      this.categoryBlock(c.id, c.label, s, cells),
    ).join("")}</div>`;

    for (const btn of this.panelEl.querySelectorAll<HTMLButtonElement>(".bt__tacha")) {
      btn.addEventListener("click", () => {
        if (this.voteSent) return; // ya confirmado: no se puede recular
        const key = `${btn.dataset.target}|${btn.dataset.cat}`;
        if (this.pendingRejects.has(key)) this.pendingRejects.delete(key);
        else this.pendingRejects.add(key);
        btn.classList.toggle("is-on", this.pendingRejects.has(key));
        btn.closest(".bt__ans")?.classList.toggle("is-doomed", this.pendingRejects.has(key));
        this.refreshVoteButton();
      });
    }
  }

  /** Banner con el progreso de la mesa + estado del boton de confirmar. */
  private refreshVoteUI(s: BtState): void {
    const total = s.players.length;
    const done = s.players.filter((p) => p.voted).length;
    // Un F5 en plena votacion rearma el tablero en blanco, pero el server sigue
    // teniendo el voto: manda el, para no ofrecer confirmar algo que ya se cerro.
    if (s.players.find((p) => p.nickname === this.me)?.voted) this.voteSent = true;
    this.bannerEl.textContent = this.voteSent
      ? `Voto enviado. Esperando a los demas (${done}/${total})`
      : `Tacha las que no valgan y confirma (${done}/${total} listos)`;
    this.refreshVoteButton();
  }

  private refreshVoteButton(): void {
    this.bastaBtn.hidden = false;
    this.bastaBtn.classList.add("is-vote");
    this.bastaBtn.disabled = this.voteSent;
    if (this.voteSent) {
      for (const btn of this.panelEl.querySelectorAll<HTMLButtonElement>(".bt__tacha")) {
        btn.disabled = true;
      }
    }
    const n = this.pendingRejects.size;
    this.bastaBtn.textContent = this.voteSent
      ? "ENVIADO"
      : n > 0
        ? `LISTO (${n})`
        : "LISTO";
  }

  private submitVotes(): void {
    if (this.voteSent) return;
    this.voteSent = true;
    const rejects: BtReject[] = [...this.pendingRejects].map((key) => {
      const [target, category] = key.split("|") as [string, BtCategoryId];
      return { target, category };
    });
    // Congela el tablero: lo enviado no se toca.
    for (const btn of this.panelEl.querySelectorAll<HTMLButtonElement>(".bt__tacha")) {
      btn.disabled = true;
    }
    this.refreshVoteButton();
    this.voteSubmitCb(rejects);
  }

  private categoryBlock(cat: BtCategoryId, label: string, s: BtState, cells: BtCell[]): string {
    const rows = s.players
      .map((p) => {
        const cell = cells.find((c) => c.player === p.nickname && c.category === cat);
        const text = cell?.text ?? "";
        const empty = text.trim() === "";
        const cls = ["bt__ans"];
        if (empty) cls.push("is-empty");
        const canVote = !empty && p.nickname !== this.me;
        const btn = canVote
          ? `<button class="bt__tacha" type="button" data-target="${esc(
              p.nickname,
            )}" data-cat="${cat}" title="Tachar">${CROSS_SVG}</button>`
          : "";
        return `
          <div class="${cls.join(" ")}">
            <span class="bt__ans-who">${esc(p.nickname)}</span>
            <span class="bt__ans-text">${empty ? "&mdash;" : esc(text)}</span>
            ${btn}
          </div>`;
      })
      .join("");
    return `<section class="bt__cat-block"><h3 class="bt__cat-title">${label}</h3>${rows}</section>`;
  }

  // ---------- Vista: reveal ----------

  private renderReveal(s: BtState): void {
    this.panelMode = "reveal";
    this.bastaBtn.hidden = true;
    const scores = s.letterScores ?? [];
    const mine = scores.find((x) => x.player === this.me);
    this.bannerEl.hidden = false;
    this.bannerEl.textContent = mine ? `Sumaste ${mine.points} esta letra` : "Puntaje de la letra";

    const cells = s.cells ?? [];
    this.panelEl.innerHTML = `<div class="bt__board">${CATEGORIES.map((c) => {
      const rows = s.players
        .map((p) => {
          const cell = cells.find((x) => x.player === p.nickname && x.category === c.id);
          const status = cell?.status ?? "empty";
          const points = cell?.points ?? 0;
          const text = cell?.text ?? "";
          const empty = text.trim() === "";
          return `
            <div class="bt__ans is-${status}">
              <span class="bt__ans-who">${esc(p.nickname)}</span>
              <span class="bt__ans-text">${empty ? "&mdash;" : esc(text)}</span>
              <span class="bt__ans-pts" title="${STATUS_LABEL[status] ?? ""}">${points}</span>
            </div>`;
        })
        .join("");
      return `<section class="bt__cat-block"><h3 class="bt__cat-title">${c.label}</h3>${rows}</section>`;
    }).join("")}</div>`;
  }

  // ---------- Reloj (barra que se consume) ----------

  private updateClock(s: BtState): void {
    if (s.clockMs == null || s.clockTotalMs == null || s.clockTotalMs <= 0) {
      this.clearClock();
      return;
    }
    this.clockAnchor = performance.now();
    this.clockMs = s.clockMs;
    this.clockTotal = s.clockTotalMs;
    if (this.clockRaf === 0) this.clockRaf = requestAnimationFrame(() => this.tickClock());
  }

  private tickClock(): void {
    this.clockRaf = 0;
    const elapsed = performance.now() - this.clockAnchor;
    const remaining = Math.max(0, this.clockMs - elapsed);
    const frac = this.clockTotal > 0 ? remaining / this.clockTotal : 0;
    this.clockBar.style.transform = `scaleX(${frac})`;
    this.clockBar.classList.toggle("is-low", frac < 0.25);
    if (remaining > 0) this.clockRaf = requestAnimationFrame(() => this.tickClock());
  }

  private clearClock(): void {
    if (this.clockRaf !== 0) cancelAnimationFrame(this.clockRaf);
    this.clockRaf = 0;
    this.clockBar.style.transform = "scaleX(0)";
    this.clockBar.classList.remove("is-low");
  }
}
