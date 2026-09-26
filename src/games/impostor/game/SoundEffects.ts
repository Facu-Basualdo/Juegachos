/**
 * Efectos sintetizados con Web Audio (sin assets), en clave "sala de interrogatorio":
 * graves, secos y tensos. Un unico AudioContext por pagina, arrancado en `suspended`
 * hasta el primer gesto.
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

/** Rafaga de ruido filtrado (sello, teclazos). */
function thud(dur: number, vol: number, type: BiquadFilterType, freq: number, delay = 0): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const t = ctx.currentTime + delay;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t);
}

export class SoundEffects {
  /** Countdown tick (3 / 2 / 1 / YA) — mismo blip que el resto del repo. */
  static playCountdownTick(): void {
    blip("sine", 750, 0.05, 0.08);
  }

  /** Se revela tu rol: golpe grave y sostenido, como que se prende el foco. */
  static playReveal(): void {
    blip("sawtooth", 110, 0.5, 0.09, 70);
    blip("sine", 220, 0.4, 0.06);
  }

  /** Tu turno de dar la pista: dos tics secos. */
  static playYourTurn(): void {
    blip("triangle", 520, 0.06, 0.08);
    blip("triangle", 640, 0.07, 0.06, undefined, 0.07);
  }

  /** Se abre la votacion: sirena baja de tension. */
  static playVoteOpen(): void {
    blip("sawtooth", 180, 0.28, 0.08, 300);
  }

  /** Sting de acusacion / desenlace: golpe dramatico. */
  static playSting(): void {
    blip("square", 300, 0.12, 0.09, 150);
    blip("sawtooth", 90, 0.35, 0.08);
  }

  /** Fin del partido (ganaste). */
  /** El sello golpea el expediente (el veredicto). */
  static playStamp(): void {
    thud(0.14, 0.5, "lowpass", 900);
    blip("sine", 110, 0.2, 0.28, 45);
  }

  /** Maquina de escribir: una rafaga de teclazos cortos (una pista nueva). */
  static playType(letters: number): void {
    const n = Math.max(2, Math.min(12, letters));
    for (let k = 0; k < n; k++) thud(0.025, 0.16, "bandpass", 2400 + Math.random() * 800, k * 0.055);
  }

  static playWin(): void {
    blip("triangle", 392, 0.14, 0.11);
    blip("triangle", 523.25, 0.18, 0.1, undefined, 0.09);
    blip("triangle", 659.25, 0.24, 0.09, undefined, 0.18);
  }

  /** Fin del partido (no ganaste). */
  static playLose(): void {
    blip("sawtooth", 200, 0.34, 0.1, 90);
  }
}
