import { EDGE, GROWTH, MAX_CRASH } from "./constants";

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

/**
 * Un vuelo, decidido entero al despegar: donde explota. Determinista por semilla
 * (nada de `Math.random()` adentro), asi todos los clientes de la sala ven
 * exactamente el mismo cohete. No avisa: explota de la nada.
 */
export class Flight {
  /** Multiplicador al que explota (1.00 = en la plataforma). */
  readonly crash: number;
  /** Segundos de vuelo hasta la explosion. */
  readonly crashT: number;

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const u = rand();
    // Inversa de la cola: P(C >= x) = EDGE / x. Redondeado hacia abajo a centesimos,
    // como lo muestra el cartel, para que "exploto en x2.37" sea literal.
    const raw = EDGE / Math.max(1e-9, 1 - u);
    this.crash = raw < 1 ? 1 : Math.min(MAX_CRASH, Math.floor(raw * 100) / 100);
    this.crashT = timeAt(this.crash);
  }
}
