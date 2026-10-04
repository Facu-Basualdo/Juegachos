import { EDGE, FAKE_DUR, FAKE_GAP, FAKE_MIN_T, FAKE_RATE, GROWTH, MAX_CRASH, warnFor } from "./constants";

/** PRNG con semilla (mulberry32): el mismo vuelo en todos los clientes de la sala. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash de texto a semilla (FNV-1a). */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Multiplicador a los `t` segundos de vuelo (forma cerrada, sin integrar nada). */
export function multAt(t: number): number {
  return Math.exp(GROWTH * Math.max(0, t));
}

/** Segundos de vuelo para llegar a `m`. */
export function timeAt(m: number): number {
  return Math.log(Math.max(1, m)) / GROWTH;
}

export interface Cough {
  /** Cuando empieza (s de vuelo). */
  t: number;
  /** Cuanto dura (s). La real dura hasta la explosion. */
  dur: number;
  /** true = humo negro, explota al terminar. false = amague de humo blanco. */
  real: boolean;
}

/**
 * Un vuelo, decidido entero al despegar: donde explota y cuando tose. Determinista
 * por semilla (nada de `Math.random()` adentro), asi todos los clientes de la sala
 * ven exactamente el mismo cohete.
 */
export class Flight {
  /** Multiplicador al que explota (1.00 = en la plataforma). */
  readonly crash: number;
  /** Segundos de vuelo hasta la explosion. */
  readonly crashT: number;
  /** Toses ordenadas por tiempo: los amagues y, si hay, el aviso real al final. */
  readonly coughs: Cough[];

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const u = rand();
    // Inversa de la cola: P(C >= x) = EDGE / x. Redondeado hacia abajo a centesimos,
    // como lo muestra el cartel, para que "exploto en x2.37" sea literal.
    const raw = EDGE / Math.max(1e-9, 1 - u);
    this.crash = raw < 1 ? 1 : Math.min(MAX_CRASH, Math.floor(raw * 100) / 100);
    this.crashT = timeAt(this.crash);

    this.coughs = [];
    const warn = warnFor(this.crash);
    const realT = this.crashT - warn;
    // Amagues: proceso de Poisson sobre el vuelo, lejos del despegue y del aviso real.
    const end = realT - FAKE_GAP;
    let t = FAKE_MIN_T + -Math.log(1 - rand()) / FAKE_RATE;
    while (t + FAKE_DUR < end) {
      this.coughs.push({ t, dur: FAKE_DUR, real: false });
      t += FAKE_DUR + -Math.log(1 - rand()) / FAKE_RATE;
    }
    // Sin tiempo para avisar (explota al despegar o casi) no hay aviso: es la falla de encendido.
    if (this.crash > 1 && realT > 0.15) this.coughs.push({ t: realT, dur: warn, real: true });
  }

  /** Tos en curso a los `t` s, con su avance 0-1; null si el motor anda bien. */
  coughAt(t: number): { cough: Cough; k: number } | null {
    for (const c of this.coughs) {
      if (t >= c.t && t < c.t + c.dur) return { cough: c, k: (t - c.t) / c.dur };
    }
    return null;
  }
}
