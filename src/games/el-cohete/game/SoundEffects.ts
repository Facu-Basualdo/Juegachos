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

function out(): AudioNode | null {
  return ctx() ? master : null;
}

function env(g: GainNode, t: number, a: number, peak: number, d: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0): void {
  const c = ctx();
  const o = out();
  if (!c || !o) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, 0.005, vol, dur);
  osc.connect(g).connect(o);
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

function noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, at = 0, q = 1): void {
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
  src.connect(f).connect(g).connect(o);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

/** Campanita de caja registradora (parciales inarmonicos que decaen). */
function bell(freq: number, at: number, vol: number): void {
  for (const [k, v] of [
    [1, 1],
    [2.76, 0.4],
    [5.4, 0.2],
  ]) {
    tone("sine", freq * k, freq * k, 0.9 / k + 0.2, vol * v, at);
  }
}

interface Engine {
  osc: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  src: AudioBufferSourceNode;
}

/**
 * Sonido de El Cohete: todo sintetizado. El motor es un loop continuo (ruido filtrado
 * mas una sierra grave) que sube de tono con el multiplicador; las toses lo cortan.
 */
export class SoundEffects {
  private static engine: Engine | null = null;

  static playCountdownTick(): void {
    tone("sine", 750, 750, 0.05, 0.08);
  }

  static unlock(): void {
    ctx();
  }

  /** Ficha que se suma a la apuesta. */
  static chip(): void {
    noise(0.03, 0.12, "highpass", 4200, 2600, 0, 1);
    tone("triangle", 2300, 1900, 0.04, 0.03);
  }

  /** La apuesta va a la mesa: dos fichas que caen sobre la pila. */
  static betPlaced(): void {
    noise(0.04, 0.16, "bandpass", 3000, 2200, 0, 3);
    noise(0.04, 0.12, "bandpass", 3400, 2400, 0.07, 3);
    tone("sine", 520, 780, 0.12, 0.05, 0.05);
  }

  /** Ultimos segundos de la ventana de apuestas. */
  static betTick(): void {
    tone("square", 1200, 1200, 0.03, 0.025);
  }

  /** Encendido en la plataforma y despegue. */
  static launch(): void {
    noise(1.4, 0.3, "lowpass", 300, 2400);
    tone("sine", 60, 40, 1.2, 0.3);
  }

  static startEngine(): void {
    const c = ctx();
    const o = out();
    if (!c || !o || this.engine) return;
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.16, c.currentTime + 0.4);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;
    filter.Q.value = 2;
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 70;
    const og = c.createGain();
    og.gain.value = 0.12;
    const sub = c.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 42;
    const sg = c.createGain();
    sg.gain.value = 0.5;
    src.connect(filter);
    osc.connect(og).connect(filter);
    filter.connect(gain);
    sub.connect(sg).connect(gain);
    gain.connect(o);
    src.start();
    osc.start();
    sub.start();
    this.engine = { osc, sub, filter, gain, src };
  }

  /** Cada cuadro: multiplicador (tono) y potencia 0-1 (las toses cortan el motor). */
  static setEngine(mult: number, power: number): void {
    const e = this.engine;
    const c = actx;
    if (!e || !c) return;
    const t = c.currentTime;
    const k = Math.log(Math.max(1, mult));
    e.osc.frequency.setTargetAtTime(70 + k * 60, t, 0.05);
    e.sub.frequency.setTargetAtTime(42 + k * 18, t, 0.05);
    e.filter.frequency.setTargetAtTime(480 + k * 900 + power * 300, t, 0.03);
    e.gain.gain.setTargetAtTime(0.05 + 0.13 * power, t, 0.02);
  }

  static stopEngine(fast = false): void {
    const e = this.engine;
    const c = actx;
    this.engine = null;
    if (!e || !c) return;
    e.gain.gain.cancelScheduledValues(c.currentTime);
    e.gain.gain.setTargetAtTime(0, c.currentTime, fast ? 0.01 : 0.15);
    window.setTimeout(() => {
      e.src.stop();
      e.osc.stop();
      e.sub.stop();
    }, fast ? 100 : 700);
  }

  /** Amague: un "puf" limpio de vapor. */
  static coughFake(): void {
    noise(0.22, 0.26, "bandpass", 1400, 600, 0, 1.5);
    tone("sine", 180, 120, 0.12, 0.08);
  }

  /** Tos de verdad: petardeo grave a los tirones, sin pausa. */
  static coughReal(): void {
    for (let i = 0; i < 4; i++) {
      noise(0.07, 0.34, "lowpass", 700, 150, i * 0.09, 2);
      tone("square", 75, 50, 0.06, 0.06, i * 0.09);
    }
  }

  /** Bajarse: caja registradora. */
  static cashOut(big: boolean): void {
    noise(0.05, 0.2, "highpass", 5000, 3000);
    bell(1318.5, 0.02, 0.12);
    bell(1760, 0.1, 0.1);
    if (big) bell(2637, 0.18, 0.08);
    for (let i = 0; i < (big ? 9 : 5); i++) noise(0.025, 0.06, "bandpass", 6000 + Math.random() * 3000, 5000, 0.2 + i * 0.05 + Math.random() * 0.03, 6);
  }

  /** Otro jugador salta (mas bajito que el propio). */
  static rivalJump(): void {
    bell(1568, 0, 0.04);
  }

  static boom(): void {
    noise(1.8, 0.7, "lowpass", 2400, 60);
    noise(0.25, 0.5, "highpass", 1200, 300);
    tone("sine", 70, 28, 1.6, 0.55);
    tone("sawtooth", 110, 40, 0.5, 0.12);
  }

  /** Final de la partida: arpegio de tragamonedas (gano) o tres notas que caen (perdio). */
  static jackpot(won: boolean): void {
    const notes = won ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [392, 349.23, 293.66];
    notes.forEach((f, i) => tone(won ? "square" : "triangle", f, f, won ? 0.14 : 0.3, won ? 0.05 : 0.08, i * (won ? 0.09 : 0.22)));
    if (won) for (let i = 0; i < 12; i++) noise(0.025, 0.05, "bandpass", 6500, 5200, 0.45 + i * 0.06, 6);
  }
}
