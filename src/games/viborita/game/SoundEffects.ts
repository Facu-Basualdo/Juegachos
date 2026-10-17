let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const cls = window.AudioContext || (window as any).webkitAudioContext;
    if (cls) audioCtx = new cls();
  }
  return audioCtx;
}

function blip(freq: number, endFreq: number, dur: number, vol: number, type: OscillatorType = "sine"): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

/** Sonidos de Viborita: blips cortos y secos, como los clicks de la landing. */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    blip(750, 750, 0.05, 0.08);
  }

  /** Chocaste: un golpe que cae. */
  static playCrash(): void {
    blip(220, 55, 0.4, 0.16, "triangle");
  }

  /** Turbo: un "fsh" corto al apretar. */
  static playBoost(): void {
    blip(300, 600, 0.12, 0.05, "sawtooth");
  }
}
