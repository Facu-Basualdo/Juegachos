import { MAX_WORD_LEN } from "./constants";
import type { ImState, ImYou } from "./ImpostorTransport";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPE[c]);
}

/** Que mide el reloj ahora mismo (va al lado de la ronda, arriba de la barra). */
function phaseLabel(s: ImState): string {
  switch (s.phase) {
    case "reveal":
      return "Tu rol";
    case "clues":
      return s.turn === null ? "Ultima pista" : "Pistas";
    case "voting":
      return "Votacion";
    case "guess":
      return "Adivinanza";
    case "result":
      return "Resultado";
    default:
      return "";
  }
}

const OUTCOME_TITLE: Record<string, string> = {
  "impostor-survived": "El impostor zafo",
  "impostor-guessed": "El impostor adivino",
  "impostor-caught": "Impostor descubierto",
};

/**
 * Hud de Impostor (estetica "sala de interrogatorio", ver DESIGN.md). Cinco vistas segun
 * la fase que manda el server:
 *  - reveal: la ficha de rol privada (tu palabra, o SOS EL IMPOSTOR + categoria).
 *  - clues: la categoria, las pistas dadas y, si es tu turno, el campo para tu pista.
 *  - voting: los sospechosos como fichas; tocas al que crees impostor.
 *  - guess: el acusado intenta adivinar la palabra (input propio si sos vos).
 *  - result: se revela el impostor, la palabra y los puntos de la ronda.
 * Los estados de espera / resultados / tablero final los cubre el RoomOverlay por encima.
 */
export class Hud {
  private readonly stage: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly roundEl: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly clockBar: HTMLElement;
  private readonly rosterEl: HTMLElement;
  private readonly panelEl: HTMLElement;

  private clueCb: (word: string) => void = () => {};
  private voteCb: (target: string) => void = () => {};
  private guessCb: (word: string) => void = () => {};

  private me = "";
  private you: ImYou | null = null;
  private panelMode = "none";
  private cluesSig = "";

  private clockRaf = 0;
  private clockAnchor = 0;
  private clockMs = 0;
  private clockTotal = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "im";
    wrap.innerHTML = `
      <div class="im__stage" hidden>
        <div class="im__topbar">
          <div class="im__toprow">
            <div class="im__meta">
              <span class="im__round" aria-label="ronda"></span>
              <span class="im__phase"></span>
            </div>
            <div class="im__roster"></div>
          </div>
          <div class="im__clock"><div class="im__clock-bar"></div></div>
        </div>
        <div class="im__panel"></div>
      </div>
      <div class="im__overlay" hidden></div>
      <div class="im__countdown" hidden></div>
    `;
    root.appendChild(wrap);

