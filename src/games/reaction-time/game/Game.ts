import { 
  TOTAL_ROUNDS, 
  MIN_DELAY, 
  MAX_DELAY, 
  BEST_KEY, 
  COUNTDOWN_LABELS, 
  COUNTDOWN_STEP, 
  MAX_DT 
} from "./constants";
import { Hud, type RoundStatus } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { clearRoomRun, loadRoomRun, saveRoomRun } from "../../../shared/room/roomRun";

type State = "ready" | "countdown" | "waitingForTrigger" | "triggerActive" | "earlyClick" | "roundFinished" | "gameOver";

/**
 * Rondas ya jugadas, persistidas en sala para sobrevivir un F5 (ver roomRun.ts).
 * Sin esto, recargar borraba los tiempos y dejaba volver a intentar las rondas
 * malas: el puntaje es el promedio y `direction` es "lower", asi que reiniciar
 * tras un mal reflejo MEJORABA el resultado.
 */
interface SavedRun {
  roundTimes: number[];
  roundStatuses: RoundStatus[];
}

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private currentRound = 0;
  private roundTimes: number[] = [];
  private roundStatuses: RoundStatus[] = [];
  
  private bestAverage: number | null = null;
  private lastTime = 0;
  
  // Timers
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private triggerDelay = 0;
  private triggerTimestamp = 0;
  
  /** Se guarda solo para poder desenganchar el pointerdown en `dispose`. */
  private container: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    // Load best score

    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) {
      this.bestAverage = parseFloat(savedBest);
    }
    
    // Init HUD
    this.hud = new Hud(container);
    this.hud.showStart(this.bestAverage);

    // Parcial por timeout: promedio de las rondas completadas hasta ahora.
    this.room = initRoomMode("reaction-time", {
      getScore: () => this.calculateCurrentAverage() ?? 0,
      onStart: () => this.beginCountdown(),
    });
    
    this.container = container;
    this.bindInputs(container);
    
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }
  
  private bindInputs(container: HTMLElement): void {
    // Click / touch input. Va sobre el container y no sobre la reaction-card
    // porque las pantallas de inicio y de fin son un overlay que la tapa: en
    // movil (donde no hay Enter) el toque sobre el cartel moria ahi y no habia
    // forma de empezar. Un solo `pointerdown` cubre mouse y dedo sin el doble
    // disparo que obligaba al preventDefault, y el panel de ranking corta la
    // propagacion de los suyos.
    container.addEventListener("pointerdown", this.handleInteraction);

    // Keyboard input
    window.addEventListener("keydown", this.handleKeyDown);
  }

  private handleInteraction = (e: PointerEvent): void => {
    if (e.button === 0) { // Left click / toque
      e.preventDefault();
      this.onAction();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      // Space is only mapped to play actions, not start/restart so users don't accidentally skip menus
      if (this.state === "ready" || this.state === "gameOver" || this.state === "roundFinished" || this.state === "earlyClick") {
        if (e.key === "Enter") {
          this.onAction();
        }
      } else {
        this.onAction();
      }
    }
  };
  
  private onAction(): void {
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;
        
      case "countdown":
        // Do nothing during pre-run countdown
        break;
        
      case "waitingForTrigger":
        // Foul! Clicked too early
        this.handleEarlyClick();
        break;
        
      case "triggerActive":
        // Success! Reaction recorded
        this.handleReactionClick();
        break;
        
      case "earlyClick":
        // Acknowledge and retry the current round
        this.startRound();
        break;
        
      case "roundFinished":
        // Proceed to next round or finish game
        if (this.currentRound < TOTAL_ROUNDS) {
          this.currentRound++;
          this.startRound();
        } else {
          this.endGame();
        }
        break;
        
      case "gameOver":
        // En modo sala se juega una sola partida por ronda: sin reintento.
        if (this.room) return;
        this.beginCountdown();
        break;
    }
  }

  private beginCountdown(): void {
    // En sala, un F5 vuelve a pasar por aca (la ronda sigue en "playing" y
    // RoomMode redispara onStart): si hay rondas ya jugadas se retoman.
    if (this.room && this.resumeSavedRun()) return;

    this.state = "countdown";
    this.currentRound = 1;
    this.roundTimes = [];
    this.roundStatuses = Array(TOTAL_ROUNDS).fill("empty");
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
    this.hud.updateRoundProgress(this.currentRound, this.roundStatuses);
  }

  /**
   * Retoma las rondas ya jugadas tras un reload, sin countdown. La ronda que
   * estaba en curso se rehace (todavia no tenia tiempo registrado), pero las
   * completadas no se pueden volver a intentar, que es lo que importa.
   *
   * `currentRound` no se guarda: se deriva de los tiempos. Un foul repite la ronda
   * sin registrar tiempo, asi que la ronda a jugar es siempre `roundTimes.length + 1`
   * — guardar el numero aparte permitiria que se desfasara y se repitiera una ronda
   * ya puntuada.
   */
  private resumeSavedRun(): boolean {
    const s = loadRoomRun<SavedRun>(this.room!, "reaction-time");
    if (!s || !Array.isArray(s.roundTimes) || !Array.isArray(s.roundStatuses)) return false;
    if (s.roundStatuses.length !== TOTAL_ROUNDS) return false;
    if (s.roundTimes.length === 0 || s.roundTimes.length > TOTAL_ROUNDS) return false;
    if (s.roundTimes.some((t) => !Number.isFinite(t))) return false;

    this.roundTimes = [...s.roundTimes];
    this.roundStatuses = [...s.roundStatuses];
    this.currentRound = this.roundTimes.length + 1;

    this.hud.hideOverlay();
    this.hud.showCountdown(null);
    // Ya estaban las 5: la corrida termino durante el reload, se cierra sin rejugar.
    if (this.roundTimes.length >= TOTAL_ROUNDS) this.endGame();
    else this.startRound();
    return true;
  }

  /** Snapshot de las rondas jugadas. No hace nada fuera de sala. */
  private saveRun(): void {
    if (!this.room) return;
    const data: SavedRun = {
      roundTimes: this.roundTimes,
      roundStatuses: this.roundStatuses,
    };
    saveRoomRun(this.room, "reaction-time", data);
  }
  
  private startRound(): void {
    this.state = "waitingForTrigger";
    
    // Calculate random trigger delay
    this.triggerDelay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
    
    // Set status of current round to empty (so it flashes/animates)
    this.roundStatuses[this.currentRound - 1] = "empty";
    
    const currentAverage = this.calculateCurrentAverage();
    this.hud.showWaitingState(this.currentRound, currentAverage);
    this.hud.updateRoundProgress(this.currentRound, this.roundStatuses);
  }
  
  private handleEarlyClick(): void {
    this.state = "earlyClick";
    this.roundStatuses[this.currentRound - 1] = "foul";
    SoundEffects.playFoul();

    this.hud.showEarlyClickState();
    this.hud.updateRoundProgress(this.currentRound, this.roundStatuses);
    this.saveRun();
  }
  
  private handleReactionClick(): void {
    const clickTime = performance.now();
    const reactionTime = Math.round(clickTime - this.triggerTimestamp);
    
    this.roundTimes.push(reactionTime);
    this.roundStatuses[this.currentRound - 1] = "success";
    
    this.state = "roundFinished";
    SoundEffects.playReaction();
    this.hud.showResultState(reactionTime);
    this.hud.updateRoundProgress(this.currentRound, this.roundStatuses);
    // Recien aca la ronda quedo registrada: es el momento de persistirla.
    this.saveRun();
  }
  
  private endGame(): void {
    const sum = this.roundTimes.reduce((a, b) => a + b, 0);
    const average = sum / this.roundTimes.length;
    
    let isNewBest = false;
    if (this.bestAverage === null || average < this.bestAverage) {
      this.bestAverage = average;
      localStorage.setItem(BEST_KEY, average.toString());
      isNewBest = true;
    }
    
    this.state = "gameOver";
    SoundEffects.playFinish();
    this.hud.showGameOver(this.roundTimes, average, isNewBest, this.bestAverage);
    if (this.room) {
      // La corrida de la ronda termino: un reload ya no debe retomarla.
      clearRoomRun(this.room, "reaction-time");
      this.room.reportScore(average);
    } else {
      this.hud.showRanking("reaction-time", average);
    }
  }
  
  private calculateCurrentAverage(): number | null {
    if (this.roundTimes.length === 0) return null;
    const sum = this.roundTimes.reduce((a, b) => a + b, 0);
    return sum / this.roundTimes.length;
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
        this.startRound();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "waitingForTrigger") {
      this.triggerDelay -= dt;
      if (this.triggerDelay <= 0) {
        this.state = "triggerActive";
        this.triggerTimestamp = performance.now();
        this.hud.showTriggerState();
        SoundEffects.playGo();
      }
    }
  }
  
  dispose(): void {
    this.container?.removeEventListener("pointerdown", this.handleInteraction);
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
