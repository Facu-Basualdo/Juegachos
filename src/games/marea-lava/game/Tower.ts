import { DEPTH_HALF, TOP_Y, WALL_HALF } from "./constants";

/** Carriles de profundidad de los escalones (atras y adelante), dentro de la pared. */
const LANES = [-(DEPTH_HALF - 1.1), DEPTH_HALF - 1.1];

/** Ancho y fondo de cada cima. */
const TOP_W = 4;
const TOP_D = DEPTH_HALF * 2 - 0.6;

/** Tipo de plataforma: comun, chica (tapa luminosa, la dificil) o la cima. */
export type PlatKind = "rock" | "small" | "top";

/** Una plataforma: caja con la tapa en `y`. */
export interface Plat {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  kind: PlatKind;
  /** Carril de profundidad de los escalones del camino (solo para generar). */
  lane?: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La torre de la partida, generada con la semilla del server: la misma en todas las
 * pantallas sin mandar ni una plataforma por la red.
 *
 * Es un CAMINO garantizado (cada escalon se alcanza del anterior con el salto: sube
 * 1.1-1.7 m con el salto de ~2 m y queda a 0.4-1.5 m de borde a borde, NUNCA encima
 * del anterior: un escalon que tape al de abajo deja al jugador sin por donde saltar)
 * mas
 * plataformas sueltas a los costados, que abren rutas y reparten a los ocho
 * jugadores para que no suban todos en fila. Las plataformas se achican con la
 * altura: arriba cuesta mas.
 */
export class Tower {
  readonly plats: Plat[] = [];

  constructor(seed: number) {
    const r = rng(seed);
    // Piso de largada: ancho, lo primero que se traga la lava.
    this.plats.push({ x: 0, z: 0.4, y: 0, w: WALL_HALF * 2 + 2, d: DEPTH_HALF * 2 + 2.4, h: 1, kind: "rock" });

    // Dos caminos, uno por mitad de la pared (sin franja compartida: no se cruzan) y
    // los ocho jugadores se reparten en dos rutas.
    const halves: [number, number, number][] = [
      [-4.5, -WALL_HALF, -0.4],
      [4.5, 0.4, WALL_HALF],
    ];
    for (const [startX, minX, maxX] of halves) this.buildPath(r, startX, minX, maxX);

    // Salientes sueltos: rutas alternativas. Solo entran donde no tapan a nadie.
    const count = 26;
    for (let i = 0; i < count; i++) {
      const ey = 2 + r() * (TOP_Y - 6);
      const ew = 1.5 + r() * 1.1;
      const ed = 1.1 + r() * 0.4;
      const ex = (r() - 0.5) * (WALL_HALF * 2 - ew);
      const ez = LANES[r() < 0.5 ? 0 : 1];
      if (!this.overlaps(ex, ez, ey, ew, ed) && !this.crowds(ex, ez, ey, ew, ed)) {
        this.plats.push({ x: ex, z: ez, y: ey, w: ew, d: ed, h: 0.6, kind: "rock" });
      }
    }

    this.plats.sort((a, b) => a.y - b.y);
  }

