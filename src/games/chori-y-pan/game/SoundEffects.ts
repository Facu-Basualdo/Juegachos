let actx: AudioContext | null = null;
let master: GainNode | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!actx) {
    const cls = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!cls) return null;
    actx = new cls();
    master = actx.createGain();
    master.gain.value = 0.85;
    master.connect(actx.destination);
  }
  if (actx.state === "suspended") void actx.resume();
  return actx;
}

function env(g: GainNode, t: number, a: number, peak: number, d: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0): void {
  const c = ctx();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, 0.005, vol, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, at = 0, q = 1): void {
  const c = ctx();
  if (!c || !master) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, 0.004, vol, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

/** Sonidos de Chori y Pan: todo sintetizado. */
export class SoundEffects {
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  static unlock(): void {
    ctx();
  }

  /** Salto: el Chori chirria como en la parrilla, el Pan hace "puf". */
  static jump(hero: "chori" | "pan"): void {
    if (hero === "chori") {
      tone("square", 330, 520, 0.09, 0.03);
      noise(0.08, 0.04, "highpass", 4000, 2500);
    } else {
      tone("triangle", 260, 420, 0.1, 0.06);
    }
  }

  static land(): void {
    noise(0.06, 0.06, "lowpass", 600, 150);
  }

  static gem(hero: "chori" | "pan"): void {
    const base = hero === "chori" ? 880 : 1046.5;
    tone("sine", base, base, 0.12, 0.08);
    tone("sine", base * 1.5, base * 1.5, 0.16, 0.06, 0.07);
  }

  static lever(): void {
    tone("square", 160, 120, 0.05, 0.05);
    noise(0.05, 0.06, "bandpass", 1800, 900, 0, 3);
  }

  static plate(on: boolean): void {
    tone("sine", on ? 420 : 300, on ? 560 : 220, 0.08, 0.05);
  }

  /** El Chori al agua: "pshhh". El Pan a las brasas: chisporroteo. Chimichurri: glup. */
  static die(cause: string): void {
    if (cause === "water") {
      noise(0.7, 0.2, "highpass", 2000, 6000);
      tone("sine", 300, 90, 0.5, 0.08);
    } else if (cause === "embers") {
      for (let i = 0; i < 8; i++) noise(0.04, 0.12, "highpass", 3000, 2000, i * 0.05 + Math.random() * 0.03);
      tone("sawtooth", 200, 60, 0.6, 0.06);
    } else {
      tone("sine", 220, 80, 0.3, 0.12);
      tone("sine", 160, 60, 0.3, 0.1, 0.12);
    }
  }

  /** Nivel superado: arpegio alegre. */
  static clear(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone("triangle", f, f, 0.18, 0.08, i * 0.09));
  }

  static win(): void {
    [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone("square", f, f, 0.14, 0.04, i * 0.08));
  }
}
