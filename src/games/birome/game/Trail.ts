import { SLOPE } from "./constants";

/**
 * El trazo de una birome, guardado como sus QUIEBRES: cada vertice es el punto
 * donde el jugador apreto o solto, con el sentido que tomo desde ahi (`h` = 1
 * subiendo). Entre dos vertices la linea es recta a 45 grados, asi que el trazo
 * entero y la altura en cualquier `x` salen de esta lista sin nada mas.
 *
 * Es la misma estructura para la punta propia y para la de cada rival: la del
 * rival se arma con los quiebres que llegan por el canal.
 */
export class Trail {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly hs: number[] = [];

  get length(): number {
    return this.xs.length;
  }

  get lastX(): number {
    return this.xs.length ? this.xs[this.xs.length - 1] : 0;
  }

  clear(): void {
    this.xs.length = 0;
    this.ys.length = 0;
    this.hs.length = 0;
  }

  /** Agrega un quiebre. Descarta los que vienen de atras (fuera de orden). */
  push(x: number, y: number, h: number): void {
    const n = this.xs.length;
    if (n > 0) {
      const lx = this.xs[n - 1];
      if (x < lx) return;
      // Dos quiebres en el mismo lugar: el ultimo manda.
      if (x - lx < 0.01) {
        this.ys[n - 1] = y;
        this.hs[n - 1] = h;
        return;
      }
    }
    this.xs.push(x);
    this.ys.push(y);
    this.hs.push(h);
  }

  /** Ultimo vertice con x <= `x` (-1 si no hay). */
  indexAt(x: number): number {
    let lo = 0;
    let hi = this.xs.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.xs[mid] <= x) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /** Altura del trazo en `x`, prolongando el ultimo tramo si hace falta. */
  yAt(x: number): number {
    if (this.xs.length === 0) return 0;
    const i = Math.max(0, this.indexAt(x));
    return this.ys[i] + (this.hs[i] ? -SLOPE : SLOPE) * (x - this.xs[i]);
  }

  /** Sentido del tramo que pasa por `x`. */
  holdAt(x: number): boolean {
    if (this.xs.length === 0) return false;
    return this.hs[Math.max(0, this.indexAt(x))] === 1;
  }
}
