import { seatColor } from "./constants";
import type { JoystickView } from "./InputController";

/**
 * HUD de La Cuerda, en DOM sobre el canvas (DESIGN.md: letra en negrita con sombra
 * dura, paneles oscuros traslucidos de bordes rectos). Sale del de Marea de Lava.
 *
 * No monta el `LeaderboardPanel` compartido: el juego es solo de sala y en sala el
 * puntaje va a la ronda, nunca al ranking global.
 */

export interface PlayerRow {
  seat: number;
  name: string;
  status: "run" | "dead" | "goal";
  /** Mejor avance (m). */
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
  private readonly pushBtn: HTMLButtonElement;
  private pushSig = -1;
  private readonly stickRing: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private playersSig = "";

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "lc";

    const top = document.createElement("div");
    top.className = "lc__top";
    this.aliveEl = document.createElement("div");
    this.aliveEl.className = "lc__alive";
    this.clockEl = document.createElement("div");
    this.clockEl.className = "lc__clock";
    this.clockEl.textContent = "0 / 0 m";
    top.append(this.aliveEl, this.clockEl);

    this.decayEl = document.createElement("div");
    this.decayEl.className = "lc__decay";
    this.decayEl.textContent = "";
    this.decayEl.hidden = true;

    this.playersEl = document.createElement("ol");
    this.playersEl.className = "lc__players";

    this.feedEl = document.createElement("div");
    this.feedEl.className = "lc__feed";

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "lc__banner";
    this.bannerEl.hidden = true;

    const controls = document.createElement("div");
    controls.className = "lc-controls";
    this.jumpBtn = document.createElement("button");
    this.jumpBtn.type = "button";
    this.jumpBtn.className = "lc-controls__jump";
    this.jumpBtn.textContent = "SALTAR";
    this.pushBtn = document.createElement("button");
    this.pushBtn.type = "button";
    this.pushBtn.className = "lc-controls__push";
    this.pushBtn.textContent = "EMPUJAR";
    controls.append(this.pushBtn, this.jumpBtn);

    this.stickRing = document.createElement("div");
    this.stickRing.className = "lc-stick";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "lc-stick__knob";
    this.stickRing.append(this.stickKnob);
    this.stickRing.hidden = true;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "lc__overlay";
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

  onPush(cb: () => void): void {
    this.pushBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cb();
    });
  }

  /** Enfriamiento del empujon: 0 = listo, 1 = recien usado. El boton se llena de abajo. */
  setPushCooldown(left: number): void {
    const q = Math.round(left * 40);
    if (q === this.pushSig) return;
    this.pushSig = q;
    this.pushBtn.style.setProperty("--cd", String(q / 40));
    this.pushBtn.classList.toggle("is-cooling", q > 0);
  }

  showHud(visible: boolean): void {
    this.root.classList.toggle("lc--playing", visible);
  }

  /** Muerto: se esconden los controles, queda el marcador. */
  setSpectating(spectating: boolean): void {
    this.root.classList.toggle("lc--spectating", spectating);
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
    this.aliveEl.textContent = `CRUZANDO ${alive}/${total}`;
  }

  /** Avance propio sobre el largo del puente. */
  setProgress(m: number, total: number): void {
    this.clockEl.textContent = `${Math.max(0, m).toFixed(1)} / ${total} m`;
  }

  /**
   * Ritmo de la cuerda mas cercana (`rope`, 1 o 2) en vueltas por minuto; late en rojo
   * mientras estas adentro de su zona. `null` lo esconde.
   */
  setRope(rpm: number | null, rope = 1, inZone = false): void {
    if (rpm === null) {
      this.decayEl.hidden = true;
      return;
    }
    this.decayEl.hidden = false;
    // En el celu "VUELTAS" se esconde por CSS: si no, el cartel se parte en dos lineas.
    this.decayEl.innerHTML = `CUERDA ${rope} · ${Math.round(rpm)}<span class="lc__rope-unit"> VUELTAS</span>/MIN`;
    this.decayEl.classList.toggle("lc__rope--near", inZone);
  }

  setPlayers(rows: PlayerRow[]): void {
    const sig = rows.map((r) => `${r.seat}:${r.status}:${Math.round(r.best)}:${r.offline}`).join("|");
    if (sig === this.playersSig) return;
    this.playersSig = sig;
    // Los que mas avanzaron arriba.
    const sorted = [...rows].sort((a, b) => b.best - a.best);
    this.playersEl.innerHTML = sorted
      .map(
        (r) => `
        <li class="lc__player${r.status === "dead" ? " lc__player--out" : ""}${r.mine ? " lc__player--mine" : ""}${
          r.offline ? " lc__player--offline" : ""
        }">
          <span class="lc__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="lc__player-name">${escapeHtml(r.name)}</span>
          <span class="lc__player-time">${r.status === "goal" ? "META" : `${Math.round(r.best)} m`}</span>
        </li>`,
      )
      .join("");
  }

  /** Aviso corto (quien cayo), que se va solo. */
  feed(html: string): void {
    const item = document.createElement("div");
    item.className = "lc__feed-item";
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
    this.bannerEl.className = `lc__banner lc__banner--${tone}`;
    this.bannerEl.innerHTML = `<div class="lc__banner-title">${title}</div>${
      sub ? `<div class="lc__banner-sub">${sub}</div>` : ""
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
      <div class="lc__card">
        <h1 class="lc__card-title">${title}</h1>
        <div class="lc__card-body">${bodyHtml}</div>
        ${action ? `<button class="lc__card-btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlayEl.querySelector<HTMLButtonElement>(".lc__card-btn")!.addEventListener("click", action.onClick);
    }
  }

  /** Tabla final: por avance (los que llegaron a la meta, por orden de llegada). */
  showResults(rows: PlayerRow[], goalTimes: number[]): void {
    const sorted = [...rows].sort((a, b) => {
      if (a.status === "goal" && b.status === "goal") return goalTimes[a.seat] - goalTimes[b.seat];
      if (a.status === "goal" || b.status === "goal") return a.status === "goal" ? -1 : 1;
      return b.best - a.best;
    });
    const list = sorted
      .map(
        (r, i) => `
        <li class="lc__result${r.mine ? " lc__result--mine" : ""}">
          <span class="lc__result-pos">${i + 1}</span>
          <span class="lc__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="lc__result-name">${escapeHtml(r.name)}</span>
          <span class="lc__result-value">${r.status === "goal" ? "cruzó" : `${r.best.toFixed(1)} m`}</span>
        </li>`,
      )
      .join("");
    const mine = sorted.findIndex((r) => r.mine);
    const headline = mine === 0 ? "Llegaste m&aacute;s lejos" : mine < 0 ? "Se termin&oacute;" : `Saliste ${mine + 1}º`;
    this.showMessage(headline, `<ol class="lc__results">${list}</ol>`);
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
