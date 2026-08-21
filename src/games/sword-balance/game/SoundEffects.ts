let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

function resumed(): AudioContext | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Synthesized sound effects (Web Audio, no assets). */
export class SoundEffects {
  /** Shared 750 Hz countdown tick (3 / 2 / 1 / YA). */
  static playCountdownTick(): void {
    const ctx = resumed();
    if (!ctx) return;
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

  /** A bright steel "shing" as the round begins. */
  static playUnsheathe(): void {
    const ctx = resumed();
    if (!ctx) return;
    const now = ctx.currentTime;
    [1800, 2600, 3400].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 1.4, now + 0.25);
      gain.gain.setValueAtTime(0.0001, now + i * 0.01);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.02 + i * 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.start(now + i * 0.01);
      osc.stop(now + 0.4);
    });
  }

  /** A soft metallic wobble tick when the blade nears the edge of failing. */
  static playWobble(): void {
    const ctx = resumed();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** Heavy metallic clang when the sword drops (game over). */
  static playClang(): void {
    const ctx = resumed();
    if (!ctx) return;
    const now = ctx.currentTime;
    [180, 330, 520, 940].forEach((f) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.6, now + 0.5);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    });
  }
}
