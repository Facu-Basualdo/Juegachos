import { getAudioContext, resumeAudio } from "./audioContext";
import { EmoteAudio } from "./EmoteAudio";
import type { EmoteId } from "./constants";

/** `delay` (seg) permite encadenar blips en una frase: una risa son varias silabas. */
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

/** Efectos sintetizados con Web Audio (sin assets), en clave "prensa de papel". */
export class SoundEffects {
  /** Countdown tick (3 / 2 / 1 / YA) — mismo blip que el resto del repo. */
  static playCountdownTick(): void {
    blip("sine", 750, 0.05, 0.08);
  }

  /** Palabra aceptada: un "sello" seco y satisfactorio. */
  static playAccept(): void {
    blip("triangle", 320, 0.09, 0.14);
    blip("sine", 640, 0.12, 0.06);
  }

  /** Palabra rechazada: un zumbido corto y opaco. */
  static playReject(): void {
    blip("sawtooth", 150, 0.16, 0.1, 90);
  }

  /** La mecha exploto en el turno de alguien: golpe seco. */
  static playExplode(): void {
    blip("square", 110, 0.28, 0.16, 55);
  }

  /**
   * Voz de cada reaccion. Primero intenta el sample real (`EmoteAudio`, mp3 en
   * `public/sfx/emotes/`); si todavia no bajo, no existe o no decodifico, cae a la
   * version sintetizada de abajo. Suenan para todos los de la sala y pueden pisarse con
   * la mecha y la explosion, asi que van a volumen bajo (pico <= 0.09 las sintetizadas,
   * `SAMPLE_GAIN` los samples) y cortas (~90ms el "oh!" de sorpresa, ~430ms el sollozo
   * de llanto, que es la mas larga): son un gesto, no un evento de la partida. El
   * cooldown de 1s por jugador es lo que evita que se acumulen.
   */
  static playEmote(id: EmoteId): void {
    if (EmoteAudio.play(id)) return;
    switch (id) {
      case "risa":
        // Risa muy aguda y rapida (tipo ardilla/rana de TikTok).
        blip("sine", 900, 0.06, 0.07, 1100, 0);
        blip("sine", 1000, 0.06, 0.07, 1200, 0.07);
        blip("sine", 1100, 0.06, 0.07, 1300, 0.14);
        blip("sine", 1200, 0.06, 0.07, 1000, 0.21);
        blip("sine", 1000, 0.06, 0.07, 800, 0.28);
        blip("sine", 900, 0.06, 0.07, 1100, 0.35);
        break;
      case "sorpresa":
        // Un "oh!" que sube de golpe.
        blip("sine", 320, 0.13, 0.07, 980);
        break;
      case "enojo":
        // Gruñido grave y aspero.
        blip("sawtooth", 140, 0.28, 0.09, 70);
        blip("square", 95, 0.2, 0.04, 62, 0.04);
        break;
      case "burla":
        // Cantito de burla: baja y vuelve a subir.
        blip("triangle", 600, 0.1, 0.07, 380, 0);
        blip("triangle", 380, 0.13, 0.07, 640, 0.1);
        break;
      case "llanto":
        // Dos sollozos que se desinflan.
        blip("sine", 620, 0.22, 0.07, 260, 0);
        blip("sine", 540, 0.26, 0.06, 220, 0.26);
        break;
    }
  }

  /** Paso de turno: un tic breve. */
  static playTurn(): void {
    blip("sine", 520, 0.05, 0.05);
  }

  /** Fin de la partida (ganaste). */
  static playWin(): void {
    blip("triangle", 523.25, 0.14, 0.12);
    blip("triangle", 659.25, 0.18, 0.1);
  }

  /** Fin de la partida (perdiste / eliminado). */
  static playLose(): void {
    blip("sawtooth", 220, 0.3, 0.1, 110);
  }
}
