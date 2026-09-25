/** Efectos sintetizados con Web Audio (sin assets), en clave "estudio de TV". */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (C) audioCtx = new C();
  }
  if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
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
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.start(now);
  osc.stop(now + dur);
}

/** Rafaga de ruido filtrado (la explosion y el "fsst" del pase). */
function noise(dur: number, peak: number, freq: number, q = 0.8): void {
  const c = getCtx();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = c.createGain();
  const now = c.currentTime;
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start(now);
}

export class SoundEffects {
  /** Countdown tick (3 / 2 / 1 / YA) — mismo blip que el resto del repo. */
  static playCountdownTick(): void {
    blip("sine", 750, 0.05, 0.08);
  }

  /** Flecha correcta: el tono sube con cada paso de la secuencia. */
  static playKey(step: number): void {
    blip("square", 440 * Math.pow(2, step / 6), 0.05, 0.05);
  }

  /** Flecha equivocada: el "buzzer" de programa de concursos. */
  static playWrong(): void {
    blip("sawtooth", 140, 0.22, 0.09, 110);
    blip("square", 146, 0.22, 0.05);
  }

  /** La papa sale volando. */
  static playPass(): void {
    noise(0.12, 0.12, 1800, 1.4);
    blip("triangle", 520, 0.1, 0.06, 900);
  }

  /** La papa cae en tus manos. */
  static playCatch(): void {
    blip("triangle", 330, 0.08, 0.1, 260);
  }

  /** Arranca una papa nueva: campana de estudio. */
  static playBell(): void {
    blip("sine", 880, 0.5, 0.08);
    blip("sine", 1320, 0.4, 0.04);
  }

  /** Tic-tac del termometro (se acelera con el calor). */
  static playTick(hot: boolean): void {
    blip("square", hot ? 1400 : 1100, 0.018, 0.025);
  }

  static playBoom(): void {
    noise(0.7, 0.35, 180, 0.6);
    blip("square", 90, 0.45, 0.14, 40);
  }

  static playWin(): void {
    blip("triangle", 523.25, 0.14, 0.12);
    blip("triangle", 659.25, 0.16, 0.1, undefined, 0.12);
    blip("triangle", 783.99, 0.3, 0.1, undefined, 0.26);
  }

  static playLose(): void {
    blip("sawtooth", 220, 0.3, 0.08, 110);
  }
}
