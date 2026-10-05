import { HowToPanel } from "../../../shared/HowToPanel";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

export const fmtTime = (s: number): string => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

/**
 * HUD de Chori y Pan (DESIGN.md "Parrilla Sagrada"): una tablilla de piedra arriba con
 * el nivel, el reloj y las gemas; carteles grandes para "nivel superado" y "se empapo";
 * y las tablas de inicio y final con el ranking.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly levelEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly ajiEl: HTMLElement;
  private readonly cubEl: HTMLElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly overlayBody: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();
  private readonly pairsEl: HTMLElement;
  private cardClick: ((el: HTMLElement) => void) | null = null;
  private sig: Record<string, string> = {};
  private bannerTimer = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "cp";
    this.root.innerHTML = `
      <div class="cp-bar">
        <div class="cp-bar__level"><span data-k="level">1 / 3</span><b data-k="name">El atrio</b></div>
        <div class="cp-bar__time" data-k="time">0:00.0</div>
        <div class="cp-bar__gems">
          <span class="cp-gem cp-gem--aji" title="Ajíes del Chori"><i></i><b data-k="aji">0/0</b></span>
          <span class="cp-gem cp-gem--cub" title="Cubitos del Pan"><i></i><b data-k="cub">0/0</b></span>
        </div>
      </div>
      <aside class="cp-pairs" data-k="pairs" hidden></aside>
    `;
    const one = (k: string) => this.root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    this.levelEl = one("level");
    this.nameEl = one("name");
    this.timeEl = one("time");
    this.ajiEl = one("aji");
    this.cubEl = one("cub");
    this.pairsEl = one("pairs");

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "cp-banner";
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "cp-overlay";
    const card = document.createElement("div");
    card.className = "cp-card";
    this.overlayBody = document.createElement("div");
    this.overlayBody.className = "cp-card__body";
    card.append(this.overlayBody);
    this.leaderboard.mount(card);
    new HowToPanel("chori-y-pan").follow(this.leaderboard);
    this.leaderboard.clear();
    this.overlayEl.append(card);
    this.overlayBody.addEventListener("click", (e) => {
      if (this.cardClick && e.target instanceof HTMLElement) this.cardClick(e.target);
    });
    container.append(this.root, this.bannerEl, this.countdownEl, this.overlayEl);
  }

  setPlaying(on: boolean): void {
    this.root.classList.toggle("cp--playing", on);
  }

  /** Botones en pantalla para el celu (online: cada uno maneja un solo heroe). */
  mountTouch(set: (key: "left" | "right" | "jump", on: boolean) => void): void {
    const pad = document.createElement("div");
    pad.className = "cp-touch";
    pad.innerHTML = `<button type="button" data-t="left" aria-label="Izquierda"></button><button type="button" data-t="right" aria-label="Derecha"></button><button type="button" data-t="jump" aria-label="Saltar">SALTAR</button>`;
    for (const b of pad.querySelectorAll<HTMLButtonElement>("[data-t]")) {
      const key = b.dataset.t as "left" | "right" | "jump";
      const down = (e: PointerEvent) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add("is-on");
        set(key, true);
      };
      const up = () => {
        b.classList.remove("is-on");
        set(key, false);
      };
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("lostpointercapture", up);
    }
    this.root.append(pad);
  }

  private text(key: string, v: string, el: HTMLElement): void {
    if (this.sig[key] === v) return;
    this.sig[key] = v;
    el.textContent = v;
  }

  setLevel(i: number, n: number, name: string): void {
    this.text("level", `${i} / ${n}`, this.levelEl);
    this.text("name", name, this.nameEl);
  }

  setTime(s: number): void {
    this.text("time", fmtTime(s), this.timeEl);
  }

  setGems(aji: [number, number], cub: [number, number]): void {
    this.text("aji", `${aji[0]}/${aji[1]}`, this.ajiEl);
    this.text("cub", `${cub[0]}/${cub[1]}`, this.cubEl);
  }

  /** Cartel grande en el medio ("¡Nivel superado!", "¡El Chori se empapó!"). */
  banner(title: string, sub: string, tone: "good" | "bad" | "info"): void {
    this.bannerEl.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}`;
    this.bannerEl.className = `cp-banner cp-banner--${tone}`;
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("is-shown");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("is-shown"), 1500);
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
      <p class="cp-eyebrow">El templo de la parrilla sagrada</p>
      <h1 class="cp-title"><span class="cp-title__chori">Chori</span> <i>y</i> <span class="cp-title__pan">Pan</span></h1>
      <p class="cp-sub">Dos en la misma compu: tres salas del templo, lo más rápido posible.</p>
      <div class="cp-who">
        <div class="cp-who__card cp-who__card--chori"><b>Chori</b><span>flechas</span><small>Camina sobre las brasas. El agua lo empapa.</small></div>
        <div class="cp-who__card cp-who__card--pan"><b>Pan</b><span>W A D</span><small>Nada en el agua. Las brasas lo queman.</small></div>
      </div>
      <p class="cp-warn">Al chimichurri vencido no lo toca nadie.</p>
      ${best !== null ? `<p class="cp-best">Récord · ${fmtTime(best)}</p>` : ""}
      <p class="cp-hint">presioná ENTER o tocá para entrar al templo</p>
    `;
    this.leaderboard.clear();
  }

  showGameOver(o: { time: number; raw: number; gems: number; best: number | null; isBest: boolean }): void {
    this.overlayEl.classList.remove("hidden");
    this.overlayBody.innerHTML = `
      <p class="cp-eyebrow">${o.isBest ? "Nuevo récord" : "Salieron del templo"}</p>
      <h1 class="cp-title cp-title--small">¡Choripán servido!</h1>
      <div class="cp-final">
        <div><span>Tiempo</span><b>${fmtTime(o.raw)}</b></div>
        <div><span>Gemas</span><b>${o.gems} (−${o.gems * 2}s)</b></div>
        <div><span>Total</span><b>${fmtTime(o.time)}</b></div>
      </div>
      <p class="cp-hint">presioná ENTER o tocá para volver a entrar${o.best !== null ? ` · récord ${fmtTime(o.best)}` : ""}</p>
    `;
  }

  /**
   * Tarjeta de la sala (conectando, apuesta, rol, resultado), sin ranking. Las tarjetas
   * de controles se ven mientras se espera; en el resultado (`final`) sobran.
   */
  showRoomCard(html: string, onClick?: (el: HTMLElement) => void, final = false): void {
    this.overlayEl.classList.remove("hidden");
    this.overlayEl.classList.toggle("cp-overlay--final", final);
    this.overlayBody.innerHTML = html;
    this.cardClick = onClick ?? null;
    this.leaderboard.clear();
  }

  /** Las parejas de la sala: en que sala van o cuanto tardaron. */
  setPairs(rows: { chori: string; pan: string; level: number; total: number; time: number; mine: boolean }[]): void {
    const sig = JSON.stringify(rows);
    if (this.sig.pairs === sig) return;
    this.sig.pairs = sig;
    this.pairsEl.hidden = rows.length === 0;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    this.pairsEl.innerHTML = `<span class="cp-pairs__k">Parejas</span><ol>${rows
      .map(
        (r) =>
          `<li class="${r.mine ? "is-me" : ""} ${r.time >= 0 ? "is-done" : ""}"><b>${esc(r.chori)}</b><i>y</i><b>${esc(r.pan)}</b><span>${r.time >= 0 ? fmtTime(r.time / 1000) : `sala ${Math.min(r.level + 1, r.total)}/${r.total}`}</span></li>`,
      )
      .join("")}</ol>`;
  }

  hideOverlay(): void {
    this.cardClick = null;
    this.overlayEl.classList.add("hidden");
  }

  showRanking(score: number): void {
    void this.leaderboard.render("chori-y-pan", { score });
  }
}
