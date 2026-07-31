/**
 * Efectos sintetizados con Web Audio (sin assets). Un unico AudioContext por pagina,
 * arrancado en `suspended` hasta el primer gesto.
 */
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

function blip(
  type: OscillatorType,
  freq: number,
  dur: number,
  peak: number,
  slideTo?: number,
  delay = 0,
): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.start(now);
  osc.stop(now + dur);
}

export class SoundEffects {
  /** Countdown tick (3 / 2 / 1 / YA) — mismo blip que el resto del repo. */
  static playCountdownTick(): void {
    blip("sine", 750, 0.05, 0.08);
  }

  /** Cambio de fase: tic corto y neutro. */
  static playPhase(): void {
    blip("sine", 520, 0.07, 0.07, 700);
  }

  /** Entregaste tu frase o tu dibujo. */
  static playSubmit(): void {
    blip("triangle", 620, 0.09, 0.08, 820);
  }

  /** Adivinaste la frase. */
  static playCorrect(): void {
    blip("triangle", 523.25, 0.12, 0.1);
    blip("triangle", 783.99, 0.18, 0.08, undefined, 0.07);
  }

  /** Intento fallido: no penaliza, solo avisa. */
  static playWrong(): void {
    blip("sawtooth", 200, 0.14, 0.07, 140);
  }

  /** Se abre la galeria de cadenas. */
  static playReveal(): void {
    blip("triangle", 440, 0.12, 0.09);
    blip("triangle", 659.25, 0.16, 0.08, undefined, 0.06);
  }

  /** Fin del partido (ganaste). */
  static playWin(): void {
    blip("triangle", 523.25, 0.14, 0.12);
    blip("triangle", 659.25, 0.18, 0.1, undefined, 0.08);
    blip("triangle", 783.99, 0.22, 0.09, undefined, 0.16);
  }

  /** Fin del partido (no ganaste). */
  static playLose(): void {
    blip("sawtooth", 220, 0.3, 0.1, 110);
  }
}
