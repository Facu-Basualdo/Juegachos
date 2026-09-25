import { CHANT } from "./SoundEffects";
import { seatColor } from "./constants";
import type { JoystickView } from "./InputController";
import type { LrStatus } from "./LuzRojaProtocol";

/**
 * HUD de Luz Roja, Luz Verde (DESIGN.md: la voz del galpon). Arriba, el cartel de
 * la luz con la cancion debajo (las silabas se van marcando); el reloj rojo
 * digital; a la derecha, la regla con el avance de cada uno hacia la meta.
 *
 * No monta el `LeaderboardPanel`: es solo de sala y en sala el puntaje nunca va al
 * ranking global.
 */

export interface RunnerRow {
  seat: number;
  name: string;
  number: string;
  status: LrStatus;
  /** Avance 0-100. */
  prog: number;
  /** Ms en que cruzo, o -1. */
  finT: number;
  mine: boolean;
}

const FEED_MS = 3600;

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly lightEl: HTMLDivElement;
  private readonly lightTextEl: HTMLDivElement;
  private readonly chantEl: HTMLDivElement;
  private readonly chantSpans: HTMLSpanElement[] = [];
  private readonly clockEl: HTMLDivElement;
  private readonly countEl: HTMLDivElement;
  private readonly trackEl: HTMLDivElement;
  private readonly dots = new Map<number, HTMLDivElement>();
  private readonly feedEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly stickRing: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "lr";

    const top = document.createElement("div");
    top.className = "lr__top";
    this.lightEl = document.createElement("div");
    this.lightEl.className = "lr__light";
    this.lightTextEl = document.createElement("div");
    this.lightTextEl.className = "lr__light-text";
    this.chantEl = document.createElement("div");
    this.chantEl.className = "lr__chant";
    for (const syl of CHANT) {
      const span = document.createElement("span");
      span.textContent = syl;
      this.chantSpans.push(span);
      this.chantEl.append(span);
    }
    this.lightEl.append(this.lightTextEl, this.chantEl);

    const side = document.createElement("div");
    side.className = "lr__side";
    this.clockEl = document.createElement("div");
    this.clockEl.className = "lr__clock";
    this.countEl = document.createElement("div");
    this.countEl.className = "lr__count";
    side.append(this.clockEl, this.countEl);
    top.append(this.lightEl, side);

    this.trackEl = document.createElement("div");
    this.trackEl.className = "lr__track";
    const goal = document.createElement("div");
    goal.className = "lr__track-goal";
    goal.textContent = "META";
    this.trackEl.append(goal);

    this.feedEl = document.createElement("div");
    this.feedEl.className = "lr__feed";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "lr__banner";
    this.bannerEl.hidden = true;

    this.stickRing = document.createElement("div");
    this.stickRing.className = "lr-stick";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "lr-stick__knob";
    this.stickRing.append(this.stickKnob);
    this.stickRing.hidden = true;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "lr__overlay";
    this.overlayEl.hidden = true;

    this.root.append(
      top,
      this.trackEl,
      this.feedEl,
      this.bannerEl,
      this.stickRing,
      this.countdownEl,
      this.overlayEl,
    );
    container.append(this.root);
    this.showHud(false);
    this.setLight(null);
  }

  showHud(visible: boolean): void {
    this.root.classList.toggle("lr--playing", visible);
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

  /** Cartel de la luz. `watching` = los ojos ya estan prendidos (el rojo "de verdad"). */
  setLight(light: "green" | "red" | null, watching = false): void {
    this.lightEl.classList.toggle("lr__light--green", light === "green");
    this.lightEl.classList.toggle("lr__light--red", light === "red");
    this.lightEl.classList.toggle("lr__light--watch", light === "red" && watching);
    this.lightTextEl.textContent = light === "green" ? "LUZ VERDE" : light === "red" ? "LUZ ROJA" : "PREPARADOS";
  }

  /** Cuantas silabas de la cancion ya se cantaron (0 = ninguna). */
  setChant(sung: number): void {
    this.chantSpans.forEach((span, i) => span.classList.toggle("is-sung", i < sung));
  }

  setClock(msLeft: number): void {
    const total = Math.max(0, Math.ceil(msLeft / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    this.clockEl.textContent = `${mm}:${ss}`;
    this.clockEl.classList.toggle("lr__clock--urgent", total <= 10);
  }

  setRunners(rows: RunnerRow[]): void {
    const running = rows.filter((r) => r.status === "run").length;
    const passed = rows.filter((r) => r.status === "fin").length;
    this.countEl.textContent = `EN JUEGO ${running} · PASARON ${passed}`;
    for (const r of rows) {
      let dot = this.dots.get(r.seat);
      if (!dot) {
        dot = document.createElement("div");
        dot.className = `lr__dot${r.mine ? " lr__dot--mine" : ""}`;
        dot.style.background = seatColor(r.seat);
        dot.textContent = r.number;
        this.dots.set(r.seat, dot);
        this.trackEl.append(dot);
      }
      dot.style.bottom = `${Math.min(100, r.prog)}%`;
      dot.classList.toggle("lr__dot--out", r.status === "out");
      dot.classList.toggle("lr__dot--fin", r.status === "fin");
    }
  }

  feed(html: string): void {
    const item = document.createElement("div");
    item.className = "lr__feed-item";
    item.innerHTML = html;
    this.feedEl.prepend(item);
    while (this.feedEl.children.length > 4) this.feedEl.lastElementChild?.remove();
    window.setTimeout(() => item.classList.add("is-gone"), FEED_MS);
    window.setTimeout(() => item.remove(), FEED_MS + 400);
  }

  banner(title: string | null, sub = "", tone: "bad" | "good" = "bad"): void {
    if (title === null) {
      this.bannerEl.hidden = true;
      return;
    }
    this.bannerEl.hidden = false;
    this.bannerEl.className = `lr__banner lr__banner--${tone}`;
    this.bannerEl.innerHTML = `<div class="lr__banner-title">${title}</div>${
      sub ? `<div class="lr__banner-sub">${sub}</div>` : ""
    }`;
  }

  setJoystick(view: JoystickView | null): void {
    if (!view) {
      this.stickRing.hidden = true;
      return;
    }
    this.stickRing.hidden = false;
    this.stickRing.style.transform = `translate(${view.originX}px, ${view.originY}px)`;
    const dx = view.x - view.originX;
    const dy = view.y - view.originY;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(len, 52) / len;
    this.stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  showMessage(title: string, bodyHtml: string, action?: { label: string; onClick: () => void }): void {
    this.overlayEl.hidden = false;
    this.overlayEl.innerHTML = `
      <div class="lr__card">
        <h1 class="lr__card-title">${title}</h1>
        <div class="lr__card-body">${bodyHtml}</div>
        ${action ? `<button class="lr__card-btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlayEl.querySelector<HTMLButtonElement>(".lr__card-btn")!.addEventListener("click", action.onClick);
    }
  }

  /** Tabla final: los que pasaron por orden de llegada, despues el resto por avance. */
  showResults(rows: RunnerRow[]): void {
    const sorted = [...rows].sort((a, b) => {
      if ((a.status === "fin") !== (b.status === "fin")) return a.status === "fin" ? -1 : 1;
      if (a.status === "fin") return a.finT - b.finT;
      return b.prog - a.prog;
    });
    const list = sorted
      .map((r, i) => {
        const value = r.status === "fin" ? `${(r.finT / 1000).toFixed(1)} s` : `${Math.round(r.prog)}%`;
        return `
        <li class="lr__result${r.mine ? " lr__result--mine" : ""}${r.status === "out" ? " lr__result--out" : ""}">
          <span class="lr__result-pos">${i + 1}</span>
          <span class="lr__result-num" style="background:${seatColor(r.seat)}">${r.number}</span>
          <span class="lr__result-name">${escapeHtml(r.name)}</span>
          <span class="lr__result-value">${value}</span>
        </li>`;
      })
      .join("");
    const mine = rows.find((r) => r.mine);
    const headline = !mine ? "Se termin&oacute;" : mine.status === "fin" ? "Pasaste" : "Eliminado";
    this.showMessage(headline, `<ol class="lr__results">${list}</ol>`);
  }

  hideMessage(): void {
    this.overlayEl.hidden = true;
    this.overlayEl.innerHTML = "";
  }
}

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
