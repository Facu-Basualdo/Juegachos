import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import type { CarInput } from "./Car";

/** HUD DOM del juego: vueltas, cronometro, posicion, overlays y tactil. */
export class Hud {
  /** Estado de los botones tactiles; el juego lo combina con el teclado. */
  readonly touchInput: CarInput = { up: false, down: false, left: false, right: false };

  private lapEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private posEl!: HTMLElement;
  private trackEl!: HTMLElement;
  private countdownEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private overlayTitleEl!: HTMLElement;
  private overlaySubtitleEl!: HTMLElement;
  private overlayStat1El!: HTMLElement;
  private overlayStat2El!: HTMLElement;
  private overlayButtonEl!: HTMLButtonElement;
  private statsEl!: HTMLElement;
  private mapsEl!: HTMLElement;
  private mapChips: HTMLElement[] = [];
  private voteCountEls: HTMLElement[] = [];
  private readonly leaderboard = new LeaderboardPanel();
  private readonly howTo = new HowToPanel("car-race");

  constructor(container: HTMLElement, onAction: () => void) {
    const hud = document.createElement("div");
    hud.className = "hud";
    hud.innerHTML = `
      <div class="hud__top">
        <div class="hud__block">
          <span class="hud__label">Vuelta</span>
          <span class="hud__value" id="race-lap">-</span>
        </div>
        <div class="hud__block hud__block--center">
          <span class="hud__label">Tiempo</span>
          <span class="hud__value hud__value--time" id="race-time">0:00.00</span>
        </div>
        <div class="hud__block hud__block--right">
          <span class="hud__label">Posición</span>
          <span class="hud__value" id="race-pos">-</span>
        </div>
      </div>
      <div class="hud__track" id="race-track"></div>
    `;
    container.append(hud);
    this.lapEl = hud.querySelector("#race-lap")!;
    this.timeEl = hud.querySelector("#race-time")!;
    this.posEl = hud.querySelector("#race-pos")!;
    this.trackEl = hud.querySelector("#race-track")!;

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown hidden";
    container.append(this.countdownEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";
    this.overlayEl.innerHTML = `
      <div class="overlay__card">
        <h1 class="overlay__title" id="overlay-title">NEON DRIFT</h1>
        <p class="overlay__subtitle" id="overlay-subtitle"></p>
        <div class="overlay__maps" id="overlay-maps"></div>
        <div class="overlay__stats">
          <div class="overlay__stat">
            <span class="hud__label">Tiempo</span>
            <span class="overlay__stat-val primary" id="overlay-stat-1">-</span>
          </div>
          <div class="overlay__stat">
            <span class="hud__label">Récord</span>
            <span class="overlay__stat-val secondary" id="overlay-stat-2">-</span>
          </div>
        </div>
        <button class="overlay__button" id="overlay-button">JUGAR</button>
        <div class="overlay__instructions">
          <b>Flechas</b> o <b>WASD</b>: acelerar, frenar y doblar.<br>
          En móviles usa los controles táctiles. Las paredes te mantienen en pista.
        </div>
      </div>
    `;
    container.append(this.overlayEl);
    this.overlayTitleEl = this.overlayEl.querySelector("#overlay-title")!;
    this.overlaySubtitleEl = this.overlayEl.querySelector("#overlay-subtitle")!;
    this.overlayStat1El = this.overlayEl.querySelector("#overlay-stat-1")!;
    this.overlayStat2El = this.overlayEl.querySelector("#overlay-stat-2")!;
    this.overlayButtonEl = this.overlayEl.querySelector("#overlay-button")!;
    this.overlayButtonEl.addEventListener("click", onAction);
    this.statsEl = this.overlayEl.querySelector(".overlay__stats")!;
    this.mapsEl = this.overlayEl.querySelector("#overlay-maps")!;

    this.leaderboard.mount(this.overlayEl.querySelector(".overlay__card")!);

    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.

    this.howTo.mount(this.leaderboard.root.parentElement!, this.leaderboard.root).hides(".overlay__instructions");
    this.leaderboard.clear();

    this.createTouchControls(container);
  }

  private createTouchControls(container: HTMLElement): void {
    const controls = document.createElement("div");
    controls.className = "race-controls";
    controls.innerHTML = `
      <div class="race-controls__cluster race-controls__cluster--left">
        <div class="race-btn" data-k="left">◀</div>
        <div class="race-btn" data-k="right">▶</div>
      </div>
      <div class="race-controls__cluster race-controls__cluster--right">
        <div class="race-btn race-btn--brake" data-k="down">▼</div>
        <div class="race-btn race-btn--gas" data-k="up">▲</div>
      </div>
    `;
    container.append(controls);

    for (const btn of controls.querySelectorAll<HTMLElement>(".race-btn")) {
      const key = btn.dataset.k as keyof CarInput;
      const press = (e: Event) => {
        e.preventDefault();
        this.touchInput[key] = true;
      };
      const release = (e: Event) => {
        e.preventDefault();
        this.touchInput[key] = false;
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  /** Crea los chips de seleccion de circuito con miniatura del trazado. */
  buildMapSelector(
    tracks: { name: string; accent: string; d: string }[],
    onSelect: (idx: number) => void,
  ): void {
    this.mapsEl.innerHTML = `<span class="overlay__maps-label">Elegí circuito</span>`;
    const row = document.createElement("div");
    row.className = "overlay__maps-row";
    this.mapChips = tracks.map((t, i) => {
      const chip = document.createElement("button");
      chip.className = "map-chip";
      chip.style.setProperty("--chip-accent", t.accent);
      chip.innerHTML = `
        <svg class="map-chip__svg" viewBox="0 0 100 62" aria-hidden="true">
          <path d="${t.d}" fill="none" stroke="${t.accent}" stroke-width="5"
                stroke-linejoin="round" stroke-linecap="round" />
        </svg>
        <span class="map-chip__name">${t.name}</span>`;
      chip.addEventListener("click", () => onSelect(i));
      row.append(chip);
      return chip;
    });
    this.mapsEl.append(row);
  }

  /** Marca el circuito activo en el selector. */
  setSelectedMap(idx: number): void {
    this.mapChips.forEach((chip, i) => chip.classList.toggle("selected", i === idx));
  }

  /**
   * Pantalla de votacion de circuito en sala: chips clickeables con contador de
   * votos. El overlay tapa la pista de fondo hasta que se decide el ganador.
   */
  showMapVote(
    tracks: { name: string; accent: string; d: string }[],
    onVote: (idx: number) => void,
  ): void {
    this.overlayTitleEl.textContent = "VOTÁ EL CIRCUITO";
    this.overlaySubtitleEl.textContent = "";
    this.overlayButtonEl.style.display = "none";
    this.statsEl.classList.add("hidden");
    this.leaderboard.clear();

    this.mapsEl.classList.remove("hidden");
    this.mapsEl.innerHTML = `<span class="overlay__maps-label">El más votado gana (empate al azar)</span>`;
    const row = document.createElement("div");
    row.className = "overlay__maps-row";
    this.voteCountEls = [];
    this.mapChips = tracks.map((t, i) => {
      const chip = document.createElement("button");
      chip.className = "map-chip";
      chip.style.setProperty("--chip-accent", t.accent);
      chip.innerHTML = `
        <svg class="map-chip__svg" viewBox="0 0 100 62" aria-hidden="true">
          <path d="${t.d}" fill="none" stroke="${t.accent}" stroke-width="5"
                stroke-linejoin="round" stroke-linecap="round" />
        </svg>
        <span class="map-chip__name">${t.name}</span>
        <span class="map-chip__votes"></span>`;
      const badge = chip.querySelector<HTMLElement>(".map-chip__votes")!;
      badge.style.cssText =
        "min-width:1.1rem;height:1.1rem;line-height:1.1rem;margin-top:2px;border-radius:999px;" +
        "font-size:0.72rem;font-weight:800;color:#0a0b0e;background:var(--chip-accent);" +
        "display:inline-block;text-align:center;visibility:hidden;";
      chip.addEventListener("click", () => onVote(i));
      row.append(chip);
      this.voteCountEls.push(badge);
      return chip;
    });
    this.mapsEl.append(row);
    this.overlayEl.classList.remove("hidden");
  }

  /** Actualiza contadores de votos, el circuito propio elegido y el texto de estado. */
  updateMapVote(counts: number[], myIdx: number, info: string): void {
    counts.forEach((c, i) => {
      const badge = this.voteCountEls[i];
      if (!badge) return;
      badge.textContent = String(c);
      badge.style.visibility = c > 0 ? "visible" : "hidden";
    });
    this.setSelectedMap(myIdx);
    this.overlaySubtitleEl.textContent = info;
  }

  setLap(lap: number, total: number): void {
    this.lapEl.textContent = `${Math.min(lap, total)}/${total}`;
  }

  setTime(text: string): void {
    this.timeEl.textContent = text;
  }

  /** Posicion en carrera ("2°/4") o "-" sin rivales. */
  setPos(text: string | null): void {
    this.posEl.textContent = text ?? "-";
  }

  setTrackName(name: string): void {
    this.trackEl.textContent = name;
  }

  showCountdown(text: string, accent: string): void {
    // Se llama en cada frame: solo reinicia la animacion si el texto cambio.
    if (this.countdownEl.textContent === text && !this.countdownEl.classList.contains("hidden")) {
      return;
    }
    this.countdownEl.textContent = text;
    this.countdownEl.style.color = accent;
    this.countdownEl.classList.remove("hidden");
    this.countdownEl.classList.remove("pop");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("pop");
  }

  hideCountdown(): void {
    this.countdownEl.classList.add("hidden");
  }

  showStart(trackName: string, laps: number, bestText: string): void {
    this.overlayTitleEl.textContent = "NEON DRIFT";
    this.setStartInfo(trackName, laps, bestText);
    this.overlayStat1El.textContent = "-";
    this.overlayButtonEl.textContent = "JUGAR";
    this.overlayButtonEl.style.display = "";
    this.statsEl.classList.remove("hidden");
    this.mapsEl.classList.remove("hidden");
    this.leaderboard.clear();
    this.howTo.show(true);
    this.overlayEl.classList.remove("hidden");
  }

  /** Refresca circuito elegido: subtitulo + record (sin tocar el resto). */
  setStartInfo(trackName: string, laps: number, bestText: string): void {
    this.overlaySubtitleEl.textContent = `Circuito: ${trackName} · ${laps} vueltas. Completá la carrera en el menor tiempo posible.`;
    this.overlayStat2El.textContent = bestText;
  }

  showGameOver(timeText: string, bestText: string, isRecord: boolean, allowRetry: boolean): void {
    this.overlayTitleEl.textContent = "¡META!";
    this.overlaySubtitleEl.textContent = isRecord
      ? "¡Nuevo récord personal! Sos una flecha."
      : "Carrera completada.";
    this.overlayStat1El.textContent = timeText;
    this.overlayStat2El.textContent = bestText;
    this.howTo.show(false);
    this.overlayButtonEl.textContent = "OTRA CARRERA";
    this.overlayButtonEl.style.display = allowRetry ? "" : "none";
    this.statsEl.classList.remove("hidden");
    this.overlayEl.classList.remove("hidden");
  }

  /** Ranking global por circuito con envio del puntaje recien logrado. */
  showRanking(gameId: string, score: number, variant?: string): void {
    void this.leaderboard.render(gameId, { score, variant });
  }

  /** Ranking global por circuito en solo lectura (al ojear otro circuito). */
  showRankingReadonly(gameId: string, variant: string): void {
    void this.leaderboard.render(gameId, { variant });
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
  }
}
