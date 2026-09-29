import { CHAMBERS } from "./constants";
import type { RunResult } from "./Game";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

/** Un jugador en el panel de "como le va al resto de la sala". */
export interface LivePlayer {
  name: string;
  frases: number;
  dead: boolean;
  me: boolean;
}

/** DOM del juego: barra de estado, revolver, escenario de tecleo, overlays. */
export class Hud {
  // HUD bar
  private readonly hudBar: HTMLDivElement;
  private readonly survivorsEl: HTMLDivElement;
  private readonly roundEl: HTMLDivElement;
  private readonly frasesEl: HTMLDivElement;
  private readonly ppmEl: HTMLDivElement;
  private readonly livePanelEl: HTMLDivElement;

  // Escenario
  private readonly stage: HTMLDivElement;
  private readonly revolverEl: HTMLDivElement;
  private readonly chamberEls: SVGCircleElement[] = [];
  private readonly verdictEl: HTMLDivElement;
  private readonly sentenceEl: HTMLDivElement;
  private readonly timerFillEl: HTMLDivElement;

  // Overlays
  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly ratingEl: HTMLDivElement;
  private readonly tableContainerEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  private readonly countdownEl: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  constructor(container: HTMLElement) {
    // --- HUD bar ---
    this.hudBar = document.createElement("div");
    this.hudBar.className = "fs-hud hidden";
    this.survivorsEl = this.makeStat("VIVOS", "fs-hud__survivors");
    this.roundEl = this.makeStat("SENTENCIA", "fs-hud__round");
    this.frasesEl = this.makeStat("SUPERADAS", "fs-hud__frases");
    this.ppmEl = this.makeStat("PPM", "fs-hud__ppm");
    this.hudBar.append(this.survivorsEl, this.roundEl, this.frasesEl, this.ppmEl);

    // Panel lateral con el progreso del resto de la sala (solo modo sala).
    this.livePanelEl = this.div("fs-live hidden");

    // --- Escenario ---
    this.stage = document.createElement("div");
    this.stage.className = "fs-stage hidden";

    this.revolverEl = document.createElement("div");
    this.revolverEl.className = "fs-revolver";
    this.revolverEl.append(this.buildCylinder());

    this.verdictEl = document.createElement("div");
    this.verdictEl.className = "fs-verdict";
    this.revolverEl.append(this.verdictEl);

    this.sentenceEl = document.createElement("div");
    this.sentenceEl.className = "fs-sentence";

    const timerBar = document.createElement("div");
    timerBar.className = "fs-timerbar";
    this.timerFillEl = document.createElement("div");
    this.timerFillEl.className = "fs-timerbar__fill";
    timerBar.append(this.timerFillEl);

    this.stage.append(this.revolverEl, this.sentenceEl, timerBar);

    // --- Overlay ---
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";
    this.titleEl = this.div("overlay__title");
    this.subtitleEl = this.div("overlay__subtitle");
    this.scoreLineEl = this.div("overlay__score");
    this.ratingEl = this.div("overlay__rating");
    this.tableContainerEl = this.div("overlay__table-container");
    this.hintEl = this.div("overlay__hint");
    this.overlayEl.append(
      this.titleEl,
      this.subtitleEl,
      this.scoreLineEl,
      this.ratingEl,
      this.tableContainerEl,
      this.hintEl,
    );
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("typing-race").follow(this.leaderboard);
    this.leaderboard.clear();

    // --- Countdown / efectos ---
    this.countdownEl = this.div("countdown");
    this.flashEl = this.div("fs-flash");
    this.bannerEl = this.div("fs-banner");

    container.append(
      this.stage,
      this.hudBar,
      this.livePanelEl,
      this.overlayEl,
      this.countdownEl,
      this.flashEl,
      this.bannerEl,
    );
  }

  // ---------- helpers de construccion ----------

  private div(cls: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = cls;
    return el;
  }

  private makeStat(label: string, cls: string): HTMLDivElement {
    const wrap = this.div(`fs-hud__stat ${cls}`);
    const l = this.div("fs-hud__label");
    l.textContent = label;
    const n = this.div("fs-hud__num");
    n.textContent = "--";
    wrap.append(l, n);
    return wrap;
  }

  private num(stat: HTMLDivElement): HTMLDivElement {
    return stat.querySelector(".fs-hud__num")!;
  }

  /** Tambor SVG con 6 recamaras dispuestas en circulo. */
  private buildCylinder(): SVGSVGElement {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "fs-cylinder");

