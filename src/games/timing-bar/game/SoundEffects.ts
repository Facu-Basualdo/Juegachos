let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  return audioCtx;
}

function tone(freq: number, type: OscillatorType, peak: number, dur: number, sweepTo?: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + dur);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.start(now);
  osc.stop(now + dur);
}

/** Synthesized sound effects (Web Audio API, no assets). */
export class SoundEffects {
  /** Countdown tick (3 / 2 / 1 / YA) — same blip as El Trile. */
  static playCountdownTick(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(750, now);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** Stop blip — pitch rises with the score (0..100) for instant feedback. */
  static playStop(points: number): void {
    const freq = 320 + (points / 100) * 700;
    tone(freq, "triangle", 0.15, 0.13);
  }

  /** Bright two-note chime on a near-perfect center hit. */
  static playPerfect(): void {
    tone(880, "sine", 0.14, 0.14);
    setTimeout(() => tone(1318.51, "sine", 0.14, 0.22), 90);
  }

  /** Rising flourish on the final results screen. */
  static playFinish(): void {
    tone(659.25, "sine", 0.13, 0.18);
    setTimeout(() => tone(987.77, "sine", 0.13, 0.28), 130);
  }
}
