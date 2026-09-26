let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const cls =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (cls) audioCtx = new cls();
  }
  if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, at = 0): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + Math.max(0, at);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, fromHz: number, toHz: number, type: BiquadFilterType = "lowpass", at = 0): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + Math.max(0, at);
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(fromHz, t);
  filter.frequency.exponentialRampToValueAtTime(toHz, t + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start(t);
}

/** Sonidos de Dalgona, todos sinteticos. */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  /** Elegiste una lata: un toc metalico. */
  static playPick(): void {
    tone("triangle", 1400, 900, 0.08, 0.06);
    noise(0.05, 0.08, 6000, 2500, "bandpass");
  }

  /** La tapa sale raspando. */
  static playLid(): void {
    noise(0.35, 0.12, 3500, 1200, "bandpass");
    tone("triangle", 620, 480, 0.2, 0.04, 0.3);
  }

  /** Raspado de la aguja; `amount` es cuanto se tallo desde el ultimo raspado. */
  static playScratch(amount: number): void {
    noise(0.04, Math.min(0.09, 0.03 + amount * 0.6), 5200, 3000, "bandpass");
  }

  /** Crujido de aviso: mas fuerte cuanto mas cerca de romperse. */
  static playCreak(level: number): void {
    noise(0.12, 0.05 + level * 0.12, 900, 300, "bandpass");
    tone("square", 90 + level * 40, 70, 0.08, 0.02);
  }

  /** Se rompio la galleta: un chasquido seco y un golpe grave. */
  static playBreak(): void {
    noise(0.18, 0.4, 7000, 900, "highpass");
    noise(0.4, 0.3, 500, 60, "lowpass", 0.05);
    tone("triangle", 180, 50, 0.4, 0.12, 0.05);
  }

  /** Lamiendo. */
  static playLick(): void {
    noise(0.16, 0.06, 700, 1800, "bandpass");
  }

  /** Salio la figura entera. */
  static playSuccess(): void {
    [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.3, 0.1, i * 0.1));
  }

  /** Se acabo el tiempo. */
  static playTimeUp(): void {
    tone("square", 440, 220, 0.5, 0.08);
  }

  /** Tic de los ultimos diez segundos. */
  static playClockTick(): void {
    tone("sine", 1200, 1200, 0.03, 0.04);
  }
}
