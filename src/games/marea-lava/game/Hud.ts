import { seatColor } from "./constants";
import type { JoystickView } from "./InputController";

/**
 * HUD de Marea de Lava, en DOM sobre el canvas (DESIGN.md: letra en negrita con
 * sombra dura, paneles negros traslucidos de bordes rectos). Sale del de Derrumbe.
 *
 * No monta el `LeaderboardPanel` compartido: el juego es solo de sala y en sala el
 * puntaje va a la ronda, nunca al ranking global.
 */

export interface PlayerRow {
  seat: number;
  name: string;
  status: "run" | "dead" | "top";
  /** Mejor altura (m). */
  best: number;
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
    this.root.className = "ml";

    const top = document.createElement("div");
    top.className = "ml__top";
    this.aliveEl = document.createElement("div");
    this.aliveEl.className = "ml__alive";
    this.clockEl = document.createElement("div");
    this.clockEl.className = "ml__clock";
    this.clockEl.textContent = "0 m";
    top.append(this.aliveEl, this.clockEl);

    this.decayEl = document.createElement("div");
    this.decayEl.className = "ml__decay";
    this.decayEl.textContent = "";
    this.decayEl.hidden = true;

    this.playersEl = document.createElement("ol");
    this.playersEl.className = "ml__players";

    this.feedEl = document.createElement("div");
    this.feedEl.className = "ml__feed";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "ml__banner";
    this.bannerEl.hidden = true;

    const controls = document.createElement("div");
    controls.className = "ml-controls";
    this.jumpBtn = document.createElement("button");
    this.jumpBtn.type = "button";
    this.jumpBtn.className = "ml-controls__jump";
    this.jumpBtn.textContent = "SALTAR";
    controls.append(this.jumpBtn);

    this.stickRing = document.createElement("div");
    this.stickRing.className = "ml-stick";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "ml-stick__knob";
    this.stickRing.append(this.stickKnob);
    this.stickRing.hidden = true;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "ml__overlay";
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
    this.root.classList.toggle("ml--playing", visible);
  }

  /** Muerto: se esconden los controles, queda el marcador. */
  setSpectating(spectating: boolean): void {
    this.root.classList.toggle("ml--spectating", spectating);
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
    this.aliveEl.textContent = `TREPANDO ${alive}/${total}`;
  }

  /** Altura propia. */
  setHeight(y: number): void {
    this.clockEl.textContent = `${Math.max(0, y).toFixed(1)} m`;
  }

  /** Distancia a la lava; late en rojo cuando esta cerca. `null` lo esconde. */
  setLava(gap: number | null): void {
    if (gap === null) {
      this.decayEl.hidden = true;
      return;
    }
    this.decayEl.hidden = false;
    this.decayEl.textContent = `LAVA A ${Math.max(0, gap).toFixed(1)} m`;
    this.decayEl.classList.toggle("ml__lava--near", gap < 3);
  }

  setPlayers(rows: PlayerRow[]): void {
    const sig = rows.map((r) => `${r.seat}:${r.status}:${Math.round(r.best)}:${r.offline}`).join("|");
    if (sig === this.playersSig) return;
    this.playersSig = sig;
    // Los vivos arriba; los caidos abajo, del que mas aguanto al que menos.
    const sorted = [...rows].sort((a, b) => b.best - a.best);
    this.playersEl.innerHTML = sorted
      .map(
        (r) => `
        <li class="ml__player${r.status === "dead" ? " ml__player--out" : ""}${r.mine ? " ml__player--mine" : ""}${
          r.offline ? " ml__player--offline" : ""
        }">
          <span class="ml__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="ml__player-name">${escapeHtml(r.name)}</span>
          <span class="ml__player-time">${r.status === "top" ? "CIMA" : `${Math.round(r.best)} m`}</span>
        </li>`,
      )
      .join("");
  }

  /** Aviso corto (quien cayo), que se va solo. */
  feed(html: string): void {
    const item = document.createElement("div");
    item.className = "ml__feed-item";
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
    this.bannerEl.className = `ml__banner ml__banner--${tone}`;
    this.bannerEl.innerHTML = `<div class="ml__banner-title">${title}</div>${
      sub ? `<div class="ml__banner-sub">${sub}</div>` : ""
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
      <div class="ml__card">
        <h1 class="ml__card-title">${title}</h1>
        <div class="ml__card-body">${bodyHtml}</div>
        ${action ? `<button class="ml__card-btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlayEl.querySelector<HTMLButtonElement>(".ml__card-btn")!.addEventListener("click", action.onClick);
    }
  }

  /** Tabla final: por altura (los que llegaron a la cima, por orden de llegada). */
  showResults(rows: PlayerRow[], topTimes: number[]): void {
    const sorted = [...rows].sort((a, b) => {
      if (a.status === "top" && b.status === "top") return topTimes[a.seat] - topTimes[b.seat];
      return b.best - a.best;
    });
    const list = sorted
      .map(
        (r, i) => `
        <li class="ml__result${r.mine ? " ml__result--mine" : ""}">
          <span class="ml__result-pos">${i + 1}</span>
          <span class="ml__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="ml__result-name">${escapeHtml(r.name)}</span>
          <span class="ml__result-value">${r.status === "top" ? "cima" : `${r.best.toFixed(1)} m`}</span>
        </li>`,
      )
      .join("");
    const mine = sorted.findIndex((r) => r.mine);
    const headline = mine === 0 ? "Llegaste m&aacute;s alto" : mine < 0 ? "Se termin&oacute;" : `Saliste ${mine + 1}º`;
    this.showMessage(headline, `<ol class="ml__results">${list}</ol>`);
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
