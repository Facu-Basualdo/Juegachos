import {
  BLOT_CLEARANCE,
  FIELD_BOT,
  FIELD_TOP,
  FIRST_GATE_X,
  GAP_MIN,
  GAP_SHRINK_UNTIL,
  GAP_START,
  PEN_R,
  SLOPE,
  SPACING_MAX,
  SPACING_MIN,
  mulberry32,
} from "./constants";

/** Tachon: bloque rectangular rayado con birome. Mata al tocarlo. */
export interface Bar {
  kind: "bar";
  left: number;
  right: number;
  y: number;
  h: number;
  seed: number;
}

/** Manchon de tinta: circulo irregular. Mata al tocar su nucleo. */
export interface Blot {
  kind: "blot";
  left: number;
  right: number;
  x: number;
  y: number;
  r: number;
  seed: number;
  /** Multiplicadores de radio del contorno (solo dibujo). */
  edge: number[];
}

export type Obstacle = Bar | Blot;

/** El obstaculo mas ancho posible (un tunel largo): acota la busqueda hacia atras. */
const MAX_OBSTACLE_W = 320;
/** El nucleo que mata es un poco mas chico que la mancha dibujada. */
const BLOT_CORE = 0.88;
/** Los tachones perdonan un par de pixeles del borde rayado. */
const BAR_FORGIVE = 2;

/**
 * Recorrido sembrado. Se genera de a poco hacia adelante y NO se poda nunca: el
 * que muere en sala sigue con la camara al rival que va adelante (o atras), y
 * ese tramo tiene que seguir existiendo. Son unas pocas compuertas por segundo,
 * nada que pese.
 *
 * Todo sale de la semilla: misma semilla, mismos tachones en todas las pantallas.
 * La factibilidad esta garantizada por construccion: cada hueco queda al alcance
 * del anterior con pendiente <= 0.8 (la punta va a 45), y los manchones se ponen
 * lejos de ese camino.
 */
export class Course {
  readonly obstacles: Obstacle[] = [];
  private rand: () => number = mulberry32(1);
  private nextGateX = FIRST_GATE_X;
  private prevExitX = 0;
  private prevCenter = (FIELD_TOP + FIELD_BOT) / 2;

  reset(seed: number): void {
    this.rand = mulberry32(seed);
    this.obstacles.length = 0;
    this.nextGateX = FIRST_GATE_X;
    this.prevExitX = 0;
    this.prevCenter = (FIELD_TOP + FIELD_BOT) / 2;
  }

  /** Genera compuertas hasta pasar `x`. */
  ensure(x: number): void {
    while (this.nextGateX < x) this.addGate();
  }

