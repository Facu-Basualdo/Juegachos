import { BEST_KEY_PREFIX, DISC_OPTIONS, optimalMoves } from "./constants";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";

export interface DiscVoteView {
  /** Opciones de discos a votar. */
  options: number[];
  /** Votos por opcion. */
  counts: Record<number, number>;
  /** Mi voto actual, o null. */
  myVote: number | null;
  onVote: (discs: number) => void;
}

export class Hud {
  private readonly container: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  private hudBar!: HTMLDivElement;
  private movesIndicator!: HTMLDivElement;
  private discsIndicator!: HTMLDivElement;
  private timeIndicator!: HTMLDivElement;

  private boardContainer!: HTMLDivElement;

  private overlayEl!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private statsLineEl!: HTMLDivElement;
  private ratingEl!: HTMLDivElement;
  private discSelectorContainer!: HTMLDivElement;
  private voteContainer!: HTMLDivElement;
  private bestScoresEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private countdownEl!: HTMLDivElement;

  /** Elementos de varilla, indexados por su posicion. */
  private pegElements: HTMLDivElement[] = [];
  private currentDiscs = DISC_OPTIONS[0];
  private discCount = DISC_OPTIONS[0];
  private currentDiscCallback?: (discs: number) => void;

  // --- Interaccion (clic-para-mover + arrastrar) ---
  private onPegClick?: (peg: number) => void;
  /** Varilla con disco levantado (espejo del estado del juego, via renderBoard). */
  private selectedPeg: number | null = null;
  /** El disco levantado en el DOM, para moverlo con el puntero al arrastrar. */
  private liftedDiscEl: HTMLDivElement | null = null;
  /** Gesto de arrastre en curso, o null. */
  private drag: { pointerId: number; fromPeg: number; grabX: number; grabY: number; moved: boolean } | null = null;
  private static readonly DRAG_THRESHOLD = 6;

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildMarkup();
    // El puntero puede moverse/soltarse fuera de la varilla: se escucha global.
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
  }

  private buildMarkup(): void {
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.movesIndicator = document.createElement("div");
    this.movesIndicator.className = "hud-bar__moves";
    this.movesIndicator.textContent = "MOVIMIENTOS: 0";

    this.discsIndicator = document.createElement("div");
    this.discsIndicator.className = "hud-bar__discs";
    this.discsIndicator.textContent = "DISCOS: 3";

    this.timeIndicator = document.createElement("div");
    this.timeIndicator.className = "hud-bar__time";
    this.timeIndicator.textContent = "TIEMPO: 00:00";

    this.hudBar.append(this.movesIndicator, this.discsIndicator, this.timeIndicator);

    const boardWrapper = document.createElement("div");
    boardWrapper.className = "board-wrapper";

    this.boardContainer = document.createElement("div");
    this.boardContainer.className = "hanoi-board hidden";
    boardWrapper.append(this.boardContainer);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.statsLineEl = document.createElement("div");
    this.statsLineEl.className = "overlay__score";

    this.ratingEl = document.createElement("div");
    this.ratingEl.className = "overlay__rating";

    this.discSelectorContainer = document.createElement("div");
    this.discSelectorContainer.className = "overlay__disc-selector";

    this.voteContainer = document.createElement("div");
    this.voteContainer.className = "overlay__vote";
    this.voteContainer.style.display = "none";

    this.bestScoresEl = document.createElement("div");
    this.bestScoresEl.className = "overlay__bests";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(
      this.titleEl,
      this.subtitleEl,
      this.statsLineEl,
      this.ratingEl,
      this.discSelectorContainer,
      this.voteContainer,
      this.bestScoresEl,
      this.hintEl,
    );
    this.leaderboard.mount(this.overlayEl);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.container.append(this.hudBar, boardWrapper, this.overlayEl, this.countdownEl);
  }

  showStart(onSelectDiscs: (discs: number) => void): void {
    this.currentDiscCallback = onSelectDiscs;
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardContainer.classList.add("hidden");

    this.titleEl.textContent = "TORRES DE HANOI";
    this.subtitleEl.textContent =
      "Mové toda la torre a la última varilla. Nunca apoyes un disco sobre otro más chico.";

    this.statsLineEl.style.display = "none";
    this.ratingEl.style.display = "none";
    this.voteContainer.style.display = "none";

    this.discSelectorContainer.innerHTML = "";
    this.discSelectorContainer.style.display = "flex";

    DISC_OPTIONS.forEach((discs) => {
      const btn = document.createElement("button");
      btn.className = `disc-btn ${discs === this.currentDiscs ? "active" : ""}`;
      btn.textContent = `${discs}`;
      btn.addEventListener("click", () => {
        this.currentDiscs = discs;
        const buttons = this.discSelectorContainer.querySelectorAll(".disc-btn");
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.updateBestScoreDisplay(discs);
        this.currentDiscCallback?.(discs);
      });
      this.discSelectorContainer.append(btn);
    });

    this.updateBestScoreDisplay(this.currentDiscs);
    this.hintEl.textContent = "elegí los discos y tocá la pantalla (o ENTER) para comenzar";
    this.leaderboard.clear();
  }

  /**
   * Votacion de discos del modo sala: reemplaza al selector solitario. Se
   * re-renderiza en cada refresco del estado compartido.
   */
  showDiscVote(view: DiscVoteView): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardContainer.classList.add("hidden");

    this.titleEl.textContent = "¿CUÁNTOS DISCOS?";
    this.subtitleEl.textContent = "Voten los discos de esta ronda. Gana la mayoría; empate al azar.";

    this.statsLineEl.style.display = "none";
    this.ratingEl.style.display = "none";
    this.discSelectorContainer.style.display = "none";
    this.bestScoresEl.style.display = "none";
    this.leaderboard.clear();

    this.voteContainer.style.display = "flex";
    this.voteContainer.innerHTML = "";
    for (const discs of view.options) {
      const btn = document.createElement("button");
      const mine = view.myVote === discs;
      btn.className = `vote-btn ${mine ? "mine" : ""}`;

      const label = document.createElement("span");
      label.className = "vote-btn__label";
      label.textContent = `${discs} discos`;

      const count = document.createElement("span");
      count.className = "vote-btn__count";
      const n = view.counts[discs] ?? 0;
      count.textContent = n === 1 ? "1 voto" : `${n} votos`;

      btn.append(label, count);
      btn.addEventListener("click", () => view.onVote(discs));
      this.voteContainer.append(btn);
    }

    this.hintEl.textContent = "tocá una opción para votar";
  }

  /** Muestra el ranking global (menos movimientos = mejor) por cantidad de discos. */
  showRanking(gameId: string, encodedScore: number, discs: number): void {
    void this.leaderboard.render(gameId, { score: encodedScore, variant: String(discs) });
  }

  private updateBestScoreDisplay(discs: number): void {
    const bestMovesStr = localStorage.getItem(`${BEST_KEY_PREFIX}${discs}_moves`);
    const bestTimeStr = localStorage.getItem(`${BEST_KEY_PREFIX}${discs}_time`);

    if (bestMovesStr && bestTimeStr) {
      const moves = parseInt(bestMovesStr, 10);
      const seconds = parseFloat(bestTimeStr);
      this.bestScoresEl.innerHTML = `MEJOR RECORD (${discs} discos):<br>${moves} movimientos en ${this.formatTime(seconds)}<br><span class="overlay__optimal">Óptimo: ${optimalMoves(discs)} movimientos</span>`;
    } else {
      this.bestScoresEl.innerHTML = `SIN RECORD AUN (${discs} discos)<br><span class="overlay__optimal">Óptimo: ${optimalMoves(discs)} movimientos</span>`;
    }
    this.bestScoresEl.style.display = "block";
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

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
    this.boardContainer.classList.remove("hidden");
    this.hudBar.classList.remove("hidden");
  }

  setupBoard(discs: number, onPegClick: (peg: number) => void): void {
    this.discCount = discs;
    this.onPegClick = onPegClick;
    this.selectedPeg = null;
    this.liftedDiscEl = null;
    this.drag = null;
    this.boardContainer.innerHTML = "";
    this.boardContainer.style.setProperty("--discs", String(discs));
    this.pegElements = [];

    for (let p = 0; p < 3; p++) {
      const peg = document.createElement("div");
      peg.className = "peg";

      const stack = document.createElement("div");
      stack.className = "peg__stack";

      const rod = document.createElement("div");
      rod.className = "peg__rod";

      const base = document.createElement("div");
      base.className = "peg__base";

      // La ultima varilla es el objetivo: ahi hay que armar la torre (dorada).
      if (p === 2) peg.classList.add("peg--target");

      peg.append(stack, rod, base);
      peg.addEventListener("pointerdown", (e) => this.handlePointerDown(p, e));
      this.boardContainer.append(peg);
      this.pegElements.push(peg);
    }

    this.discsIndicator.textContent = `DISCOS: ${discs}`;
    this.updateStats(0, 0);
  }

  /**
   * Al presionar una varilla: si no hay disco levantado, levanta el de arriba
   * (y arma un posible arrastre); si ya hay uno levantado, lo suelta ahi (clic
   * para mover). Todo se resuelve reusando onPegClick del juego (levantar =
   * seleccionar, soltar = mover / deseleccionar).
   */
  private handlePointerDown(peg: number, e: PointerEvent): void {
    if (!this.onPegClick) return;
    e.preventDefault();
    if (this.selectedPeg === null) {
      this.onPegClick(peg);
      // Si el juego efectivamente levanto el disco de esta varilla, arrancar el
      // gesto de arrastre; sino (varilla vacia / fuera de juego) no hacer nada.
      if (this.selectedPeg === peg) {
        this.drag = { pointerId: e.pointerId, fromPeg: peg, grabX: e.clientX, grabY: e.clientY, moved: false };
      }
    } else {
      // Ya hay un disco levantado: soltarlo en esta varilla.
      this.onPegClick(peg);
      this.drag = null;
    }
  }

  private handlePointerMove = (e: PointerEvent): void => {
    const g = this.drag;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.grabX;
    const dy = e.clientY - g.grabY;
    if (!g.moved && Math.hypot(dx, dy) > Hud.DRAG_THRESHOLD) {
      g.moved = true;
      this.liftedDiscEl?.classList.add("disc--dragging");
    }
    if (g.moved && this.liftedDiscEl) {
      this.liftedDiscEl.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const g = this.drag;
    if (!g || e.pointerId !== g.pointerId) return;
    this.drag = null;
    // Sin movimiento fue un tap: se deja el disco levantado (modo clic-para-mover).
    if (!g.moved) return;
    const target = this.pegAt(e.clientX, e.clientY);
    // Sobre otra varilla: mover ahi. Sobre la misma o fuera: soltar / deseleccionar.
    this.onPegClick?.(target !== null && target !== g.fromPeg ? target : g.fromPeg);
  };

  /** Indice de la varilla bajo el punto, o null. */
  private pegAt(x: number, y: number): number | null {
    for (let i = 0; i < this.pegElements.length; i++) {
      const r = this.pegElements[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }
    return null;
  }

  /** Dibuja las tres pilas; `selected` resalta la varilla con el disco levantado. */
  renderBoard(pegs: number[][], selected: number | null): void {
    // Espejo del estado de seleccion, para el gesto de arrastre.
    this.selectedPeg = selected;
    this.liftedDiscEl = null;
    for (let p = 0; p < this.pegElements.length; p++) {
      const pegEl = this.pegElements[p];
      const stack = pegEl.querySelector<HTMLDivElement>(".peg__stack")!;
      stack.innerHTML = "";
      pegEl.classList.toggle("peg--selected", selected === p);

      const discsInPeg = pegs[p];
      // El stack se dibuja de arriba hacia abajo (column-reverse en CSS pone el
      // primer hijo abajo), asi que agregamos del fondo al tope en orden.
      for (let i = 0; i < discsInPeg.length; i++) {
        const size = discsInPeg[i];
        const disc = document.createElement("div");
        disc.className = "disc";
        const isTop = i === discsInPeg.length - 1;
        if (isTop && selected === p) {
          disc.classList.add("disc--lifted");
          this.liftedDiscEl = disc;
        }
        // Ancho relativo al tamano del disco sobre el total.
        const widthPct = 34 + (size / this.discCount) * 60;
        disc.style.width = `${widthPct}%`;
        disc.style.background = `hsl(${(size - 1) * 40}, 72%, 56%)`;
        disc.textContent = String(size);
        stack.append(disc);
      }
    }
  }

  updateStats(moves: number, timeSeconds: number): void {
    this.movesIndicator.textContent = `MOVIMIENTOS: ${moves}`;
    this.timeIndicator.textContent = `TIEMPO: ${this.formatTime(timeSeconds)}`;
  }

  showVictory(
    moves: number,
    timeSeconds: number,
    isNewBestMoves: boolean,
    isNewBestTime: boolean,
    bestMoves: number,
    bestTime: number,
    discs: number,
    roomMode: boolean,
  ): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardContainer.classList.add("hidden");
    this.voteContainer.style.display = "none";

    const isOptimal = moves === optimalMoves(discs);
    const record = isNewBestMoves || isNewBestTime;
    this.titleEl.textContent = isOptimal ? "¡PERFECTO!" : record ? "¡NUEVO RECORD!" : "VICTORIA";
    this.subtitleEl.textContent = `¡Resolviste la torre de ${discs} discos!`;

    this.statsLineEl.style.display = "block";
    this.statsLineEl.innerHTML = `Movimientos: ${moves}<br>Tiempo: ${this.formatTime(timeSeconds)}`;

    this.ratingEl.style.display = "inline-block";
    this.ratingEl.textContent = this.getRatingLabel(moves, discs);
    this.ratingEl.className = `overlay__rating rating-${this.getRatingClass(moves, discs)}`;

    this.discSelectorContainer.style.display = "none";

    this.bestScoresEl.style.display = "block";
    this.bestScoresEl.innerHTML = `MEJOR RECORD (${discs} discos):<br>${bestMoves} movimientos en ${this.formatTime(bestTime)}<br><span class="overlay__optimal">Óptimo: ${optimalMoves(discs)} movimientos</span>`;

    this.hintEl.textContent = roomMode
      ? "esperá a que termine la ronda"
      : "presioná ENTER para volver a jugar";
  }

  private formatTime(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const pad = (num: number) => num.toString().padStart(2, "0");
    return `${pad(mins)}:${pad(secs)}`;
  }

  private getRatingLabel(moves: number, discs: number): string {
    const optimal = optimalMoves(discs);
    if (moves === optimal) return "Cerebro Galáctico";
    if (moves <= optimal * 1.25) return "Maestro del Orden";
    if (moves <= optimal * 1.75) return "Veloz";
    return "Paciente";
  }

  private getRatingClass(moves: number, discs: number): string {
    const optimal = optimalMoves(discs);
    if (moves === optimal) return "divine";
    if (moves <= optimal * 1.25) return "ultra";
    if (moves <= optimal * 1.75) return "fast";
    return "average";
  }
}