    this.stage = wrap.querySelector(".im__stage")!;
    this.overlay = wrap.querySelector(".im__overlay")!;
    this.countdownEl = wrap.querySelector(".im__countdown")!;
    this.roundEl = wrap.querySelector(".im__round")!;
    this.phaseEl = wrap.querySelector(".im__phase")!;
    this.clockBar = wrap.querySelector(".im__clock-bar")!;
    this.rosterEl = wrap.querySelector(".im__roster")!;
    this.panelEl = wrap.querySelector(".im__panel")!;
  }

  // ---------- Suscripciones ----------

  onClue(cb: (word: string) => void): void {
    this.clueCb = cb;
  }
  onVote(cb: (target: string) => void): void {
    this.voteCb = cb;
  }
  onGuess(cb: (word: string) => void): void {
    this.guessCb = cb;
  }

  setYou(you: ImYou): void {
    this.you = you;
  }

  // ---------- Mensajes / countdown ----------

  showMessage(title: string, bodyHtml: string, action?: { label: string; onClick: () => void }): void {
    this.stage.hidden = true;
    this.overlay.hidden = false;
    this.overlay.innerHTML = `
      <div class="im__card">
        <h1 class="im__card-title">${title}</h1>
        <div class="im__card-body">${bodyHtml}</div>
        ${action ? `<button class="im__card-btn" type="button">${action.label}</button>` : ""}
      </div>`;
    if (action) {
      this.overlay
        .querySelector<HTMLButtonElement>(".im__card-btn")!
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

  // ---------- Render por fase ----------

  render(s: ImState, me: string): void {
    this.me = me;
    this.roundEl.textContent = `Ronda ${Math.min(s.round, s.totalRounds)}/${s.totalRounds}`;
    this.phaseEl.textContent = phaseLabel(s);
    this.renderRoster(s);
    this.updateClock(s);

    switch (s.phase) {
      case "reveal":
        this.renderReveal(s);
        break;
      case "clues":
        this.renderClues(s);
        break;
      case "voting":
        this.renderVoting(s);
        break;
      case "guess":
        this.renderGuess(s);
        break;
      case "result":
        this.renderResult(s);
        break;
      default:
        break;
    }
  }

  private renderRoster(s: ImState): void {
    const chips = s.players
      .map((p) => {
        const cls = ["im__chip"];
        if (!p.connected) cls.push("is-off");
        if (p.nickname === this.me) cls.push("is-me");
        if (s.phase === "clues" && p.nickname === s.turn) cls.push("is-turn");
        let mark = "";
        if (s.phase === "clues" && p.clued) mark = `<span class="im__chip-mark">&bull;</span>`;
        else if (s.phase === "voting" && p.voted) mark = `<span class="im__chip-mark">&bull;</span>`;
        else mark = `<span class="im__chip-prog">${p.total}</span>`;
        return `<div class="${cls.join(" ")}"><span class="im__chip-name">${esc(p.nickname)}</span>${mark}</div>`;
      })
      .join("");
    this.rosterEl.innerHTML = chips;
  }

  // ---------- Vista: reveal (rol privado) ----------

  private renderReveal(s: ImState): void {
    this.panelMode = "reveal";
    // Esperamos el rol de ESTA ronda (im:you llega junto al reveal) para no mostrar la
    // ficha de la ronda anterior por un instante.
    if (!this.you || this.you.round !== s.round) {
      this.panelEl.innerHTML = `<div class="im__role"><div class="im__role-tag">Repartiendo roles...</div></div>`;
      return;
    }
    const category = esc(s.category ?? this.you?.category ?? "");
    if (this.you?.impostor) {
      const mates =
        this.you.mates.length > 0
          ? `<p class="im__role-note">Tu complice: ${this.you.mates.map(esc).join(", ")}</p>`
          : "";
      this.panelEl.innerHTML = `
        <div class="im__role is-impostor">
          <div class="im__role-tag">Tu rol</div>
          <div class="im__role-word">SOS EL IMPOSTOR</div>
          <p class="im__role-hint">No sabes la palabra. La categoria es <strong>${category}</strong>. Improvisa una pista que no te delate.</p>
          ${mates}
        </div>`;
    } else {
      this.panelEl.innerHTML = `
        <div class="im__role is-crew">
          <div class="im__role-tag">La palabra secreta (${category})</div>
          <div class="im__role-word">${esc(this.you?.word ?? "")}</div>
          <p class="im__role-hint">Da una pista que pruebe que la sabes, sin cantarla al impostor.</p>
        </div>`;
    }
  }

  // ---------- Vista: pistas ----------

  private renderClues(s: ImState): void {
    const myTurn = s.turn === this.me;
    const sig = `${s.turn}|${s.clues.length}|${myTurn}`;
    if (this.panelMode === "clues" && this.cluesSig === sig) return; // no romper el foco del input
    this.panelMode = "clues";
    this.cluesSig = sig;

    const roleChip = this.you?.impostor
      ? `<span class="im__mini is-impostor">Sos el impostor</span>`
      : `<span class="im__mini is-crew">Tu palabra: <strong>${esc(this.you?.word ?? "")}</strong></span>`;

    const cluesHtml = s.clues.length
      ? s.clues
          .map((c, i) => {
            const cls = ["im__clue"];
            if (c.player === this.me) cls.push("is-mine");
            if (i === s.clues.length - 1) cls.push("is-new"); // la ultima entra iluminada
            return `
            <li class="${cls.join(" ")}">
              <span class="im__clue-who">${esc(c.player)}</span>
              <span class="im__clue-word">${c.word.trim() ? esc(c.word) : "&mdash;"}</span>
            </li>`;
          })
          .join("")
      : `<li class="im__clue is-empty">Todavia nadie dio una pista.</li>`;

    // Sin turno = pausa de lectura del server (`CLUES_RECAP_MS`): estan todas las pistas
    // sobre la mesa y la votacion arranca en unos segundos.
    const inputHtml = myTurn
      ? `
        <form class="im__cluebar" novalidate>
          <input class="im__clue-input" type="text" autocomplete="off" autocapitalize="none"
                 spellcheck="false" maxlength="${MAX_WORD_LEN}" placeholder="Tu pista (una palabra)" />
          <button class="im__send" type="submit">Enviar</button>
        </form>`
      : s.turn !== null
        ? `<div class="im__turnwait">Turno de <strong>${esc(s.turn)}</strong>...</div>`
        : `<div class="im__turnwait is-recap">Ya estan todas las pistas. Empieza la votaci&oacute;n...</div>`;

    this.panelEl.innerHTML = `
      <div class="im__cluewrap">
        <div class="im__cluehead">
          <span class="im__cat">${esc(s.category ?? "")}</span>
          ${roleChip}
        </div>
        <ul class="im__clues">${cluesHtml}</ul>
        ${inputHtml}
      </div>`;

    if (myTurn) {
      const form = this.panelEl.querySelector<HTMLFormElement>(".im__cluebar")!;
      const input = this.panelEl.querySelector<HTMLInputElement>(".im__clue-input")!;
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const word = input.value.trim();
        if (word === "") return;
        input.disabled = true;
        form.querySelector<HTMLButtonElement>(".im__send")!.disabled = true;
        this.clueCb(word);
      });
      input.focus();
    }
  }

  // ---------- Vista: votacion ----------

  private renderVoting(s: ImState): void {
    this.panelMode = "voting";
    const votes = s.votes ?? [];
    const suspects = s.players
      .map((p) => {
        const isMe = p.nickname === this.me;
        const count = votes.filter((v) => v.target === p.nickname).length;
        const mine = votes.some((v) => v.voter === this.me && v.target === p.nickname);
        const clue = s.clues.find((c) => c.player === p.nickname)?.word ?? "";
        const cls = ["im__suspect"];
        if (mine) cls.push("is-mine");
        if (isMe) cls.push("is-self");
        return `
          <button class="${cls.join(" ")}" type="button" data-target="${esc(p.nickname)}" ${isMe ? "disabled" : ""}>
            <span class="im__suspect-name">${esc(p.nickname)}${isMe ? " (vos)" : ""}</span>
            <span class="im__suspect-clue">${clue.trim() ? esc(clue) : "&mdash;"}</span>
            ${count > 0 ? `<span class="im__suspect-votes">${count}</span>` : ""}
          </button>`;
      })
      .join("");

    this.panelEl.innerHTML = `
      <div class="im__votewrap">
        <div class="im__votehead">Quien es el impostor?</div>
        <div class="im__suspects">${suspects}</div>
      </div>`;

    for (const btn of this.panelEl.querySelectorAll<HTMLButtonElement>(".im__suspect")) {
      if (btn.disabled) continue;
      btn.addEventListener("click", () => this.voteCb(btn.dataset.target!));
    }
  }

  // ---------- Vista: adivinanza ----------

  private renderGuess(s: ImState): void {
    if (this.panelMode === "guess") return; // input propio: no reconstruir
    this.panelMode = "guess";
    const accused = esc(s.accused ?? "");
    const amAccused = s.accused === this.me;

    if (amAccused) {
      this.panelEl.innerHTML = `
        <div class="im__guesswrap">
          <div class="im__guesshead">Te descubrieron.</div>
          <p class="im__guesssub">Adivina la palabra secreta (${esc(s.category ?? "")}) para robar la ronda.</p>
          <form class="im__cluebar" novalidate>
            <input class="im__clue-input" type="text" autocomplete="off" autocapitalize="none"
                   spellcheck="false" maxlength="${MAX_WORD_LEN}" placeholder="La palabra secreta" />
            <button class="im__send" type="submit">Adivinar</button>
          </form>
        </div>`;
      const form = this.panelEl.querySelector<HTMLFormElement>(".im__cluebar")!;
      const input = this.panelEl.querySelector<HTMLInputElement>(".im__clue-input")!;
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const word = input.value.trim();
        if (word === "") return;
        input.disabled = true;
        form.querySelector<HTMLButtonElement>(".im__send")!.disabled = true;
        this.guessCb(word);
      });
      input.focus();
    } else {
      this.panelEl.innerHTML = `
        <div class="im__guesswrap">
          <div class="im__guesshead"><strong>${accused}</strong> fue descubierto.</div>
          <p class="im__guesssub">Esta intentando adivinar la palabra para robar la ronda...</p>
        </div>`;
    }
  }

  // ---------- Vista: resultado ----------

  private renderResult(s: ImState): void {
    this.panelMode = "result";
    const outcome = s.outcome;
    const impostors = s.impostors ?? [];
    const title = outcome ? OUTCOME_TITLE[outcome.kind] ?? "Resultado" : "Resultado";
    const winners = outcome?.winners === "impostores" ? "Ganan los impostores" : "Ganan los inocentes";
    const guessLine =
      outcome?.kind === "impostor-guessed" || outcome?.kind === "impostor-caught"
        ? `<p class="im__result-guess">Adivino: <strong>${outcome.guess ? esc(outcome.guess) : "&mdash;"}</strong></p>`
        : "";

    const scores = outcome?.scores ?? [];
    const scoreRows = s.players
      .map((p) => {
        const pts = scores.find((x) => x.player === p.nickname)?.points ?? 0;
        const isImp = impostors.includes(p.nickname);
        return `
          <div class="im__score${p.nickname === this.me ? " is-me" : ""}">
            <span class="im__score-role ${isImp ? "is-impostor" : "is-crew"}">${isImp ? "impostor" : "inocente"}</span>
            <span class="im__score-name">${esc(p.nickname)}</span>
            <span class="im__score-pts">${pts > 0 ? `+${pts}` : "0"}</span>
          </div>`;
      })
      .join("");

    this.panelEl.innerHTML = `
      <div class="im__result${outcome?.winners === "impostores" ? " is-impostor" : " is-crew"}">
        <div class="im__result-title">${title}</div>
        <div class="im__result-word">La palabra era <strong>${esc(s.word ?? "")}</strong></div>
        <div class="im__result-imp">${impostors.length > 1 ? "Impostores" : "Impostor"}: <strong>${impostors.map(esc).join(", ")}</strong></div>
        ${guessLine}
        <div class="im__result-winner">${winners}</div>
        <div class="im__scores">${scoreRows}</div>
      </div>`;
  }

  // ---------- Reloj (barra que se consume) ----------

  private updateClock(s: ImState): void {
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
