import { pitchAt, soundDuration, type SynthSound } from "./sounds";

/**
 * El "jurado": compara una toma de voz con la definicion del sonido de referencia.
 * Corre entero en el navegador de cada jugador (como la IA local del juego original),
 * y puntua lo que una garganta puede copiar — no el timbre:
 *
 *  - **golpes**: cuantos ataques tiene (ladrar una vez o tres).
 *  - **ritmo**: donde caen esos ataques y cuanto dura el total.
 *  - **melodia**: la forma del contorno de altura, independiente de la tonalidad
 *    (se le resta la mediana a cada contorno, asi un grave y un agudo que dibujan la
 *    misma curva empatan) y con un poco de tolerancia de tiempo (DTW con banda).
 *
 * Los sonidos sin altura (`m: null`, las palmas) solo puntuan golpes y ritmo.
 */

/** Salto entre cuadros de analisis. */
export const HOP_S = 0.02;
/** Ventana de cada cuadro: dos periodos de la voz mas grave que se busca. */
const WINDOW_S = 0.045;
const MIN_HZ = 70;
const MAX_HZ = 1100;
/** Umbral de YIN: mas bajo = mas exigente para declarar que hay altura. */
const YIN_THRESHOLD = 0.2;
/** Pico de RMS por debajo del cual la toma se considera silencio. */
const SILENCE_RMS = 0.012;
/** Puntos a los que se remuestrean los contornos para compararlos. */
const MELODY_POINTS = 40;
const DTW_BAND = 6;
/** Semitonos de salto entre dos cuadros que cuentan como nota nueva. */
const NOTE_JUMP = 2.5;
/** Desvio medio (semitonos) al que la melodia vale cero. */
const MELODY_ZERO_AT = 2.5;

export interface Frame {
  t: number;
  rms: number;
  midi: number | null;
}

export interface Features {
  silent: boolean;
  /** Ataques, en segundos, relativos al primero. */
  onsets: number[];
  /** Fin del ultimo sonido, relativo al primer ataque. */
  end: number;
  /** Altura (MIDI) cada `HOP_S`, desde el primer ataque hasta `end`. null = sin altura. */
  contour: (number | null)[];
}

export interface Breakdown {
  attacks: number;
  rhythm: number;
  melody: number;
  /** 0..100, lo que viaja al server como puntaje crudo. */
  raw: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---------- Cuadros ----------

/** Altura por YIN (diferencia normalizada acumulada). Devuelve Hz o null. */
function detectPitch(buf: Float32Array, start: number, size: number, rate: number): number | null {
  const minLag = Math.max(2, Math.floor(rate / MAX_HZ));
  const maxLag = Math.min(Math.floor(rate / MIN_HZ), Math.floor(size / 2));
  const w = size - maxLag;
  if (w <= minLag) return null;
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let d = 0;
    for (let j = 0; j < w; j++) {
      const diff = buf[start + j] - buf[start + j + tau];
      d += diff * diff;
    }
    running += d;
    cmnd[tau] = running > 0 ? (d * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Interpolacion parabolica alrededor del minimo.
  let better = tau;
  if (tau > 1 && tau < maxLag) {
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const den = a + c - 2 * b;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return rate / better;
}

/** Analiza un cuadro que arranca en `start`. */
export function analyzeFrame(buf: Float32Array, start: number, rate: number): Frame {
  const size = Math.round(WINDOW_S * rate);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const v = buf[start + i] ?? 0;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / size);
  let midi: number | null = null;
  if (rms > SILENCE_RMS * 0.5 && start + size <= buf.length) {
    const hz = detectPitch(buf, start, size, rate);
    if (hz !== null) midi = 69 + 12 * Math.log2(hz / 440);
  }
  return { t: start / rate, rms, midi };
}

export function windowSamples(rate: number): number {
  return Math.round(WINDOW_S * rate);
}

export function analyzeTake(samples: Float32Array, rate: number): Frame[] {
  const size = windowSamples(rate);
  const hop = Math.round(HOP_S * rate);
  const frames: Frame[] = [];
  for (let start = 0; start + size <= samples.length; start += hop) {
    frames.push(analyzeFrame(samples, start, rate));
  }
  return frames;
}

// ---------- Rasgos ----------

export function featuresFromSound(sound: SynthSound): Features {
  const end = soundDuration(sound);
  const onsets = sound.notes.map((n) => n.t).sort((a, b) => a - b);
  const contour: (number | null)[] = [];
  for (let t = 0; t <= end; t += HOP_S) contour.push(pitchAt(sound, t));
  return { silent: false, onsets, end, contour };
}

export function featuresFromFrames(frames: Frame[]): Features {
  const empty: Features = { silent: true, onsets: [], end: 0, contour: [] };
  if (frames.length === 0) return empty;
  const rms = frames.map((f) => f.rms);
  const peak = Math.max(...rms);
  if (peak < SILENCE_RMS) return empty;

  const floor = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.2)];
  const on = Math.max(floor * 3, peak * 0.2);
  const off = on * 0.6;

