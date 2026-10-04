import { BRAID } from "./constants";

/** Paredes de una celda como bits: norte, este, sur, oeste. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
export const DIRS: { bit: number; dx: number; dy: number; opp: number }[] = [
  { bit: N, dx: 0, dy: -1, opp: S },
  { bit: E, dx: 1, dy: 0, opp: W },
  { bit: S, dx: 0, dy: 1, opp: N },
  { bit: W, dx: -1, dy: 0, opp: E },
];

/** PRNG sembrado (mulberry32): mismo laberinto para la misma semilla. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla a partir de un texto (codigo de sala + ronda). */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * El laberinto de un nivel. Se talla con backtracker recursivo (un laberinto
 * "perfecto": un solo camino entre dos celdas) y despues se abren `BRAID` de los
 * callejones sin salida, que arma vueltas: en un laberinto perfecto el Minotauro te
 * acorrala siempre, con vueltas se le puede dar la vuelta a una manzana.
 *
 * Todo sale de la semilla: en una sala todos bajan los mismos laberintos.
 */
export class Maze {
  readonly w: number;
  readonly h: number;
  /** Bits de paredes por celda (N/E/S/W prendido = hay pared). */
  readonly walls: Uint8Array;
  readonly start = { x: 0, y: 0 };
  readonly exit: { x: number; y: number };
  readonly lair: { x: number; y: number };
  readonly amphorae: { x: number; y: number }[];
  /** Distancia en pasos desde la largada a cada celda. */
  readonly fromStart: Int32Array;

  constructor(size: number, seed: number, amphoraCount: number) {
    this.w = size;
    this.h = size;
    const rand = mulberry32(seed);
    this.walls = new Uint8Array(size * size).fill(N | E | S | W);
    this.carve(rand);
    this.braid(rand);
    this.fromStart = this.distances(this.start.x, this.start.y);

    // El ovillo: la celda mas lejana de la largada.
    let far = 0;
    for (let i = 1; i < this.fromStart.length; i++) if (this.fromStart[i] > this.fromStart[far]) far = i;
    this.exit = { x: far % size, y: Math.floor(far / size) };

    // La guarida: AFUERA de la ruta al ovillo. Medido: elegida solo "lejos de la
    // largada" caia sobre la ruta casi la mitad de las veces, y el que iba por el buen
    // camino se lo llevaba puesto. Lejos de la ruta tiene que salir a buscarte.
    const route = new Set(this.path(this.start.x, this.start.y, this.exit.x, this.exit.y).map((c) => this.index(c.x, c.y)));
    route.add(0);
    const fromRoute = this.distancesFrom([...route]);
    const fromExit = this.distances(this.exit.x, this.exit.y);
    let lair = -1;
    let best = -Infinity;
    for (let i = 0; i < this.fromStart.length; i++) {
      if (fromRoute[i] < 4 || fromExit[i] < 4 || this.fromStart[i] < 6) continue;
      const score = this.fromStart[i] + fromRoute[i] * 2 + rand() * 4;
      if (score > best) {
        best = score;
        lair = i;
      }
    }
    if (lair < 0) {
      // Laberinto chico sin lugar lejos de la ruta: el mas apartado que haya.
      for (let i = 0; i < this.fromStart.length; i++) {
        const score = fromRoute[i] * 3 + this.fromStart[i] + rand();
        if (i !== far && score > best) {
          best = score;
          lair = i;
        }
      }
    }
    this.lair = { x: lair % size, y: Math.floor(lair / size) };

    // Anforas en los callejones que quedaron, lejos de la largada: riesgo por aceite.
    const ends: number[] = [];
    for (let i = 0; i < this.walls.length; i++) {
      if (i === far || i === 0 || i === lair) continue;
      if (this.openings(i) === 1 && this.fromStart[i] > 3) ends.push(i);
    }
    shuffle(ends, rand);
    ends.sort((a, b) => this.fromStart[b] - this.fromStart[a]);
    // De los mas lejanos, repartidos: se toma uno de cada tanto.
    const pick: number[] = [];
    const stride = Math.max(1, Math.floor(ends.length / Math.max(1, amphoraCount)));
    for (let i = 0; i < ends.length && pick.length < amphoraCount; i += stride) pick.push(ends[i]);
    this.amphorae = pick.map((i) => ({ x: i % size, y: Math.floor(i / size) }));
  }

