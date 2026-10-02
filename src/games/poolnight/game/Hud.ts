import { MAX_OFFSET, TEAM_COLORS, TEAM_NAMES, ballColor, groupOf } from "./constants";
import type { BiState } from "./PoolProtocol";

/**
 * HUD de Poolnight, en DOM sobre el canvas (DESIGN.md: la informacion que importa vive en
 * el mundo; el HUD se queda con lo que el mundo no puede decir, y lo dice chico). No monta
 * el `LeaderboardPanel` compartido: el juego es solo de sala y en sala el resultado va a la
 * ronda, nunca al ranking global.
 */

export interface ResultRow {
  team: 0 | 1;
  names: string[];
}

const TOAST_MS = 2600;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function stopDown(e: Element): void {
  e.addEventListener("pointerdown", (ev) => ev.stopPropagation());
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly teamsEl: HTMLDivElement;
  private readonly turnEl: HTMLDivElement;
  private readonly turnName: HTMLDivElement;
  private readonly turnBar: HTMLElement;
  private readonly msgEl: HTMLDivElement;
  private readonly countEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly powerEl: HTMLDivElement;
  private readonly powerFill: HTMLElement;
  private readonly spinEl: HTMLDivElement;
  private readonly spinDot: HTMLElement;
  private readonly btnsEl: HTMLDivElement;
  private readonly shootBtn: HTMLButtonElement;
  private readonly overlayEl: HTMLDivElement;
  private teamsSig = "";
  private turnSig = "";
  private toastTimer = 0;

  private powerCb: (p: number) => void = () => {};
  private spinCb: (ox: number, oy: number) => void = () => {};
  private cameraCb: () => void = () => {};
  private shootCb: () => void = () => {};

  constructor(container: HTMLElement) {
    this.root = el("div", "pn");

    const logo = el("div", "pn__logo", "Poolnight");

    this.teamsEl = el("div", "pn__teams");

    this.turnEl = el("div", "pn__turn");
    this.turnName = el("div", "pn__turn-name");
    const bar = el("div", "pn__turn-bar");
    this.turnBar = el("i", "");
    bar.append(this.turnBar);
    this.turnEl.append(this.turnName, bar);
    this.turnEl.hidden = true;

    this.msgEl = el("div", "pn__msg");
    this.msgEl.hidden = true;
    this.countEl = el("div", "pn__count");
    this.countEl.hidden = true;
    this.hintEl = el("div", "pn__hint");
    this.hintEl.hidden = true;

    // Potencia: una barra vertical que tambien se puede arrastrar (el celu no tiene teclado).
    this.powerEl = el("div", "pn__power");
    this.powerFill = el("i", "");
    this.powerEl.append(this.powerFill);
    this.powerEl.hidden = true;
    stopDown(this.powerEl);
    const setFromPointer = (e: PointerEvent): void => {
      const r = this.powerEl.getBoundingClientRect();
      this.powerCb(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)));
    };
    this.powerEl.addEventListener("pointerdown", (e) => {
      this.powerEl.setPointerCapture(e.pointerId);
      setFromPointer(e);
    });
    this.powerEl.addEventListener("pointermove", (e) => {
      if (e.buttons > 0) setFromPointer(e);
    });

    // Efecto: se toca donde se quiere pegarle a la blanca.
    this.spinEl = el("div", "pn__spin");
    this.spinEl.title = "Efecto: tocá donde querés pegarle a la blanca";
    this.spinDot = el("i", "");
    this.spinEl.append(this.spinDot);
    this.spinEl.hidden = true;
    stopDown(this.spinEl);
    const spinFromPointer = (e: PointerEvent): void => {
      const r = this.spinEl.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      this.spinCb(nx * MAX_OFFSET, -ny * MAX_OFFSET);
    };
    this.spinEl.addEventListener("pointerdown", (e) => {
      this.spinEl.setPointerCapture(e.pointerId);
      spinFromPointer(e);
    });
    this.spinEl.addEventListener("pointermove", (e) => {
      if (e.buttons > 0) spinFromPointer(e);
    });
    this.spinEl.addEventListener("dblclick", () => this.spinCb(0, 0));

    this.btnsEl = el("div", "pn__btns");
    const cam = el("button", "pn__btn", "CÁMARA");
    cam.type = "button";
    cam.addEventListener("click", () => this.cameraCb());
    this.shootBtn = el("button", "pn__btn pn__btn--shoot", "TIRAR");
    this.shootBtn.type = "button";
    this.shootBtn.addEventListener("click", () => this.shootCb());
    this.shootBtn.hidden = true;
    this.btnsEl.append(cam, this.shootBtn);
    stopDown(this.btnsEl);

    this.overlayEl = el("div", "pn__overlay hidden");
    stopDown(this.overlayEl);

    const vignette = el("div", "pn__vignette");
    this.root.append(vignette, logo, this.teamsEl, this.turnEl, this.msgEl, this.countEl, this.hintEl, this.powerEl, this.spinEl, this.btnsEl, this.overlayEl);
    this.showHud(false);
    container.append(this.root);
  }

  // ------------------------------------------------------------ callbacks

  onPower(cb: (p: number) => void): void {
    this.powerCb = cb;
  }
  onSpin(cb: (ox: number, oy: number) => void): void {
    this.spinCb = cb;
  }
  onCamera(cb: () => void): void {
    this.cameraCb = cb;
  }
  onShoot(cb: () => void): void {
    this.shootCb = cb;
  }

  // ------------------------------------------------------------ visibilidad

  showHud(on: boolean): void {
    this.teamsEl.hidden = !on;
    this.btnsEl.hidden = !on;
  }

  /** Controles de quien tira: potencia, efecto y TIRAR. */
  setControls(on: boolean): void {
    this.powerEl.hidden = !on;
    this.spinEl.hidden = !on;
    this.shootBtn.hidden = !on;
  }

  setPower(p: number): void {
    this.powerFill.style.height = `${Math.round(p * 100)}%`;
  }

  setSpin(ox: number, oy: number): void {
    const x = 50 + (ox / MAX_OFFSET) * 50;
    const y = 50 - (oy / MAX_OFFSET) * 50;
    this.spinDot.style.left = `${x}%`;
    this.spinDot.style.top = `${y}%`;
  }

  setHint(text: string | null): void {
    this.hintEl.hidden = !text;
    if (text) this.hintEl.textContent = text;
  }

  showCountdown(text: string | null): void {
    this.countEl.hidden = text === null;
    if (text !== null) {
      this.countEl.textContent = text;
      // Reinicia la animacion de "pop" en cada etiqueta.
      this.countEl.classList.remove("pn__count--pop");
      void this.countEl.offsetWidth;
      this.countEl.classList.add("pn__count--pop");
    }
  }

  toast(text: string, kind: "good" | "bad" | "info" = "info"): void {
    this.msgEl.textContent = text;
    this.msgEl.className = `pn__msg pn__msg--${kind}`;
    this.msgEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.msgEl.hidden = true), TOAST_MS);
  }

  // ------------------------------------------------------------ equipos y turno

  /** Los dos equipos con sus jugadores y las bolas que le quedan a cada grupo. Solo reconstruye si cambio. */
  setTeams(state: BiState, mySeat: number): void {
    const alive = (id: number): boolean => state.balls.length === 48 && state.balls[id * 3 + 2] === 1;
    const sig = JSON.stringify([
      state.seats.map((s, i) => [s.team, s.nickname, s.bot, s.on, i === state.shooter]),
      mySeat,
      state.balls.length === 48 ? [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].map((id) => (alive(id) ? 1 : 0)) : 0,
    ]);
    if (sig === this.teamsSig) return;
    this.teamsSig = sig;
    this.teamsEl.replaceChildren();
    for (const team of [0, 1] as const) {
      const box = el("div", `pn-team pn-team--${team}`);
      box.style.setProperty("--team", TEAM_COLORS[team]);
      const head = el("div", "pn-team__head");
      head.append(el("span", "pn-team__name", TEAM_NAMES[team]), el("span", "pn-team__left", String(state.groupsLeft[team])));
      const list = el("ol", "pn-team__players");
      state.seats.forEach((s, i) => {
        if (s.team !== team) return;
        const li = el("li", "pn-p");
        if (i === mySeat) li.classList.add("pn-p--me");
        if (i === state.shooter) li.classList.add("pn-p--turn");
        if (s.nickname !== null && !s.on) li.classList.add("pn-p--off");
        li.append(el("span", "pn-p__name", s.nickname ?? "Bot"));
        if (s.bot) li.append(el("small", "pn-p__bot", "BOT"));
        list.append(li);
      });
      const balls = el("div", "pn-team__balls");
      for (let id = 1; id <= 15; id++) {
        if (groupOf(id) !== team) continue;
        const b = el("i", "pn-ball");
        const c = ballColor(id);
        b.style.background = id > 8 ? `linear-gradient(#f3ecd8 0 26%, ${c} 26% 74%, #f3ecd8 74%)` : c;
        if (state.balls.length === 48 && !alive(id)) b.classList.add("pn-ball--gone");
        balls.append(b);
      }
      box.append(head, list, balls);
      this.teamsEl.append(box);
    }
  }

  /** Quien tira y cuanto le queda del reloj (0 a 1). */
  setTurn(name: string | null, team: 0 | 1, fraction: number, secondsLeft: number, mine: boolean): void {
    if (name === null) {
      this.turnEl.hidden = true;
      return;
    }
    this.turnEl.hidden = false;
    this.turnEl.style.setProperty("--team", TEAM_COLORS[team]);
    const label = mine ? "TU TURNO" : `TIRA ${name.toUpperCase()}`;
    const sig = `${label}|${team}|${mine}`;
    if (sig !== this.turnSig) {
      this.turnSig = sig;
      this.turnName.textContent = label;
      this.turnEl.classList.toggle("pn__turn--mine", mine);
    }
    this.turnBar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    this.turnBar.parentElement?.classList.toggle("pn__turn-bar--low", secondsLeft <= 5);
  }

  // ------------------------------------------------------------ pantallas

  showMessage(title: string, html: string, action?: { label: string; onClick: () => void }): void {
    this.overlayEl.classList.remove("hidden");
    this.overlayEl.replaceChildren();
    const card = el("div", "pn__card");
    const h = el("h2", "pn__card-title");
    // Los titulos llegan con entidades HTML ("Sin conexi&oacute;n"), como en el resto de los juegos.
    h.innerHTML = title;
    const p = el("p", "pn__card-text");
    p.innerHTML = html;
    card.append(h, p);
    if (action) {
      const b = el("button", "pn__card-btn", action.label);
      b.type = "button";
      b.addEventListener("click", action.onClick);
      card.append(b);
    }
    this.overlayEl.append(card);
  }

  hideMessage(): void {
    this.overlayEl.classList.add("hidden");
  }

  /** La pantalla final: quien gano, por que y como quedaron los equipos. */
  showResults(headline: string, sub: string, rows: ResultRow[], mine: 0 | 1 | null): void {
    this.overlayEl.classList.remove("hidden");
    this.overlayEl.replaceChildren();
    const card = el("div", "pn__card pn__card--results");
    card.append(el("h2", "pn__card-title", headline), el("p", "pn__card-text", sub));
    const grid = el("div", "pn__results");
    for (const r of rows) {
      const col = el("div", `pn__results-team${mine === r.team ? " pn__results-team--mine" : ""}`);
      col.style.setProperty("--team", TEAM_COLORS[r.team]);
      col.append(el("div", "pn__results-name", TEAM_NAMES[r.team]));
      for (const n of r.names) col.append(el("div", "pn__results-player", n));
      grid.append(col);
    }
    card.append(grid, el("p", "pn__card-hint", "Esperá a que termine la ronda para seguir con la sala."));
    this.overlayEl.append(card);
  }
}
