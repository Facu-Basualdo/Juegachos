import { HowToPanel } from "../../../shared/HowToPanel";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { roman } from "./constants";
import type { MinoState } from "./Minotaur";

/** Ancho desde el que van las estelas a los costados (si no, franja arriba). */
const WIDE = 1080;

const MINO_TEXT: Record<MinoState, string> = {
  sleep: "Duerme",
  wander: "Ronda",
  investigate: "Escuchó algo",
  search: "Te busca",
  chase: "Te persigue",
};

export interface RivalRow {
  name: string;
  level: number;
  alive: boolean;
}

/**
 * HUD de Minotauro (DESIGN.md "Losa de Creta"): piedra tallada, no interfaz.
 * Estelas a los costados en la compu (ITER: nivel, tiempo, puntos; LVMEN: aceite,
 * que hace el Minotauro, record y la sala), una franja angosta arriba en el celu, el
 * cartel de cada descenso y las tablas de inicio y final con el ranking.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly levelEls: HTMLElement[];
  private readonly timeEls: HTMLElement[];
  private readonly scoreEls: HTMLElement[];
  private readonly oilFills: HTMLElement[];
  private readonly stateEls: HTMLElement[];
  private readonly bestEl: HTMLElement;
  private readonly rivalsEl: HTMLElement;
  private readonly rivalsBox: HTMLElement;
  private readonly toastEl: HTMLDivElement;
  private readonly descentEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly overlayBody: HTMLDivElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly stickRing: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();
  private toastTimer = 0;
  private sig: Record<string, string> = {};

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "mn";
    this.root.innerHTML = `
      <aside class="mn-stele mn-stele--left" aria-label="Recorrido">
        <div class="mn-stele__head">ITER</div>
        <div class="mn-stat"><span class="mn-stat__k">Descensvs · nivel</span><span class="mn-stat__v mn-roman" data-k="level">I</span></div>
        <div class="mn-stat"><span class="mn-stat__k">Tempvs · tiempo</span><span class="mn-stat__v" data-k="time">0:00</span></div>
        <div class="mn-stat"><span class="mn-stat__k">Pvncta · puntos</span><span class="mn-stat__v" data-k="score">0</span></div>
      </aside>
      <aside class="mn-stele mn-stele--right" aria-label="Antorcha">
        <div class="mn-stele__head">LVMEN</div>
        <div class="mn-stat"><span class="mn-stat__k">Olevm · aceite</span><span class="mn-oil"><span class="mn-oil__fill" data-k="oil"></span></span></div>
        <div class="mn-stat"><span class="mn-stat__k">Minotavrvs</span><span class="mn-stat__v mn-state" data-k="state">Duerme</span></div>
        <div class="mn-stat"><span class="mn-stat__k">Optimvm · récord</span><span class="mn-stat__v" data-k="best">—</span></div>
        <div class="mn-rivals" hidden><span class="mn-stat__k">Theseis · la sala</span><ol data-k="rivals"></ol></div>
      </aside>
      <div class="mn-top" aria-hidden="true">
        <span class="mn-top__level mn-roman" data-k="level">I</span>
        <span class="mn-top__time" data-k="time">0:00</span>
        <span class="mn-top__score" data-k="score">0</span>
        <span class="mn-oil mn-oil--top"><span class="mn-oil__fill" data-k="oil"></span></span>
        <span class="mn-top__state mn-state" data-k="state">Duerme</span>
      </div>
    `;
    const all = (k: string) => [...this.root.querySelectorAll<HTMLElement>(`[data-k="${k}"]`)];
    this.levelEls = all("level");
    this.timeEls = all("time");
    this.scoreEls = all("score");
    this.oilFills = all("oil");
    this.stateEls = all("state");
    this.bestEl = all("best")[0];
    this.rivalsEl = all("rivals")[0];
    this.rivalsBox = this.root.querySelector(".mn-rivals")!;

    this.toastEl = document.createElement("div");
    this.toastEl.className = "mn-toast";
    this.descentEl = document.createElement("div");
    this.descentEl.className = "mn-descent";
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.runBtn = document.createElement("button");
    this.runBtn.type = "button";
    this.runBtn.className = "mn-run";
    this.runBtn.textContent = "CORRER";
    this.stickRing = document.createElement("div");
    this.stickRing.className = "mn-stick";
    this.stickRing.hidden = true;
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "mn-stick__knob";
    this.stickRing.append(this.stickKnob);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "mn-overlay";
    const tablet = document.createElement("div");
    tablet.className = "mn-tablet";
    this.overlayBody = document.createElement("div");
    this.overlayBody.className = "mn-tablet__body";
    tablet.append(this.overlayBody);
    this.leaderboard.mount(tablet);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("minotauro").follow(this.leaderboard);
    this.leaderboard.clear();
    this.overlayEl.append(tablet);

    this.root.append(this.toastEl, this.descentEl, this.runBtn, this.stickRing);
    container.append(this.root, this.countdownEl, this.overlayEl);
  }

  /** Espacio que el HUD deja libre para la losa. */
  margins(): { left: number; right: number; top: number; bottom: number } {
    const w = window.innerWidth;
    if (w >= WIDE) return { left: 300, right: 300, top: 28, bottom: 28 };
    return { left: 12, right: 12, top: 64, bottom: matchMedia("(pointer: coarse)").matches ? 116 : 20 };
  }

  onRun(down: () => void, up: () => void): void {
    this.runBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.runBtn.setPointerCapture(e.pointerId);
      this.runBtn.classList.add("is-on");
      down();
    });
    const release = () => {
      this.runBtn.classList.remove("is-on");
      up();
    };
    this.runBtn.addEventListener("pointerup", release);
    this.runBtn.addEventListener("pointercancel", release);
    this.runBtn.addEventListener("lostpointercapture", release);
  }

  setPlaying(on: boolean): void {
    this.root.classList.toggle("mn--playing", on);
  }

  private set(key: string, value: string, els: HTMLElement[]): void {
    if (this.sig[key] === value) return;
    this.sig[key] = value;
    for (const el of els) el.textContent = value;
  }

  setLevel(level: number): void {
    this.set("level", roman(level), this.levelEls);
  }

  setTime(seconds: number): void {
    const s = Math.max(0, Math.floor(seconds));
    this.set("time", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, this.timeEls);
  }

  setScore(points: number): void {
    this.set("score", points.toLocaleString("es-AR"), this.scoreEls);
  }

  setOil(oil: number): void {
    const q = Math.round(oil * 100);
    if (this.sig.oil === String(q)) return;
    this.sig.oil = String(q);
    for (const el of this.oilFills) {
      el.style.transform = `scaleX(${Math.max(0, Math.min(1, oil))})`;
      el.classList.toggle("is-low", oil < 0.22);
    }
  }

  setState(state: MinoState): void {
    if (this.sig.state === state) return;
    this.sig.state = state;
    for (const el of this.stateEls) {
      el.textContent = MINO_TEXT[state];
      el.dataset.state = state;
    }
  }

  setBest(best: number | null): void {
    this.bestEl.textContent = best === null ? "—" : best.toLocaleString("es-AR");
  }

  setRivals(rows: RivalRow[]): void {
    this.rivalsBox.hidden = rows.length === 0;
    const sig = rows.map((r) => `${r.name}:${r.level}:${r.alive}`).join("|");
    if (sig === this.sig.rivals) return;
    this.sig.rivals = sig;
    this.rivalsEl.innerHTML = rows
      .map((r) => `<li class="${r.alive ? "" : "is-out"}"><span>${escapeHtml(r.name)}</span><b class="mn-roman">${r.alive ? roman(Math.max(1, r.level)) : "†"}</b></li>`)
      .join("");
  }

  setStick(view: { ox: number; oy: number; x: number; y: number } | null): void {
    if (!view) {
      this.stickRing.hidden = true;
      return;
    }
    this.stickRing.hidden = false;
    this.stickRing.style.transform = `translate(${view.ox}px, ${view.oy}px)`;
    const dx = view.x - view.ox;
    const dy = view.y - view.oy;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(len, 44) / len;
    this.stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  toast(text: string, tone: "gold" | "danger" | "info" = "info"): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `mn-toast mn-toast--${tone}`;
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("is-shown");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("is-shown"), 1600);
  }

  /** Cartel del descenso: "DESCENSVS III". */
  descent(level: number | null, sub = ""): void {
    if (level === null) {
      this.descentEl.classList.remove("is-shown");
      return;
    }
    this.descentEl.innerHTML = `<span class="mn-descent__k">Descensvs</span><span class="mn-descent__n">${roman(level)}</span>${
      sub ? `<span class="mn-descent__sub">${sub}</span>` : ""
    }`;
    this.descentEl.classList.remove("is-shown");
    void this.descentEl.offsetWidth;
    this.descentEl.classList.add("is-shown");
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

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.overlayBody.innerHTML = `
      <p class="mn-eyebrow">Un laberinto · una antorcha · una bestia</p>
      <h1 class="mn-title">Minotauro</h1>
      <svg class="mn-keyline" viewBox="0 0 560 14" aria-hidden="true"><path d="${keyline(560, 14)}"/></svg>
      <p class="mn-sub">Seguí el hilo · encontrá el ovillo · no lo despiertes</p>
      ${best !== null ? `<p class="mn-best">Optimvm · ${best.toLocaleString("es-AR")} pts</p>` : ""}
      <p class="mn-hint">presioná ENTER o tocá para entrar</p>
    `;
    this.leaderboard.clear();
  }

  showGameOver(o: { title: string; levels: number; score: number; time: number; best: number | null; isBest: boolean; room: boolean }): void {
    this.overlayEl.classList.remove("hidden");
    const s = Math.floor(o.time);
    this.overlayBody.innerHTML = `
      <p class="mn-eyebrow">${o.isBest ? "Nuevo récord" : "El laberinto se cierra"}</p>
      <h1 class="mn-title mn-title--small">${o.title}</h1>
      <svg class="mn-keyline" viewBox="0 0 560 14" aria-hidden="true"><path d="${keyline(560, 14)}"/></svg>
      <div class="mn-final">
        <div><span class="mn-stat__k">Descensos</span><b class="mn-roman">${o.levels > 0 ? roman(o.levels) : "—"}</b></div>
        <div><span class="mn-stat__k">Puntos</span><b>${o.score.toLocaleString("es-AR")}</b></div>
        <div><span class="mn-stat__k">Tiempo</span><b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</b></div>
      </div>
      ${o.room ? "" : `<p class="mn-hint">presioná ENTER o tocá para volver a bajar${o.best !== null ? ` · récord ${o.best.toLocaleString("es-AR")}` : ""}</p>`}
    `;
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  showRanking(score: number): void {
    void this.leaderboard.render("minotauro", { score });
  }
}

/** Trazo de una greca para la linea bajo el titulo (SVG). */
function keyline(w: number, h: number): string {
  const u = h;
  let d = "";
  for (let x = 0; x + u * 1.25 <= w; x += u * 1.25) {
    d += `M${x} ${h}V0H${x + u}V${u * 0.75}H${x + u * 0.3}V${u * 0.3}H${x + u * 0.65}`;
  }
  return d;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
