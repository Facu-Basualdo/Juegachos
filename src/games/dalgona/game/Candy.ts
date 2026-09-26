import {
  BIN_LEN,
  CARVE_STILL_TIME,
  DRY_RATE,
  DWELL_GRACE,
  FRAGILE_THIN,
  FRAGILE_TURN,
  K_DWELL,
  K_INSIDE,
  K_OUTSIDE,
  K_SPEED,
  LICK_DECAY_MULT,
  LICK_RATE,
  OUTSIDE_REACH,
  PASS_DEPTH,
  SAMPLE_STEP,
  SPEED_SMOOTH,
  STRESS_DECAY,
  THIN_BELOW,
  V_SAFE,
  WET_RELIEF,
} from "./constants";
import type { ShapeDef } from "./shapes";

/** Lo que el jugador hace este cuadro, en coordenadas de galleta (radio 1). */
export interface NeedleInput {
  pressed: boolean;
  x: number;
  y: number;
  licking: boolean;
  /** Tolerancia de tallado en radios (TOL_CARVE, o mas si la galleta se ve chica). */
  tol: number;
}

export interface CandyEvents {
  /** Cuanto se tallo este cuadro (para el sonido del raspado). */
  carved: number;
  /** El tramo que se rompio, o -1. */
  broke: number;
  /** Se cortaron todos los tramos: la figura sale. */
  done: boolean;
}

/**
 * La galleta: el metodo de simulacion aprobado por el programador (ver CLAUDE.md).
 * NO hay fisica de cuerpos rigidos ni azar en el bucle: el contorno estampado se
 * divide en tramos de `BIN_LEN` y cada tramo lleva dos numeros.
 *
 *  - `carve` (0-1): cuanto se tallo. La aguja talla mientras esta a `TOL_CARVE` de la
 *    linea: cada pasada completa por un tramo le suma `PASS_DEPTH` (tres pasadas lo
 *    cortan), y quedarse quieto encima talla despacio (`CARVE_STILL_TIME`). Como se talla
 *    por largo recorrido, ir mas rapido termina antes, pero cruje.
 *  - `stress` (0-1): cuanto cruje. Sube por velocidad (el cuadrado del exceso sobre
 *    `V_SAFE`, repartido por largo recorrido), por apretar fuera de la linea (mucho mas
 *    del lado de ADENTRO de la figura, que es la que hay que salvar) y por quedarse
 *    quieto apretando el mismo tramo. Baja sola con el tiempo. Un tramo que llega a 1
 *    se raja y la partida se pierde.
 *
 * Toda la tension que entra en un tramo se multiplica por su fragilidad, calculada una
 * sola vez por la geometria: los tramos angostos (el mango del paraguas, las puntas de
 * la estrella) y las esquinas se rompen antes. Lamer (el truco de la serie) moja la
 * galleta: mientras esta humeda la tension entra con menos fuerza y se descarga mas
 * rapido, pero lamiendo no se puede tallar.
 */
export class Candy {
  readonly shape: ShapeDef;
  /** Contorno remuestreado cada `SAMPLE_STEP`. */
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  /** Largo acumulado hasta cada muestra. */
  readonly ss: Float32Array;
  readonly length: number;
  readonly binCount: number;
  /** Muestra inicial de cada tramo (el tramo i va de binStart[i] a binStart[i + 1]). */
  readonly binStart: Int32Array;
  readonly fragility: Float32Array;
  readonly carve: Float32Array;
  readonly stress: Float32Array;
  /** Grietitas de aviso de cada tramo (fijas, sembradas): dos trazos cortos. */
  readonly warnCracks: [number, number][][][];
  /** La grieta que rompio la galleta (vacia mientras esta entera). */
  crack: [number, number][][] = [];

  wet = 0;
  broken = -1;
  done = false;

  private prevX = 0;
  private prevY = 0;
  private prevS = -1;
  private hadPrev = false;
  private dwell = 0;
  private dwellBin = -1;
  /** Velocidad de la aguja suavizada (ver `SPEED_SMOOTH`). */
  private speed = 0;

