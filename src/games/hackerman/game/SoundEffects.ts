let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

/** Un blip simple con envolvente corta. Base de casi todos los efectos. */
function blip(
  freq: number,
  type: OscillatorType,
  duration: number,
  peak: number,
  slideTo?: number
): void {
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
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);

  gain.gain.setValueAtTime(0.01, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.start(now);
  osc.stop(now + duration);
}

export class SoundEffects {
  /** Tick del countdown (3 / 2 / 1 / YA) — mismo blip 750 Hz que el resto. */
  static playCountdownTick(): void {
    blip(750, "sine", 0.05, 0.08);
  }

  /** Cursor / navegacion: click seco y corto. */
  static playMove(): void {
    blip(420, "square", 0.03, 0.05);
  }

  /** Ciclar un candidato / girar un reel: tono neutro un poco mas agudo. */
  static playCycle(): void {
    blip(560, "triangle", 0.04, 0.05);
  }

  /** Componente encajado / letra alineada: confirmacion positiva. */
  static playLock(): void {
    blip(660, "sine", 0.09, 0.12, 990);
  }

  /** Intento fallido: buzz grave. */
  static playError(): void {
    blip(180, "sawtooth", 0.16, 0.12, 90);
  }

  /** Nivel superado: arpegio ascendente corto. */
  static playLevelClear(): void {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => setTimeout(() => blip(f, "sine", 0.18, 0.13), i * 70));
  }

  /** Hackeo completo: arpegio mas largo y brillante. */
  static playVictory(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => setTimeout(() => blip(f, "sine", 0.32, 0.14), i * 80));
  }
}
