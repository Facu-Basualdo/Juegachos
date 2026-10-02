/**
 * Sonido de Poolnight, sintetizado con Web Audio (sin assets). Pensado para que suene a un salon
 * de noche y no a un videojuego de los 80:
 *
 *  - Cada golpe es una suma de PARCIALES que se apagan rapido (como una bola de resina o la
 *    madera de un taco), no una rafaga de ruido ni un bip. Los parciales no son multiplos
 *    exactos, que es lo que da el "tac" de material y no de nota.
 *  - Todo entra con un ataque de unos milisegundos: nada arranca de golpe (ahi esta el "click" feo).
 *  - Pasa por un filtro pasa-bajos suave, un compresor y una reverberacion corta de salon, asi
 *    ningun sonido raspa y todos comparten el mismo espacio.
 *  - El volumen de un choque crece con la RAIZ de la velocidad de impacto (el server la manda en
 *    cada evento): un roce suena a roce y la rotura suena a rotura sin que el medio sea un grito.
 *
 * `SoundEngine` recibe cualquier `BaseAudioContext`, asi se puede renderizar sin conexion y medir
 * (picos, ataque) sin escuchar; `SoundEffects` es la fachada que usa el juego.
 */

/** Una voz de parciales: frecuencia relativa, volumen relativo y cuanto dura (s). */
interface Partial {
  ratio: number;
  gain: number;
  decay: number;
}

export class SoundEngine {
  private readonly c: BaseAudioContext;
  /** Donde entran todas las voces. */
  private readonly bus: GainNode;
  private noise: AudioBuffer | null = null;
  /** Cuando sono cada choque reciente: en la rotura caen decenas juntos y no se pueden sumar tal cual. */
  private recent: number[] = [];
  /** El volumen del rodado (ver `rolling`). */
  private roll: GainNode | null = null;

  constructor(context: BaseAudioContext) {
    this.c = context;
    const bus = context.createGain();
    this.bus = bus;

    // Un pasa-bajos suave le saca lo aspero a todo. Despues del volumen va un compresor (que asi
    // actua sobre el nivel FINAL) y un recorte suave (tanh): si una rotura junta muchos choques,
    // se redondea en vez de saturar.
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 6200;
    tone.Q.value = 0.5;
    const master = context.createGain();
    master.gain.value = 2.3;
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const soft = context.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 2 * 1.6 - 1.6) / Math.tanh(1.6) * 0.95;
    soft.curve = curve;

    // Reverberacion corta (un salon con madera): la respuesta es ruido que se apaga y se opaca.
    const convolver = context.createConvolver();
    convolver.buffer = this.impulse(1.0, 4.6);
    const send = context.createGain();
    send.gain.value = 0.2;
    const wet = context.createGain();
    wet.gain.value = 0.9;