  // Segmentos con histeresis.
  let segs: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < rms.length; i++) {
    if (open < 0 && rms[i] > on) open = i;
    else if (open >= 0 && rms[i] < off) {
      segs.push([open, i]);
      open = -1;
    }
  }
  if (open >= 0) segs.push([open, rms.length]);

  // Junta huecos cortos y descarta chasquidos.
  const gap = Math.round(0.03 / HOP_S);
  const merged: [number, number][] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s[0] - last[1] <= gap) last[1] = s[1];
    else merged.push([s[0], s[1]]);
  }
  segs = merged.filter(([a, b]) => b - a >= Math.round(0.05 / HOP_S));
  if (segs.length === 0) return empty;

  // Ataques: el arranque de cada segmento, mas los re-ataques adentro de uno
  // ("ta-ta-ta" ligado no siempre baja del umbral entre silabas).
  const onsetIdx: number[] = [];
  const minSpacing = Math.round(0.1 / HOP_S);
  for (const [a, b] of segs) {
    onsetIdx.push(a);
    let maxSince = rms[a];
    let dipMin = Infinity;
    for (let i = a + 1; i < b; i++) {
      const v = rms[i];
      if (dipMin === Infinity) {
        maxSince = Math.max(maxSince, v);
        if (v < maxSince * 0.45) dipMin = v;
      } else {
        dipMin = Math.min(dipMin, v);
        if (v > dipMin * 2.2 && v > peak * 0.25 && i - onsetIdx[onsetIdx.length - 1] >= minSpacing) {
          onsetIdx.push(i);
          maxSince = v;
          dipMin = Infinity;
        }
      }
    }
  }

  // Y los cambios de nota sin silencio en el medio (una tirolesa, un "ta-taa" ligado):
  // un salto de altura sostenido tambien es un ataque.
  for (const [a, b] of segs) {
    for (let i = a + 2; i < b - 1; i++) {
      const p0 = frames[i - 2].midi;
      const p1 = frames[i - 1].midi;
      const p2 = frames[i].midi;
      const p3 = frames[i + 1].midi;
      if (p0 == null || p1 == null || p2 == null || p3 == null) continue;
      const jump = Math.abs(p2 - p1) > NOTE_JUMP && Math.abs(p3 - p0) > NOTE_JUMP && Math.abs(p1 - p0) < 1;
      if (!jump) continue;
      if (onsetIdx.some((o) => Math.abs(o - i) < minSpacing)) continue;
      onsetIdx.push(i);
    }
  }
  onsetIdx.sort((x, y) => x - y);

  const first = segs[0][0];
  const last = segs[segs.length - 1][1];
  const active = new Uint8Array(frames.length);
  for (const [a, b] of segs) active.fill(1, a, b);

  const contour: (number | null)[] = [];
  for (let i = first; i < last; i++) {
    if (!active[i]) {
      contour.push(null);
      continue;
    }
    // Mediana de 3 para matar los saltos de octava sueltos del detector.
    const around = [frames[i - 1]?.midi, frames[i].midi, frames[i + 1]?.midi].filter(
      (v): v is number => v != null,
    );
    contour.push(frames[i].midi == null ? null : median(around));
  }

  return {
    silent: false,
    onsets: onsetIdx.map((i) => (i - first) * HOP_S),
    end: (last - first) * HOP_S,
    contour,
  };
}

