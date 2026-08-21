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

/** Efectos sintetizados (Web Audio API, sin assets). */
export class SoundEffects {
  /** Tick del countdown (3 / 2 / 1 / YA) — mismo blip que el resto del sitio. */
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

  /** Aparicion del numero: un blip suave y luminoso. */
  static playReveal(): void {
    tone(523.25, "sine", 0.09, 0.12);
  }

  /** Blip corto de tecla al ingresar un digito. */
  static playKey(): void {
    tone(660, "triangle", 0.05, 0.05);
  }

  /** Acierto: dos notas ascendentes calidas. */
  static playCorrect(): void {
    tone(659.25, "sine", 0.12, 0.14);
    setTimeout(() => tone(987.77, "sine", 0.12, 0.2), 110);
  }

  /** Error: buzz grave descendente. */
  static playWrong(): void {
    tone(196, "sawtooth", 0.14, 0.35, 90);
  }

  /** Cierre de partida: floreo descendente resignado. */
  static playFinish(): void {
    tone(392, "sine", 0.12, 0.22);
    setTimeout(() => tone(261.63, "sine", 0.12, 0.32), 150);
  }
}
