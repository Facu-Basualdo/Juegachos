let actx: AudioContext | null = null;
let master: GainNode | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!actx) {
    const cls = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!cls) return null;
    actx = new cls();
    master = actx.createGain();
    master.gain.value = 0.9;
    master.connect(actx.destination);
  }
  if (actx.state === "suspended") void actx.resume();
  return actx;
}

function out(): AudioNode | null {
  return ctx() ? master : null;
}

/** Envolvente: ataque corto y caida exponencial. */
function env(g: GainNode, t: number, a: number, peak: number, d: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0, pan = 0): void {
  const c = ctx();
  const o = out();
  if (!c || !o) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  const p = c.createStereoPanner();
  p.pan.value = pan;
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, 0.006, vol, dur);
  osc.connect(g).connect(p).connect(o);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, at = 0, pan = 0, q = 1): void {
  const c = ctx();
  const o = out();
  if (!c || !o) return;
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, 0.004, vol, dur);
  const p = c.createStereoPanner();
  p.pan.value = pan;
  src.connect(f).connect(g).connect(p).connect(o);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

/** Cuerda pulsada de lira (Karplus-Strong simplificado con un triangulo filtrado). */
function pluck(freq: number, at: number, vol: number): void {
  const c = ctx();
  const o = out();
  if (!c || !o) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(freq * 6, t);
  f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 1.2);
  const g = c.createGain();
  env(g, t, 0.004, vol, 1.4);
  osc.connect(f).connect(g).connect(o);
  osc.start(t);
  osc.stop(t + 1.5);
}

/**
 * Sonido de Minotauro: todo sintetizado. Lo del Minotauro sale con volumen por
 * distancia y paneo por el lado en que esta (`near` 0-1, `pan` -1..1), asi se lo
 * escucha venir en la oscuridad antes de verlo.
 */
export class SoundEffects {
  private static drone: { stop: () => void } | null = null;
  private static heartAt = 0;

  /** Blip del 3 / 2 / 1 / YA, duplicado en todos los juegos del repo. */
  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  /** Destraba el audio en el primer gesto. */
  static unlock(): void {
    ctx();
  }

  /** Zumbido de caverna: dos senoidales graves batiendo y ruido filtrado muy bajo. */
  static startAmbience(): void {
    const c = ctx();
    const o = out();
    if (!c || !o || this.drone) return;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.06, c.currentTime + 2.5);
    const a = c.createOscillator();
    a.frequency.value = 55;
    const b = c.createOscillator();
    b.frequency.value = 55.7;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 260;
    const ng = c.createGain();
    ng.gain.value = 0.35;
    a.connect(g);
    b.connect(g);
    src.connect(f).connect(ng).connect(g);
    g.connect(o);
    a.start();
    b.start();
    src.start();
    this.drone = {
      stop: () => {
        g.gain.linearRampToValueAtTime(0, c.currentTime + 0.8);
        window.setTimeout(() => {
          a.stop();
          b.stop();
          src.stop();
        }, 900);
      },
    };
  }

  static stopAmbience(): void {
    this.drone?.stop();
    this.drone = null;
  }

  /** Chisporroteo de la antorcha (se llama al azar). */
  static crackle(): void {
    noise(0.03, 0.03 + Math.random() * 0.03, "highpass", 3000, 1800, 0, (Math.random() - 0.5) * 0.3);
  }

  static footstep(run: boolean): void {
    noise(run ? 0.05 : 0.06, run ? 0.07 : 0.04, "bandpass", run ? 900 : 700, 300, 0, 0, 2);
  }

  static bump(): void {
    tone("sine", 120, 60, 0.18, 0.18);
    noise(0.12, 0.12, "lowpass", 600, 120);
  }

  /** Pezuña del Minotauro: golpe grave, mas fuerte cuanto mas cerca. */
  static hoof(near: number, pan: number): void {
    if (near <= 0.02) return;
    tone("sine", 70, 42, 0.22, 0.26 * near, 0, pan);
    noise(0.1, 0.12 * near, "lowpass", 420, 90, 0, pan);
  }

  /** Bufido: escucho algo. */
  static snort(near: number, pan: number): void {
    noise(0.45, 0.22 * Math.max(0.25, near), "bandpass", 600, 250, 0, pan, 3);
    noise(0.3, 0.12 * Math.max(0.25, near), "bandpass", 900, 400, 0.18, pan, 3);
  }

  /** Bramido: te vio. Sierra que cae con ruido encima. */
  static roar(near: number, pan: number): void {
    const v = 0.3 * Math.max(0.35, near);
    tone("sawtooth", 140, 62, 1.1, v, 0, pan);
    tone("sawtooth", 147, 66, 1.1, v * 0.7, 0.02, pan);
    noise(1.0, v * 0.8, "bandpass", 500, 160, 0, pan, 1.5);
  }

  /**
   * Latido: se llama cada cuadro con la cercania del Minotauro (0-1) y agenda los
   * golpes solo; mas cerca, mas rapido y mas fuerte.
   */
  static heartbeat(near: number): void {
    const c = ctx();
    if (!c || near < 0.15) return;
    const now = c.currentTime;
    if (now < this.heartAt) return;
    const period = 1.1 - near * 0.62;
    this.heartAt = now + period;
    const v = 0.12 + near * 0.32;
    tone("sine", 62, 40, 0.16, v);
    tone("sine", 58, 38, 0.14, v * 0.75, 0.16);
  }

  static amphora(): void {
    pluck(880, 0, 0.12);
    pluck(1318.5, 0.08, 0.1);
    noise(0.25, 0.05, "highpass", 2500, 6000);
  }

  /** Ovillo: arpegio de lira, el mismo modo dorico de la referencia. */
  static spool(): void {
    [293.66, 349.23, 440, 587.33, 523.25, 587.33].forEach((f, i) => pluck(f, i * 0.12, 0.2));
  }

  /** Bajada al nivel siguiente: soplido que cae. */
  static descend(): void {
    noise(1.6, 0.16, "lowpass", 2400, 120);
    tone("sine", 220, 82, 1.6, 0.1);
  }

  /** Atrapado. */
  static caught(): void {
    tone("sawtooth", 180, 40, 1.4, 0.3);
    noise(0.9, 0.4, "lowpass", 1800, 80);
    tone("sine", 50, 30, 1.8, 0.35, 0.1);
  }

  /** La antorcha se esta apagando (aviso unico). */
  static gutter(): void {
    noise(0.5, 0.08, "bandpass", 1600, 400, 0, 0, 2);
  }
}
