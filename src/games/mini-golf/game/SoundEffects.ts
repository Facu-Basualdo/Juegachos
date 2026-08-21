/**
 * Synthesized Web Audio effects, no assets. Same lazy-context pattern as
 * the rest of the repo (first defined in shell-game).
 */
export class SoundEffects {
  private ctx: AudioContext | null = null;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Shared 750 Hz countdown blip (3 / 2 / 1 / YA). */
  playCountdownTick(): void {
    this.tone(750, 0.09, "sine", 0.18);
  }

  /** Putter impact; pitch and volume scale with shot power (0-1). */
  playHit(power: number): void {
    this.tone(150 + power * 110, 0.09, "triangle", 0.1 + power * 0.2);
    this.tone(950, 0.025, "square", 0.05 + power * 0.06);
  }

  /** Wood wall knock. */
  playBounce(intensity: number): void {
    const v = Math.min(intensity, 1);
    this.tone(210 + v * 60, 0.07, "triangle", 0.05 + v * 0.14);
  }

  /** Bumper boing. */
  playBumper(): void {
    this.tone(280, 0.14, "sine", 0.16, 0, 640);
  }

  /** Ball drops in the cup. */
  playHole(): void {
    this.tone(392, 0.1, "sine", 0.16);
    this.tone(523, 0.1, "sine", 0.16, 0.09);
    this.tone(784, 0.16, "sine", 0.18, 0.18);
  }

  /** Fell off the course. */
  playFall(): void {
    this.tone(420, 0.35, "sine", 0.15, 0, 110);
  }

  /** Round finished. */
  playFinish(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.14, "sine", 0.15, i * 0.11));
  }
}