  constructor(shape: ShapeDef, seed: number) {
    this.shape = shape;
    const { xs, ys, ss, length } = resample(shape.outline, SAMPLE_STEP);
    this.sx = xs;
    this.sy = ys;
    this.ss = ss;
    this.length = length;
    const n = xs.length;
    this.binCount = Math.max(12, Math.round(length / BIN_LEN));
    this.binStart = new Int32Array(this.binCount + 1);
    for (let b = 0, i = 0; b <= this.binCount; b++) {
      const at = (b / this.binCount) * length;
      while (i < n && ss[i] < at) i++;
      this.binStart[b] = Math.min(i, n);
    }
    this.fragility = this.computeFragility();
    this.carve = new Float32Array(this.binCount);
    this.stress = new Float32Array(this.binCount);
    const rand = mulberry32(seed);
    this.warnCracks = [];
    for (let b = 0; b < this.binCount; b++) {
      const i = this.midSample(b);
      const [nx, ny] = this.normalAt(i);
      const lines: [number, number][][] = [];
      for (const side of [1, -1]) {
        lines.push(jagged(xs[i], ys[i], nx * side, ny * side, 0.035 + rand() * 0.04, rand, 0.5));
      }
      this.warnCracks.push(lines);
    }
  }

  binOfSample(i: number): number {
    return Math.min(this.binCount - 1, Math.floor((this.ss[i] / this.length) * this.binCount));
  }

  midSample(b: number): number {
    return Math.min(this.sx.length - 1, (this.binStart[b] + this.binStart[b + 1]) >> 1);
  }

  /** Avance del tallado, 0-1. */
  get progress(): number {
    let sum = 0;
    for (let b = 0; b < this.binCount; b++) sum += Math.min(1, this.carve[b]);
    return sum / this.binCount;
  }

  /** La tension mas alta de la galleta, 0-1. */
  get maxStress(): number {
    let m = 0;
    for (let b = 0; b < this.binCount; b++) m = Math.max(m, this.stress[b]);
    return m;
  }

  update(dt: number, input: NeedleInput): CandyEvents {
    const events: CandyEvents = { carved: 0, broke: -1, done: false };
    if (this.broken >= 0 || this.done) return events;

    this.wet = input.licking ? Math.min(1, this.wet + LICK_RATE * dt) : Math.max(0, this.wet - DRY_RATE * dt);
    const decay = STRESS_DECAY * (input.licking ? LICK_DECAY_MULT : 1) * dt;
    for (let b = 0; b < this.binCount; b++) this.stress[b] = Math.max(0, this.stress[b] - decay);

    if (!input.pressed || input.licking) {
      this.hadPrev = false;
      this.prevS = -1;
      this.dwell = 0;
      this.speed = 0;
      return events;
    }

    const relief = 1 - WET_RELIEF * this.wet;
    const { index, dist } = this.nearest(input.x, input.y);
    const s = this.ss[index];
    const bin = this.binOfSample(index);
    // La velocidad se promedia (~0.1 s): los eventos del puntero llegan a tirones y la
    // instantanea de un cuadro a otro puede triplicar la real sin que el jugador apure.
    const moved = this.hadPrev ? Math.hypot(input.x - this.prevX, input.y - this.prevY) : 0;
    if (dt > 0) this.speed += (moved / dt - this.speed) * (1 - Math.exp(-dt / SPEED_SMOOTH));
    const speed = this.speed;
    const tol = input.tol;
    const reach = dist <= tol * OUTSIDE_REACH;

    if (dist <= tol) {
      // Tramos cruzados desde el cuadro anterior (con la vuelta del contorno cerrado).
      const bins = this.prevS >= 0 ? this.crossed(this.prevS, s) : [bin];
      const ds = this.prevS >= 0 ? Math.abs(wrap(s - this.prevS, this.length)) : 0;
      const quality = 1 - 0.5 * (dist / tol) ** 2;
      const carveEach = (quality * (PASS_DEPTH * (ds / BIN_LEN) + dt / CARVE_STILL_TIME)) / bins.length;
      const excess = Math.max(0, speed / V_SAFE - 1);
      const stressEach = (K_SPEED * excess * excess * (ds / BIN_LEN)) / bins.length;
      for (const b of bins) {
        const before = this.carve[b];
        this.carve[b] = Math.min(1.2, before + carveEach);
        events.carved += Math.max(0, Math.min(1, this.carve[b]) - Math.min(1, before));
        this.stress[b] += stressEach * this.fragility[b] * relief;
      }
    } else if (this.inside(input.x, input.y)) {
      // Adentro de la figura: la aguja esta pinchando lo que hay que salvar.
      this.stress[bin] += K_INSIDE * Math.min(4, dist / tol) * dt * this.fragility[bin] * relief;
    } else if (reach) {
      this.stress[bin] += K_OUTSIDE * dt * this.fragility[bin] * relief;
    }

    // Quieto apretando el mismo tramo: se hunde.
    if (reach && bin === this.dwellBin && speed < 0.08) this.dwell += dt;
    else {
      this.dwell = 0;
      this.dwellBin = bin;
    }
    if (reach && this.dwell > DWELL_GRACE) this.stress[bin] += K_DWELL * dt * this.fragility[bin] * relief;

    this.prevX = input.x;
    this.prevY = input.y;
    this.hadPrev = true;
    this.prevS = reach ? s : -1;

    for (let b = 0; b < this.binCount; b++) {
      if (this.stress[b] >= 1) {
        this.break(b);
        events.broke = b;
        return events;
      }
    }
    let all = true;
    for (let b = 0; b < this.binCount && all; b++) all = this.carve[b] >= 1;
    if (all) {
      this.done = true;
      events.done = true;
    }
    return events;
  }

