/**
 * Estela de una cabeza: el camino por donde paso, que ES el cuerpo de la viborita.
 *
 * Del server llegan solo cabezas (20 por segundo). Cada una se agrega aca con la hora
 * local de su snapshot; para dibujar, el cuerpo se arma recorriendo la estela desde
 * la cabeza (interpolada) hacia atras hasta completar el largo que corresponde a la
 * masa. Como el server define el cuerpo igual — puntos sobre la estela por largo de
 * arco — los dos coinciden aunque el server registre la estela a 40 Hz y el cliente a
 * 20 (la diferencia es la flecha de cada cuerda: menos de una unidad).
 *
 * La primera vez que se ve una viborita no hay estela: el server manda el cuerpo
 * entero (`k` del snapshot) y se siembra con `seed`.
 */
export class Trail {
  /** De la mas vieja a la mas nueva, desde `start`. */
  private xs: number[] = [];
  private ys: number[] = [];
  /** Hora local de cada punto (para no dibujar los que estan "en el futuro" de la interpolacion). */
  private ts: number[] = [];
  private start = 0;
  private len = 0;
  /** Ultima vez que el server la incluyo (para olvidar las que salieron de la vista). */
  lastSeen = 0;

  /** Siembra con el cuerpo entero (de la cabeza a la cola) visto en `t`. */
  seed(points: number[], t: number): void {
    this.xs = [];
    this.ys = [];
    this.ts = [];
    this.start = 0;
    this.len = 0;
    const n = points.length / 2;
    for (let i = n - 1; i >= 0; i--) {
      // Mas viejos que la cabeza, en orden: el cuerpo ya estaba ahi.
      this.add(points[i * 2], points[i * 2 + 1], t - i * 0.001);
    }
  }

  push(t: number, x: number, y: number): void {
    this.add(x, y, t);
  }

  private add(x: number, y: number, t: number): void {
    const n = this.xs.length;
    if (n > this.start) {
      const d = Math.hypot(x - this.xs[n - 1], y - this.ys[n - 1]);
      if (d < 0.05) {
        this.ts[n - 1] = Math.max(this.ts[n - 1], t);
        return;
      }
      this.len += d;
    }
    this.xs.push(x);
    this.ys.push(y);
    this.ts.push(t);
  }

  /** Olvida lo que quedo mas atras que `keep` desde la punta. */
  trim(keep: number): void {
    while (this.xs.length - this.start > 2) {
      const s = this.start;
      const first = Math.hypot(this.xs[s + 1] - this.xs[s], this.ys[s + 1] - this.ys[s]);
      if (this.len - first < keep) break;
      this.len -= first;
      this.start++;
    }
    if (this.start > 256) {
      this.xs.splice(0, this.start);
      this.ys.splice(0, this.start);
      this.ts.splice(0, this.start);
      this.start = 0;
    }
  }

  /** Corre la estela entera (una correccion grande de la viborita propia). */
  translate(dx: number, dy: number): void {
    for (let i = this.start; i < this.xs.length; i++) {
      this.xs[i] += dx;
      this.ys[i] += dy;
    }
  }

  get empty(): boolean {
    return this.xs.length - this.start === 0;
  }

  /**
   * El cuerpo para dibujar: arranca en la cabeza (hx, hy) y sigue por los puntos de
   * la estela con hora <= `until`, hasta juntar `maxLen` de largo. Devuelve x, y
   * planos de la cabeza a la cola.
   */
  body(hx: number, hy: number, until: number, maxLen: number, out: number[]): void {
    out.length = 0;
    out.push(hx, hy);
    let x = hx;
    let y = hy;
    let acc = 0;
    for (let i = this.xs.length - 1; i >= this.start; i--) {
      if (this.ts[i] > until) continue;
      const nx = this.xs[i];
      const ny = this.ys[i];
      const d = Math.hypot(nx - x, ny - y);
      if (d < 0.01) continue;
      if (acc + d >= maxLen) {
        const f = (maxLen - acc) / d;
        out.push(x + (nx - x) * f, y + (ny - y) * f);
        return;
      }
      acc += d;
      out.push(nx, ny);
      x = nx;
      y = ny;
    }
  }
}
