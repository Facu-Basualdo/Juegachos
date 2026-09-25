import { getAudio, resumeAudio } from "./audio";

/** Efectos sintetizados con Web Audio (sin assets). Van por el bus, asi mueven la boca. */
function blip(type: OscillatorType, freq: number, dur: number, peak: number, slideTo?: number, delay = 0): void {
  const a = getAudio();
  if (!a) return;
  resumeAudio();
  const { ctx, bus } = a;
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(bus);
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

  /** Arranca la grabacion: pitido corto y agudo, como el "rec" de una grabadora. */
  static playRecStart(): void {
    blip("sine", 1320, 0.12, 0.08);
  }

  /** Corta la grabacion. */
  static playRecStop(): void {
    blip("sine", 880, 0.1, 0.07, 660);
  }

  /** Se revela el puntaje de una toma: sube mas cuanto mejor le fue. */
  static playScore(raw: number): void {
    const top = 400 + raw * 6;
    blip("triangle", 330, 0.12, 0.09, top);
    if (raw >= 80) blip("triangle", top, 0.2, 0.08, top * 1.5, 0.12);
  }

  /** Cada porcion que pasa la aguja de la ruleta. */
  static playWheelTick(): void {
    blip("square", 1800, 0.018, 0.03);
  }

  static playWheelStop(bonus: boolean): void {
    if (bonus) {
      blip("triangle", 523.25, 0.12, 0.1);
      blip("triangle", 783.99, 0.2, 0.09, undefined, 0.1);
    } else {
      blip("sawtooth", 300, 0.35, 0.09, 120);
    }
  }

  static playWin(): void {
    blip("triangle", 523.25, 0.14, 0.12);
    blip("triangle", 659.25, 0.18, 0.1, undefined, 0.08);
    blip("triangle", 783.99, 0.22, 0.09, undefined, 0.16);
  }

  static playLose(): void {
    blip("sawtooth", 220, 0.3, 0.1, 110);
  }
}