  /** Indice del primer obstaculo que puede asomar a la derecha de `x`. */
  firstFrom(x: number): number {
    const target = x - MAX_OBSTACLE_W;
    let lo = 0;
    let hi = this.obstacles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.obstacles[mid].left < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** True si la punta en (x, y) toca un tachon, un manchon o un margen. */
  hits(x: number, y: number): boolean {
    if (y - PEN_R <= FIELD_TOP || y + PEN_R >= FIELD_BOT) return true;
    const obs = this.obstacles;
    for (let i = this.firstFrom(x); i < obs.length; i++) {
      const o = obs[i];
      if (o.left > x + PEN_R) break;
      if (o.right < x - PEN_R) continue;
      if (o.kind === "bar") {
        const l = o.left + BAR_FORGIVE;
        const r = o.right - BAR_FORGIVE;
        const t = o.y + (o.y <= FIELD_TOP ? 0 : BAR_FORGIVE);
        const b = o.y + o.h - (o.y + o.h >= FIELD_BOT ? 0 : BAR_FORGIVE);
        const cx = Math.max(l, Math.min(x, r));
        const cy = Math.max(t, Math.min(y, b));
        if ((x - cx) ** 2 + (y - cy) ** 2 <= PEN_R * PEN_R) return true;
      } else {
        const rr = o.r * BLOT_CORE + PEN_R;
        if ((x - o.x) ** 2 + (y - o.y) ** 2 <= rr * rr) return true;
      }
    }
    return false;
  }

  private gapAt(x: number): number {
    const t = Math.min(1, x / GAP_SHRINK_UNTIL);
    return GAP_START + (GAP_MIN - GAP_START) * t;
  }

  private addGate(): void {
    const rand = this.rand;
    const x = this.nextGateX;
    const tunnel = x > 2500 && rand() < 0.2;
    const w = tunnel ? 150 + rand() * 150 : 26 + rand() * 34;
    // Los tuneles son un poco mas holgados: adentro hay que zigzaguear.
    const gap = this.gapAt(x) + (tunnel ? 26 : 0);

    // El centro nuevo tiene que quedar al alcance del anterior con pendiente
    // <= 0.8: la punta va a 45, asi que siempre sobra para corregir.
    const maxShift = (x - this.prevExitX) * SLOPE * 0.8;
    const lo = Math.max(FIELD_TOP + gap / 2 + 18, this.prevCenter - maxShift);
    const hi = Math.min(FIELD_BOT - gap / 2 - 18, this.prevCenter + maxShift);
    const center = lo + rand() * Math.max(0, hi - lo);

    // Manchones en el tramo abierto ANTES de esta compuerta (orden por `left`).
    this.placeBlots(this.prevExitX, this.prevCenter, x, center);

    const gapTop = center - gap / 2;
    const gapBot = center + gap / 2;
    if (gapTop - FIELD_TOP > 4) {
      this.obstacles.push({
        kind: "bar",
        left: x,
        right: x + w,
        y: FIELD_TOP,
        h: gapTop - FIELD_TOP,
        seed: (rand() * 2 ** 31) >>> 0,
      });
    }
    if (FIELD_BOT - gapBot > 4) {
      this.obstacles.push({
        kind: "bar",
        left: x,
        right: x + w,
        y: gapBot,
        h: FIELD_BOT - gapBot,
        seed: (rand() * 2 ** 31) >>> 0,
      });
    }

    this.prevExitX = x + w;
    this.prevCenter = center;
    this.nextGateX = this.prevExitX + SPACING_MIN + rand() * (SPACING_MAX - SPACING_MIN);
  }

  /** Hasta dos manchones lejos del segmento (x1,y1)-(x2,y2), que es factible. */
  private placeBlots(x1: number, y1: number, x2: number, y2: number): void {
    const rand = this.rand;
    if (x2 < 1500) return;
    const want = rand() < Math.min(0.75, 0.25 + x2 / 40000) ? (rand() < 0.35 ? 2 : 1) : 0;
    const placed: Blot[] = [];
    for (let tries = 0; tries < 8 && placed.length < want; tries++) {
      const r = 18 + rand() * 34;
      const minX = x1 + r + 16;
      const maxX = x2 - r - 16;
      if (maxX <= minX) return;
      const bx = minX + rand() * (maxX - minX);
      // Mitad pegados al margen (como tinta que se corrio), mitad sueltos.
      const onMargin = rand() < 0.5;
      const by = onMargin
        ? rand() < 0.5
          ? FIELD_TOP + rand() * 10
          : FIELD_BOT - rand() * 10
        : FIELD_TOP + r + 10 + rand() * Math.max(0, FIELD_BOT - FIELD_TOP - 2 * r - 20);
      if (distToSegment(bx, by, x1, y1, x2, y2) < r + BLOT_CLEARANCE) continue;
      if (placed.some((b) => Math.hypot(b.x - bx, b.y - by) < b.r + r + 12)) continue;
      const edge: number[] = [];
      for (let i = 0; i < 18; i++) edge.push(0.88 + rand() * 0.24);
      placed.push({
        kind: "blot",
        left: bx - r,
        right: bx + r,
        x: bx,
        y: by,
        r,
        seed: (rand() * 2 ** 31) >>> 0,
        edge,
      });
    }
    placed.sort((a, b) => a.left - b.left);
    this.obstacles.push(...placed);
  }
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
