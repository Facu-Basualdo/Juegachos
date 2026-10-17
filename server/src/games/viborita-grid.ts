/**
 * Spatial hash grid de Viborita (SIMULATION_ARCHITECTURE.md, ficha 3.3): el mapa partido
 * en baldes cuadrados, para que las colisiones y el culling consulten solo los baldes
 * cercanos en vez de todas las entidades contra todas (nada de O(n^2)).
 *
 * Cada entidad va al balde de su CENTRO. Una consulta por rectangulo devuelve todo lo
 * que tiene el centro adentro; el que quiera encontrar algo grande que asoma desde
 * afuera agranda el rectangulo con el radio maximo que le importa. Es lo que hacen
 * las colisiones: para ver a quien se come A alcanza con mirar centros a menos de rA
 * (la chica tiene que tener el centro adentro de la grande).
 *
 * Los baldes son arrays reutilizados (`length = 0`), asi reconstruir la grilla de las
 * celulas en cada paso no genera basura para el GC.
 */
export class SpatialHash<T extends { x: number; y: number }> {
  private readonly cols: number;
  private readonly buckets: T[][];

  constructor(
    worldSize: number,
    private readonly cellSize: number,
  ) {
    this.cols = Math.max(1, Math.ceil(worldSize / cellSize));
    this.buckets = Array.from({ length: this.cols * this.cols }, () => []);
  }

  clear(): void {
    for (const bucket of this.buckets) bucket.length = 0;
  }

  insert(item: T): void {
    this.buckets[this.indexOf(item.x, item.y)].push(item);
  }

  /** Saca un item (orden de su balde no importa: swap con el ultimo). */
  remove(item: T): void {
    const bucket = this.buckets[this.indexOf(item.x, item.y)];
    const i = bucket.indexOf(item);
    if (i < 0) return;
    bucket[i] = bucket[bucket.length - 1];
    bucket.pop();
  }

  /** Llama `cb` con cada item cuyo centro cae en el rectangulo [x0,x1] x [y0,y1]. */
  query(x0: number, y0: number, x1: number, y1: number, cb: (item: T) => void): void {
    const c0 = this.col(x0);
    const c1 = this.col(x1);
    const r0 = this.col(y0);
    const r1 = this.col(y1);
    for (let row = r0; row <= r1; row++) {
      const base = row * this.cols;
      for (let col = c0; col <= c1; col++) {
        const bucket = this.buckets[base + col];
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          if (item.x >= x0 && item.x <= x1 && item.y >= y0 && item.y <= y1) cb(item);
        }
      }
    }
  }

  private col(v: number): number {
    const c = Math.floor(v / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private indexOf(x: number, y: number): number {
    return this.col(y) * this.cols + this.col(x);
  }
}
