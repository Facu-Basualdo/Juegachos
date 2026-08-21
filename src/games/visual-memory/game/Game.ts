import {
  START_LEVEL,
  LIVES,
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP_MS,
  LEVEL_HOLD_MS,
  gridNFor,
  tilesFor,
  showMsFor,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "showing" | "recall" | "levelHold" | "gameOver";

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private level = START_LEVEL;
  /** Niveles completados = puntaje. */
  private score = 0;
  private best: number | null = null;
  private improvedThisRun = false;
  private lives = LIVES;
  /**
   * True solo cuando el overlay de inicio / fin esta realmente en pantalla. El
   * estado pasa a "gameOver" al perder, pero el overlay aparece 1100ms despues
   * (revelado de celdas): sin este guard un tap en esa ventana reinicia la
   * partida y cancela `endGame()`, asi que nunca se muestra el puntaje ni el
   * ranking.
   */
  private menuVisible = true;

  private gridN = 3;
  private lit: number[] = [];
  private found = new Set<number>();
  private wrong = new Set<number>();

  private lastCountdownIndex = -1;
  private countdownTimer: number | null = null;
  private showTimer: number | null = null;
  private holdTimer: number | null = null;
  private overTimer: number | null = null;

  constructor(container: HTMLElement) {
    const saved = localStorage.getItem(BEST_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (Number.isFinite(n)) this.best = n;
    }

    this.hud = new Hud(container, { onCell: (i) => this.onCell(i) });
    this.hud.showStart(this.best);

    this.room = initRoomMode("visual-memory", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("pointerdown", this.handlePointerDown);
  }

  // ---------- Input ----------

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && this.menuVisible) {
      this.startFromMenu();
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.menuVisible) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest(".mg-lb")) return;
    this.startFromMenu();
  };

  private startFromMenu(): void {
    if (this.room) return; // en sala el arranque lo dispara RoomMode
    this.beginCountdown();
  }

  private onCell(index: number): void {
    if (this.state !== "recall") return;

    if (this.lit.includes(index)) {
      if (this.found.has(index)) return;
      this.found.add(index);
      this.hud.markFound(index);
      SoundEffects.playTile();
      if (this.found.size === this.lit.length) this.levelComplete();
    } else {
      if (this.wrong.has(index)) return;
      this.wrong.add(index);
      this.hud.markWrong(index);
      SoundEffects.playWrong();
      this.lives--;
      this.hud.setLives(this.lives);
      if (this.lives <= 0) this.lose();
    }
  }

  // ---------- Flujo ----------

  private beginCountdown(): void {
    this.clearTimers();
    this.menuVisible = false;
    this.state = "countdown";
    this.level = START_LEVEL;
    this.score = 0;
    this.lives = LIVES;
    this.improvedThisRun = false;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.hud.startPlayUi(this.best);
    this.hud.setLevel(this.level);
    this.runCountdown();
  }

  private runCountdown(): void {
    this.lastCountdownIndex = 0;
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
    SoundEffects.playCountdownTick();

    this.countdownTimer = window.setInterval(() => {
      this.lastCountdownIndex++;
      if (this.lastCountdownIndex >= COUNTDOWN_LABELS.length) {
        this.clearTimer("countdownTimer");
        this.hud.showCountdown(null);
        this.startLevel();
        return;
      }
      this.hud.showCountdown(COUNTDOWN_LABELS[this.lastCountdownIndex]);
      SoundEffects.playCountdownTick();
    }, COUNTDOWN_STEP_MS);
  }

  private startLevel(): void {
    this.state = "showing";
    this.gridN = gridNFor(this.level);
    const tiles = tilesFor(this.level);
    this.lit = pickDistinct(tiles, this.gridN * this.gridN);
    this.found = new Set();
    this.wrong = new Set();

    this.hud.setLevel(this.level);
    this.hud.buildGrid(this.gridN);
    this.hud.showPattern(this.lit);
    SoundEffects.playReveal();

    this.showTimer = window.setTimeout(() => {
      this.hud.hidePattern();
      this.state = "recall";
    }, showMsFor(tiles));
  }

  private levelComplete(): void {
    this.state = "levelHold";
    this.score = this.level;
    if (this.best === null || this.score > this.best) {
      this.best = this.score;
      this.improvedThisRun = true;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    SoundEffects.playLevel();
    this.holdTimer = window.setTimeout(() => {
      this.level++;
      this.startLevel();
    }, LEVEL_HOLD_MS);
  }

  private lose(): void {
    this.state = "gameOver";
    this.hud.revealMissed(this.lit);
    this.overTimer = window.setTimeout(() => this.endGame(), 1100);
  }

  private endGame(): void {
    SoundEffects.playFinish();
    this.hud.showGameOver(this.score, this.best ?? 0, this.improvedThisRun);
    this.menuVisible = true;
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("visual-memory", this.score);
  }

  // ---------- Utilidades ----------

  private clearTimer(name: "countdownTimer" | "showTimer" | "holdTimer" | "overTimer"): void {
    const id = this[name];
    if (id !== null) {
      if (name === "countdownTimer") window.clearInterval(id);
      else window.clearTimeout(id);
      this[name] = null;
    }
  }

  private clearTimers(): void {
    this.clearTimer("countdownTimer");
    this.clearTimer("showTimer");
    this.clearTimer("holdTimer");
    this.clearTimer("overTimer");
  }

  dispose(): void {
    this.clearTimers();
    window.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("pointerdown", this.handlePointerDown);
  }
}

/** k indices distintos al azar en el rango [0, total). */
function pickDistinct(k: number, total: number): number[] {
  const pool = Array.from({ length: total }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(k, total));
}
