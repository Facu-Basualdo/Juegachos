import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { HowToPanel } from "../../../shared/HowToPanel";
import { formatClock } from "../../../shared/scoring";
import { PLAYER_COLORS, symbolColor, symbolSvg } from "./symbols";

/** "m:ss" para el cronometro en vivo (sin centesimas para que no vibre). */
function formatMMSS(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Entrada del marcador por jugador (modo sala). */
export interface PlayerPanelEntry {
  player: string;
  pairs: number;
  /** Indice dentro del orden de turnos: define el color del jugador. */
  colorIdx: number;
  isTurn: boolean;
  isMe: boolean;
}

interface CardElements {
  root: HTMLDivElement;
}

export class Hud {
  private readonly container: HTMLElement;
  private readonly leaderboard = new LeaderboardPanel();

  private hudBar!: HTMLDivElement;
  private pairsIndicator!: HTMLDivElement;
  private turnIndicator!: HTMLDivElement;
  private timeIndicator!: HTMLDivElement;

  private playersPanel!: HTMLDivElement;
  private boardEl!: HTMLDivElement;

  private overlayEl!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private scoreEl!: HTMLDivElement;
  private bestEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private countdownEl!: HTMLDivElement;

  private cards: CardElements[] = [];
  private lastOwners: (number | null)[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.buildMarkup();
  }

  private buildMarkup(): void {
    this.hudBar = document.createElement("div");
    this.hudBar.className = "hud-bar hidden";

    this.pairsIndicator = document.createElement("div");
    this.pairsIndicator.className = "hud-bar__pairs";
    this.pairsIndicator.textContent = "PARES: 0";

    this.turnIndicator = document.createElement("div");
    this.turnIndicator.className = "hud-bar__turn";

    this.timeIndicator = document.createElement("div");
    this.timeIndicator.className = "hud-bar__time";

    this.hudBar.append(this.pairsIndicator, this.turnIndicator, this.timeIndicator);

    this.playersPanel = document.createElement("div");
    this.playersPanel.className = "players-panel hidden";

    const boardWrapper = document.createElement("div");
    boardWrapper.className = "board-wrapper";

    this.boardEl = document.createElement("div");
    this.boardEl.className = "memory-board hidden";
    boardWrapper.append(this.boardEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "overlay";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "overlay__title";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.className = "overlay__subtitle";

    this.scoreEl = document.createElement("div");
    this.scoreEl.className = "overlay__score";

    this.bestEl = document.createElement("div");
    this.bestEl.className = "overlay__bests";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "overlay__hint";

    this.overlayEl.append(this.titleEl, this.subtitleEl, this.scoreEl, this.bestEl, this.hintEl);
    this.leaderboard.mount(this.overlayEl);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("memory-match").follow(this.leaderboard);
    this.leaderboard.clear();

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";

    this.container.append(this.hudBar, this.playersPanel, boardWrapper, this.overlayEl, this.countdownEl);
  }

  showStart(best: { time: number | null; moves: number | null }, roomMode: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardEl.classList.add("hidden");
    this.playersPanel.classList.add("hidden");

    this.titleEl.textContent = "MEMORIA";
    this.subtitleEl.textContent = roomMode
      ? "Tablero compartido: por turnos, quien encuentra un par sigue jugando. Gana quien junte mas pares."
      : "Da vuelta las cartas y encontra todos los pares lo mas rapido y con menos movimientos posible.";

    this.scoreEl.style.display = "none";
    this.bestEl.style.display = "block";
    if (roomMode) {
      this.bestEl.textContent = "";
    } else if (best.time !== null && best.moves !== null) {
      this.bestEl.textContent = `MEJOR RECORD: ${formatClock(best.time * 100)} - ${best.moves} mov`;
    } else {
      this.bestEl.textContent = "SIN RECORD AUN";
    }

    this.hintEl.textContent = "presiona ENTER o toca la pantalla para comenzar";
    this.leaderboard.clear();
  }

  /** Fin del modo solo: tiempo de resolucion y movimientos usados. */
  showGameOver(elapsedSec: number, moves: number, isNewBest: boolean): void {
    this.overlayEl.classList.remove("hidden");
    this.hudBar.classList.add("hidden");
    this.boardEl.classList.add("hidden");

    this.titleEl.textContent = isNewBest ? "¡NUEVO RECORD!" : "¡COMPLETADO!";
    this.subtitleEl.textContent = "";

    this.scoreEl.style.display = "block";
    this.scoreEl.innerHTML = `Tiempo: ${formatClock(elapsedSec * 100)}<br>Movimientos: ${moves}`;

    this.bestEl.style.display = "none";

    this.hintEl.textContent = "presiona ENTER para volver a jugar";
  }

  /** Ranking combinado del modo solo (ordenado por tiempo, mov. de desempate). */
  showSoloRanking(encodedScore: number): void {
    void this.leaderboard.render("memory-match", { score: encodedScore, variant: "solo" });
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
    // Reflow para reiniciar la animacion del pop.
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  hideOverlay(): void {
    this.overlayEl.classList.add("hidden");
    this.boardEl.classList.remove("hidden");
    this.hudBar.classList.remove("hidden");
  }

  /** Handler de Enter/clic del estado inicial (el caller decide arrancar). */
  onOverlayTap(cb: () => void): void {
    this.overlayEl.addEventListener("click", (e) => {
      // No robar los clics de los controles del panel de ranking.
      if ((e.target as HTMLElement).closest("button, input, a")) return;
      cb();
    });
  }

  /**
   * Reconstruye la grilla de cartas boca abajo. `cards` son los ids de par en
   * orden; las caras (simbolo + color) quedan fijas en el DOM y solo se
   * muestran/ocultan con clases en renderCards.
   */
  setupBoard(cols: number, cards: number[], onCardClick: (index: number) => void): void {
    this.boardEl.innerHTML = "";
    this.boardEl.style.setProperty("--cols", cols.toString());
    this.boardEl.style.setProperty("--rows", Math.ceil(cards.length / cols).toString());
    this.cards = [];
    this.lastOwners = new Array(cards.length).fill(null);

    cards.forEach((pairId, index) => {
      const card = document.createElement("div");
      card.className = "card";

      const inner = document.createElement("div");
      inner.className = "card__inner";

      const back = document.createElement("div");
      back.className = "card__face card__face--back";

      const front = document.createElement("div");
      front.className = "card__face card__face--front";
      front.style.color = symbolColor(pairId);
      front.innerHTML = symbolSvg(pairId);

      inner.append(back, front);
      card.append(inner);
      card.addEventListener("click", () => onCardClick(index));

      this.cards.push({ root: card });
      this.boardEl.append(card);
    });
  }

  /**
   * Sincroniza las clases de cada carta con el estado: boca arriba y, si esta
   * emparejada, el color del dueno. Los pares recien ganados hacen un pop.
   */
  renderCards(faceUp: boolean[], ownerColorIdx: (number | null)[]): void {
    this.cards.forEach((card, i) => {
      card.root.classList.toggle("is-up", faceUp[i]);

      const owner = ownerColorIdx[i];
      card.root.classList.toggle("is-matched", owner !== null);
      if (owner !== null) {
        card.root.style.setProperty("--owner-color", PLAYER_COLORS[owner % PLAYER_COLORS.length]);
        if (this.lastOwners[i] === null) {
          card.root.classList.remove("is-won");
          void card.root.offsetWidth;
          card.root.classList.add("is-won");
        }
      } else {
        card.root.classList.remove("is-won");
      }
      this.lastOwners[i] = owner;
    });
  }

  /** Marcador del modo sala: pares propios (el tiempo va en la franja de sala). */
  setStats(pairs: number): void {
    this.pairsIndicator.textContent = `PARES: ${pairs}`;
    this.timeIndicator.textContent = "";
  }

  /** Marcador del modo solo: movimientos, progreso de pares y cronometro. */
  setSoloStats(moves: number, pairsFound: number, totalPairs: number, elapsedSec: number): void {
    this.pairsIndicator.textContent = `MOVIMIENTOS: ${moves}`;
    this.turnIndicator.textContent = `PARES: ${pairsFound}/${totalPairs}`;
    this.turnIndicator.classList.remove("is-mine");
    this.timeIndicator.textContent = `TIEMPO: ${formatMMSS(elapsedSec)}`;
  }

  /** Banner de turno / estado del tablero compartido. */
  setTurnText(text: string | null, isMine = false): void {
    this.turnIndicator.textContent = text ?? "";
    this.turnIndicator.classList.toggle("is-mine", isMine);
  }

  /** Marcador por jugador (modo sala); null lo oculta. */
  showPlayers(entries: PlayerPanelEntry[] | null): void {
    if (!entries) {
      this.playersPanel.classList.add("hidden");
      return;
    }
    this.playersPanel.classList.remove("hidden");
    this.playersPanel.innerHTML = "";
    for (const entry of entries) {
      const chip = document.createElement("div");
      chip.className = "player-chip";
      chip.classList.toggle("is-turn", entry.isTurn);
      chip.style.setProperty("--player-color", PLAYER_COLORS[entry.colorIdx % PLAYER_COLORS.length]);

      const name = document.createElement("span");
      name.className = "player-chip__name";
      name.textContent = entry.isMe ? `${entry.player} (tu)` : entry.player;

      const pairs = document.createElement("span");
      pairs.className = "player-chip__pairs";
      pairs.textContent = String(entry.pairs);

      chip.append(name, pairs);
      this.playersPanel.append(chip);
    }
  }
}
