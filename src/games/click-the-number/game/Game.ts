import {
  DEFAULT_GRID_SIZE,
  BEST_KEY_PREFIX,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, ROOM_VARIANTS, type RoomMode } from "../../../shared/room/roomMode";
import {
  clearRoomRun,
  elapsedSince,
  loadRoomRun,
  saveRoomRun,
} from "../../../shared/room/roomRun";

type State = "ready" | "countdown" | "playing" | "victory";

/** Partida en curso persistida en sala, para sobrevivir un F5 (ver roomRun.ts). */
interface SavedRun {
  size: number;
  /** El tablero sorteado: layout[i] es el numero de la celda i. */
  layout: number[];
  /** Proximo numero a tocar. Es el progreso, no un cursor derivable: el layout
   *  no registra que celdas ya se apagaron. */
  next: number;
  /** Epoch ms del arranque; el tiempo se recalcula contra el reloj de pared. */
  startedAt: number;
}

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;
  private state: State = "ready";

  // Grid parameters
  private size: number = DEFAULT_GRID_SIZE;
  private layout: number[] = [];
  /** Proximo numero buscado (1..size*size). Al superar el total, gano. */
  private next = 1;

  // Game stats
  private elapsedTime = 0;
  private lastTime = 0;
  /** Epoch ms del arranque de la partida. Solo en sala (ver `update`). */
  private startedAt = 0;

  // Timers
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.hud = new Hud(container);
    this.hud.showStart(this.handleSelectSize);

    // El parcial por timeout es el tiempo corrido: en un juego "lower" sin
    // terminar no es comparable con una grilla limpia, y points.ts ya lo sabe.
    this.room = initRoomMode("click-the-number", {
      getScore: () => this.encodeTime(),
      onStart: () => this.beginCountdown(),
    });
    if (this.room) {
      // En sala todos juegan el mismo tamano: fijo, sin selector.
      this.size = parseInt(ROOM_VARIANTS["click-the-number"], 10);
      const selector = container.querySelector<HTMLElement>(".overlay__size-selector");
      if (selector) selector.style.display = "none";
    }

    this.bindInputs(container);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private get total(): number {
    return this.size * this.size;
  }

  /** El puntaje del ranking es el tiempo en centesimas (menor mejor). */
  private encodeTime(): number {
    return Math.max(0, Math.round(this.elapsedTime * 100));
  }

  private handleSelectSize = (size: number): void => {
    this.size = size;
  };

  private bindInputs(container: HTMLElement): void {
    window.addEventListener("keydown", this.handleKeyDown);
    // En movil no hay Enter: el toque tiene que poder arrancar. Va sobre el
    // container porque la pantalla de inicio es un overlay que tapa al resto,
    // y se exenta el selector (.overlay__size-selector), que sigue
    // siendo solo un selector para poder mirar el record de cada opcion antes
    // de jugar. El panel de ranking corta la propagacion de sus pointerdown.
    container.addEventListener("pointerdown", this.handlePointerDown);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest(".overlay__size-selector")) return;
    if (this.state === "victory" && this.room) return;
    if (this.state === "ready" || this.state === "victory") this.beginCountdown();
  };


  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter") return;
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "victory" && this.room) return;
    if (this.state === "ready" || this.state === "victory") {
      this.beginCountdown();
    }
  };

  private beginCountdown(): void {
    // En sala, un F5 vuelve a pasar por aca (la ronda sigue en "playing" y
    // RoomMode redispara onStart): si hay partida guardada se retoma tal cual,
    // sin countdown ni tablero nuevo.
    if (this.room && this.resumeSavedRun()) return;

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hideOverlay();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);

    this.shuffleBoard();
    this.next = 1;
    this.hud.setupBoard(this.size, this.layout, this.handleCellClick);
    this.hud.renderBoard(this.layout, this.next);
    this.hud.updateStats(this.next, this.total, 0);
  }

  /**
   * Retoma la partida guardada de esta ronda tras un reload. Devuelve false si no
   * hay nada guardado (o no cuadra con el tamano de la sala) y hay que empezar.
   */
  private resumeSavedRun(): boolean {
    const saved = loadRoomRun<SavedRun>(this.room!, "click-the-number");
    if (!saved || saved.size !== this.size) return false;
    if (!Array.isArray(saved.layout) || saved.layout.length !== this.total) return false;
    if (saved.layout.some((n) => !Number.isInteger(n) || n < 1 || n > this.total)) return false;
    if (!Number.isInteger(saved.next) || saved.next < 1 || saved.next > this.total) return false;
    if (!Number.isFinite(saved.startedAt)) return false;

    this.layout = [...saved.layout];
    this.next = saved.next;
    this.startedAt = saved.startedAt;
    this.elapsedTime = elapsedSince(saved.startedAt);

    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.hideOverlay();
    this.hud.setupBoard(this.size, this.layout, this.handleCellClick);
    this.hud.renderBoard(this.layout, this.next);
    this.hud.updateStats(this.next, this.total, this.elapsedTime);
    return true;
  }

  /** Snapshot de la partida para sobrevivir un F5. No hace nada fuera de sala. */
  private saveRun(): void {
    if (!this.room) return;
    const data: SavedRun = {
      size: this.size,
      layout: this.layout,
      next: this.next,
      startedAt: this.startedAt,
    };
    saveRoomRun(this.room, "click-the-number", data);
  }

  /** Fisher-Yates sobre 1..total: cualquier orden sirve, siempre es jugable. */
  private shuffleBoard(): void {
    const values: number[] = [];
    for (let i = 1; i <= this.total; i++) values.push(i);
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    this.layout = values;
  }

  private handleCellClick = (index: number): void => {
    if (this.state !== "playing") return;

    const value = this.layout[index];
    // Ya apagada: ni acierto ni error, la celda no existe mas.
    if (value < this.next) return;

    if (value !== this.next) {
      // El reloj ya cobra el error; no hay penalidad extra.
      SoundEffects.playError();
      this.hud.flashError(index);
      return;
    }

    this.next++;
    SoundEffects.playHit((this.next - 1) / this.total);
    this.hud.renderBoard(this.layout, this.next);
    this.hud.updateStats(this.next, this.total, this.elapsedTime);
    this.saveRun();

    if (this.next > this.total) this.handleVictory();
  };

  private handleVictory(): void {
    this.state = "victory";
    SoundEffects.playVictory();
    // La partida de la ronda termino: un reload ya no debe retomarla.
    if (this.room) clearRoomRun(this.room, "click-the-number");

    const timeKey = `${BEST_KEY_PREFIX}${this.size}_time`;
    const savedBestTime = localStorage.getItem(timeKey);

    let isNewBestTime = false;
    let bestTime = this.elapsedTime;

    if (savedBestTime === null || this.elapsedTime < parseFloat(savedBestTime)) {
      localStorage.setItem(timeKey, this.elapsedTime.toString());
      isNewBestTime = true;
    } else {
      bestTime = parseFloat(savedBestTime);
    }

    this.hud.showVictory(this.elapsedTime, isNewBestTime, bestTime, this.size);

    const rankedScore = this.encodeTime();
    if (this.room) this.room.reportScore(rankedScore);
    else this.hud.showRanking("click-the-number", rankedScore, this.size);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt);

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);

      if (index >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.state = "playing";
        this.elapsedTime = 0;
        this.startedAt = Date.now();
        this.hud.hideOverlay();
        this.hud.updateStats(this.next, this.total, this.elapsedTime);
        this.saveRun();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "playing") {
      // En sala el cronometro es el reloj de pared desde `startedAt`, no la suma
      // de dt: asi un F5 (o una pestana en segundo plano) no regala tiempo.
      this.elapsedTime = this.room ? elapsedSince(this.startedAt) : this.elapsedTime + dt;
      this.hud.updateStats(this.next, this.total, this.elapsedTime);
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    this.hud.dispose();
  }
}
