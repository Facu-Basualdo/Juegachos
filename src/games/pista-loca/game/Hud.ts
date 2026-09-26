import { WOOL, seatColor } from "./constants";
import type { JoystickView } from "./InputController";

/**
 * HUD de Pista Loca (DESIGN.md: letra en negrita con sombra dura, paneles negros
 * rectos). El unico color saturado del HUD es el bloque del color pedido.
 *
 * No monta el `LeaderboardPanel`: es solo de sala y en sala el puntaje nunca va al
 * ranking global.
 */

export interface PlayerRow {
  seat: number;
  name: string;
  alive: boolean;
  /** Rondas aguantadas, o -1 mientras sigue. */
  rounds: number;
  mine: boolean;
  offline: boolean;
}

const FEED_MS = 3600;

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly roundEl: HTMLDivElement;
  private readonly aliveEl: HTMLDivElement;
  private readonly callEl: HTMLDivElement;
  private readonly swatchEl: HTMLDivElement;
  private readonly callTextEl: HTMLDivElement;
  private readonly barEl: HTMLDivElement;
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
  private callSig = "";

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "pl";

    const top = document.createElement("div");
    top.className = "pl__top";
    this.roundEl = document.createElement("div");
    this.roundEl.className = "pl__round";
    this.aliveEl = document.createElement("div");
    this.aliveEl.className = "pl__alive";
    top.append(this.roundEl, this.aliveEl);

    this.callEl = document.createElement("div");
    this.callEl.className = "pl__call";
    this.swatchEl = document.createElement("div");
    this.swatchEl.className = "pl__swatch";
    this.callTextEl = document.createElement("div");
    this.callTextEl.className = "pl__call-text";
    const bar = document.createElement("div");
    bar.className = "pl__bar";
    this.barEl = document.createElement("div");
    this.barEl.className = "pl__bar-fill";
    bar.append(this.barEl);
    this.callEl.append(this.swatchEl, this.callTextEl, bar);

    this.playersEl = document.createElement("ol");
    this.playersEl.className = "pl__players";
    this.feedEl = document.createElement("div");
    this.feedEl.className = "pl__feed";
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "pl__banner";
    this.bannerEl.hidden = true;

    const controls = document.createElement("div");
    controls.className = "pl-controls";
    this.jumpBtn = document.createElement("button");
    this.jumpBtn.type = "button";
    this.jumpBtn.className = "pl-controls__jump";
    this.jumpBtn.textContent = "SALTAR";
    this.pushBtn = document.createElement("button");
    this.pushBtn.type = "button";
    this.pushBtn.className = "pl-controls__push";
    this.pushBtn.textContent = "EMPUJAR";
    controls.append(this.pushBtn, this.jumpBtn);

    this.stickRing = document.createElement("div");
    this.stickRing.className = "pl-stick";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "pl-stick__knob";
    this.stickRing.append(this.stickKnob);
    this.stickRing.hidden = true;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "pl__overlay";
    this.overlayEl.hidden = true;

    this.root.append(
      top,
      this.callEl,
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
    this.setCall("idle", -1, 0);
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

  /** Enfriamiento del empujon: 0 = listo, 1 = recien usado. El boton se llena de abajo. */
  setPushCooldown(left: number): void {
    const q = Math.round(left * 40);
    if (q === this.pushSig) return;
    this.pushSig = q;
    this.pushBtn.style.setProperty("--cd", String(q / 40));
    this.pushBtn.classList.toggle("is-cooling", q > 0);
  }

  showHud(visible: boolean): void {
    this.root.classList.toggle("pl--playing", visible);
  }

  setSpectating(spectating: boolean): void {
    this.root.classList.toggle("pl--spectating", spectating);
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

  setRound(round: number, alive: number, total: number): void {
    this.roundEl.textContent = round > 0 ? `RONDA ${round}` : "PREPARADOS";
    this.aliveEl.textContent = `QUEDAN ${alive}/${total}`;
  }

  /**
   * Cartel central. `dance`: suena la musica. `choose`: el color pedido con su barra
   * (`left` 0-1 del tiempo que queda). `drop`: cae la pista.
   */
  setCall(mode: "idle" | "dance" | "choose" | "drop", color: number, left: number): void {
    const sig = `${mode}:${color}`;
    if (sig !== this.callSig) {
      this.callSig = sig;
      this.callEl.className = `pl__call pl__call--${mode}`;
      const wool = WOOL[color];
      this.swatchEl.style.background = mode === "choose" || mode === "drop" ? (wool?.hex ?? "#fff") : "transparent";
      this.callTextEl.textContent =
        mode === "dance" ? "A BAILAR" : mode === "choose" ? (wool?.name ?? "") : mode === "drop" ? (wool?.name ?? "") : "";
    }
    this.barEl.style.transform = `scaleX(${mode === "choose" ? Math.max(0, Math.min(1, left)) : 0})`;
  }

  setPlayers(rows: PlayerRow[]): void {
    const sig = rows.map((r) => `${r.seat}:${r.alive}:${r.rounds}:${r.offline}`).join("|");
    if (sig === this.playersSig) return;
    this.playersSig = sig;
    const sorted = [...rows].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.rounds - a.rounds;
    });
    this.playersEl.innerHTML = sorted
      .map(
        (r) => `
        <li class="pl__player${r.alive ? "" : " pl__player--out"}${r.mine ? " pl__player--mine" : ""}${
          r.offline ? " pl__player--offline" : ""
        }">
          <span class="pl__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="pl__player-name">${escapeHtml(r.name)}</span>
          <span class="pl__player-rounds">${r.alive ? "" : `R${r.rounds}`}</span>
        </li>`,
      )
      .join("");
  }

  feed(html: string): void {
    const item = document.createElement("div");
    item.className = "pl__feed-item";
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
    this.bannerEl.className = `pl__banner pl__banner--${tone}`;
    this.bannerEl.innerHTML = `<div class="pl__banner-title">${title}</div>${
      sub ? `<div class="pl__banner-sub">${sub}</div>` : ""
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
      <div class="pl__card">
        <h1 class="pl__card-title">${title}</h1>
        <div class="pl__card-body">${bodyHtml}</div>
        ${action ? `<button class="pl__card-btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlayEl.querySelector<HTMLButtonElement>(".pl__card-btn")!.addEventListener("click", action.onClick);
    }
  }

  showResults(rows: PlayerRow[]): void {
    const sorted = [...rows].sort((a, b) => b.rounds - a.rounds);
    const list = sorted
      .map(
        (r, i) => `
        <li class="pl__result${r.mine ? " pl__result--mine" : ""}">
          <span class="pl__result-pos">${i + 1}</span>
          <span class="pl__player-dot" style="background:${seatColor(r.seat)}"></span>
          <span class="pl__result-name">${escapeHtml(r.name)}</span>
          <span class="pl__result-value">${Math.max(0, r.rounds)} ${r.rounds === 1 ? "ronda" : "rondas"}</span>
        </li>`,
      )
      .join("");
    const mine = sorted.findIndex((r) => r.mine);
    const headline = mine === 0 ? "Quedaste en pie" : mine < 0 ? "Se termin&oacute;" : `Saliste ${mine + 1}º`;
    this.showMessage(headline, `<ol class="pl__results">${list}</ol>`);
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
