import { 
  TOTAL_ROUNDS, 
  MIN_TARGET_TIME, 
  MAX_TARGET_TIME, 
  BLIND_THRESHOLD, 
  BEST_KEY, 
  COUNTDOWN_LABELS, 
  COUNTDOWN_STEP, 
  MAX_DT 
} from "./constants";
import { Hud, type RoundStatus } from "./Hud";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { clearRoomRun, loadRoomRun, saveRoomRun } from "../../../shared/room/roomRun";
import { SoundEffects } from "./SoundEffects";

type State = "ready" | "countdown" | "running" | "blind" | "stopped" | "earlyClick" | "gameOver";

interface RoundResult {
  target: number;
  stopped: number;
  diff: number;
  foul: boolean;
}

/**
 * Rondas ya jugadas, persistidas en sala para sobrevivir un F5 (ver roomRun.ts).
 * Sin esto, recargar borraba los resultados y dejaba reintentar las rondas malas:
 * el puntaje es el error promedio y `direction` es "lower", asi que reiniciar tras
 * una mala estimacion MEJORABA el resultado. La ronda a jugar se deriva de
 * `roundsData.length` (un foul repite la ronda sin registrar resultado).
 */
interface SavedRun {
  roundsData: RoundResult[];
  roundStatuses: RoundStatus[];
}

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private currentRound = 0;
  private roundsData: RoundResult[] = [];
  private roundStatuses: RoundStatus[] = [];
  
  private bestAverage: number | null = null;
  private lastTime = 0;
  
  // Gameplay variables
  private countdownTime = 0;
  private targetTime = 0;
  private runningTimestamp = 0;
  private stoppedTime = 0;
  private lastCountdownIndex = -1;
  
  private containerEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.containerEl = container;

    // Load best score (minimum average deviation in ms)
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) {
      this.bestAverage = parseFloat(savedBest);
    }
    
    // Init HUD
    this.hud = new Hud(container);
    this.hud.showStart(this.bestAverage);

    // Initialize multiplayer room support
    this.room = initRoomMode("blind-time", {
      getScore: () => this.calculateCurrentAverage() ?? 9999, // default large score if no rounds done
      onStart: () => this.beginCountdown(),
    });
    
    this.bindInputs();
    
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }
  
  private bindInputs(): void {
    // We bind to the main container or window for clicking/touching the screen
    this.containerEl.addEventListener("mousedown", this.handleInteraction);
    this.containerEl.addEventListener("touchstart", this.handleTouchInteraction, { passive: false });
    window.addEventListener("keydown", this.handleKeyDown);
  }
  
  private handleTouchInteraction = (e: TouchEvent): void => {
    e.preventDefault(); // Prevents double triggers
    this.onAction();
  };

  private handleInteraction = (e: MouseEvent): void => {
    if (e.button === 0) { // Left click only
      this.onAction();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      // Avoid accidental menu skips by ignoring Space on non-gameplay states
      if (this.state === "ready" || this.state === "gameOver" || this.state === "stopped" || this.state === "earlyClick") {
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
        // Do nothing during 3-2-1 count
        break;
        
      case "running":
        // Foul! Touched before 0.5s (before screen goes blind)
        this.handleEarlyClick();
        break;
        
      case "blind":
        // Stopped in time! Record score
        this.handleStop();
        break;
        
      case "earlyClick":
        // Retry the current round
        this.startRound();
        break;
        
      case "stopped":
        // Proceed to next round or end game
        if (this.currentRound < TOTAL_ROUNDS) {
          this.currentRound++;
          this.startRound();
        } else {
          this.endGame();
        }
        break;
        
      case "gameOver":
        if (this.room) return; // In room mode, host resets or playlist proceeds
        this.beginCountdown();
        break;
    }
  }

  private beginCountdown(): void {
    // En sala, un F5 vuelve a pasar por aca (la ronda sigue en "playing" y
    // RoomMode redispara onStart): si hay rondas ya jugadas se retoman.
    if (this.room && this.resumeSavedRun()) return;

    this.currentRound = 1;
    this.roundsData = [];
    this.roundStatuses = Array(TOTAL_ROUNDS).fill("empty");
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.startRound();
  }

  /**
   * Retoma las rondas ya jugadas tras un reload. La que estaba en curso se rehace
   * (no habia resultado registrado); las completadas no se pueden reintentar.
   */
  private resumeSavedRun(): boolean {
    const s = loadRoomRun<SavedRun>(this.room!, "blind-time");
    if (!s || !Array.isArray(s.roundsData) || !Array.isArray(s.roundStatuses)) return false;
    if (s.roundStatuses.length !== TOTAL_ROUNDS) return false;
    if (s.roundsData.length === 0 || s.roundsData.length > TOTAL_ROUNDS) return false;
    if (s.roundsData.some((r) => !r || !Number.isFinite(r.diff))) return false;

    this.roundsData = [...s.roundsData];
    this.roundStatuses = [...s.roundStatuses];
    this.currentRound = this.roundsData.length + 1;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    // Ya estaban todas: la corrida termino durante el reload, se cierra sin rejugar.
    if (this.roundsData.length >= TOTAL_ROUNDS) this.endGame();
    else this.startRound();
    return true;
  }

  /** Snapshot de las rondas jugadas. No hace nada fuera de sala. */
  private saveRun(): void {
    if (!this.room) return;
    const data: SavedRun = {
      roundsData: this.roundsData,
      roundStatuses: this.roundStatuses,
    };
    saveRoomRun(this.room, "blind-time", data);
  }
  
  private startRound(): void {
    this.state = "countdown"; // Run count down before actual round
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    
    // Target time: random between 2.0 and 12.0 seconds, rounded to 1 decimal place (e.g. 6.4s)
    this.targetTime = MIN_TARGET_TIME + Math.random() * (MAX_TARGET_TIME - MIN_TARGET_TIME);
    this.targetTime = Math.round(this.targetTime * 10) / 10;
    
    this.roundStatuses[this.currentRound - 1] = "empty";
    
    const currentAverage = this.calculateCurrentAverage();
    this.hud.showWaitingState(this.currentRound, this.targetTime, currentAverage);
    this.hud.updateRoundProgress(this.currentRound, this.roundStatuses);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }
  
  private handleEarlyClick(): void {
    this.state = "earlyClick";
    this.roundStatuses[this.currentRound - 1] = "foul";
    
    this.hud.showEarlyClickState();
    this.hud.updateRoundProgress(this.currentRound, this.roundStatuses);
    SoundEffects.playFail();
    this.saveRun();
  }
  
  private handleStop(): void {
    const now = performance.now();
    this.stoppedTime = (now - this.runningTimestamp) / 1000;
    
    const diffMs = Math.round((this.stoppedTime - this.targetTime) * 1000);
    
    this.roundsData.push({
      target: this.targetTime,
      stopped: this.stoppedTime,
      diff: diffMs,
      foul: false
    });
    
    this.roundStatuses[this.currentRound - 1] = "success";
    this.state = "stopped";
    
    this.hud.showResultState(this.stoppedTime, this.targetTime, diffMs);
    this.hud.updateRoundProgress(this.currentRound, this.roundStatuses);
    // Recien aca la ronda quedo registrada: es el momento de persistirla.
    this.saveRun();

    if (Math.abs(diffMs) < 150) {
      SoundEffects.playSuccess();
    } else {
      SoundEffects.playNeutral();
    }
  }
  
  private endGame(): void {
    const validRounds = this.roundsData.filter(r => !r.foul);
    const sumDiff = validRounds.reduce((a, b) => a + Math.abs(b.diff), 0);
    
    // If all failed (should not happen since foul retries, but safe fallback)
    const average = validRounds.length > 0 ? sumDiff / validRounds.length : 9999;
    
    let isNewBest = false;
    if (this.bestAverage === null || average < this.bestAverage) {
      this.bestAverage = average;
      localStorage.setItem(BEST_KEY, average.toString());
      isNewBest = true;
    }
    
    this.state = "gameOver";
    this.hud.showGameOver(this.roundsData, average, isNewBest, this.bestAverage);
    
    if (this.room) {
      // La corrida de la ronda termino: un reload ya no debe retomarla.
      clearRoomRun(this.room, "blind-time");
      this.room.reportScore(average);
    } else {
      this.hud.showRanking("blind-time", average);
    }
  }
  
  private calculateCurrentAverage(): number | null {
    const validRounds = this.roundsData.filter(r => !r.foul);
    if (validRounds.length === 0) return null;
    const sumDiff = validRounds.reduce((a, b) => a + Math.abs(b.diff), 0);
    return sumDiff / validRounds.length;
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
      
      if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        if (index >= COUNTDOWN_LABELS.length) {
          SoundEffects.playStart();
          this.hud.showCountdown(null);
          this.state = "running";
          this.runningTimestamp = performance.now();
          this.hud.showActiveState(0);
        } else if (index >= 0) {
          SoundEffects.playTick();
          this.hud.showCountdown(COUNTDOWN_LABELS[index]);
        }
      }
    } else if (this.state === "running" || this.state === "blind") {
      const elapsed = (performance.now() - this.runningTimestamp) / 1000;
      
      // Auto timeout if player waits way too long (e.g. 15s or targetTime + 3s)
      const maxLimit = Math.max(15, this.targetTime + 3);
      if (elapsed >= maxLimit) {
        this.handleEarlyClick(); // treats as foul/early click so they can retry
        return;
      }

      if (elapsed >= BLIND_THRESHOLD) {
        if (this.state === "running") {
          this.state = "blind";
          this.hud.showBlindState();
        }
      } else {
        this.hud.showActiveState(elapsed);
      }
      
      // Update progress ring ratio
      const ratio = elapsed / this.targetTime;
      this.hud.setRingOffset(ratio);
    }
  }
  
  dispose(): void {
    this.containerEl.removeEventListener("mousedown", this.handleInteraction);
    this.containerEl.removeEventListener("touchstart", this.handleTouchInteraction);
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
