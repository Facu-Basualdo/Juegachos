import { BEST_KEY, COUNTDOWN_LABELS, COUNTDOWN_STEP, LEVEL_COUNT, MAX_DT } from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { type HackLevel, type LevelContext } from "../levels/types";
import { FingerprintLevel } from "../levels/fingerprint";
import { DecoderLevel } from "../levels/decoder";
import { BruteForceLevel } from "../levels/bruteforce";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  clearRoomRun,
  elapsedSince,
  loadRoomRun,
  saveRoomRun,
} from "../../../shared/room/roomRun";

type State = "ready" | "countdown" | "playing" | "victory";

const GAME_ID = "hackerman";

/**
 * Snapshot para sobrevivir un F5 en sala (ver roomRun.ts). Guardamos solo el
 * nivel en curso y el arranque del reloj: como en circuit-breaker, un reload
 * reinicia el puzzle del nivel actual (aceptable, como un choque) pero preserva
 * el tiempo ya gastado — el reloj es `startedAt` (epoch), nunca acumulado.
 */
interface SavedRun {
  level: number;
  startedAt: number;
}

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;
  private state: State = "ready";

  private levels: HackLevel[] = [];
  private currentLevel = 0;

  private elapsedTime = 0; // segundos
  private startedAt = 0; // epoch ms (arranque de la corrida)
  private lastTime = 0;

  private countdownTime = 0;
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.hud = new Hud(container);
    this.hud.showStart();

    const ctx: LevelContext = {
      onSolved: () => this.onLevelSolved(),
      onProgress: () => this.saveRun(),
      setStatus: (t) => this.hud.setStatus(t),
    };
    this.levels = [
      new FingerprintLevel(ctx),
      new DecoderLevel(ctx),
      new BruteForceLevel(ctx),
    ];

    // Parcial por timeout en sala: tiempo actual en centisegundos. En un juego
    // "lower" el parcial no compite con una corrida terminada (points.ts).
    this.room = initRoomMode(GAME_ID, {
      getScore: () => this.currentCentis(),
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private currentCentis(): number {
    return Math.round(this.elapsedTime * 100);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      if (this.state === "victory" && this.room) return; // una corrida por ronda
      if (this.state === "ready" || this.state === "victory") {
        this.beginCountdown();
        return;
      }
    }
    if (this.state === "playing") {
      this.levels[this.currentLevel]?.handleKey(e);
    }
  };

  private beginCountdown(): void {
    // En sala, un F5 vuelve a pasar por aca (RoomMode redispara onStart): si hay
    // partida guardada se retoma sin countdown.
    if (this.room && this.resumeSavedRun()) return;

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.currentLevel = 0;
    this.hud.hideOverlay();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);

    // Montar el primer nivel ya (visible detras del countdown).
    this.mountLevel(0);
  }

  private resumeSavedRun(): boolean {
    const saved = loadRoomRun<SavedRun>(this.room!, GAME_ID);
    if (!saved) return false;
    if (!Number.isFinite(saved.startedAt) || !Number.isFinite(saved.level)) return false;
    if (saved.level < 0 || saved.level >= LEVEL_COUNT) return false;

    this.currentLevel = saved.level;
    this.startedAt = saved.startedAt;
    this.elapsedTime = elapsedSince(saved.startedAt);
    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.hideOverlay();
    this.mountLevel(saved.level);
    this.hud.updateTime(this.currentCentis());
    return true;
  }

  private mountLevel(index: number): void {
    const level = this.levels[index];
    this.hud.setLevel(index, LEVEL_COUNT, level.title, level.controls);
    level.mount(this.hud.getStage());
    level.begin();
  }

  private onLevelSolved(): void {
    if (this.currentLevel >= LEVEL_COUNT - 1) {
      this.handleVictory();
      return;
    }
    this.levels[this.currentLevel].destroy();
    this.currentLevel++;
    SoundEffects.playLevelClear();
    this.mountLevel(this.currentLevel);
    this.saveRun(); // persistir el avance de nivel (anti-F5)
  }

  private handleVictory(): void {
    this.state = "victory";
    this.levels[this.currentLevel]?.destroy();
    SoundEffects.playVictory();
    if (this.room) clearRoomRun(this.room, GAME_ID);

    const centis = this.currentCentis();
    const best = this.saveBest(centis);
    const isNewBest = centis <= best;
    this.hud.showVictory(centis, best, isNewBest);

    if (this.room) this.room.reportScore(centis);
    else this.hud.showRanking(GAME_ID, centis);
  }

  private saveBest(centis: number): number {
    const raw = localStorage.getItem(BEST_KEY);
    const prev = raw === null ? null : parseInt(raw, 10);
    if (prev === null || !Number.isFinite(prev) || centis < prev) {
      localStorage.setItem(BEST_KEY, String(centis));
      return centis;
    }
    return prev;
  }

  private saveRun(): void {
    if (!this.room) return;
    const data: SavedRun = { level: this.currentLevel, startedAt: this.startedAt };
    saveRoomRun(this.room, GAME_ID, data);
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
        this.hud.updateTime(0);
        this.saveRun();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "playing") {
      // En sala el reloj es el de pared desde `startedAt`, no la suma de dt: asi
      // un F5 (o una pestana en segundo plano) no regala tiempo.
      this.elapsedTime = this.room ? elapsedSince(this.startedAt) : this.elapsedTime + dt;
      const centis = this.currentCentis();
      this.hud.updateTime(centis);
      const lvl = this.levels[this.currentLevel];
      if (lvl) {
        if (lvl.updateTime) lvl.updateTime(centis);
        lvl.update?.(dt);
      }
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    this.levels.forEach((l) => l.destroy());
  }
}
