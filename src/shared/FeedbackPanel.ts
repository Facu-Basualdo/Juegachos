import { games } from "../games";
import { FEEDBACK_MAX, isFeedbackEnabled, myVote, sendFeedback, type FeedbackKind, type FeedbackSource } from "./feedback";

/**
 * "¿Te gustó?" con pulgares, y debajo un formulario corto para contar mas (bug, idea u
 * otro). Lo monta el `LeaderboardPanel` en el game over de cada juego (asi ningun juego
 * tuvo que tocarse) y el `RoomOverlay` en los resultados de cada ronda.
 *
 * Nunca interrumpe: es una linea; el formulario se abre solo si el jugador toca "Contanos
 * mas" / "Reportar un problema", o con el pulgar abajo (ahi es cuando mas importa saber
 * por que). Toma el color del texto de la pantalla donde queda (`currentColor`), igual
 * que las tarjetas de `HowToPanel`, asi respeta el estilo de cada juego.
 */

const STYLE_ID = "mg-feedback-styles";

const CSS = `
/* El display de cada parte le ganaba al atributo hidden: el formulario salia abierto. */
.mg-fb [hidden] { display: none !important; }
.mg-fb { width: 100%; max-width: 360px; margin: 0 auto 0.9rem; font-family: inherit; color: inherit; text-align: center; }
.mg-fb__row { display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; }
.mg-fb__q { font-size: 0.9rem; font-weight: 700; }
.mg-fb__thumb {
  display: inline-grid; place-items: center; width: 2.3rem; height: 2.3rem; border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, currentColor 35%, transparent);
  background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; cursor: pointer;
  transition: transform 0.15s, background 0.15s, border-color 0.15s;
}
.mg-fb__thumb svg { width: 1.15rem; height: 1.15rem; }
.mg-fb__thumb:hover { transform: translateY(-2px); border-color: currentColor; }
.mg-fb__thumb[aria-pressed="true"] { background: color-mix(in srgb, currentColor 24%, transparent); border: 2.5px solid currentColor; }
.mg-fb__thumb[aria-pressed="true"] svg { fill: color-mix(in srgb, currentColor 45%, transparent); }
.mg-fb__links { display: flex; justify-content: center; gap: 0.9rem; margin-top: 0.35rem; font-size: 0.78rem; }
.mg-fb__link { background: none; border: 0; padding: 0; color: inherit; font: inherit; opacity: 0.7; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.mg-fb__link:hover { opacity: 1; }
.mg-fb__form { display: grid; gap: 0.45rem; margin-top: 0.55rem; text-align: left; }
.mg-fb__kinds { display: flex; gap: 0.3rem; justify-content: center; }
.mg-fb__kind {
  padding: 0.22rem 0.7rem; border-radius: 999px; font: inherit; font-size: 0.78rem; cursor: pointer; color: inherit;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; opacity: 0.75;
}
.mg-fb__kind[aria-pressed="true"] { opacity: 1; font-weight: 700; background: color-mix(in srgb, currentColor 14%, transparent); border-color: currentColor; }
.mg-fb__text {
  width: 100%; box-sizing: border-box; min-height: 4.2rem; resize: vertical; padding: 0.5rem 0.6rem; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: color-mix(in srgb, currentColor 6%, transparent);
  color: inherit; font: inherit; font-size: 0.85rem; line-height: 1.35;
}
.mg-fb__text:focus { outline: none; border-color: currentColor; }
.mg-fb__text::placeholder { color: inherit; opacity: 0.5; }
.mg-fb__send-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.mg-fb__count { font-size: 0.72rem; opacity: 0.5; font-variant-numeric: tabular-nums; }
.mg-fb__send {
  padding: 0.4rem 0.95rem; border-radius: 999px; border: 2px solid currentColor; cursor: pointer; color: inherit;
  background: color-mix(in srgb, currentColor 16%, transparent); font: inherit; font-size: 0.82rem; font-weight: 700;
}
.mg-fb__send:hover:not(:disabled) { background: color-mix(in srgb, currentColor 28%, transparent); }
.mg-fb__send:disabled { opacity: 0.4; cursor: default; }
.mg-fb__note { font-size: 0.8rem; opacity: 0.75; margin-top: 0.35rem; }
.mg-fb__note:empty { display: none; }
`;

