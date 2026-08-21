import * as THREE from "three";
import { SteamVent } from "./SteamVent";
import { Particles } from "./Particles";
import type { ModelSet } from "./Models";
import {
  ACTIVE_TIME,
  PLAYER_SPEED,
  DIFF_STEP,
  OVERLOAD_DURATION,
  OVERLOAD_FIRST_AT,
  OVERLOAD_PERIOD,
  OVERLOAD_TIME_SCALE,
  PATTERN_GAP_MIN,
  PATTERN_GAP_START,
  PATTERN_GAP_STEP,
  ROOM_HALF_WIDTH,
  CELL_WIDTH,
  VENT_COUNT,
  WARN_TIME_MIN,
  WARN_TIME_START,
  WARN_TIME_STEP,
} from "./constants";

/** A vent scheduled to fire after `delay` seconds (used to stagger wave patterns). */
interface ScheduledTrigger {
  index: number;
  delay: number;
  warn: number;
  active: number;
}

export interface FieldTick {
  /** Rising edge: an overload phase just began (Game plays the alarm + red light). */
  overloadStarted: boolean;
}

type Pattern = "single" | "cluster" | "wave" | "cage";

/**
 * The boss-fight director. Owns every SteamVent and, on a shrinking timer,
 * launches attack patterns whose mix and speed escalate with the difficulty
 * level (one level per DIFF_STEP seconds). Periodically triggers an OVERLOAD
 * phase that runs the whole field at OVERLOAD_TIME_SCALE and flags the emergency
 * lighting. All vent time advances through a scaled dt so overload speeds up
 * warnings, jets and staggered waves alike.
 */
export class VentField {
  private readonly vents: SteamVent[] = [];
  private readonly queue: ScheduledTrigger[] = [];
  /** Indices belonging to the wave currently sweeping, tracked so no other
   *  pattern can stack onto it while it's still a real threat (see `waveActive`). */
  private waveCols: number[] = [];
  private patternTimer = 1.2;
  private elapsed = 0;
  private playerX = 0;
  /** The first wave of a run gets a long warning so a new player can read it. */
  private firstWave = true;

  private overload = false;
  private overloadTimer = 0;
  private nextOverloadAt = OVERLOAD_FIRST_AT;
  /** 0..1 flicker value for the emergency lighting, valid while overloaded. */
  emergencyFlicker = 0;

  constructor(
    scene: THREE.Scene,
    particles: Particles,
    models: ModelSet,
    gradientMap: THREE.Texture | undefined,
    onErupt: () => void,
  ) {
    for (let i = 0; i < VENT_COUNT; i++) {
      const x = -ROOM_HALF_WIDTH + (i + 0.5) * CELL_WIDTH;
      this.vents.push(new SteamVent(scene, particles, x, models, gradientMap, onErupt));
    }
  }

  get overloadActive(): boolean {
    return this.overload;
  }

  get level(): number {
    return Math.floor(this.elapsed / DIFF_STEP);
  }

  /** True if any live jet overlaps the player box (unless the player is dashing). */
  isPlayerHit(px: number, halfW: number, feetY: number): boolean {
    for (const v of this.vents) if (v.hits(px, halfW, feetY)) return true;
    return false;
  }

  update(dt: number, elapsedTotal: number, playerX: number): FieldTick {
    this.elapsed = elapsedTotal;
    this.playerX = playerX;
    let overloadStarted = false;

    // --- Overload scheduling (real time, not scaled). ---
    if (this.overload) {
      this.overloadTimer -= dt;
      this.emergencyFlicker = 0.55 + 0.45 * Math.sin(elapsedTotal * 22);
      if (this.overloadTimer <= 0) {
        this.overload = false;
        this.nextOverloadAt = elapsedTotal + OVERLOAD_PERIOD;
      }
    } else if (elapsedTotal >= this.nextOverloadAt) {
      this.overload = true;
      this.overloadTimer = OVERLOAD_DURATION;
      overloadStarted = true;
    }

    const scale = this.overload ? OVERLOAD_TIME_SCALE : 1;
    const sdt = dt * scale;

    // --- Advance every vent and the staggered trigger queue on scaled time. ---
    for (const v of this.vents) v.update(sdt);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.delay -= sdt;
      if (q.delay <= 0) {
        if (!this.vents[q.index].busy) this.vents[q.index].trigger(q.warn, q.active);
        this.queue.splice(i, 1);
      }
    }

    // --- Launch a fresh pattern when the gap elapses. ---
    this.patternTimer -= sdt;
    if (this.patternTimer <= 0) {
      if (this.waveInProgress()) {
        // A sweep is still a live threat — hold off instead of stacking another
        // pattern's vents onto it (that's what used to blow past 3-wide bands).
        this.patternTimer = 0.15;
      } else {
        this.launchPattern();
        this.patternTimer = this.currentGap();
      }
    }

