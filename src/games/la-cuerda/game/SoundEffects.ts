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

function tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, fromHz: number, toHz: number): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
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

/** Sonidos de La Cuerda, todos sinteticos. */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  /**
   * La cuerda golpea el tablero: el golpe seco marca el ritmo, que es el aviso (se
   * salta escuchando). `near` 0 (lejos) a 1 (en la zona) sube el volumen.
   */
  static playRopeSlap(near: number): void {
    const k = 0.25 + 0.75 * Math.max(0, Math.min(1, near));
    noise(0.12, 0.28 * k, 1800, 220);
    tone("sine", 120, 60, 0.12, 0.12 * k);
  }

  /** El silbido de la cuerda bajando, justo antes del golpe. */
  static playRopeWhoosh(near: number): void {
    const k = 0.2 + 0.8 * Math.max(0, Math.min(1, near));
    noise(0.22, 0.08 * k, 400, 2400);
  }

  static playJump(): void {
    tone("square", 280, 460, 0.1, 0.035);
  }

  static playLand(): void {
    noise(0.08, 0.1, 600, 140);
  }

  /** Empujaste. */
  static playPush(): void {
    noise(0.1, 0.22, 1400, 200);
    tone("square", 180, 110, 0.08, 0.04);
  }

  /** Empujo otro (mas bajo: no es asunto tuyo). */
  static playPushOther(): void {
    noise(0.08, 0.1, 1200, 200);
  }

  /** Te empujaron: golpe y un silbido que sube. */
  static playShoved(): void {
    noise(0.14, 0.3, 900, 120);
    tone("triangle", 330, 660, 0.22, 0.06);
  }

  /** Te agarro la cuerda. */
  static playHit(): void {
    noise(0.18, 0.4, 3000, 300);
    tone("sawtooth", 320, 90, 0.35, 0.07);
  }

  /** Caiste al vacio: silbido que baja. */
  static playFall(): void {
    tone("triangle", 900, 120, 1.1, 0.07);
  }

  static playOtherOut(): void {
    tone("triangle", 880, 660, 0.18, 0.06);
  }

  /** Llegaste a la meta. */
  static playGoal(): void {
    [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.3, 0.1, i * 0.1));
  }

  static playEnd(): void {
    [392, 523, 659].forEach((f, i) => tone("triangle", f, f, 0.28, 0.08, i * 0.1));
  }
}
