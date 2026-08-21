let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

/** Tono simple con envolvente corta (la base de casi todos los efectos de aca). */
function blip(
  freq: number,
  type: OscillatorType,
  duration: number,
  peak: number,
  slideTo?: number,
): void {
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
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);

  gain.gain.setValueAtTime(0.01, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.start(now);
  osc.stop(now + duration);
}

export class SoundEffects {
  /** Countdown tick (3 / 2 / 1 / YA) — mismo blip que El Trile. */
  static playCountdownTick(): void {
    blip(750, "sine", 0.05, 0.08);
  }

  /** Tecla: golpe seco y corto, como una tecla de maquina de escribir. */
  static playKey(): void {
    blip(220, "square", 0.03, 0.03);
  }

  /** Borrar: igual que la tecla pero cayendo. */
  static playDelete(): void {
    blip(200, "square", 0.04, 0.03, 140);
  }

  /** Palabra que no esta en el diccionario: zumbido grave de rechazo. */
  static playInvalid(): void {
    blip(150, "sawtooth", 0.16, 0.05, 90);
  }

  /**
   * Sello de una casilla al revelarse. El tono sube con lo bueno que es el
   * resultado, asi la fila se escucha como se ve.
   */
  static playReveal(state: "exact" | "present" | "absent"): void {
    const freq = state === "exact" ? 660 : state === "present" ? 520 : 380;
    blip(freq, "triangle", 0.09, 0.05);
  }

  /** Adivinada: arpegio ascendente. */
  static playWin(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const now = ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.01, now + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.35);
    });
  }

  /** Sin intentos: dos notas cayendo. */
  static playLose(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    [330, 247].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);

      gain.gain.setValueAtTime(0.01, now + idx * 0.16);
      gain.gain.linearRampToValueAtTime(0.11, now + idx * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.42);

      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.42);
    });
  }
}