    const body = document.createElementNS(NS, "circle");
    body.setAttribute("cx", "50");
    body.setAttribute("cy", "50");
    body.setAttribute("r", "44");
    body.setAttribute("class", "fs-cylinder__body");
    svg.append(body);

    const cx = 50;
    const cy = 50;
    const r = 30;
    for (let i = 0; i < CHAMBERS; i++) {
      const ang = (-90 + i * (360 / CHAMBERS)) * (Math.PI / 180);
      const hole = document.createElementNS(NS, "circle");
      hole.setAttribute("cx", String(cx + r * Math.cos(ang)));
      hole.setAttribute("cy", String(cy + r * Math.sin(ang)));
      hole.setAttribute("r", "9");
      hole.setAttribute("class", "fs-cylinder__hole");
      svg.append(hole);
      this.chamberEls.push(hole);
    }

    const pin = document.createElementNS(NS, "circle");
    pin.setAttribute("cx", "50");
    pin.setAttribute("cy", "50");
    pin.setAttribute("r", "6");
    pin.setAttribute("class", "fs-cylinder__pin");
    svg.append(pin);

    return svg;
  }

  // ---------- Estado en juego ----------

  showChrome(): void {
    this.hudBar.classList.remove("hidden");
    this.stage.classList.remove("hidden");
  }

  showPlay(): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.remove("hidden");
    this.stage.classList.remove("hidden");
    this.revolverEl.classList.remove("is-spinning", "is-tense");
    this.verdictEl.className = "fs-verdict";
    this.verdictEl.textContent = "";
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }

  setSurvivors(n: number, start: number): void {
    this.num(this.survivorsEl).textContent = String(n);
    this.survivorsEl.classList.toggle("is-sole", n <= 1);
    void start;
  }

  setRound(round: number): void {
    this.num(this.roundEl).textContent = String(round).padStart(2, "0");
  }

  setFrases(n: number): void {
    this.num(this.frasesEl).textContent = String(n);
  }

  setPpm(n: number): void {
    this.num(this.ppmEl).textContent = String(n);
  }

  /** Muestra el panel de progreso de sala (solo cuando hay `?room=`). */
  enableLivePanel(): void {
    this.livePanelEl.classList.remove("hidden");
  }

  /** Ranking en vivo del resto de la sala (ya ordenado por frases desc). */
  setLivePlayers(list: LivePlayer[]): void {
    this.livePanelEl.innerHTML = "";
    const title = this.div("fs-live__title");
    title.textContent = "EN LA SALA";
    this.livePanelEl.append(title);

    list.forEach((pl, i) => {
      const row = this.div(
        "fs-live__row" + (pl.me ? " is-me" : "") + (pl.dead ? " is-dead" : ""),
      );
      const rank = this.div("fs-live__rank");
      rank.textContent = pl.dead ? "x" : String(i + 1);
      const name = this.div("fs-live__name");
      name.textContent = pl.name;
      const frs = this.div("fs-live__frases");
      frs.textContent = String(pl.frases);
      row.append(rank, name, frs);
      this.livePanelEl.append(row);
    });
  }

  setChamber(loaded: number): void {
    this.chamberEls.forEach((c, i) => c.classList.toggle("is-loaded", i < loaded));
    this.revolverEl.classList.toggle("is-danger", loaded >= 4);
    this.revolverEl.classList.toggle("is-full", loaded >= CHAMBERS);
  }

  setTimer(left: number, limit: number): void {
    const frac = limit > 0 ? Math.max(0, Math.min(1, left / limit)) : 0;
    this.timerFillEl.style.transform = `scaleX(${frac})`;
    this.timerFillEl.classList.toggle("is-urgent", frac <= 0.28);
  }

  /** Render estricto: hechas / actual (con caret) / pendientes. */
  renderSentence(target: string, pos: number): void {
    this.sentenceEl.innerHTML = "";
    for (let i = 0; i < target.length; i++) {
      const ch = document.createElement("span");
      const isSpace = target[i] === " ";
      ch.className =
        "fs-char" +
        (isSpace ? " fs-char--space" : "") +
        (i < pos ? " fs-char--done" : i === pos ? " fs-char--current" : " fs-char--pending");
      ch.textContent = target[i];
      this.sentenceEl.append(ch);
    }
  }

  /** Sacudida roja al errar (la bala ya entro al tambor). */
  flashError(): void {
    this.sentenceEl.classList.remove("fs-miss");
    this.revolverEl.classList.remove("is-kick");
    void this.sentenceEl.offsetWidth;
    this.sentenceEl.classList.add("fs-miss");
    this.revolverEl.classList.add("is-kick");
  }

  // ---------- Gatillo ----------

  startTriggerPull(loaded: number, timedOut: boolean): void {
    this.revolverEl.classList.add("is-spinning", "is-tense");
    this.setChamber(loaded);
    this.verdictEl.className = "fs-verdict is-tense";
    this.verdictEl.textContent = timedOut ? "SE ACABO EL TIEMPO" : "GATILLO";
  }

  showClickRelief(loaded: number, frases: number): void {
    this.revolverEl.classList.remove("is-spinning");
    this.setChamber(loaded);
    this.setFrases(frases);
    this.verdictEl.className = "fs-verdict is-safe";
    this.verdictEl.textContent = "*CLIC*";
  }

  showDeath(): void {
    this.revolverEl.classList.remove("is-spinning");
    this.verdictEl.className = "fs-verdict is-dead";
    this.verdictEl.textContent = "BANG";
    this.flashEl.classList.remove("is-firing");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("is-firing");
    this.stage.classList.remove("is-shot");
    void this.stage.offsetWidth;
    this.stage.classList.add("is-shot");
  }

  showSoleSurvivor(): void {
    this.showBanner("ULTIMO EN PIE");
  }

  private showBanner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove("is-shown");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("is-shown");
  }

  // ---------- Countdown ----------

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

  // ---------- Overlays ----------

  showStart(bestFrases: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");

    this.titleEl.textContent = "FINAL SENTENCE";
    this.titleEl.className = "overlay__title";
    this.subtitleEl.innerHTML =
      "Despertaste en un hangar oscuro con un revolver en la sien. Escribi cada frase sin fallar: " +
      "<b>cada error carga una bala</b>. Al terminar cada frase se jala el gatillo. Solo uno sobrevive.";

    if (bestFrases !== null && bestFrases > 0) {
      this.scoreLineEl.style.display = "block";
      this.scoreLineEl.textContent = `SOBREVIVISTE ${bestFrases} FRASES`;
    } else {
      this.scoreLineEl.style.display = "none";
    }

    this.ratingEl.style.display = "none";
    this.tableContainerEl.style.display = "none";
    this.tableContainerEl.innerHTML = "";
    this.hintEl.textContent = "presiona ENTER si te animas";
    this.leaderboard.clear();
  }

  showRanking(gameId: string, score: number, variant: string): void {
    void this.leaderboard.render(gameId, { score, variant });
  }

  showGameOver(result: RunResult, isNewBest: boolean, best: number): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.stage.classList.add("hidden");

    this.titleEl.textContent = result.soleSurvivor
      ? "ULTIMO EN PIE"
      : isNewBest
        ? "NUEVO RECORD"
        : "EJECUTADO";
    this.titleEl.className = "overlay__title" + (result.soleSurvivor ? " is-victory" : " is-dead");

    this.subtitleEl.textContent = result.soleSurvivor
      ? "Sobreviviste a todos en el hangar. El revolver se queda con hambre."
      : `Caiste en el puesto #${result.placement} de ${result.startSurvivors}.`;

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `${result.frases} ${result.frases === 1 ? "FRASE" : "FRASES"}`;

    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = ratingLabel(result.frases);
    this.ratingEl.className = `overlay__rating rating-${ratingClass(result.frases)}`;

    this.tableContainerEl.style.display = "block";
    this.tableContainerEl.innerHTML = "";
    const table = document.createElement("table");
    table.className = "results-table";
    const rows: [string, string][] = [
      ["Frases superadas", `${result.frases}`],
      ["Puesto", `#${result.placement} / ${result.startSurvivors}`],
      ["Velocidad", `${result.wpm} PPM`],
      ["Precision", `${result.accuracy}%`],
    ];
    for (const [label, value] of rows) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = label;
      const td2 = document.createElement("td");
      td2.textContent = value;
      tr.append(td1, td2);
      table.append(tr);
    }
    this.tableContainerEl.append(table);

    this.hintEl.textContent = `presiona ENTER para otra condena · mejor: ${best} frases`;
  }
}

function ratingLabel(frases: number): string {
  if (frases >= 16) return "Leyenda del hangar";
  if (frases >= 11) return "Sangre fria";
  if (frases >= 7) return "Superviviente";
  if (frases >= 3) return "Con suerte";
  return "Carne de canon";
}

function ratingClass(frases: number): string {
  if (frases >= 16) return "divine";
  if (frases >= 11) return "ultra";
  if (frases >= 7) return "fast";
  if (frases >= 3) return "average";
  return "slow";
}