const THUMB = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3z"/><path d="M7 10l4-7a2.4 2.4 0 0 1 2.6 2.8L13 9h5.6a2 2 0 0 1 2 2.4l-1.4 7.2A2 2 0 0 1 17.2 21H7"/></svg>`;
const THUMB_DOWN = THUMB.replace("<svg ", `<svg style="transform: rotate(180deg)" `);

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const KINDS: { kind: FeedbackKind; label: string }[] = [
  { kind: "bug", label: "Problema" },
  { kind: "idea", label: "Idea" },
  { kind: "other", label: "Otro" },
];

const PLACEHOLDER: Partial<Record<FeedbackKind, string>> = {
  bug: "¿Qué pasó? Contanos qué estabas haciendo.",
  idea: "¿Qué le agregarías o cambiarías?",
  other: "Lo que quieras contarnos.",
};

export interface FeedbackShowOpts {
  gameId: string;
  source: FeedbackSource;
  room?: string | null;
  /**
   * Mismo `key` que la vez anterior = misma pantalla (el overlay de sala se redibuja en
   * cada sync): conserva lo que el jugador estaba escribiendo. Sin `key` siempre empieza
   * de cero.
   */
  key?: string;
}

export class FeedbackPanel {
  readonly root: HTMLDivElement;
  private readonly qEl: HTMLElement;
  private readonly upBtn: HTMLButtonElement;
  private readonly downBtn: HTMLButtonElement;
  private readonly linksEl: HTMLElement;
  private readonly moreBtn: HTMLButtonElement;
  private readonly formEl: HTMLFormElement;
  private readonly textEl: HTMLTextAreaElement;
  private readonly countEl: HTMLElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly noteEl: HTMLElement;
  private readonly kindBtns = new Map<FeedbackKind, HTMLButtonElement>();
  private opts: FeedbackShowOpts | null = null;
  private kind: FeedbackKind = "bug";
  private sending = false;

