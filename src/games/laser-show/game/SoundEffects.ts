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

function tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, at = 0, out?: AudioNode): void {
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

function now(): number {
  return ctx()?.currentTime ?? 0;
}

/** Progresion en mayor (semitonos sobre Do2): I - vi - IV - V, un compas cada uno. */
const CHORDS = [0, 9, 5, 7];
const BASS = [0, 6, 8, 10, 14];
const STAB = [4, 12];
const ROOT = 65.4;
const LOOKAHEAD = 0.12;

/**
 * La cortina del programa: bombo en negras, palmas en el 2 y el 4, bajo saltarin y
 * golpes de acorde, agendados con el reloj del AudioContext (lookahead) para que el
 * ritmo no dependa de los frames. Va bajito: los lasers tienen que oirse encima.
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
    this.stop();
    this.bus = c.createGain();
    this.bus.gain.value = 0.6;
    this.bus.connect(c.destination);
    this.stepDur = 60 / bpm / 4;
    this.step = 0;
    this.nextTime = c.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  /** Acelera sin cortar (la musica sube con la dificultad). */
  tempo(bpm: number): void {
    this.stepDur = 60 / bpm / 4;
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const c = ctx();
    if (this.bus && c) {
      this.bus.gain.cancelScheduledValues(c.currentTime);
      this.bus.gain.setValueAtTime(this.bus.gain.value, c.currentTime);
      this.bus.gain.linearRampToValueAtTime(0, c.currentTime + 0.05);
    }
    this.bus = null;
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
    if (s16 % 4 === 0) tone("sine", 130, 48, 0.16, 0.42, t, bus);
    if (s16 === 4 || s16 === 12) noise(0.09, 0.12, 2400, 1200, "bandpass", t, bus);
    if (s16 % 2 === 1) noise(0.03, 0.04, 9000, 7000, "highpass", t, bus);
    if (BASS.includes(s16)) {
      const f = ROOT * Math.pow(2, chord / 12);
      tone("square", f, f, this.stepDur * 1.4, 0.05, t, bus);
    }
    if (STAB.includes(s16)) {
      // El vi es menor: tercera de 3 semitonos en vez de 4.
      for (const iv of [0, chord === 9 ? 3 : 4, 7]) {
        const f = ROOT * 4 * Math.pow(2, (chord + iv) / 12);
        tone("sawtooth", f, f, this.stepDur * 1.2, 0.018, t, bus);
      }
    }
  }
}

const music = new Music();

/** Sonidos de Laser Show, todos sinteticos. */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  static startMusic(): void {
    music.start(118);
  }

  /** `level` 0..1: la cortina se acelera con la dificultad. */
  static musicTempo(level: number): void {
    music.tempo(118 + level * 26);
  }

  static stopMusic(): void {
    music.stop();
  }

  /** Arranque del show: jingle de tres notas. */
  static playJingle(): void {
    const t = now();
    [523, 659, 784, 1047].forEach((f, i) => tone("square", f, f, 0.14, 0.05, t + i * 0.09));
  }

  /** Una barrida se carga: zumbido que sube. */
  static playSpinWarn(): void {
    tone("sawtooth", 110, 440, 0.9, 0.035);
  }

  /** La barrida arranca a girar. */
  static playSpinGo(): void {
    tone("square", 880, 440, 0.18, 0.05);
    noise(0.25, 0.08, 4000, 800, "bandpass");
  }

  /** Una pared arranca: un "piuu" laser. */
  static playWallGo(): void {
    tone("sawtooth", 1400, 300, 0.22, 0.045);
  }

  /** Aviso de la lluvia: carga electrica. */
  static playZoneWarn(): void {
    tone("triangle", 300, 900, 0.5, 0.04);
  }

  /** Estalla la lluvia. */
  static playZoneBlast(): void {
    noise(0.35, 0.22, 5000, 200, "lowpass");
    tone("square", 180, 60, 0.3, 0.06);
  }

  static playJump(): void {
    tone("square", 300, 600, 0.1, 0.035);
  }

  static playLand(): void {
    noise(0.07, 0.08, 600, 150, "lowpass");
  }

  static playDuck(): void {
    tone("triangle", 380, 200, 0.08, 0.04);
  }

  static playPush(): void {
    noise(0.1, 0.22, 1400, 200, "lowpass");
    tone("square", 180, 110, 0.08, 0.04);
  }

  static playPushOther(): void {
    noise(0.08, 0.1, 1200, 200, "lowpass");
  }

  static playShoved(): void {
    noise(0.14, 0.3, 900, 120, "lowpass");
    tone("triangle", 330, 660, 0.22, 0.06);
  }

  /** Te toco un laser: chisporroteo y el bocinazo de "respuesta incorrecta". */
  static playZapped(): void {
    noise(0.5, 0.3, 8000, 400, "highpass");
    const t = now();
    tone("square", 150, 150, 0.32, 0.07, t + 0.08);
    tone("square", 110, 110, 0.45, 0.07, t + 0.42);
  }

  static playFall(): void {
    tone("triangle", 600, 90, 0.9, 0.08);
  }

  /** Quedo afuera otro: un bocinazo corto, mas bajo. */
  static playOtherOut(): void {
    tone("square", 140, 140, 0.18, 0.035);
  }

  /** Quedaste ultimo en pie: fanfarria. */
  static playLastStanding(): void {
    const t = now();
    [523, 659, 784].forEach((f, i) => tone("triangle", f, f, 0.18, 0.08, t + i * 0.12));
    tone("triangle", 1047, 1047, 0.5, 0.09, t + 0.36);
  }

  /** Aplausos del publico: rafagas de ruido. */
  static playApplause(): void {
    const t = now();
    for (let i = 0; i < 40; i++) noise(0.06, 0.05 + Math.random() * 0.05, 3000, 1500, "bandpass", t + Math.random() * 1.6);
  }

  static playWin(): void {
    const t = now();
    [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.3, 0.1, t + i * 0.1));
    SoundEffects.playApplause();
  }

  static playEnd(): void {
    const t = now();
    [392, 523, 659].forEach((f, i) => tone("triangle", f, f, 0.28, 0.08, t + i * 0.1));
  }
}