// ---------- Comparacion ----------

/** Remuestrea un contorno a `n` puntos sobre tiempo normalizado y lo centra en su mediana. */
export function normalizeContour(contour: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (contour.length === 0) return Array.from({ length: n }, () => null);
  for (let k = 0; k < n; k++) {
    const idx = Math.min(contour.length - 1, Math.round((k / (n - 1)) * (contour.length - 1)));
    out.push(contour[idx]);
  }
  const voiced = out.filter((v): v is number => v != null);
  const mid = median(voiced);
  return out.map((v) => {
    if (v == null) return null;
    let c = v - mid;
    // Un salto de octava del detector (o de la garganta) no es otra melodia.
    if (c > 9) c -= 12;
    else if (c < -9) c += 12;
    return c;
  });
}

function melodyScore(ref: Features, take: Features): number {
  const a = normalizeContour(ref.contour, MELODY_POINTS);
  const b = normalizeContour(take.contour, MELODY_POINTS);
  if (!b.some((v) => v != null)) return 0;
  const cost = (x: number | null, y: number | null): number => {
    if (x == null && y == null) return 0;
    if (x == null || y == null) return 2.5;
    return Math.min(7, Math.abs(x - y));
  };
  const n = MELODY_POINTS;
  const D: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - DTW_BAND); j <= Math.min(n - 1, i + DTW_BAND); j++) {
      const c = cost(a[i], b[j]);
      if (i === 0 && j === 0) D[i][j] = c;
      else {
        const prev = Math.min(
          i > 0 ? D[i - 1][j] : Infinity,
          j > 0 ? D[i][j - 1] : Infinity,
          i > 0 && j > 0 ? D[i - 1][j - 1] : Infinity,
        );
        D[i][j] = c + prev;
      }
    }
  }
  const mean = D[n - 1][n - 1] / n;
  return clamp01(1 - mean / MELODY_ZERO_AT);
}

function rhythmScore(ref: Features, take: Features): number {
  const ratio = take.end / Math.max(0.05, ref.end);
  const tempo = clamp01(1 - Math.abs(Math.log(Math.max(0.01, ratio))) / Math.log(2.2));
  if (ref.onsets.length <= 1) return tempo;
  // Se estira la toma al largo de la referencia: importa donde caen los golpes, no
  // si se canto un poco mas lento.
  const scale = take.end > 0 ? ref.end / take.end : 1;
  const scaled = take.onsets.map((t) => t * scale);
  let err = 0;
  for (const t of ref.onsets) {
    let best = Infinity;
    for (const u of scaled) best = Math.min(best, Math.abs(u - t));
    err += best / ref.end;
  }
  const timing = clamp01(1 - err / ref.onsets.length / 0.12);
  return 0.65 * timing + 0.35 * tempo;
}

export function scoreTake(ref: Features, take: Features): Breakdown {
  if (take.silent) return { attacks: 0, rhythm: 0, melody: 0, raw: 0 };
  const nRef = ref.onsets.length;
  const attacks = clamp01(1 - Math.abs(take.onsets.length - nRef) / Math.max(2, nRef));
  const rhythm = rhythmScore(ref, take);
  const pitched = ref.contour.filter((v) => v != null).length >= 3;
  const melody = pitched ? melodyScore(ref, take) : 0;
  const total = pitched ? 0.25 * attacks + 0.3 * rhythm + 0.45 * melody : 0.5 * attacks + 0.5 * rhythm;
  return { attacks, rhythm, melody, raw: Math.round(100 * clamp01(total)) };
}