  constructor() {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "mg-fb";
    this.root.style.display = "none";
    this.root.innerHTML = `
      <div class="mg-fb__row">
        <span class="mg-fb__q"></span>
        <button type="button" class="mg-fb__thumb" data-vote="like" aria-label="Me gustó" aria-pressed="false">${THUMB}</button>
        <button type="button" class="mg-fb__thumb" data-vote="dislike" aria-label="No me gustó" aria-pressed="false">${THUMB_DOWN}</button>
      </div>
      <div class="mg-fb__links">
        <button type="button" class="mg-fb__link" data-act="more">Contanos más</button>
        <button type="button" class="mg-fb__link" data-act="bug">Reportar un problema</button>
      </div>
      <div class="mg-fb__note" aria-live="polite"></div>
      <form class="mg-fb__form" hidden>
        <div class="mg-fb__kinds">${KINDS.map((k) => `<button type="button" class="mg-fb__kind" data-kind="${k.kind}" aria-pressed="false">${k.label}</button>`).join("")}</div>
        <textarea class="mg-fb__text" maxlength="${FEEDBACK_MAX}" rows="3" aria-label="Tu mensaje"></textarea>
        <div class="mg-fb__send-row"><span class="mg-fb__count"></span><button type="submit" class="mg-fb__send">Enviar</button></div>
      </form>
    `;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.qEl = q(".mg-fb__q");
    this.upBtn = q('[data-vote="like"]');
    this.downBtn = q('[data-vote="dislike"]');
    this.linksEl = q(".mg-fb__links");
    this.moreBtn = q('[data-act="more"]');
    this.formEl = q(".mg-fb__form");
    this.textEl = q(".mg-fb__text");
    this.countEl = q(".mg-fb__count");
    this.sendBtn = q(".mg-fb__send");
    this.noteEl = q(".mg-fb__note");
    for (const b of this.root.querySelectorAll<HTMLButtonElement>("[data-kind]")) {
      this.kindBtns.set(b.dataset.kind as FeedbackKind, b);
      b.addEventListener("click", () => this.setKind(b.dataset.kind as FeedbackKind));
    }

    // Los toques y las teclas de adentro no llegan al "toca para reiniciar" del juego.
    const stop = (e: Event) => e.stopPropagation();
    for (const ev of ["pointerdown", "mousedown", "click", "touchstart", "keydown", "keyup"]) this.root.addEventListener(ev, stop);

    this.upBtn.addEventListener("click", () => void this.vote("like"));
    this.downBtn.addEventListener("click", () => void this.vote("dislike"));
    this.moreBtn.addEventListener("click", () => this.open("idea"));
    q('[data-act="bug"]').addEventListener("click", () => this.open("bug"));
    this.textEl.addEventListener("input", () => this.syncSend());
    this.textEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void this.submit();
      }
    });
    this.formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.submit();
    });
  }

  /** Se ve en el game over / resultados. Sin donde mandarlo, no aparece. */
  show(opts: FeedbackShowOpts): void {
    if (!isFeedbackEnabled()) {
      this.hide();
      return;
    }
    const same = opts.key !== undefined && this.opts?.key === opts.key && this.opts.gameId === opts.gameId;
    this.opts = opts;
    this.root.style.display = "";
    if (same) return;
    const title = games.find((g) => g.id === opts.gameId)?.title;
    this.qEl.textContent = title ? `¿Te gustó ${title}?` : "¿Te gustó este juego?";
    this.paintVote(myVote(opts.gameId));
    this.formEl.hidden = true;
    this.linksEl.hidden = false;
    this.textEl.value = "";
    this.noteEl.textContent = "";
    this.syncSend();
  }

  hide(): void {
    this.root.style.display = "none";
  }

  private paintVote(v: "like" | "dislike" | null): void {
    this.upBtn.setAttribute("aria-pressed", String(v === "like"));
    this.downBtn.setAttribute("aria-pressed", String(v === "dislike"));
  }

  private async vote(v: "like" | "dislike"): Promise<void> {
    const o = this.opts;
    if (!o || myVote(o.gameId) === v) return;
    this.paintVote(v);
    const res = await sendFeedback({ kind: v, source: o.source, gameId: o.gameId, room: o.room });
    if (res !== "ok") {
      this.paintVote(myVote(o.gameId));
      this.noteEl.textContent = res === "limit" ? "Mandaste mucho seguido. Probá en un rato." : "No se pudo enviar.";
      return;
    }
    if (v === "dislike") {
      // El pulgar abajo es cuando mas sirve saber por que: se abre solo.
      this.open("other", "Gracias. ¿Qué no te gustó?");
    } else if (this.formEl.hidden) {
      this.noteEl.textContent = "¡Gracias!";
      this.moreBtn.textContent = "Contanos más";
    }
  }

  private open(kind: FeedbackKind, note = ""): void {
    this.formEl.hidden = false;
    this.linksEl.hidden = true;
    this.noteEl.textContent = note;
    this.setKind(kind);
    this.textEl.focus();
  }

  private setKind(kind: FeedbackKind): void {
    this.kind = kind;
    for (const [k, b] of this.kindBtns) b.setAttribute("aria-pressed", String(k === kind));
    this.textEl.placeholder = PLACEHOLDER[kind] ?? "";
  }

  private syncSend(): void {
    const n = this.textEl.value.trim().length;
    this.sendBtn.disabled = this.sending || n < 3;
    this.countEl.textContent = n > FEEDBACK_MAX * 0.8 ? `${n}/${FEEDBACK_MAX}` : "";
  }

  private async submit(): Promise<void> {
    const o = this.opts;
    const message = this.textEl.value.trim();
    if (!o || this.sending || message.length < 3) return;
    this.sending = true;
    this.syncSend();
    this.noteEl.textContent = "Enviando...";
    const res = await sendFeedback({ kind: this.kind, source: o.source, gameId: o.gameId, room: o.room, message });
    this.sending = false;
    if (res === "ok") {
      this.textEl.value = "";
      this.formEl.hidden = true;
      this.linksEl.hidden = false;
      this.moreBtn.textContent = "Contar algo más";
      this.noteEl.textContent = "¡Gracias! Lo vamos a leer.";
    } else {
      this.noteEl.textContent = res === "limit" ? "Mandaste mucho seguido. Probá en un rato." : "No se pudo enviar. Probá de nuevo.";
    }
    this.syncSend();
  }
}
