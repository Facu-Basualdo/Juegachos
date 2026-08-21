import { seatColor } from "./constants";

/**
 * HUD de Manchon, en DOM sobre el canvas.
 *
 * No monta el `LeaderboardPanel` compartido a proposito: el juego es solo de sala
 * y en modo sala el puntaje va a la ronda, nunca al ranking global (ver el
 * CLAUDE.md raiz), asi que un panel de ranking no tendria nunca nada que mostrar.
 */

export interface ScoreRow {
  seat: number;
  name: string;
  cells: number;
  /** Porcentaje del tablero, 0-100. */
  pct: number;
  mine: boolean;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly barEl: HTMLDivElement;
  private readonly legendEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly splatBtn: HTMLButtonElement;
  private readonly splatFillEl: HTMLDivElement;
  /** Barras y chips por asiento, para actualizarlas sin rehacer el DOM cada frame. */
  private readonly bars = new Map<number, HTMLDivElement>();
  private readonly chips = new Map<number, { root: HTMLDivElement; value: HTMLSpanElement }>();

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "pt";

    const top = document.createElement("div");
    top.className = "pt__top";

    this.clockEl = document.createElement("div");
    this.clockEl.className = "pt__clock";
    this.clockEl.textContent = "1:30";

    this.barEl = document.createElement("div");
    this.barEl.className = "pt__bar";

    this.legendEl = document.createElement("div");
    this.legendEl.className = "pt__legend";

    top.append(this.clockEl, this.barEl, this.legendEl);

    const controls = document.createElement("div");
    controls.className = "pt-controls";

    this.splatBtn = document.createElement("button");
    this.splatBtn.className = "pt-controls__splat";
    this.splatBtn.type = "button";

    this.splatFillEl = document.createElement("div");
    this.splatFillEl.className = "pt-controls__fill";

    const splatLabel = document.createElement("span");
    splatLabel.className = "pt-controls__label";
    splatLabel.textContent = "SALPICAR";

    this.splatBtn.append(this.splatFillEl, splatLabel);
    controls.append(this.splatBtn);

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "pt__overlay";
    this.overlayEl.hidden = true;

    this.root.append(top, controls, this.countdownEl, this.overlayEl);
    container.append(this.root);
    this.showHud(false);
  }

  onSplat(cb: () => void): void {
    // pointerdown y no click: en el celular el click llega ~300 ms tarde y el
    // salpicon es una accion de reflejos.
    this.splatBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cb();
    });
  }

  /** Marcador y controles: visibles solo mientras se juega. */
  showHud(visible: boolean): void {
    this.root.classList.toggle("pt--playing", visible);
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

  setClock(msLeft: number): void {
    const total = Math.max(0, Math.ceil(msLeft / 1000));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    this.clockEl.textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    this.clockEl.classList.toggle("pt__clock--urgent", total <= 10);
  }

  /** Cooldown del salpicon, 0 (recien usado) a 1 (listo). */
  setSplatCharge(charge: number): void {
    this.splatFillEl.style.transform = `scaleY(${Math.max(0, Math.min(1, charge))})`;
    this.splatBtn.classList.toggle("is-ready", charge >= 1);
  }

  /** Reparto del tablero: una barra apilada y un chip por jugador. */
  setScores(rows: ScoreRow[]): void {
    for (const row of rows) {
      let bar = this.bars.get(row.seat);
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "pt__bar-slice";
        bar.style.background = seatColor(row.seat);
        this.bars.set(row.seat, bar);
        this.barEl.append(bar);
      }
      bar.style.flexGrow = String(Math.max(row.pct, 0.001));

      let chip = this.chips.get(row.seat);
      if (!chip) {
        const chipRoot = document.createElement("div");
        chipRoot.className = `pt__chip${row.mine ? " pt__chip--mine" : ""}`;
        const dot = document.createElement("span");
        dot.className = "pt__chip-dot";
        dot.style.background = seatColor(row.seat);
        const name = document.createElement("span");
        name.className = "pt__chip-name";
        name.textContent = row.name;
        const value = document.createElement("span");
        value.className = "pt__chip-value";
        chipRoot.append(dot, name, value);
        chip = { root: chipRoot, value };
        this.chips.set(row.seat, chip);
        this.legendEl.append(chipRoot);
      }
      chip.value.textContent = `${row.pct.toFixed(1)}%`;
    }
  }

  /** Cartel a pantalla completa (esperando la ronda, no disponible, resultados). */
  showMessage(title: string, bodyHtml: string, action?: { label: string; onClick: () => void }): void {
    this.overlayEl.hidden = false;
    this.overlayEl.innerHTML = `
      <div class="pt__card">
        <h1 class="pt__card-title">${title}</h1>
        <div class="pt__card-body">${bodyHtml}</div>
        ${action ? `<button class="pt__card-btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlayEl
        .querySelector<HTMLButtonElement>(".pt__card-btn")!
        .addEventListener("click", action.onClick);
    }
  }

  /** Tabla final de la partida, ordenada por territorio. */
  showResults(rows: ScoreRow[]): void {
    const sorted = [...rows].sort((a, b) => b.cells - a.cells);
    const list = sorted
      .map(
        (row, i) => `
          <li class="pt__result${row.mine ? " pt__result--mine" : ""}">
            <span class="pt__result-pos">${i + 1}</span>
            <span class="pt__result-dot" style="background:${seatColor(row.seat)}"></span>
            <span class="pt__result-name">${escapeHtml(row.name)}</span>
            <span class="pt__result-value">${row.pct.toFixed(1)}%</span>
          </li>`,
      )
      .join("");
    const mine = sorted.findIndex((r) => r.mine);
    const headline =
      mine === 0 ? "Ganaste el tablero" : mine < 0 ? "Se acabo" : `Saliste ${mine + 1}º`;
    this.showMessage(headline, `<ol class="pt__results">${list}</ol>`);
  }

  hideMessage(): void {
    this.overlayEl.hidden = true;
    this.overlayEl.innerHTML = "";
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
