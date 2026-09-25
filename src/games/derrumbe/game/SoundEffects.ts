let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const cls = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (cls) audioCtx = new cls();
  }
  if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

/** Tono simple con ataque corto y caida exponencial. */
function tone(
  type: OscillatorType,
  from: number,
  to: number,
  dur: number,
  vol: number,
  delay = 0,
): void {
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

/** Rafaga de ruido filtrado (mecha, derrumbe, lava). */
function noise(dur: number, vol: number, fromHz: number, toHz: number, type: BiquadFilterType = "lowpass"): void {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime;
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
  gain.connect(c.destination);
  src.start(t);
}

/**
 * Sonidos de Derrumbe: todos sinteticos. La mecha es un siseo corto y agudo, el
 * derrumbe un golpe sordo, y la lava un chirrido de ruido que baja. Los que se
 * repiten mucho (mecha, derrumbe) los topea el juego por tiempo.
 */
export class SoundEffects {
  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  /** Pisaste un bloque: siseo de mecha. */
  static playFuse(): void {
    noise(0.09, 0.05, 6000, 2500, "highpass");
  }

  /** Cayo un bloque cerca. */
  static playCrumble(): void {
    noise(0.16, 0.12, 900, 140);
  }

  static playJump(): void {
    tone("square", 260, 420, 0.1, 0.035);
  }

  static playLand(): void {
    noise(0.08, 0.1, 500, 120);
  }

  /** Te caiste del piso: silbido que baja. */
  static playFall(): void {
    tone("triangle", 700, 180, 0.6, 0.06);
  }

  /** Tocaste la lava. */
  static playLava(): void {
    noise(0.7, 0.28, 2400, 120);
    tone("sawtooth", 180, 50, 0.6, 0.06);
  }

  /** Cayo otro jugador. */
  static playOtherOut(): void {
    tone("triangle", 880, 660, 0.18, 0.06);
  }

  /** El piso se empezo a pudrir. */
  static playDecay(): void {
    tone("square", 330, 330, 0.12, 0.05);
    tone("square", 262, 262, 0.18, 0.05, 0.14);
  }

  /** Quedaste ultimo en pie. */
  static playWin(): void {
    [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.3, 0.1, i * 0.1));
  }

  static playEnd(): void {
    [392, 523, 659].forEach((f, i) => tone("triangle", f, f, 0.28, 0.08, i * 0.1));
  }
}
