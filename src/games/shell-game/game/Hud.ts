import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";

export class Hud {
  private readonly hudBar: HTMLDivElement;
  private readonly levelEl: HTMLDivElement;

  private readonly boardEl: HTMLDivElement;
  private readonly cupsContainerEl: HTMLDivElement;
  private readonly coinEl: HTMLDivElement;

  private readonly overlayEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly scoreLineEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  private readonly countdownEl: HTMLDivElement;
  private readonly multiplayerStatusEl: HTMLDivElement;
  private readonly selectTimerEl: HTMLDivElement;

  private readonly leaderboard = new LeaderboardPanel();

  private ghostEl: HTMLDivElement | null = null;

  constructor(container: HTMLElement) {
    // 1. HUD top bar
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.levelEl = document.createElement("div");
    this.levelEl.className = "hud-bar__level";
    this.levelEl.textContent = "NIVEL: 1";

    this.hudBar.append(this.levelEl);

    // 2. Main Board
    this.boardEl = document.createElement("div");
    this.boardEl.className = "board";

    this.coinEl = document.createElement("div");
    this.coinEl.className = "coin hidden";
    this.coinEl.innerHTML = `<div class="coin-inner"></div>`;

    this.cupsContainerEl = document.createElement("div");
    this.cupsContainerEl.className = "cups-container";

    this.boardEl.append(this.coinEl, this.cupsContainerEl);

    // 3. Start/Game Over Overlay
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreLineEl = document.createElement("div");
    this.scoreLineEl.className = "overlay__score";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreLineEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("shell-game").follow(this.leaderboard);
    this.leaderboard.clear();

    // 4. Countdown Label
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    // 5. Multiplayer Choices Panel
    this.multiplayerStatusEl = document.createElement("div");
    this.multiplayerStatusEl.className = "multiplayer-status hidden";

    // 6. Room mode: countdown to pick a cup (auto-resolves on timeout).
    this.selectTimerEl = document.createElement("div");
    this.selectTimerEl.className = "select-timer hidden";

    container.append(
      this.hudBar,
      this.boardEl,
      this.overlayEl,
      this.countdownEl,
      this.multiplayerStatusEl,
      this.selectTimerEl,
    );
  }

  get overlay(): HTMLDivElement {
    return this.overlayEl;
  }

  get cupsContainer(): HTMLDivElement {
    return this.cupsContainerEl;
  }

  get coin(): HTMLDivElement {
    return this.coinEl;
  }

  showStart(best: number | null): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.multiplayerStatusEl.classList.add("hidden");
    this.clearBoard();
    this.clearGhost();

    this.titleEl.textContent = "EL TRILE";
    this.subtitleEl.textContent =
      "Sigue el movimiento de los vasos. Cuando se detengan, selecciona el que tiene la moneda oculta. ¡La velocidad, el número de pases y la cantidad de vasos aumentan en cada nivel!";

    if (best !== null) {
      this.scoreLineEl.textContent = `MEJOR NIVEL: ${best}`;
      this.scoreLineEl.style.display = "block";
    } else {
      this.scoreLineEl.textContent = "";
      this.scoreLineEl.style.display = "none";
    }

