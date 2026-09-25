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
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, fromHz: number, toHz: number, type: BiquadFilterType = "lowpass"): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime;
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

/** Melodia de la cancion (semitonos sobre Do4): sol sol mi, sol sol mi, la sol do. */
const MELODY = [7, 7, 4, 7, 7, 4, 9, 7, 12];
const BASE = 261.63;

/**
 * Sonidos de Luz Roja, Luz Verde. La cancion es lo mas importante: cada silaba se
 * agenda con el reloj del AudioContext repartida en la duracion del verde, asi el
 * RITMO dice cuanto falta para que la muñeca se de vuelta.
 */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  /**
   * Agenda la cancion. `times` son los segundos desde ahora de cada silaba (las que
   * ya pasaron vienen negativas y se saltean).
   */
  static playChant(times: number[]): void {
    times.forEach((t, i) => {
      if (t < -0.01) return;
      const f = BASE * Math.pow(2, MELODY[i % MELODY.length] / 12);
      const last = i === times.length - 1;
      tone("triangle", f, f, last ? 0.32 : 0.2, 0.13, t);
      tone("sine", f * 2, f * 2, 0.12, 0.03, t);
    });
  }

  /** Se da vuelta la cabeza: chirrido mecanico que baja. */
  static playTurn(): void {
    tone("sawtooth", 180, 70, 0.35, 0.05);
    noise(0.3, 0.05, 1200, 300, "bandpass");
  }

  /** Se le prenden los ojos: "te estoy mirando". */
  static playScan(): void {
    tone("square", 1480, 1480, 0.07, 0.035);
    tone("square", 1480, 1480, 0.07, 0.035, 0.1);
  }

  /** Amague: medio chirrido. */
  static playTease(): void {
    tone("sawtooth", 150, 110, 0.18, 0.04);
  }

  /** Disparo: chasquido seco y un golpe grave. `near` = el propio (mas fuerte). */
  static playShot(near: boolean): void {
    noise(0.25, near ? 0.55 : 0.2, 5200, 400);
    tone("sine", 120, 40, 0.3, near ? 0.25 : 0.08);
  }

  /** Cruzaste la linea. */
  static playFinish(): void {
    [784, 988, 1175].forEach((f, i) => tone("triangle", f, f, 0.35, 0.1, i * 0.09));
  }

  /** Se acabo el tiempo. */
  static playTimeUp(): void {
    tone("square", 220, 220, 0.6, 0.06);
    tone("square", 165, 165, 0.6, 0.05);
  }

  static playEnd(): void {
    [392, 523, 659].forEach((f, i) => tone("triangle", f, f, 0.28, 0.08, i * 0.1));
  }
}

/** Silabas de la cancion, en el orden en que se cantan. */
export const CHANT = ["LUZ", "VER", "DE,", "LUZ", "RO", "JA,", "1,", "2,", "3"];