    bus.connect(tone);
    bus.connect(send).connect(convolver).connect(wet).connect(tone);
    tone.connect(master).connect(comp).connect(soft).connect(context.destination);
  }

  // ------------------------------------------------------------ piezas

  private impulse(seconds: number, decayRate: number): AudioBuffer {
    const rate = this.c.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        // Ruido filtrado (una sola polo) para que la cola sea opaca, no un siseo.
        lp += (Math.random() * 2 - 1 - lp) * 0.35;
        d[i] = lp * Math.exp(-t * decayRate) * (1 - Math.exp(-t * 90));
      }
    }
    return buf;
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const rate = this.c.sampleRate;
      const buf = this.c.createBuffer(1, Math.floor(rate * 2), rate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }

  /** Un parcial: seno con ataque corto y caida exponencial. */
  private partial(freq: number, peak: number, decay: number, delay: number, type: OscillatorType = "sine"): void {
    const t = this.c.currentTime + delay;
    const o = this.c.createOscillator();
    const g = this.c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.003 + decay);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** Un deslizamiento de frecuencia (el "thump" grave de una banda, el "plop" de la tronera). */
  private glide(f0: number, f1: number, peak: number, decay: number, delay: number): void {
    const t = this.c.currentTime + delay;
    const o = this.c.createOscillator();
    const g = this.c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + decay);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** Un soplido de ruido filtrado (el fieltro, el roce): suave, nunca un siseo. */
  private soft(cutoff: number, peak: number, decay: number, delay: number, type: BiquadFilterType = "lowpass", q = 0.7, attack = 0.006): void {
    const t = this.c.currentTime + delay;
    const s = this.c.createBufferSource();
    s.buffer = this.noiseBuffer();
    const f = this.c.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    f.Q.value = q;
    const g = this.c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random() * 1.5);
    s.stop(t + decay + 0.05);
  }

  /**
   * Cuantos choques hubo en los ultimos 90 ms: el volumen de cada uno se reparte (1/raiz) y a partir de
   * cierto punto los mas flojos se descartan. Devuelve 0 para saltear este choque.
   */
  private crowd(level: number): number {
    const now = this.c.currentTime;
    this.recent = this.recent.filter((t) => now - t < 0.09);
    const n = this.recent.length;
    if (n >= 14 && level < 0.6) return 0;
    this.recent.push(now);
    return 1 / Math.sqrt(1 + n * 0.45);
  }

  private voice(base: number, parts: Partial[], level: number, delay = 0): void {
    for (const p of parts) this.partial(base * p.ratio, level * p.gain, p.decay, delay);
  }

  // ------------------------------------------------------------ efectos

  /**
   * Bola contra bola: el "clack" de la resina fenolica. Es sobre todo un transitorio brillante y
   * cortisimo (ruido en la banda de 2 a 5 kHz, ~14 ms) con un timbre inarmonico que se apaga en 20-30 ms.
   * No tiene que sonar a nota: la version anterior, con parciales largos y graves, sonaba a marimba.
   */
  ball(speed: number): void {
    const v = Math.sqrt(Math.min(1, speed / 4.5));
    if (v < 0.03) return;
    const k = this.crowd(v);
    if (k === 0) return;
    const lvl = (0.05 + 0.2 * v) * k;
    const d = 0.96 + Math.random() * 0.08;
    this.soft(3300 * d, lvl * 0.9, 0.014, 0, "bandpass", 1.1, 0.0012);
    this.voice(
      2150 * d,
      [
        { ratio: 1, gain: 1, decay: 0.028 },
        { ratio: 1.34, gain: 0.6, decay: 0.02 },
        { ratio: 1.69, gain: 0.35, decay: 0.013 },
      ],
      lvl * 0.55,
    );
    this.glide(620 * d, 430, lvl * 0.35, 0.022, 0);
  }

  /** Bola contra banda: un golpe sordo, amortiguado por la goma y el fieltro, con un roce de paño. */
  cushion(speed: number): void {
    const v = Math.sqrt(Math.min(1, speed / 3.5));
    if (v < 0.05) return;
    const k = this.crowd(v);
    if (k === 0) return;
    const lvl = (0.03 + 0.18 * v) * k;
    this.glide(170, 78, lvl, 0.085, 0);
    this.soft(900, lvl * 0.45, 0.045, 0);
    this.soft(1500, lvl * 0.18, 0.01, 0, "bandpass", 1.4, 0.002);
  }

  /** La bola cae a la tronera: el golpe contra la boca y despues el asentarse en el cuero de la bolsa. */
  pocket(): void {
    this.glide(430, 180, 0.075, 0.06, 0);
    this.soft(1000, 0.04, 0.03, 0, "bandpass", 1.0, 0.002);
    this.glide(150, 70, 0.08, 0.13, 0.09);
    this.soft(320, 0.035, 0.28, 0.1);
  }

  /** El taco contra la blanca: el golpe seco de la suela de cuero, mas grave y mas corto que el de dos bolas. */
  cue(speed: number): void {
    const v = Math.sqrt(Math.min(1, speed / 7));
    const lvl = 0.04 + 0.16 * v;
    this.soft(1800, lvl * 0.7, 0.011, 0, "bandpass", 1.5, 0.0015);
    this.glide(980, 720, lvl * 0.5, 0.018, 0);
    this.glide(320, 240, lvl * 0.4, 0.03, 0);
  }

  /**
   * El murmullo de las bolas rodando sobre el paño: un ruido grave y suave cuyo volumen sigue la
   * suma de las velocidades de lo que se mueve (el juego lo llama cada cuadro). Con todo quieto
   * se apaga solo; la fuente queda andando en silencio, no se crea una por tiro.
   */
  rolling(speedSum: number): void {
    if (!this.roll) {
      const src = this.c.createBufferSource();
      src.buffer = this.noiseBuffer();
      src.loop = true;
      const low = this.c.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 260;
      low.Q.value = 0.7;
      const high = this.c.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 60;
      const g = this.c.createGain();
      g.gain.value = 0;
      src.connect(low).connect(high).connect(g).connect(this.bus);
      src.start();
      this.roll = g;
    }
    const target = Math.min(0.09, 0.03 * Math.sqrt(Math.max(0, speedSum)));
    this.roll.gain.setTargetAtTime(target, this.c.currentTime, 0.08);
  }

  /** La cuenta 3 / 2 / 1: una nota suave; el "YA" es mas alto y dura un poco mas. */
  tick(final: boolean): void {
    const f = final ? 880 : 660;
    this.voice(f, [{ ratio: 1, gain: 1, decay: final ? 0.3 : 0.17 }, { ratio: 2, gain: 0.18, decay: 0.12 }], final ? 0.2 : 0.16);
  }

  /** Falta: dos notas graves que bajan, como un "ay" amable. */
  foul(): void {
    this.voice(247, [{ ratio: 1, gain: 1, decay: 0.26 }, { ratio: 2, gain: 0.15, decay: 0.12 }], 0.07, 0);
    this.voice(196, [{ ratio: 1, gain: 1, decay: 0.34 }, { ratio: 2, gain: 0.12, decay: 0.14 }], 0.07, 0.13);
  }

  /** Ganar: cuatro notas de marimba que suben. */
  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.voice(f, [{ ratio: 1, gain: 1, decay: 0.55 }, { ratio: 3.9, gain: 0.16, decay: 0.12 }], 0.062, i * 0.12);
    });
  }

  /** Perder: tres notas que bajan, suaves. */
  lose(): void {
    [440, 349.23, 293.66].forEach((f, i) => {
      this.voice(f, [{ ratio: 1, gain: 1, decay: 0.6 }, { ratio: 2, gain: 0.14, decay: 0.2 }], 0.052, i * 0.17);
    });
  }
}