    return { overloadStarted };
  }

  /** True while a launched wave still poses a real threat: either it hasn't
   *  finished triggering all its columns (`queue`, wave-only) or one of its
   *  already-triggered columns is still warning/active. Dissipate (visual-only)
   *  doesn't count, so the field frees up as soon as the sweep stops being live. */
  private waveInProgress(): boolean {
    if (this.queue.length > 0) return true;
    if (this.waveCols.length === 0) return false;
    const stillDangerous = this.waveCols.some((i) => this.vents[i].dangerous);
    if (!stillDangerous) this.waveCols = [];
    return stillDangerous;
  }

  private currentWarn(): number {
    return Math.max(WARN_TIME_MIN, WARN_TIME_START - this.level * WARN_TIME_STEP);
  }

  private currentGap(): number {
    return Math.max(PATTERN_GAP_MIN, PATTERN_GAP_START - this.level * PATTERN_GAP_STEP);
  }

  private launchPattern(): void {
    let pattern = this.pickPattern();
    // A wave wants a clean field to sweep — if another pattern's leftover danger
    // is still live, fall back rather than starting a sweep already tangled up
    // with it (that combination is what could exceed the 3-wide cap).
    if (pattern === "wave" && this.vents.some((v) => v.dangerous)) {
      pattern = Math.random() < 0.6 ? "single" : "cluster";
    }
    const warn = this.currentWarn();
    switch (pattern) {
      case "single":
        this.launchSingle(warn);
        break;
      case "cluster":
        this.launchCluster(warn);
        break;
      case "wave":
        this.launchWave(warn);
        break;
      case "cage":
        this.launchCage(warn);
        break;
    }
  }

  private pickPattern(): Pattern {
    const lvl = this.level;
    const roll = Math.random();
    if (lvl <= 0) return roll < 0.75 ? "single" : "cluster";
    if (lvl === 1) return roll < 0.55 ? "single" : roll < 0.85 ? "cluster" : "wave";
    if (lvl === 2) return roll < 0.4 ? "single" : roll < 0.65 ? "cluster" : roll < 0.88 ? "wave" : "cage";
    // Level 3+: the full boss repertoire, weighted toward the hard patterns.
    return roll < 0.28 ? "single" : roll < 0.5 ? "cluster" : roll < 0.78 ? "wave" : "cage";
  }

  private fire(index: number, warn: number): void {
    if (index < 0 || index >= this.vents.length) return;
    if (!this.vents[index].busy) this.vents[index].trigger(warn, ACTIVE_TIME);
  }

  private launchSingle(warn: number): void {
    const count = 1 + (this.level >= 2 ? 1 : 0);
    for (let k = 0; k < count; k++) this.fire(Math.floor(Math.random() * VENT_COUNT), warn);
  }

  private launchCluster(warn: number): void {
    const start = Math.floor(Math.random() * (VENT_COUNT - 2));
    for (let i = start; i < start + 3; i++) this.fire(i, warn);
  }

  /**
   * A thin wall of steam sweeping the room. The front advances one column per
   * `step` (accelerating with level), while each vent's *short* life keeps the
   * lethal band only ~2 columns wide — thin enough to punch through with a dash
   * (its i-frames) to the already-cleared side. That dash-through is the
   * intended escape: a wide band can't be crossed (dash is ~2 cells) nor climbed
   * over (a jet is taller than the max jump), so running ahead only corners you.
   * Difficulty scales via a faster front, NOT a wider (uncrossable) band.
   */
  private launchWave(warn: number): void {
    const leftToRight = Math.random() < 0.5;
    const step = Math.max(0.2, 0.34 - this.level * 0.01); // front speeds up with level
    const waveActive = Math.min(ACTIVE_TIME, step * 2.0); // lethal band ~2 columns wide
    // Teach the pattern: the very first wave telegraphs much longer so a
    // first-time player can watch the red sweep before anything erupts.
    const waveWarn = this.firstWave ? Math.max(warn, 1.9) : warn;
    this.firstWave = false;
    this.waveCols = [];
    for (let n = 0; n < VENT_COUNT; n++) {
      const index = leftToRight ? n : VENT_COUNT - 1 - n;
      this.waveCols.push(index);
      this.queue.push({ index, delay: n * step, warn: waveWarn, active: waveActive });
    }
  }

  /**
   * Every column erupts except one safe cell. To stay fair the gap is placed
   * within reach of the player's current column (given the warning time), so
   * there is always a run that makes it — but you must move.
   */
  private launchCage(warn: number): void {
    const cageWarn = Math.max(warn, 0.85) * 1.3; // a big ask: always a generous tell
    const from = this.nearestIndex(this.playerX);
    const reach = Math.max(1, Math.floor((cageWarn * PLAYER_SPEED) / CELL_WIDTH));
    const maxOff = Math.min(3, reach);
    const off = (1 + Math.floor(Math.random() * maxOff)) * (Math.random() < 0.5 ? -1 : 1);
    const safe = Math.min(VENT_COUNT - 1, Math.max(0, from + off));
    for (let i = 0; i < VENT_COUNT; i++) {
      if (i === safe) continue;
      this.fire(i, cageWarn);
    }
  }

  private nearestIndex(x: number): number {
    const idx = Math.round((x + ROOM_HALF_WIDTH - CELL_WIDTH / 2) / CELL_WIDTH);
    return Math.min(VENT_COUNT - 1, Math.max(0, idx));
  }

  reset(): void {
    for (const v of this.vents) v.reset();
    this.queue.length = 0;
    this.waveCols = [];
    this.patternTimer = 1.2;
    this.firstWave = true;
    this.elapsed = 0;
    this.overload = false;
    this.overloadTimer = 0;
    this.nextOverloadAt = OVERLOAD_FIRST_AT;
    this.emergencyFlicker = 0;
  }
}
