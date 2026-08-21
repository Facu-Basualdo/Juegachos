import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { chooseMove } from "./ai";
import {
  AI_THINK_MS,
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  SOLO_RESULT_MS,
} from "./constants";
import { Hud } from "./Hud";
import { humanBoards, pairFor } from "./pairing";
import { SharedMatch } from "./sharedMatch";
import {
  applyMove,
  createState,
  pieceToRemove,
  type Player,
  type TttState,
} from "./logic";
import { SoundEffects } from "./SoundEffects";

type State = "ready" | "countdown" | "playing" | "over";

/** El humano es X; la IA es O y abre cada partida (juega primero). */
const HUMAN: Player = 0;
const AI: Player = 1;

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador PvP): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;
  /** Mi tablero compartido; existe solo en modo sala (PvP) y tras el countdown. */
  private shared: SharedMatch | null = null;
  /** Tableros que el host administra sin jugar (las otras parejas de la ronda). */
  private shadowMatches: SharedMatch[] = [];
  /** En sala, me toco jugar contra la IA (jugador impar): partida local que puntua. */
  private aiRoomMatch = false;
  /** Resultado de esa partida vs IA (1 gane / 0 perdi), para el parcial. */
  private aiRoomScore = 0;
  /** Numero de mi tablero PvP (para no espectarme a mi mismo); null si juego vs IA. */
  private myHumanBoardNo: number | null = null;
  /** Tablero ajeno que estoy mirando tras terminar mi partida. */
  private spectator: SharedMatch | null = null;
  /** Ya arranque a espectar (idempotente: no volver a repartir la cola). */
  private spectateStarted = false;
  /** Otras partidas de la ronda para mirar, en orden al azar. */
  private spectateQueue: Array<{ boardNo: number; seats: [string, string] }> = [];
  /** Tableros ya mirados hasta el final (no repetir). */
  private readonly spectatedBoards = new Set<number>();

  private state: State = "ready";

  // Modo solo (vs IA, racha de victorias)
  private soloState: TttState | null = null;
  private streak = 0;
  private best: number | null = null;
  /** Bloquea el input mientras la IA piensa o entre partidas de la racha. */
  private busy = false;

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = 0;

  /** Tokens de setTimeout en curso (turno IA / transicion de partida). */
  private pending: number[] = [];
  /** Se incrementa en cada partida nueva: los timeouts viejos se descartan. */
  private runId = 0;
  /**
   * True solo cuando el overlay de inicio / fin esta realmente en pantalla. Al
   * perder la racha, el estado pasa a "over" pero el overlay de fin aparece
   * `SOLO_RESULT_MS` despues (se muestra un momento el tablero perdido): sin este
   * guard un Enter en esa ventana reiniciaba la partida y su `cancelPending()`
   * cancelaba el `schedule` del overlay, asi que nunca se mostraba el puntaje ni
   * el ranking.
   */
  private menuVisible = true;

  constructor(container: HTMLElement) {
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) this.best = parseInt(savedBest, 10);

    this.hud = new Hud(container);
    this.hud.bindCells(this.handleCell);

    this.room = initRoomMode("tic-tac-toe", {
      getScore: () => this.shared?.myScore() ?? this.aiRoomScore,
      onStart: () => this.beginCountdown(),
      // Al terminar mi partida no muestro la espera generica: paso a mirar otra
      // partida en curso (true = la manejo yo, RoomMode oculta el "esperando").
      onReportedWaiting: () => this.beginSpectating(),
    });

    this.hud.showStart(this.best, this.room !== null);

    window.addEventListener("keydown", this.handleKeyDown);
    this.hud.overlay.addEventListener("pointerdown", this.handleOverlayTap);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") this.tryStart();
  };

  private handleOverlayTap = (e: Event): void => {
    // El panel de ranking dentro del overlay es interactivo: no arrancar por su clic.
    const target = e.target as HTMLElement;
    if (target !== this.hud.overlay && target.closest("input, button, form")) return;
    this.tryStart();
  };

  private tryStart(): void {
    // Solo se arranca con el overlay realmente en pantalla, nunca durante el
    // tiempo en que se muestra el tablero perdido antes del overlay de fin.
    if (!this.menuVisible) return;
    if (this.state === "ready") {
      this.beginCountdown();
    } else if (this.state === "over") {
      if (this.room) return; // en sala se juega una sola partida por ronda
      this.beginCountdown();
    }
  }

  private beginCountdown(): void {
    this.cancelPending();
    this.menuVisible = false;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.busy = false;

    this.hud.hideOverlay();

    if (this.room) {
      this.hud.setScore("");
      this.hud.setStatus("");
      this.hud.setBest("");
    } else {
      this.streak = 0;
      this.newSoloMatch();
    }
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startPlay(): void {
    this.state = "playing";
    if (this.room) {
      this.startRoomMatches();
    } else {
      this.renderSolo();
    }
  }

  /**
   * Reparte a los jugadores de la sala en duelos 1v1 (ver `pairing.ts`): juego mi
   * tablero (PvP con mi pareja, o contra la IA si soy el jugador impar que sobra),
   * y si soy el host ademas administro los demas tableros humanos (los creo y les
   * destrabo el AFK) sin jugarlos.
   */
  private startRoomMatches(): void {
    const room = this.room!;
    const pairing = pairFor(room.players(), room.me);
    if (!pairing) return; // espectador: RoomMode ya lo maneja, no arranca partida

    if (pairing.vsAI) {
      // Jugador impar: partida local contra la IA que igual reporta 1/0 a la sala.
      this.aiRoomMatch = true;
      this.aiRoomScore = 0;
      this.myHumanBoardNo = null; // no tengo tablero compartido propio
      this.newSoloMatch();
    } else {
      this.myHumanBoardNo = pairing.boardNo;
      this.shared = new SharedMatch(room, this.hud, () => {
        this.state = "over";
        this.beginSpectating();
      }, { boardNo: pairing.boardNo, seats: pairing.seats });
      this.shared.start();
    }

    // El host crea y destraba (AFK) los tableros de las otras parejas.
    if (room.isHost()) {
      for (const board of humanBoards(room.players())) {
        if (!pairing.vsAI && board.boardNo === pairing.boardNo) continue; // ese lo juego yo
        const shadow = new SharedMatch(room, this.hud, () => {}, {
          boardNo: board.boardNo,
          seats: board.seats,
          passive: true,
        });
        shadow.start();
        this.shadowMatches.push(shadow);
      }
    }
  }

  // ---------- Espectar otras partidas (sala PvP) ----------

  /**
   * Al terminar mi partida paso a mirar otra en curso de la ronda en vez de la
   * pantalla generica "esperando a los demas": con 4 jugadores, la otra; con mas,
   * una al azar, saltando a la siguiente cuando la mirada termina. Devuelve true
   * si hay algo para espectar (RoomMode oculta la espera), false si no queda
   * ninguna (se muestra la espera de siempre). Idempotente.
   */
  private beginSpectating(): boolean {
    if (!this.room) return false;
    if (!this.spectateStarted) {
      this.spectateStarted = true;
      this.shared?.dispose(); // mi tablero ya termino: dejo de sondearlo
      const boards = humanBoards(this.room.players()).filter(
        (b) => b.boardNo !== this.myHumanBoardNo,
      );
      // Al azar para que ">4 jugadores" mire una cualquiera; con 4 hay una sola.
      for (let i = boards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [boards[i], boards[j]] = [boards[j], boards[i]];
      }
      this.spectateQueue = boards;
      this.spectateNext();
    }
    return this.spectator !== null;
  }

  /** Pasa a mirar la siguiente partida no vista; si no queda ninguna, se detiene. */
  private spectateNext(): void {
    this.spectator?.dispose();
    this.spectator = null;
    const room = this.room;
    if (!room) return;
    const next = this.spectateQueue.find((b) => !this.spectatedBoards.has(b.boardNo));
    if (!next) return; // no queda otra partida en curso para mirar
    this.spectatedBoards.add(next.boardNo);
    this.spectator = new SharedMatch(room, this.hud, () => this.spectateNext(), {
      boardNo: next.boardNo,
      seats: next.seats,
      spectate: true,
    });
    this.spectator.start();
  }

  // ---------- Modo solo (vs IA) ----------

  private newSoloMatch(): void {
    this.soloState = createState(AI); // la IA abre cada partida
    // Bloquea el input y deja que la IA juegue primero tras una breve pausa.
    this.busy = true;
    this.renderSolo();
    this.schedule(() => this.aiMove(), AI_THINK_MS);
  }

  private handleCell = (index: number): void => {
    // En sala PvP el clic va al tablero compartido; en solo (y en sala vs IA,
    // donde no hay tablero compartido) va al tablero local de aca abajo.
    if (this.room && this.shared) {
      this.shared.handleCell(index);
      return;
    }
    const state = this.soloState;
    if (this.state !== "playing" || !state || this.busy) return;
    if (state.turn !== HUMAN || state.winner !== null) return;
    if (state.cells[index] !== null) return;

    this.playSolo(index, HUMAN);
    if (this.soloState!.winner !== null) {
      this.onMatchWin();
      return;
    }
    // Turno de la IA tras una breve pausa para que se lea la jugada.
    this.busy = true;
    this.renderSolo();
    this.schedule(() => this.aiMove(), AI_THINK_MS);
  };

  private aiMove(): void {
    const state = this.soloState;
    if (!state || state.winner !== null) return;
    const cell = chooseMove(state, AI);
    this.playSolo(cell, AI);

    if (this.soloState!.winner !== null) {
      this.onMatchLose();
      return;
    }
    this.busy = false;
    this.renderSolo();
  }

  /** Aplica una jugada al tablero solo con sus sonidos (sin decidir el flujo). */
  private playSolo(index: number, player: Player): void {
    const state = this.soloState!;
    if (pieceToRemove(state, player) !== null) SoundEffects.playRemove();
    this.soloState = applyMove(state, index);
    SoundEffects.playPlace(player);
    this.renderSolo();
  }

  private onMatchWin(): void {
    if (this.aiRoomMatch) {
      SoundEffects.playWin();
      this.finishAiRoom(1);
      return;
    }
    this.streak++;
    SoundEffects.playWin();
    this.busy = true;
    this.renderSolo();
    // Se muestra la linea ganadora un momento y arranca la siguiente partida.
    this.schedule(() => {
      this.newSoloMatch();
    }, SOLO_RESULT_MS);
  }

  /** Sala vs IA: cierra la partida local y reporta el resultado (1/0) a la sala. */
  private finishAiRoom(score: number): void {
    this.state = "over";
    this.busy = true;
    this.aiRoomScore = score;
    this.renderSolo();
    this.room!.reportScore(score);
    this.beginSpectating();
  }

  private onMatchLose(): void {
    if (this.aiRoomMatch) {
      SoundEffects.playLose();
      this.finishAiRoom(0);
      return;
    }
    this.state = "over";
    this.busy = true;
    SoundEffects.playLose();
    this.renderSolo();

    let isNewBest = false;
    if (this.best === null || this.streak > this.best) {
      this.best = this.streak;
      localStorage.setItem(BEST_KEY, String(this.best));
      isNewBest = true;
    }

    this.schedule(() => {
      this.menuVisible = true;
      this.hud.showGameOver(this.streak, isNewBest, this.best!);
      this.hud.showRanking("tic-tac-toe", this.streak);
    }, SOLO_RESULT_MS);
  }

  private renderSolo(): void {
    const state = this.soloState;
    if (!state) return;
    const removable = state.winner === null ? pieceToRemove(state, state.turn) : null;
    this.hud.renderBoard(state.cells, { removable, winningLine: state.winningLine });

    const myTurn = this.state === "playing" && state.turn === HUMAN && state.winner === null && !this.busy;
    this.hud.setInteractive(myTurn);

    if (this.aiRoomMatch) {
      this.hud.setScore("VS IA");
      this.hud.setBest("");
    } else {
      this.hud.setScore(`RACHA: ${this.streak}`);
      this.hud.setBest(this.best !== null ? `MEJOR: ${this.best}` : "MEJOR: --");
    }

    if (state.winner === HUMAN) this.hud.setStatus("GANASTE", true);
    else if (state.winner === AI) this.hud.setStatus("PERDISTE");
    else if (state.turn === HUMAN) this.hud.setStatus("TU TURNO", true);
    else this.hud.setStatus("PIENSA LA IA");
  }

  // ---------- Timers ----------

  private schedule(fn: () => void, delayMs: number): void {
    const id = this.runId;
    const handle = window.setTimeout(() => {
      if (id !== this.runId) return;
      fn();
    }, delayMs);
    this.pending.push(handle);
  }

  private cancelPending(): void {
    this.runId++;
    this.pending.forEach((h) => window.clearTimeout(h));
    this.pending = [];
  }

  // ---------- Loop ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.startPlay();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    }

    requestAnimationFrame(this.tick);
  };

  dispose(): void {
    this.cancelPending();
    window.removeEventListener("keydown", this.handleKeyDown);
    this.hud.overlay.removeEventListener("pointerdown", this.handleOverlayTap);
  }
}