// ---------------------------------------------------------------- la fachada que usa el juego

let ctx: AudioContext | null = null;
let engine: SoundEngine | null = null;
let unlocked = false;

/**
 * Chrome no deja arrancar audio sin un gesto del usuario, y avisa en la consola cada vez que se
 * lo intenta. En sala nadie toca nada antes de la rotura, asi que hasta el primer clic o tecla
 * los sonidos se saltean en silencio.
 */
function unlock(): void {
  unlocked = true;
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
}
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

function eng(): SoundEngine | null {
  if (!unlocked) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      engine = new SoundEngine(ctx);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return engine;
  } catch {
    return null;
  }
}

export class SoundEffects {
  static playCountdownTick(final = false): void {
    eng()?.tick(final);
  }
  static playBall(speed: number): void {
    eng()?.ball(speed);
  }
  static playCushion(speed: number): void {
    eng()?.cushion(speed);
  }
  static playPocket(): void {
    eng()?.pocket();
  }
  static playCue(speed: number): void {
    eng()?.cue(speed);
  }
  static playFoul(): void {
    eng()?.foul();
  }
  static playWin(): void {
    eng()?.win();
  }
  static playLose(): void {
    eng()?.lose();
  }
  /** Suma de las velocidades de las bolas que ruedan (m/s); 0 lo apaga. */
  static setRolling(speedSum: number): void {
    eng()?.rolling(speedSum);
  }
}