  /** Muestra del contorno mas cercana a (x, y), y su distancia. */
  nearest(x: number, y: number): { index: number; dist: number } {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.sx.length; i++) {
      const d = (this.sx[i] - x) ** 2 + (this.sy[i] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  /** Punto adentro de la figura (par-impar contra el contorno). */
  inside(x: number, y: number): boolean {
    const o = this.shape.outline;
    let c = false;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const [xi, yi] = o[i];
      const [xj, yj] = o[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /** Tramos entre dos posiciones del contorno, en el sentido mas corto. */
  private crossed(from: number, to: number): number[] {
    const d = wrap(to - from, this.length);
    const a = Math.min(this.binCount - 1, Math.floor((from / this.length) * this.binCount));
    const steps = Math.min(this.binCount, Math.round(Math.abs(d) / (this.length / this.binCount)));
    const dir = d >= 0 ? 1 : -1;
    const out: number[] = [];
    for (let k = 0; k <= steps; k++) out.push((((a + k * dir) % this.binCount) + this.binCount) % this.binCount);
    return out;
  }

  /** Normal unitaria que apunta hacia ADENTRO de la figura en la muestra i. */
  normalAt(i: number): [number, number] {
    const n = this.sx.length;
    const a = (i - 2 + n) % n;
    const b = (i + 2) % n;
    const tx = this.sx[b] - this.sx[a];
    const ty = this.sy[b] - this.sy[a];
    const len = Math.hypot(tx, ty) || 1;
    let nx = -ty / len;
    let ny = tx / len;
    if (!this.inside(this.sx[i] + nx * 0.01, this.sy[i] + ny * 0.01)) {
      nx = -nx;
      ny = -ny;
    }
    return [nx, ny];
  }

  /**
   * Fragilidad de cada tramo: grosor de la figura hacia adentro (un rayo por la
   * normal hasta el otro lado del contorno) y cuanto gira el contorno ahi. Se toma la
   * peor muestra del tramo.
   */
  private computeFragility(): Float32Array {
    const n = this.sx.length;
    const frag = new Float32Array(this.binCount).fill(1);
    for (let i = 0; i < n; i++) {
      const [nx, ny] = this.normalAt(i);
      const thick = this.rayToOutline(this.sx[i] + nx * 0.004, this.sy[i] + ny * 0.004, nx, ny);
      const thin = Math.max(0, Math.min(1, (THIN_BELOW - thick) / THIN_BELOW));
      const w = Math.max(1, Math.round(0.03 / SAMPLE_STEP));
      const a = (i - w + n) % n;
      const b = (i + w) % n;
      const t1 = Math.atan2(this.sy[i] - this.sy[a], this.sx[i] - this.sx[a]);
      const t2 = Math.atan2(this.sy[b] - this.sy[i], this.sx[b] - this.sx[i]);
      const turn = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
      const f = 1 + FRAGILE_THIN * thin + FRAGILE_TURN * Math.min(1, turn / (Math.PI / 2));
      const bin = this.binOfSample(i);
      frag[bin] = Math.max(frag[bin], f);
    }
    return frag;
  }

  /** Distancia desde (x, y) por la direccion (dx, dy) hasta cruzar el contorno. */
  private rayToOutline(x: number, y: number, dx: number, dy: number): number {
    const n = this.sx.length;
    let best = 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = this.sx[j] - this.sx[i];
      const ey = this.sy[j] - this.sy[i];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const qx = this.sx[i] - x;
      const qy = this.sy[i] - y;
      const t = (qx * ey - qy * ex) / den;
      const u = (qx * dy - qy * dx) / den;
      if (t > 1e-3 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best;
  }

  /** La grieta: un zigzag sembrado que cruza la figura desde el tramo roto, con ramas. */
  private break(b: number): void {
    this.broken = b;
    const rand = mulberry32(b * 7919 + this.binCount);
    const i = this.midSample(b);
    const [nx, ny] = this.normalAt(i);
    // La grieta principal apunta al centro de la figura: tiene que verse que la parte.
    let cx = 0;
    let cy = 0;
    for (const [x, y] of this.shape.outline) {
      cx += x;
      cy += y;
    }
    cx /= this.shape.outline.length;
    cy /= this.shape.outline.length;
    const tx = cx - this.sx[i];
    const ty = cy - this.sy[i];
    const tl = Math.hypot(tx, ty) || 1;
    const dx = nx * 0.35 + (tx / tl) * 0.65;
    const dy = ny * 0.35 + (ty / tl) * 0.65;
    const main = jagged(this.sx[i], this.sy[i], dx, dy, tl * 1.8, rand, 0.45);
    this.crack = [main];
    for (let k = 0; k < 3; k++) {
      const from = main[Math.floor(main.length * (0.25 + rand() * 0.5))];
      const a = Math.atan2(ny, nx) + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.6);
      this.crack.push(jagged(from[0], from[1], Math.cos(a), Math.sin(a), 0.25 + rand() * 0.3, rand, 0.6));
    }
    // Hacia afuera tambien (el sobrante se parte).
    this.crack.push(jagged(this.sx[i], this.sy[i], -nx, -ny, 0.35 + rand() * 0.25, rand, 0.6));
  }
}

function resample(outline: [number, number][], step: number) {
  const pts = [...outline, outline[0]];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const n = Math.max(24, Math.round(total / step));
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const ss = new Float32Array(n);
  let seg = 1;
  let segStart = 0;
  let segLen = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  for (let k = 0; k < n; k++) {
    const at = (k / n) * total;
    while (at > segStart + segLen && seg < pts.length - 1) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]);
    }
    const t = segLen > 0 ? (at - segStart) / segLen : 0;
    xs[k] = pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * t;
    ys[k] = pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * t;
    ss[k] = at;
  }
  return { xs, ys, ss, length: total };
}

/** Diferencia en un contorno cerrado de largo L, llevada a [-L/2, L/2]. */
function wrap(d: number, length: number): number {
  let v = d % length;
  if (v > length / 2) v -= length;
  if (v < -length / 2) v += length;
  return v;
}

/** Trazo en zigzag desde (x, y) por (dx, dy), de largo `len`, que no sale de la galleta. */
function jagged(x: number, y: number, dx: number, dy: number, len: number, rand: () => number, wobble: number): [number, number][] {
  const out: [number, number][] = [[x, y]];
  let a = Math.atan2(dy, dx);
  const base = a;
  const steps = Math.max(3, Math.round(len / 0.025));
  let cx = x;
  let cy = y;
  for (let k = 0; k < steps; k++) {
    a = base + (rand() - 0.5) * wobble * 2;
    const l = len / steps;
    cx += Math.cos(a) * l;
    cy += Math.sin(a) * l;
    if (cx * cx + cy * cy > 0.97) break;
    out.push([cx, cy]);
  }
  return out;
}

/** PRNG sembrado (mulberry32): mismas grietas para la misma semilla. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
