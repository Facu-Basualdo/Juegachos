import { seatColor } from "./constants";
import type { JoystickView } from "./InputController";

/**
 * HUD de Derrumbe, en DOM sobre el canvas (DESIGN.md: letra en negrita con sombra
 * dura, paneles negros traslucidos de bordes rectos).
 *
 * No monta el `LeaderboardPanel` compartido: el juego es solo de sala y en sala el
 * puntaje va a la ronda, nunca al ranking global.
 */

export interface PlayerRow {
  seat: number;
  name: string;
  alive: boolean;
  /** Ms aguantados, o -1 mientras sigue vivo. */
  time: number;
  mine: boolean;
  offline: boolean;
}

const FEED_MS = 3800;

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly aliveEl: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly decayEl: HTMLDivElement;
  private readonly playersEl: HTMLOListElement;
  private readonly feedEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly stickRing: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private playersSig = "";

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "dr";

    const top = document.createElement("div");
    top.className = "dr__top";
    this.aliveEl = document.createElement("div");
    this.aliveEl.className = "dr__alive";
    this.clockEl = document.createElement("div");
    this.clockEl.className = "dr__clock";
    this.clockEl.textContent = "0.0";
    top.append(this.aliveEl, this.clockEl);

    this.decayEl = document.createElement("div");
    this.decayEl.className = "dr__decay";
    this.decayEl.textContent = "EL PISO SE ESTÁ PUDRIENDO";
    this.decayEl.hidden = true;

    this.playersEl = document.createElement("ol");
    this.playersEl.className = "dr__players";

    this.feedEl = document.createElement("div");
    this.feedEl.className = "dr__feed";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "dr__banner";
    this.bannerEl.hidden = true;

    const controls = document.createElement("div");
    controls.className = "dr-controls";
    this.jumpBtn = document.createElement("button");
    this.jumpBtn.type = "button";
    this.jumpBtn.className = "dr-controls__jump";
    this.jumpBtn.textContent = "SALTAR";
    controls.append(this.jumpBtn);

    this.stickRing = document.createElement("div");
    this.stickRing.className = "dr-stick";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "dr-stick__knob";
    this.stickRing.append(this.stickKnob);
    this.stickRing.hidden = true;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "dr__overlay";
    this.overlayEl.hidden = true;

    this.root.append(
      top,
      this.decayEl,
      this.playersEl,
      this.feedEl,
      this.bannerEl,
      controls,
      this.stickRing,
      this.countdownEl,
      this.overlayEl,
    );
    container.append(this.root);
    this.showHud(false);
  }

  onJump(cb: () => void): void {
    // pointerdown y no click: en el celu el click llega ~300 ms tarde y el salto es
    // una accion de reflejos.
    this.jumpBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cb();
    });
  }

  showHud(visible: boolean): void {
    this.root.classList.toggle("dr--playing", visible);
  }

  /** Muerto: se esconden los controles, queda el marcador. */
  setSpectating(spectating: boolean): void {
    this.root.classList.toggle("dr--spectating", spectating);
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

  setAlive(alive: number, total: number): void {
    this.aliveEl.textContent = `EN PIE ${alive}/${total}`;
  }

  /** Tiempo aguantado, en segundos con un decimal. */
  setClock(ms: number): void {
    this.clockEl.textContent = formatSeconds(ms);
  }

  setDecay(on: boolean): void {
    this.decayEl.hidden = !on;
  }

  setPlayers(rows: PlayerRow[]): void {
    const sig = rows.map((r) => `${r.seat}:${r.alive}:${r.time}:${r.offline}`).join("|");
    if (sig === this.playersSig) return;
    this.playersSig = sig;
    // Los vivos arriba; los caidos abajo, del que mas aguanto al que menos.
    const sorted = [...rows].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.time - a.time;
    });
    this.playersEl.innerHTML = sorted
      .map(
        (r) => `
        <li class="dr__player${r.alive ? "" : " dr__player--out"}${r.mine ? " dr__player--mine" : ""}${
          r.offline ? " dr__player--offline" : ""
        }">
          <span class="dr__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="dr__player-name">${escapeHtml(r.name)}</span>
          <span class="dr__player-time">${r.alive ? "" : formatSeconds(r.time)}</span>
        </li>`,
      )
      .join("");
  }

  /** Aviso corto (quien cayo), que se va solo. */
  feed(html: string): void {
    const item = document.createElement("div");
    item.className = "dr__feed-item";
    item.innerHTML = html;
    this.feedEl.prepend(item);
    while (this.feedEl.children.length > 4) this.feedEl.lastElementChild?.remove();
    window.setTimeout(() => item.classList.add("is-gone"), FEED_MS);
    window.setTimeout(() => item.remove(), FEED_MS + 400);
  }

  /** Cartel grande del centro (CAISTE / GANASTE). `null` lo esconde. */
  banner(title: string | null, sub = "", tone: "bad" | "good" = "bad"): void {
    if (title === null) {
      this.bannerEl.hidden = true;
      return;
    }
    this.bannerEl.hidden = false;
    this.bannerEl.className = `dr__banner dr__banner--${tone}`;
    this.bannerEl.innerHTML = `<div class="dr__banner-title">${title}</div>${
      sub ? `<div class="dr__banner-sub">${sub}</div>` : ""
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
      <div class="dr__card">
        <h1 class="dr__card-title">${title}</h1>
        <div class="dr__card-body">${bodyHtml}</div>
        ${action ? `<button class="dr__card-btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlayEl.querySelector<HTMLButtonElement>(".dr__card-btn")!.addEventListener("click", action.onClick);
    }
  }

  /** Tabla final: del que mas aguanto al que menos. */
  showResults(rows: PlayerRow[]): void {
    const sorted = [...rows].sort((a, b) => b.time - a.time);
    const list = sorted
      .map(
        (r, i) => `
        <li class="dr__result${r.mine ? " dr__result--mine" : ""}">
          <span class="dr__result-pos">${i + 1}</span>
          <span class="dr__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="dr__result-name">${escapeHtml(r.name)}</span>
          <span class="dr__result-value">${formatSeconds(Math.max(0, r.time))} s</span>
        </li>`,
      )
      .join("");
    const mine = sorted.findIndex((r) => r.mine);
    const headline = mine === 0 ? "Quedaste en pie" : mine < 0 ? "Se terminó" : `Saliste ${mine + 1}º`;
    this.showMessage(headline, `<ol class="dr__results">${list}</ol>`);
  }

  hideMessage(): void {
    this.overlayEl.hidden = true;
    this.overlayEl.innerHTML = "";
  }
}

export function formatSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
