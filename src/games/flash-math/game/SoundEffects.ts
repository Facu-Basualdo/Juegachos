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

function resumed(): AudioContext | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function blip(freqFrom: number, freqTo: number, duration: number, type: OscillatorType, volume = 0.15): void {
  const ctx = resumed();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, ctx.currentTime);
  if (freqTo !== freqFrom) {
    osc.frequency.exponentialRampToValueAtTime(freqTo, ctx.currentTime + duration);
  }

  gain.gain.setValueAtTime(0.01, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export class SoundEffects {
  /** Blip de cada label del countdown 3/2/1/YA (750 Hz, patron compartido del repo). */
  static playCountdownTick(): void {
    blip(750, 750, 0.06, "sine", 0.1);
  }

  /** Arranque de la partida (YA). */
  static playStart(): void {
    blip(1000, 1500, 0.15, "triangle", 0.15);
  }

  /** Aparicion de un numero en la secuencia. */
  static playTerm(): void {
    blip(520, 520, 0.045, "sine", 0.08);
  }

  /** Tecla del teclado numerico. */
  static playKey(): void {
    blip(360, 360, 0.03, "square", 0.05);
  }

  /** Respuesta correcta (arpegio ascendente). */
  static playCorrect(): void {
    const ctx = resumed();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.01, now + idx * 0.06);
      gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.28);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.28);
    });
  }

  /** Respuesta incorrecta / fin de partida. */
  static playWrong(): void {
    blip(220, 110, 0.32, "sawtooth", 0.15);
  }
}
