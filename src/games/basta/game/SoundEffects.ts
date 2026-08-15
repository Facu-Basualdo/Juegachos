import { BastaAudio } from "./BastaAudio";
import { getAudioContext, resumeAudio } from "./audioContext";

/**
 * Efectos sintetizados con Web Audio (sin assets), en clave "lapiz sobre papel".
 * La unica excepcion es el grito de BASTA, que es un sample real (`BastaAudio`) con
 * fallback al campanazo sintetizado de aca.
 */

function blip(type: OscillatorType, freq: number, dur: number, peak: number, slideTo?: number, delay = 0): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  resumeAudio(ctx);
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

  /**
   * Alguien grito BASTA (suena en todas las pantallas, no solo en la del que corto).
   * Sample real si esta cargado; si no, campanazo seco sintetizado.
   */
  static playBasta(): void {
    if (BastaAudio.play()) return;
    blip("square", 440, 0.1, 0.12, 660);
    blip("triangle", 880, 0.18, 0.08);
  }

  /** Se abre la votacion: dos tics ascendentes. */
  static playVoteOpen(): void {
    blip("sine", 520, 0.07, 0.07, 700);
    blip("sine", 700, 0.09, 0.06, 900, 0.08);
  }

  /** Se revela el puntaje de la letra: acorde corto y brillante. */
  static playReveal(): void {
    blip("triangle", 523.25, 0.12, 0.1);
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