  /**
   * Un camino garantizado. Los escalones se ALTERNAN entre dos carriles de
   * profundidad (atras y adelante), como una escalera de mano: dos escalones seguidos
   * estan en carriles distintos y no se pueden tapar. Cada escalon nuevo queda corrido
   * del ultimo de SU carril al menos lo que miden los dos, asi tampoco tapa al de dos
   * mas abajo (con direccion al azar eso pasaba seguido y dejaba trampas).
   *
   * Cada escalon prueba varias posiciones (seguir, dar la vuelta en el carril, dar la
   * vuelta cambiando de carril) y se queda con la primera que no tape a ningun
   * escalon de su carril con menos espacio que cuerpo + salto (3.6 m) y que siga al
   * alcance del salto. La vuelta era lo que dejaba trampas: con cualquier regla fija
   * terminaba encima de un escalon de dos pasadas antes.
   *
   * Cada escalon sube 1.2-1.7 m (el salto llega a ~2 m) y queda a menos de ~2.2 m de
   * borde a borde del anterior.
   */
  private buildPath(r: () => number, startX: number, minX: number, maxX: number): void {
    let x = startX;
    let y = 0;
    let lane = r() < 0.5 ? 0 : 1;
    let dir = startX < 0 ? 1 : -1;
    const path: Plat[] = [];
    const inside = (cx: number, w: number) => cx >= minX + w / 2 && cx <= maxX - w / 2;
    // No tapa a ningun escalon de su carril con menos espacio que cuerpo + salto.
    const clearOf = (cx: number, cy: number, w: number, ln: number) =>
      path.every((q) => {
        if (q.lane !== ln || cy - 0.6 - q.y >= 3.6) return true;
        return Math.abs(q.x - cx) >= (q.w + w) / 2 + 0.3;
      });
    // Al alcance del salto desde el escalon actual (de borde a borde).
    const reachable = (from: Plat | null, cx: number, w: number, d: number, ln: number) => {
      if (!from) return true;
      const gx = Math.max(0, Math.abs(cx - from.x) - (from.w + w) / 2);
      const gz = Math.max(0, Math.abs(LANES[ln] - from.z) - (from.d + d) / 2);
      return Math.hypot(gx, gz) <= 2.1;
    };
    while (y < TOP_Y - 1.7) {
      const hard = y / TOP_Y;
      const baseY = y;
      const rise = 1.2 + r() * 0.5;
      const w = Math.max(1.1, (1.7 + r() * 1.3) * (1 - hard * 0.4));
      const d = 1.1 + r() * 0.4;
      const cur = path.length > 0 ? path[path.length - 1] : null;
      const curW = cur?.w ?? 2;
      const step = 0.9 + r() * 0.8;
      const adjacent = (curW + w) / 2 + 0.3;
      // Candidatos en orden de preferencia: seguir cambiando de carril; dar la
      // vuelta en el mismo carril pegado al actual; dar la vuelta cambiando de
      // carril; y variantes corridas un poco mas.
      const cands: [number, number, number][] = [
        [x + dir * step, 1 - lane, dir],
        [x + dir * (step + 0.8), 1 - lane, dir],
        [x - dir * adjacent, lane, -dir],
        [x - dir * step, 1 - lane, -dir],
        [x - dir * (adjacent + 0.6), lane, -dir],
        [x - dir * (step + 0.8), 1 - lane, -dir],
        [x + dir * adjacent, lane, dir],
      ];
      // Cada candidato se prueba tambien un poco mas alto (siempre dentro del salto):
      // a veces unos centimetros le devuelven el espacio al escalon de abajo.
      let ok: [number, number, number] | undefined;
      y = baseY + rise;
      for (const cy of [rise, Math.min(1.7, rise + 0.25), 1.7]) {
        ok = cands.find(([cx, ln]) => inside(cx, w) && clearOf(cx, baseY + cy, w, ln) && reachable(cur, cx, w, d, ln));
        if (ok) {
          y = baseY + cy;
          break;
        }
      }
      const [nx, nl, nd] = ok ?? cands.find(([cx]) => inside(cx, w)) ?? cands[2];
      x = Math.max(minX + w / 2, Math.min(maxX - w / 2, nx));
      lane = nl;
      dir = nd;
      const p: Plat = { x, z: LANES[lane], y, w, d, h: 0.6, kind: w < 1.5 ? "small" : "rock", lane };
      path.push(p);
      this.plats.push(p);
    }

    // Su cima: ancha (ocupa los dos carriles), a TOP_Y, junto al ultimo escalon y
    // sin tapar a NINGUNA plataforma con menos espacio que cuerpo + salto.
    const last = path[path.length - 1];
    const options: number[] = [];
    for (const side of [dir, -dir]) {
      for (const extra of [0, 0.5, 1, 1.5]) options.push(last.x + side * ((last.w + TOP_W) / 2 + 0.5 + extra));
    }
    const fits = (tx: number) =>
      Math.abs(tx) <= WALL_HALF - TOP_W / 2 + 0.5 &&
      // Todas las plataformas, no solo las de este camino: la cima de un camino que
      // cae sobre los ultimos escalones del otro lo deja sin por donde subir.
      this.plats.every(
        (q) =>
          q === last ||
          q.kind === "top" ||
          q.w > WALL_HALF * 2 ||
          TOP_Y - 0.8 - q.y >= 3.6 ||
          Math.abs(q.x - tx) >= (q.w + TOP_W) / 2 + 0.3,
      );
    const tx = options.find(fits) ?? options[0];
    // Si cae encima de la cima del otro camino (las dos tiran al medio), no se agrega
    // otra: queda una sola, compartida. Dos cajas a la misma altura parpadean.
    const other = this.plats.find((p) => p.kind === "top" && Math.abs(p.x - tx) < TOP_W + 0.2);
    if (other) return;
    this.plats.push({ x: tx, z: 0, y: TOP_Y, w: TOP_W, d: TOP_D, h: 0.8, kind: "top" });
  }

