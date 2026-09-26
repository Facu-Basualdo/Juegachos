import { bookingNumber, mugshot } from "./avatar";
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
  "impostor-survived": "El impostor zaf&oacute;",
  "impostor-guessed": "El impostor adivin&oacute;",
  "impostor-caught": "Impostor descubierto",
};

/** Numero de expediente de la ronda: el mismo para todos, cambia ronda a ronda. */
function caseNumber(s: ImState): string {
  return `${String(s.round).padStart(2, "0")}-${bookingNumber(`${s.category ?? ""}:${s.round}`)}`;
}

/** Ficha policial: retrato + regla de altura + pizarra de detenido. */
function mugCard(name: string, extraClass = "", inner = ""): string {
  return `
    <div class="im-mug ${extraClass}">
      <div class="im-mug__photo">${mugshot(name)}</div>
      <div class="im-mug__plate"><span class="im-mug__no">N&ordm; ${bookingNumber(name)}</span><span class="im-mug__name">${esc(name)}</span></div>
      ${inner}
    </div>`;
}

/**
 * Hud de Impostor (estetica "Expediente noir", ver DESIGN.md). La sala (lampara, polvo,
 * viñeta, grano) es fija; cada fase del server arma una pieza del expediente:
 *  - reveal: el sobre CONFIDENCIAL que se abre con tu palabra, o el sello de impostor.
 *  - clues: la hoja de declaraciones a maquina; si es tu turno, el renglon para declarar.
 *  - voting: la rueda de reconocimiento; tocas la ficha del que crees impostor.
 *  - guess: ultima chance del acusado, con la luz en rojo.
 *  - result: caso cerrado, con los sellos sobre las fichas y el registro de puntos.
 * Los estados de espera / resultados / tablero final los cubre el RoomOverlay por encima.
 */
export class Hud {
  private readonly root: HTMLElement;
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
  private revealSig = "";
  private resultSig = "";
  private rosterSig = "";

