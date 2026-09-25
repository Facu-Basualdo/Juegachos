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

/** Retumbe continuo de la lava: ruido grave en loop cuyo volumen sube cuando esta cerca. */
class Rumble {
  private gain: GainNode | null = null;

  start(): void {
    const c = ctx();
    if (!c || this.gain) return;
    const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // Ruido marron: se integra el blanco, que es lo que suena a burbujeo grave.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    this.gain = c.createGain();
    this.gain.gain.value = 0;
    src.connect(filter);
    filter.connect(this.gain);
    this.gain.connect(c.destination);
    src.start();
  }

  /** `closeness` 0 (lejos) a 1 (encima). */
  set(closeness: number): void {
    const c = ctx();
    if (!c || !this.gain) return;
    this.gain.gain.setTargetAtTime(0.04 + Math.max(0, Math.min(1, closeness)) * 0.5, c.currentTime, 0.2);
  }

  stop(): void {
    const c = ctx();
    if (!c || !this.gain) return;
    this.gain.gain.setTargetAtTime(0, c.currentTime, 0.3);
  }
}

const rumble = new Rumble();

/** Sonidos de Marea de Lava, todos sinteticos. */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  static startRumble(): void {
    rumble.start();
  }

  static setRumble(closeness: number): void {
    rumble.set(closeness);
  }

  static stopRumble(): void {
    rumble.stop();
  }

  static playJump(): void {
    tone("square", 280, 460, 0.1, 0.035);
  }

  static playLand(): void {
    noise(0.08, 0.1, 600, 140);
  }

  /** La lava esta cerca: dos pitidos cortos. */
  static playWarn(): void {
    tone("square", 880, 880, 0.07, 0.04);
    tone("square", 880, 880, 0.07, 0.04, 0.12);
  }

  /** Te alcanzo la lava. */
  static playBurn(): void {
    noise(0.8, 0.3, 2600, 120);
    tone("sawtooth", 200, 50, 0.6, 0.06);
  }

  static playOtherOut(): void {
    tone("triangle", 880, 660, 0.18, 0.06);
  }

  /** Llegaste a la cima. */
  static playTop(): void {
    [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.3, 0.1, i * 0.1));
  }

  static playEnd(): void {
    [392, 523, 659].forEach((f, i) => tone("triangle", f, f, 0.28, 0.08, i * 0.1));
  }
}