    this.hintEl.textContent = "presiona ENTER o toca para comenzar";
    this.leaderboard.clear();
  }

  showGameOver(score: number, isNewBest: boolean, best: number, roomMode: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.multiplayerStatusEl.classList.add("hidden");
    this.clearGhost();

    this.titleEl.textContent = isNewBest ? "NUEVO RECORD" : "FIN DE LA PARTIDA";
    this.subtitleEl.textContent = "¡Buen intento! Tu concentración mejorará con la práctica.";

    this.scoreLineEl.style.display = "block";
    this.scoreLineEl.textContent = `NIVEL ALCANZADO: ${score}`;

    this.hintEl.textContent = roomMode
      ? `mejor nivel: ${best}`
      : `presiona ENTER o toca para volver a jugar - mejor nivel: ${best}`;
  }

  showRanking(gameId: string, score: number): void {
    void this.leaderboard.render(gameId, { score });
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
    this.hudBar.classList.remove("hidden");
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
    void this.countdownEl.offsetWidth; // Reflow to reset CSS transition
    this.countdownEl.classList.add("is-shown");
  }

  clearBoard(): void {
    this.cupsContainerEl.innerHTML = "";
    this.coinEl.classList.add("hidden");
  }

  /**
   * Snapshot the current cups as a ghost layer that stays on screen while the
   * board is rebuilt, so the outgoing and incoming rounds crossfade with no
   * blank frame. No-ops when the board is empty (e.g. the first level).
   */
  beginCrossfade(): void {
    this.clearGhost();

    if (this.cupsContainerEl.children.length === 0) return;

    const boardRect = this.boardEl.getBoundingClientRect();
    const rect = this.cupsContainerEl.getBoundingClientRect();

    const ghost = this.cupsContainerEl.cloneNode(true) as HTMLDivElement;
    ghost.classList.add("board-ghost");
    ghost.classList.remove("board-faded");
    ghost.style.position = "absolute";
    ghost.style.left = `${rect.left - boardRect.left}px`;
    ghost.style.top = `${rect.top - boardRect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;

    this.boardEl.append(ghost);
    this.ghostEl = ghost;
  }

  /** Mark a freshly built board as hidden so it can be faded in. */
  hideBoardForFade(): void {
    this.cupsContainerEl.classList.add("board-faded");
    this.coinEl.classList.add("board-faded");
  }

  /** Fade the new board in and, if present, crossfade the ghost snapshot out. */
  revealBoard(): void {
    // Flush the faded (opacity 0) state before clearing it, otherwise adding and
    // removing the class in the same tick cancels out and the fade never runs.
    void this.cupsContainerEl.offsetWidth;
    this.cupsContainerEl.classList.remove("board-faded");
    this.coinEl.classList.remove("board-faded");

    const ghost = this.ghostEl;
    if (ghost) {
      this.ghostEl = null;
      ghost.classList.add("board-faded");
      setTimeout(() => ghost.remove(), 400);
    }
  }

  /** Remove any lingering ghost snapshot immediately. */
  private clearGhost(): void {
    if (this.ghostEl) {
      this.ghostEl.remove();
      this.ghostEl = null;
    }
  }

  updateStats(level: number): void {
    this.levelEl.textContent = `NIVEL: ${level}`;
  }

  /** Update multiplayer choice waiting screen status */
  updateMultiplayerStatus(
    players: string[],
    choices: Record<string, number>,
    surviving: string[],
    me: string
  ): void {
    this.multiplayerStatusEl.classList.remove("hidden");
    this.multiplayerStatusEl.innerHTML = "";

    const isMeSurviving = surviving.includes(me);
    const title = document.createElement("div");
    title.className = "multiplayer-status__title";
    title.textContent = isMeSurviving
      ? "Elige tu vaso..."
      : "Eliminado - Observando a los sobrevivientes...";
    this.multiplayerStatusEl.append(title);

    const list = document.createElement("div");
    list.className = "multiplayer-status__list";

    players.forEach((player) => {
      const isPlayerSurviving = surviving.includes(player);
      const hasChosen = choices[player] !== undefined;
      const item = document.createElement("div");

      let borderClass = "waiting";
      let statusText = "Pensando...";

      if (!isPlayerSurviving) {
        borderClass = "eliminated";
        statusText = "Eliminado";
      } else if (hasChosen) {
        borderClass = "ready";
        statusText = "Listo";
      }

      item.className = `multiplayer-status__item ${borderClass} ${player === me ? "me" : ""}`;
      item.innerHTML = `
        <span class="player-name">${player === me ? `${player} (Tú)` : player}</span>
        <span class="status-indicator">${statusText}</span>
      `;
      list.append(item);
    });

    this.multiplayerStatusEl.append(list);
  }

  hideMultiplayerStatus(): void {
    this.multiplayerStatusEl.classList.add("hidden");
  }

  /** Room mode: seconds left to pick a cup, or null to hide the timer. */
  showSelectTimer(seconds: number | null): void {
    if (seconds === null) {
      this.selectTimerEl.classList.add("hidden");
      return;
    }
    this.selectTimerEl.classList.remove("hidden");
    this.selectTimerEl.classList.toggle("is-urgent", seconds <= 3);
    this.selectTimerEl.textContent = `Elegi tu vaso: ${seconds}s`;
  }
}