  private clockRaf = 0;
  private clockAnchor = 0;
  private clockMs = 0;
  private clockTotal = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "im";
    wrap.innerHTML = `
      <div class="im__room" aria-hidden="true">
        <div class="im__cone"></div>
        <div class="im__dust"></div>
        <div class="im__lamp"><span class="im__lamp-cord"></span><span class="im__lamp-shade"></span><span class="im__lamp-bulb"></span></div>
        <div class="im__vignette"></div>
        <div class="im__grain"></div>
      </div>
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

    this.root = wrap;
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
        <div class="im__card-tab">EXPEDIENTE</div>
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

  /**
   * El server rechazo la pista (repetida o canta la palabra): el turno sigue siendo
   * nuestro, asi que se rehabilita el campo y el motivo reemplaza la regla de abajo.
   */
  showClueError(reason: string): void {
    if (this.panelMode !== "clues") return;
    const input = this.panelEl.querySelector<HTMLInputElement>(".im__clue-input");
    const send = this.panelEl.querySelector<HTMLButtonElement>(".im__send");
    const note = this.panelEl.querySelector<HTMLElement>(".im__cluenote");
    if (!input || !send) return;
    input.disabled = false;
    send.disabled = false;
    // Sin scroll: el navegador desplazaria la sala para mostrar el campo.
    input.focus({ preventScroll: true });
    input.select();
    if (note) {
      note.textContent = reason;
      note.classList.add("is-error");
    }
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
    // La fase va en la sala: la adivinanza pone la lampara en rojo.
    this.root.dataset.phase = s.phase;
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
    const sig = s.players
      .map((p) => `${p.nickname}:${p.connected}:${p.total}:${p.clued}:${p.voted}`)
      .join("|") + `|${s.phase}|${s.turn}`;
    if (sig === this.rosterSig) return;
    this.rosterSig = sig;
    const chips = s.players
      .map((p) => {
        const cls = ["im__chip"];
        if (!p.connected) cls.push("is-off");
        if (p.nickname === this.me) cls.push("is-me");
        if (s.phase === "clues" && p.nickname === s.turn) cls.push("is-turn");
        let mark = "";
        if (s.phase === "clues" && p.clued) mark = `<span class="im__chip-mark" title="ya declar&oacute;"></span>`;
        else if (s.phase === "voting" && p.voted) mark = `<span class="im__chip-mark" title="ya vot&oacute;"></span>`;
        else mark = `<span class="im__chip-prog">${p.total}</span>`;
        return `<div class="${cls.join(" ")}"><span class="im__chip-face">${mugshot(p.nickname)}</span><span class="im__chip-name">${esc(p.nickname)}</span>${mark}</div>`;
      })
      .join("");
    this.rosterEl.innerHTML = chips;
  }

  // ---------- Vista: reveal (el sobre confidencial) ----------

  private renderReveal(s: ImState): void {
    // Esperamos el rol de ESTA ronda (im:you llega junto al reveal) para no mostrar la
    // ficha de la ronda anterior por un instante.
    if (!this.you || this.you.round !== s.round) {
      this.panelMode = "reveal";
      this.revealSig = "";
      this.panelEl.innerHTML = `<div class="im__dealing">Repartiendo los sobres...</div>`;
      return;
    }
    const sig = `${s.round}|${this.you.impostor}|${this.you.word}`;
    // No se rearma con cada broadcast: la animacion del sobre se veria una y otra vez.
    if (this.panelMode === "reveal" && this.revealSig === sig) return;
    this.panelMode = "reveal";
    this.revealSig = sig;
    const category = esc(s.category ?? this.you.category ?? "");
    const kicker = `<div class="im__file-kicker">Expediente N&ordm; ${caseNumber(s)} &middot; Caso: ${category}</div>`;
    const inner = this.you.impostor
      ? `
        ${kicker}
        <div class="im__stamp im__stamp--role">Sos el impostor</div>
        <p class="im__file-hint">No sab&eacute;s la palabra. La categor&iacute;a es <strong>${category}</strong>: improvis&aacute; una pista que no te delate.</p>
        ${
          this.you.mates.length > 0
            ? `<p class="im__file-mates">Tu c&oacute;mplice: <strong>${this.you.mates.map(esc).join(", ")}</strong></p>`
            : ""
        }`
      : `
        ${kicker}
        <div class="im__file-label">La palabra secreta</div>
        <div class="im__secret">${esc(this.you.word ?? "")}</div>
        <p class="im__file-hint">Da una pista que pruebe que la sab&eacute;s, sin cant&aacute;rsela al impostor.</p>`;
    this.panelEl.innerHTML = `
      <div class="im__envelope ${this.you.impostor ? "is-impostor" : "is-crew"}">
        <div class="im__env-back"></div>
        <div class="im__env-letter">${inner}</div>
        <div class="im__env-front"><span class="im__env-seal">Confidencial</span></div>
        <div class="im__env-flap"></div>
      </div>`;
  }

  // ---------- Vista: pistas (la hoja de declaraciones) ----------

  private renderClues(s: ImState): void {
    const myTurn = s.turn === this.me;
    const sig = `${s.turn}|${s.clues.length}|${myTurn}`;
    if (this.panelMode === "clues" && this.cluesSig === sig) return; // no romper el foco del input
    const prevCount = this.panelMode === "clues" ? Number(this.cluesSig.split("|")[1]) : -1;
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
            // Solo la que entro recien se tipea; las de antes ya estan escritas.
            if (i === s.clues.length - 1 && i >= prevCount) cls.push("is-new");
            const word = c.word.trim() ? esc(c.word) : "(no declar&oacute;)";
            const len = c.word.trim() ? c.word.trim().length : 14;
            return `
            <li class="${cls.join(" ")}">
              <span class="im__clue-face">${mugshot(c.player)}</span>
              <span class="im__clue-who">${esc(c.player)}:</span>
              <span class="im__clue-word${c.word.trim() ? "" : " is-blank"}" style="--n:${len}">${word}</span>
            </li>`;
          })
          .join("")
      : `<li class="im__clue is-empty">Todav&iacute;a nadie declar&oacute;.</li>`;

    // Sin turno = pausa de lectura del server (`CLUES_RECAP_MS`): estan todas las pistas
    // sobre la mesa y la votacion arranca en unos segundos.
    const inputHtml = myTurn
      ? `
        <form class="im__cluebar" novalidate>
          <span class="im__cluebar-who">${esc(this.me)}:</span>
          <input class="im__clue-input" type="text" autocomplete="off" autocapitalize="none"
                 spellcheck="false" maxlength="${MAX_WORD_LEN}" placeholder="tu pista" />
          <button class="im__send" type="submit">Declarar</button>
        </form>
        <p class="im__cluenote">No vale repetir una pista ni cantar la palabra.</p>`
      : s.turn !== null
        ? `<div class="im__turnwait"><span class="im__turnwait-face">${mugshot(s.turn)}</span><span>Declara <strong>${esc(s.turn)}</strong>...</span></div>`
        : `<div class="im__turnwait is-recap">Ya est&aacute;n todas las declaraciones. Empieza la votaci&oacute;n...</div>`;

    this.panelEl.innerHTML = `
      <div class="im__sheet">
        <div class="im__sheet-head">
          <span class="im__cat">Caso: ${esc(s.category ?? "")}</span>
          ${roleChip}
        </div>
        <div class="im__sheet-title">Declaraciones</div>
        <ol class="im__clues">${cluesHtml}</ol>
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
      input.focus({ preventScroll: true });
    }
  }

  // ---------- Vista: votacion (rueda de reconocimiento) ----------

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
        // Los votos son chinches rojas clavadas en la ficha.
        const pins = Array.from({ length: count }, (_, i) => `<span class="im__pin" style="--i:${i}"></span>`).join("");
        return `
          <button class="${cls.join(" ")}" type="button" data-target="${esc(p.nickname)}" ${isMe ? "disabled" : ""}>
            ${mugCard(
              p.nickname,
              "",
              `<span class="im__circle"></span><span class="im__pins">${pins}</span>${isMe ? `<span class="im__self-tag">vos</span>` : ""}`,
            )}
            <span class="im__suspect-clue">dijo <strong>${clue.trim() ? esc(clue) : "nada"}</strong></span>
            ${count > 0 ? `<span class="im__suspect-votes">${count}</span>` : ""}
          </button>`;
      })
      .join("");

    this.panelEl.innerHTML = `
      <div class="im__votewrap">
        <div class="im__votehead">&iquest;Qui&eacute;n es el impostor?</div>
        <p class="im__votesub">Toc&aacute; una ficha para acusar. Toc&aacute; de nuevo para sacar tu voto. Si hay empate, el impostor zafa.</p>
        <div class="im__lineup">${suspects}</div>
      </div>`;

    for (const btn of this.panelEl.querySelectorAll<HTMLButtonElement>(".im__suspect")) {
      if (btn.disabled) continue;
      btn.addEventListener("click", () => this.voteCb(btn.dataset.target!));
    }
  }

  // ---------- Vista: adivinanza (ultima chance) ----------

  private renderGuess(s: ImState): void {
    if (this.panelMode === "guess") return; // input propio: no reconstruir
    this.panelMode = "guess";
    const accused = s.accused ?? "";
    const amAccused = accused === this.me;
    const mug = accused ? mugCard(accused, "im-mug--big", `<span class="im__stamp im__stamp--mug">Acusado</span>`) : "";

    if (amAccused) {
      this.panelEl.innerHTML = `
        <div class="im__guesswrap">
          ${mug}
          <div class="im__guesshead">Te descubrieron</div>
          <p class="im__guesssub">&Uacute;ltima chance: adivin&aacute; la palabra secreta (${esc(s.category ?? "")}) y te rob&aacute;s la ronda.</p>
          <form class="im__cluebar" novalidate>
            <input class="im__clue-input" type="text" autocomplete="off" autocapitalize="none"
                   spellcheck="false" maxlength="${MAX_WORD_LEN}" placeholder="la palabra secreta" />
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
      input.focus({ preventScroll: true });
    } else {
      this.panelEl.innerHTML = `
        <div class="im__guesswrap">
          ${mug}
          <div class="im__guesshead"><strong>${esc(accused)}</strong> fue descubierto</div>
          <p class="im__guesssub">Tiene una &uacute;ltima chance: si adivina la palabra, se roba la ronda...</p>
        </div>`;
    }
  }

  // ---------- Vista: resultado (caso cerrado) ----------

  private renderResult(s: ImState): void {
    const outcome = s.outcome;
    const sig = `${s.round}|${outcome?.kind}|${(s.impostors ?? []).join(",")}`;
    // El estado se re-difunde cada tanto: los sellos no pueden volver a golpear.
    if (this.panelMode === "result" && this.resultSig === sig) return;
    this.panelMode = "result";
    this.resultSig = sig;
    const impostors = s.impostors ?? [];
    const title = outcome ? (OUTCOME_TITLE[outcome.kind] ?? "Resultado") : "Resultado";
    const winners = outcome?.winners === "impostores" ? "Ganan los impostores" : "Ganan los inocentes";
    const guessLine =
      outcome?.kind === "impostor-guessed" || outcome?.kind === "impostor-caught"
        ? `<p class="im__result-guess">El impostor dijo: <strong>${outcome.guess ? esc(outcome.guess) : "nada"}</strong></p>`
        : "";

    // Las fichas del veredicto: los impostores (culpables o profugos) y, si la mesa acuso
    // a un inocente, el inocente con su sello.
    const caught = outcome?.kind === "impostor-caught";
    const faces = impostors.map((name) =>
      mugCard(
        name,
        "im-mug--verdict",
        `<span class="im__stamp im__stamp--mug ${caught ? "is-guilty" : "is-escaped"}">${caught ? "Culpable" : "Pr&oacute;fugo"}</span>`,
      ),
    );
    if (s.accused && !impostors.includes(s.accused)) {
      faces.push(mugCard(s.accused, "im-mug--verdict", `<span class="im__stamp im__stamp--mug is-innocent">Inocente</span>`));
    }

    const scores = outcome?.scores ?? [];
    const votes = s.votes ?? [];
    const scoreRows = s.players
      .map((p) => {
        const row = scores.find((x) => x.player === p.nickname);
        const pts = row?.points ?? 0;
        const isImp = impostors.includes(p.nickname);
        const got = votes.filter((v) => v.target === p.nickname).length;
        const cls = ["im__score"];
        if (p.nickname === this.me) cls.push("is-me");
        if (p.nickname === s.accused) cls.push("is-accused");
        // "Lo vio": inocente que voto a un impostor (su bonus ya viene sumado en `pts`).
        const eye = row?.votedRight ? `<span class="im__score-eye">lo vio</span>` : "";
        return `
          <div class="${cls.join(" ")}">
            <span class="im__score-role ${isImp ? "is-impostor" : "is-crew"}">${isImp ? "impostor" : "inocente"}</span>
            <span class="im__score-name">${esc(p.nickname)}${eye}</span>
            <span class="im__score-votes">${got > 0 ? `${got} ${got === 1 ? "voto" : "votos"}` : ""}</span>
            <span class="im__score-pts">${pts > 0 ? `+${pts}` : "0"}</span>
          </div>`;
      })
      .join("");

    this.panelEl.innerHTML = `
      <div class="im__result${outcome?.winners === "impostores" ? " is-impostor" : " is-crew"}">
        <div class="im__file-kicker">Expediente N&ordm; ${caseNumber(s)} &middot; Caso: ${esc(s.category ?? "")}</div>
        <div class="im__result-title">${title}</div>
        <div class="im__result-word">La palabra era <strong>${esc(s.word ?? "")}</strong></div>
        <div class="im__verdict">${faces.join("")}</div>
        ${guessLine}
        <div class="im__result-winner">${winners}</div>
        <div class="im__scores">${scoreRows}</div>
        <div class="im__stamp im__stamp--closed">Caso cerrado</div>
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
