import { HIGH_COLOR, LOW_COLOR, seatColor } from "./constants";
import type { JoystickView } from "./InputController";

/**
 * HUD de Laser Show (DESIGN.md "Prime Time": la grafica del programa). Placas
 * violetas con filete dorado; el cronometro de supervivencia es la cifra protagonista
 * porque es el puntaje; el locutor anuncia cada prueba con un zocalo que entra
 * deslizando.
 *
 * No monta el `LeaderboardPanel`: es solo de sala. La partida terminada igual entra al
 * ranking global (la registra `RoomMode`) y se ve desde la card de la landing.
 */

export interface PlayerRow {
  seat: number;
  name: string;
  alive: boolean;
  /** Ms aguantados, o -1 mientras sigue. */
  time: number;
  mine: boolean;
  offline: boolean;
}

const FEED_MS = 3600;
const THIRD_MS = 1900;

export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly aliveEl: HTMLDivElement;
  private readonly thirdEl: HTMLDivElement;
  private readonly playersEl: HTMLOListElement;
  private readonly feedEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly duckBtn: HTMLButtonElement;
  private readonly pushBtn: HTMLButtonElement;
  private readonly stickRing: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private pushSig = -1;
  private playersSig = "";
  private clockSig = "";
  private thirdTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "ls";

    const top = document.createElement("div");
    top.className = "ls__top";
    this.clockEl = document.createElement("div");
    this.clockEl.className = "ls__clock";
    this.aliveEl = document.createElement("div");
    this.aliveEl.className = "ls__alive";
    top.append(this.clockEl, this.aliveEl);

    this.thirdEl = document.createElement("div");
    this.thirdEl.className = "ls__third";

    const legend = document.createElement("div");
    legend.className = "ls__legend";
    legend.innerHTML = `
      <span><i style="background:${LOW_COLOR}"></i>ROJO: SALT&Aacute;</span>
      <span><i style="background:${HIGH_COLOR}"></i>CELESTE: AGACHATE</span>`;

    this.playersEl = document.createElement("ol");
    this.playersEl.className = "ls__players";
    this.feedEl = document.createElement("div");
    this.feedEl.className = "ls__feed";
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "ls__banner";
    this.bannerEl.hidden = true;

    const controls = document.createElement("div");
    controls.className = "ls-controls";
    this.pushBtn = this.button("ls-controls__push", "EMPUJAR");
    this.duckBtn = this.button("ls-controls__duck", "AGACHARSE");
    this.jumpBtn = this.button("ls-controls__jump", "SALTAR");
    controls.append(this.pushBtn, this.duckBtn, this.jumpBtn);

    this.stickRing = document.createElement("div");
    this.stickRing.className = "ls-stick";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "ls-stick__knob";
    this.stickRing.append(this.stickKnob);
    this.stickRing.hidden = true;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "ls__overlay";
    this.overlayEl.hidden = true;

    this.root.append(
      top,
      this.thirdEl,
      legend,
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

  private button(cls: string, text: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    return b;
  }

  onJump(cb: () => void): void {
    this.jumpBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cb();
    });
  }

  onPush(cb: () => void): void {
    this.pushBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cb();
    });
  }

  /** Agacharse se mantiene: avisa al apretar y al soltar (o si el dedo se va del boton). */
  onDuck(cb: (down: boolean) => void): void {
    this.duckBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.duckBtn.setPointerCapture(e.pointerId);
      this.duckBtn.classList.add("is-down");
      cb(true);
    });
    const up = (): void => {
      this.duckBtn.classList.remove("is-down");
      cb(false);
    };
    this.duckBtn.addEventListener("pointerup", up);
    this.duckBtn.addEventListener("pointercancel", up);
    this.duckBtn.addEventListener("lostpointercapture", up);
  }

  /** Enfriamiento del empujon: 0 = listo, 1 = recien usado. */
  setPushCooldown(left: number): void {
    const q = Math.round(left * 40);
    if (q === this.pushSig) return;
    this.pushSig = q;
    this.pushBtn.style.setProperty("--cd", String(q / 40));
    this.pushBtn.classList.toggle("is-cooling", q > 0);
  }

  showHud(visible: boolean): void {
    this.root.classList.toggle("ls--playing", visible);
  }

  setSpectating(spectating: boolean): void {
    this.root.classList.toggle("ls--spectating", spectating);
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

  /** Cronometro de supervivencia (el puntaje) y cuantos siguen, o la vuelta de honor, o el final. */
  setClock(ms: number, alive: number, total: number, mode: "run" | "lap" | "over"): void {
    const sig = `${Math.floor(Math.max(0, ms) / 100)}:${alive}:${total}:${mode}`;
    if (sig === this.clockSig) return;
    this.clockSig = sig;
    this.clockEl.textContent = formatSeconds(ms);
    this.aliveEl.textContent =
      mode === "over" ? "FIN DEL SHOW" : mode === "lap" ? "VUELTA DE HONOR" : `EN PIE ${alive}/${total}`;
    this.aliveEl.classList.toggle("is-lap", mode !== "run");
  }

  /** Zocalo del locutor: entra deslizando con el nombre de la prueba y se va solo. */
  announce(title: string): void {
    this.thirdEl.textContent = title;
    this.thirdEl.classList.remove("is-shown");
    void this.thirdEl.offsetWidth;
    this.thirdEl.classList.add("is-shown");
    if (this.thirdTimer !== null) window.clearTimeout(this.thirdTimer);
    this.thirdTimer = window.setTimeout(() => this.thirdEl.classList.remove("is-shown"), THIRD_MS);
  }

  setPlayers(rows: PlayerRow[]): void {
    const sig = rows.map((r) => `${r.seat}:${r.alive}:${r.time}:${r.offline}`).join("|");
    if (sig === this.playersSig) return;
    this.playersSig = sig;
    const sorted = [...rows].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.time - a.time;
    });
    this.playersEl.innerHTML = sorted
      .map(
        (r) => `
        <li class="ls__player${r.alive ? "" : " ls__player--out"}${r.mine ? " ls__player--mine" : ""}${
          r.offline ? " ls__player--offline" : ""
        }">
          <span class="ls__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="ls__player-name">${escapeHtml(r.name)}</span>
          <span class="ls__player-time">${r.alive ? "" : formatSeconds(r.time)}</span>
        </li>`,
      )
      .join("");
  }

  feed(html: string): void {
    const item = document.createElement("div");
    item.className = "ls__feed-item";
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
    this.bannerEl.className = `ls__banner ls__banner--${tone}`;
    this.bannerEl.innerHTML = `<div class="ls__banner-title">${title}</div>${
      sub ? `<div class="ls__banner-sub">${sub}</div>` : ""
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
      <div class="ls__card">
        <h1 class="ls__card-title">${title}</h1>
        <div class="ls__card-body">${bodyHtml}</div>
        ${action ? `<button class="ls__card-btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlayEl.querySelector<HTMLButtonElement>(".ls__card-btn")!.addEventListener("click", action.onClick);
    }
  }

  showResults(rows: PlayerRow[]): void {
    const sorted = [...rows].sort((a, b) => b.time - a.time);
    const list = sorted
      .map(
        (r, i) => `
        <li class="ls__result${r.mine ? " ls__result--mine" : ""}">
          <span class="ls__result-pos">${i + 1}</span>
          <span class="ls__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="ls__result-name">${escapeHtml(r.name)}</span>
          <span class="ls__result-value">${formatSeconds(r.time)}</span>
        </li>`,
      )
      .join("");
    const mine = sorted.findIndex((r) => r.mine);
    const headline = mine === 0 ? "&iexcl;Ganaste el show!" : mine < 0 ? "Fin del show" : `Saliste ${mine + 1}º`;
    this.showMessage(headline, `<ol class="ls__results">${list}</ol>`);
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