  /**
   * La torre de la semilla, VERIFICADA: si algun camino quedo sin llegar a su cima
   * (pasa en ~1 de cada 70 semillas, cuando ninguna posicion de un escalon entra sin
   * tapar a otro), se prueba con la semilla siguiente. Es deterministico, asi que
   * todas las pantallas terminan en la misma torre sin hablar entre si.
   */
  static create(seed: number): Tower {
    let tower = new Tower(seed);
    for (let attempt = 1; attempt < 12 && !tower.valid(); attempt++) tower = new Tower(seed + attempt * 7919);
    return tower;
  }

  /**
   * Todas las cimas se alcanzan desde el piso saltando: de A se puede ir a B si B
   * sube hasta 1.8 m y queda a menos de 2.4 m de borde a borde, y A no esta tapada
   * del todo por otra plataforma con menos espacio que cuerpo + salto.
   */
  valid(): boolean {
    const n = this.plats.length;
    const covered = this.plats.map((a) =>
      this.plats.some((c) => {
        if (c === a || c.y <= a.y || a.w > WALL_HALF * 2) return false;
        if (c.y - c.h - a.y >= 3.5) return false;
        const ox = (a.w + c.w) / 2 - Math.abs(a.x - c.x);
        const oz = (a.d + c.d) / 2 - Math.abs(a.z - c.z);
        return ox >= a.w - 0.6 && oz >= a.d - 0.6;
      }),
    );
    const start = this.plats.findIndex((p) => p.w > WALL_HALF * 2);
    const reach = new Set<number>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const i = queue.pop()!;
      if (covered[i]) continue;
      const a = this.plats[i];
      for (let j = 0; j < n; j++) {
        if (reach.has(j)) continue;
        const b = this.plats[j];
        if (b.y - a.y > 1.8) continue;
        const gx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
        const gz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
        if (Math.hypot(gx, gz) > 2.4) continue;
        reach.add(j);
        queue.push(j);
      }
    }
    return this.plats.every((p, i) => p.kind !== "top" || reach.has(i));
  }

  /** Plataformas cuya caja cae entre `y0` y `y1` (para el choque). */
  near(y0: number, y1: number): Plat[] {
    const out: Plat[] = [];
    // Estan ordenadas por la tapa: busqueda binaria del primero que puede entrar.
    let lo = 0;
    let hi = this.plats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.plats[mid].y < y0) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.plats.length; i++) {
      const p = this.plats[i];
      if (p.y - p.h > y1) break;
      out.push(p);
    }
    return out;
  }

  /**
   * La plataforma en (x, z, y) quedaria encima o debajo de otra con menos espacio
   * libre que cuerpo + salto: desde la de abajo, el salto le pega en la cabeza. El piso de largada no cuenta (los primeros escalones
   * estan arriba de el a proposito: se salta desde el pasillo del frente).
   */
  private crowds(x: number, z: number, y: number, w: number, d: number): boolean {
    return this.crowdCount(x, z, y, w, d) > 0;
  }

  private crowdCount(x: number, z: number, y: number, w: number, d: number): number {
    return this.plats.filter((p) => {
      if (p.w > WALL_HALF * 2) return false;
      if (Math.abs(p.x - x) >= (p.w + w) / 2 + 0.3 || Math.abs(p.z - z) >= (p.d + d) / 2 + 0.3) return false;
      // Cuerpo (1.8) + lo que sube un salto (1.7) + margen: menos que eso tapa.
      const clear = y > p.y ? y - 0.6 - p.y : p.y - p.h - y;
      return clear < 3.6;
    }).length;
  }

  private overlaps(x: number, z: number, y: number, w: number, d: number): boolean {
    return this.plats.some(
      (p) => Math.abs(p.y - y) < 2.2 && Math.abs(p.x - x) < (p.w + w) / 2 + 0.6 && Math.abs(p.z - z) < (p.d + d) / 2 + 0.4,
    );
  }
}
