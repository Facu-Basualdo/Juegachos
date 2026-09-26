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

function tone(
  type: OscillatorType,
  from: number,
  to: number,
  dur: number,
  vol: number,
  at = 0,
  out?: AudioNode,
): void {
  const c = ctx();
  if (!c) return;
  const t = at > 0 ? at : c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(out ?? c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, fromHz: number, toHz: number, type: BiquadFilterType, at = 0, out?: AudioNode): void {
  const c = ctx();
  if (!c) return;
  const t = at > 0 ? at : c.currentTime;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
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
  gain.connect(out ?? c.destination);
  src.start(t);
}

/** Progresion (semitonos sobre La1): Lam - Fa - Do - Sol, un compas cada uno. */
const CHORDS = [0, -4, 3, -2];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const ARP = [0, 7, 12, 7, 15, 12, 7, 12];
const ROOT = 55;
const LOOKAHEAD = 0.12;

/**
 * La musica de baile: bombo en negras, platillo a contratiempo, bajo sincopado y un
 * arpegio, agendados con el reloj del AudioContext (lookahead) para que el ritmo no
 * dependa de los frames. Cortarla es la señal del juego: `stop()` la apaga de golpe
 * y suena el rayon de disco.
 */
class Music {
  private timer: number | null = null;
  private bus: GainNode | null = null;
  private nextTime = 0;
  private step = 0;
  private stepDur = 0.125;

  start(bpm: number): void {
    const c = ctx();
    if (!c) return;
    this.stop(false);
    this.bus = c.createGain();
    this.bus.gain.value = 0.85;
    this.bus.connect(c.destination);
    this.stepDur = 60 / bpm / 4;
    this.step = 0;
    this.nextTime = c.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(scratch: boolean): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const c = ctx();
    if (this.bus && c) {
      this.bus.gain.cancelScheduledValues(c.currentTime);
      this.bus.gain.setValueAtTime(this.bus.gain.value, c.currentTime);
      this.bus.gain.linearRampToValueAtTime(0, c.currentTime + 0.03);
    }
    this.bus = null;
    if (scratch) {
      // Rayon de disco: ruido que baja rapido y un tono que se frena.
      noise(0.28, 0.18, 3000, 200, "bandpass");
      tone("sawtooth", 420, 60, 0.3, 0.05);
    }
  }

  private schedule(): void {
    const c = ctx();
    if (!c || !this.bus) return;
    while (this.nextTime < c.currentTime + LOOKAHEAD) {
      this.note(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private note(step: number, t: number): void {
    const bus = this.bus!;
    const s16 = step % 16;
    const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
    if (s16 % 4 === 0) tone("sine", 140, 45, 0.18, 0.5, t, bus);
    if (s16 % 4 === 2) noise(0.05, 0.08, 9000, 6000, "highpass", t, bus);
    if (BASS_STEPS.includes(s16)) {
      const f = ROOT * Math.pow(2, chord / 12);
      tone("square", f, f, this.stepDur * 1.6, 0.06, t, bus);
    }
    if (s16 % 2 === 0) {
      const f = ROOT * 4 * Math.pow(2, (chord + ARP[(s16 / 2) % ARP.length]) / 12);
      tone("triangle", f, f, this.stepDur * 1.8, 0.035, t, bus);
    }
  }
}

const music = new Music();

/** Sonidos de Pista Loca, todos sinteticos. */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  /** Arranca la musica; se acelera ronda a ronda. */
  static startMusic(round: number): void {
    music.start(Math.min(150, 116 + round * 2.5));
  }

  static stopMusic(scratch: boolean): void {
    music.stop(scratch);
  }

  /** Se pidio el color: dos notas altas. */
  static playCall(): void {
    tone("square", 988, 988, 0.08, 0.05);
    tone("square", 1319, 1319, 0.12, 0.05, (ctx()?.currentTime ?? 0) + 0.09);
  }

  /** Cae la pista. */
  static playDrop(): void {
    noise(0.6, 0.25, 700, 90, "lowpass");
  }

  static playJump(): void {
    tone("square", 260, 420, 0.1, 0.035);
  }

  static playLand(): void {
    noise(0.08, 0.1, 500, 120, "lowpass");
  }

  /** Empujaste: un golpe seco y corto. */
  static playPush(): void {
    noise(0.1, 0.22, 1400, 200, "lowpass");
    tone("square", 180, 110, 0.08, 0.04);
  }

  /** Empujo otro (mas bajo: no es asunto tuyo). */
  static playPushOther(): void {
    noise(0.08, 0.1, 1200, 200, "lowpass");
  }

  /** Te empujaron: golpe y un silbido que sube. */
  static playShoved(): void {
    noise(0.14, 0.3, 900, 120, "lowpass");
    tone("triangle", 330, 660, 0.22, 0.06);
  }

  /** Te caiste al vacio. */
  static playFall(): void {
    tone("triangle", 600, 90, 0.9, 0.08);
  }

  /** Cayo otro. */
  static playOtherOut(): void {
    tone("triangle", 880, 660, 0.18, 0.06);
  }

  /** Aguantaste la ronda. */
  static playSurvive(): void {
    tone("triangle", 784, 784, 0.12, 0.06);
    tone("triangle", 1047, 1047, 0.16, 0.06, (ctx()?.currentTime ?? 0) + 0.1);
  }

  static playWin(): void {
    const now = ctx()?.currentTime ?? 0;
    [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.3, 0.1, now + i * 0.1));
  }

  static playEnd(): void {
    const now = ctx()?.currentTime ?? 0;
    [392, 523, 659].forEach((f, i) => tone("triangle", f, f, 0.28, 0.08, now + i * 0.1));
  }
}
