import { analyzeFrame, windowSamples, type Frame } from "./analysis";
import { getAudio } from "./audio";
import { TAKE_TARGET_RATE } from "./constants";

/**
 * Grabadora del microfono. Baja la señal a ~11 kHz a medida que llega (la voz sobra
 * con eso y la toma pesa poco) y analiza un cuadro por bloque para dibujar en vivo
 * la altura que se esta cantando.
 *
 * Usa `ScriptProcessorNode` y no `MediaRecorder` a proposito: las tomas viajan a
 * todos como PCM crudo (mu-law, ver abajo), que cualquier navegador reproduce. Con
 * `MediaRecorder` Safari graba mp4 y Firefox webm, y no todos decodifican lo del otro.
 */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private length = 0;
  private factor = 1;
  private recording = false;
  private onFrame: ((f: Frame) => void) | null = null;
  private tail = new Float32Array(0);
  /** RMS del ultimo bloque del micro (para el vumetro). */
  level = 0;
  rate = TAKE_TARGET_RATE;

  /** Pide el micro. Devuelve false si no hay permiso o no hay micro. */
  async init(): Promise<boolean> {
    if (this.stream) return true;
    const a = getAudio();
    if (!a || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Sin supresion de ruido: se come los sonidos sostenidos y aplana la altura.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      return false;
    }
    const { ctx } = a;
    this.factor = downsampleFactor(ctx.sampleRate);
    this.rate = ctx.sampleRate / this.factor;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.processor = ctx.createScriptProcessor(2048, 1, 1);
    // El processor solo corre si esta conectado a la salida: se lo cuelga de una
    // ganancia en cero para que el micro no se escuche por los parlantes.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.sink).connect(ctx.destination);
    this.processor.onaudioprocess = (e) => this.onBlock(e.inputBuffer.getChannelData(0));
    return true;
  }

  get ready(): boolean {
    return this.stream !== null;
  }

  start(onFrame: (f: Frame) => void): void {
    this.chunks = [];
    this.length = 0;
    this.tail = new Float32Array(0);
    this.onFrame = onFrame;
    this.recording = true;
  }

  stop(): Float32Array {
    this.recording = false;
    this.onFrame = null;
    const out = new Float32Array(this.length);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  private onBlock(input: Float32Array): void {
    const down = downsample(input, this.factor);
    const n = down.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += down[i] * down[i];
    this.level = Math.sqrt(sum / Math.max(1, n));
    if (!this.recording) return;
    this.chunks.push(down);
    this.length += n;

    // Cuadro en vivo sobre el final de lo grabado (bloque actual + cola del anterior).
    const size = windowSamples(this.rate);
    const joined = new Float32Array(this.tail.length + down.length);
    joined.set(this.tail);
    joined.set(down, this.tail.length);
    if (joined.length >= size) {
      const frame = analyzeFrame(joined, joined.length - size, this.rate);
      frame.t = this.length / this.rate;
      this.onFrame?.(frame);
    }
    this.tail = joined.slice(Math.max(0, joined.length - size));
  }
}

/** Factor entero para bajar `rate` a ~`TAKE_TARGET_RATE`. */
export function downsampleFactor(rate: number): number {
  return Math.max(1, Math.round(rate / TAKE_TARGET_RATE));
}

/** Promedio de a `factor` muestras = bajar la tasa con un filtro pasabajos tosco. */
export function downsample(input: Float32Array, factor: number): Float32Array {
  const n = Math.floor(input.length / factor);
  const down = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < factor; k++) acc += input[i * factor + k];
    down[i] = acc / factor;
  }
  return down;
}

// ---------- Recorte y codec ----------

/**
 * Saca el silencio de las puntas (deja un margen), para que la reproduccion en la
 * ronda no tenga dos segundos muertos antes de que la persona abra la boca.
 */
export function trimSilence(pcm: Float32Array, rate: number): Float32Array {
  const block = Math.round(rate * 0.02);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 0.02) return pcm.slice(0, Math.min(pcm.length, Math.round(rate * 0.5)));
  const thr = peak * 0.1;
  let start = 0;
  let end = pcm.length;
  const loud = (from: number): boolean => {
    for (let i = from; i < Math.min(pcm.length, from + block); i++) if (Math.abs(pcm[i]) > thr) return true;
    return false;
  };
  while (start < pcm.length && !loud(start)) start += block;
  while (end > start && !loud(end - block)) end -= block;
  const margin = Math.round(rate * 0.12);
  return pcm.slice(Math.max(0, start - margin), Math.min(pcm.length, end + margin));
}

/** Normaliza el volumen para que todas las tomas suenen parecido en la ronda. */
export function normalizeGain(pcm: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-4) return pcm;
  const g = Math.min(8, 0.9 / peak);
  return pcm.map((v) => v * g);
}

const MU = 255;

/** PCM float -> mu-law de 8 bits: la mitad de bytes que 16 bits y suena a telefono, que acá suma. */
export function muLawEncode(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    const y = (Math.sign(x) * Math.log1p(MU * Math.abs(x))) / Math.log1p(MU);
    out[i] = Math.round(((y + 1) / 2) * 255);
  }
  return out;
}

export function muLawDecode(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const y = (bytes[i] / 255) * 2 - 1;
    out[i] = (Math.sign(y) * (Math.pow(1 + MU, Math.abs(y)) - 1)) / MU;
  }
  return out;
}