  index(x: number, y: number): number {
    return y * this.w + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Se puede pasar de (x, y) en la direccion d (indice de DIRS). */
  open(x: number, y: number, d: number): boolean {
    return (this.walls[this.index(x, y)] & DIRS[d].bit) === 0;
  }

  private openings(i: number): number {
    const w = this.walls[i];
    return 4 - ((w & N ? 1 : 0) + (w & E ? 1 : 0) + (w & S ? 1 : 0) + (w & W ? 1 : 0));
  }

  private knock(x: number, y: number, d: number): void {
    const nx = x + DIRS[d].dx;
    const ny = y + DIRS[d].dy;
    this.walls[this.index(x, y)] &= ~DIRS[d].bit;
    this.walls[this.index(nx, ny)] &= ~DIRS[d].opp;
  }

  private carve(rand: () => number): void {
    const seen = new Uint8Array(this.w * this.h);
    const stack: [number, number][] = [[0, 0]];
    seen[0] = 1;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const options: number[] = [];
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d].dx;
        const ny = y + DIRS[d].dy;
        if (this.inside(nx, ny) && !seen[this.index(nx, ny)]) options.push(d);
      }
      if (!options.length) {
        stack.pop();
        continue;
      }
      const d = options[Math.floor(rand() * options.length)];
      this.knock(x, y, d);
      const nx = x + DIRS[d].dx;
      const ny = y + DIRS[d].dy;
      seen[this.index(nx, ny)] = 1;
      stack.push([nx, ny]);
    }
  }

  private braid(rand: () => number): void {
    for (let i = 0; i < this.walls.length; i++) {
      if (this.openings(i) !== 1 || rand() > BRAID) continue;
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      const options: number[] = [];
      for (let d = 0; d < 4; d++) {
        if (this.open(x, y, d)) continue;
        if (this.inside(x + DIRS[d].dx, y + DIRS[d].dy)) options.push(d);
      }
      if (options.length) this.knock(x, y, options[Math.floor(rand() * options.length)]);
    }
  }

  /** Distancia en pasos (BFS) desde una celda a todas. */
  distances(sx: number, sy: number): Int32Array {
    return this.distancesFrom([this.index(sx, sy)]);
  }

  /** Distancia en pasos desde el conjunto de celdas mas cercano (BFS de varios origenes). */
  distancesFrom(sources: number[]): Int32Array {
    const dist = new Int32Array(this.w * this.h).fill(-1);
    const queue = [...sources];
    for (const i of queue) dist[i] = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      for (let d = 0; d < 4; d++) {
        if (!this.open(x, y, d)) continue;
        const j = this.index(x + DIRS[d].dx, y + DIRS[d].dy);
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
    return dist;
  }

  /**
   * Camino mas corto con A* (heuristica Manhattan, admisible en una grilla de 4
   * vecinos). Devuelve las celdas desde la siguiente a la de origen hasta el destino,
   * o [] si ya esta ahi. Un laberinto de 23x23 son 529 nodos: microsegundos.
   */
  path(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    avoid?: (x: number, y: number) => boolean,
  ): { x: number; y: number }[] {
    const total = this.w * this.h;
    const start = this.index(sx, sy);
    const goal = this.index(tx, ty);
    if (start === goal) return [];
    const g = new Int32Array(total).fill(1 << 30);
    const came = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open: number[] = [start];
    const f = new Float64Array(total).fill(Infinity);
    g[start] = 0;
    f[start] = Math.abs(sx - tx) + Math.abs(sy - ty);
    while (open.length) {
      let best = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[best]]) best = k;
      const i = open[best];
      open[best] = open[open.length - 1];
      open.pop();
      if (i === goal) break;
      if (closed[i]) continue;
      closed[i] = 1;
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      for (let d = 0; d < 4; d++) {
        if (!this.open(x, y, d)) continue;
        const nx = x + DIRS[d].dx;
        const ny = y + DIRS[d].dy;
        const j = this.index(nx, ny);
        if (closed[j]) continue;
        if (avoid && j !== goal && avoid(nx, ny)) continue;
        const ng = g[i] + 1;
        if (ng >= g[j]) continue;
        g[j] = ng;
        came[j] = i;
        f[j] = ng + Math.abs(nx - tx) + Math.abs(ny - ty);
        open.push(j);
      }
    }
    if (came[goal] < 0) return [];
    const out: { x: number; y: number }[] = [];
    for (let i = goal; i !== start; i = came[i]) out.push({ x: i % this.w, y: Math.floor(i / this.w) });
    return out.reverse();
  }

  /** Linea de vista: misma fila o columna, sin paredes en el medio, hasta `max` celdas. */
  sees(ax: number, ay: number, bx: number, by: number, max: number): boolean {
    if (ax !== bx && ay !== by) return false;
    const dist = Math.abs(ax - bx) + Math.abs(ay - by);
    if (dist > max) return false;
    const d = ax === bx ? (by > ay ? 2 : 0) : bx > ax ? 1 : 3;
    let x = ax;
    let y = ay;
    for (let k = 0; k < dist; k++) {
      if (!this.open(x, y, d)) return false;
      x += DIRS[d].dx;
      y += DIRS[d].dy;
    }
    return true;
  }
}

function shuffle<T>(a: T[], rand: () => number): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
