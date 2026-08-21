import { themeFor, type Theme } from "./themes";

export interface Pt {
  x: number;
  y: number;
}

/**
 * Definicion de un circuito. La linea central se traza pasando una spline
 * Catmull-Rom cerrada por una lista de nodos de control. Hay dos formas de dar
 * los nodos:
 *  - `nodes`: polares `[anguloGrados, radio]` con angulos crecientes (garantiza
 *    que la curva no se autointersecta; util para pistas proceduraes).
 *  - `waypoints`: coordenadas libres `[x, y]` (se auto-centran en su centroide),
 *    para reproducir trazados reales que se doblan sobre si mismos (horquillas,
 *    espirales) que un `r(theta)` no puede representar.
 * scaleX/scaleY estiran el conjunto y `rotation` lo gira.
 */
export interface TrackDef {
  id: string;
  name: string;
  laps: number;
  /** Ancho del asfalto en px. */
  width: number;
  themeId: string;
  /** Nodos polares [anguloGrados, radioPx] con angulos crecientes. */
  nodes?: [number, number][];
  /** Nodos cartesianos libres [x, y] en un espacio de diseno cualquiera. */
  waypoints?: [number, number][];
  scaleX: number;
  scaleY: number;
  /** Rotacion global del circuito (rad). */
  rotation: number;
}

export const TRACK_DEFS: TrackDef[] = [
  {
    id: "monaco",
    name: "Mónaco",
    laps: 4,
    width: 112,
    themeId: "city",
    // Callejero angosto trazado sobre el mapa real de Montecarlo (corners 1-19):
    // lento, sinuoso, con horquilla. Angosto a proposito (calle). Geometria
    // verificada (scratchpad/faithful.mjs): radio > medio ancho, sin cruces.
    waypoints: [
      [420, 155],
      [795, 355],
      [905, 405],
      [985, 300],
      [1235, 265],
      [1210, 400],
      [1320, 380],
      [1330, 470],
      [1030, 585],
      [720, 455],
      [600, 400],
      [450, 268],
      [350, 330],
      [350, 400],
      [258, 500],
      [210, 520],
      [185, 580],
      [190, 700],
      [52, 610],
    ],
    scaleX: 2.0,
    scaleY: 2.0,
    rotation: 0,
  },
  {
    id: "shanghai",
    name: "Shanghái",
    laps: 3,
    width: 152,
    themeId: "space",
    // Semi-fiel a Shanghai: su recta trasera larga caracteristica + horquilla
    // final. El "snail" (espiral de entrada) real es imposible como loop cerrado
    // sin autointersecarse, asi que el sector 1 va como curva simple.
    waypoints: [
      [680, 240],
      [920, 250],
      [1150, 360],
      [1240, 560],
      [1130, 730],
      [900, 750],
      [800, 600],
      [640, 640],
      [520, 800],
      [220, 850],
      [180, 640],
      [420, 600],
      [560, 460],
      [620, 320],
    ],
    scaleX: 2.1,
    scaleY: 2.1,
    rotation: 0,
  },
  {
    id: "silverstone",
    name: "Silverstone",
    laps: 3,
    width: 138,
    themeId: "jungle",
    // Trazado sobre Silverstone: sweeps rapidos + esses (Maggotts/Becketts) y la
    // curva lenta del sector final. Geometria verificada.
    waypoints: [
      [320, 250],
      [640, 180],
      [930, 230],
      [1160, 370],
      [1235, 580],
      [1095, 710],
      [1015, 580],
      [905, 690],
      [795, 570],
      [665, 690],
      [485, 760],
      [250, 730],
      [150, 540],
      [250, 420],
      [210, 320],
    ],
    scaleX: 2.0,
    scaleY: 2.0,
    rotation: 0,
  },
  {
    id: "red-dune",
    name: "Duna Roja",
    laps: 3,
    width: 200,
    themeId: "desert",
    nodes: [
      [0, 1320],
      [30, 1200],
      [58, 620],
      [90, 1180],
      [135, 1000],
      [180, 1300],
      [220, 960],
      [258, 1220],
      [300, 900],
      [332, 1260],
    ],
    scaleX: 1.32,
    scaleY: 0.78,
    rotation: 0,
  },
  {
    id: "glacier-loop",
    name: "Glaciar",
    laps: 3,
    width: 196,
    themeId: "ice",
    nodes: [
      [15, 980],
      [50, 1180],
      [82, 760],
      [118, 1120],
      [150, 820],
      [190, 1160],
      [228, 820],
      [262, 1140],
      [298, 780],
      [332, 1120],
    ],
    scaleX: 1.1,
    scaleY: 0.98,
    rotation: Math.PI / 6,
  },
  {
    id: "magma-eight",
    name: "Volcán",
    laps: 3,
    width: 205,
    themeId: "volcano",
    nodes: [
      [8, 1300],
      [46, 640],
      [86, 1180],
      [128, 900],
      [172, 1280],
      [214, 640],
      [252, 1180],
      [296, 900],
      [338, 1280],
    ],
    scaleX: 1.24,
    scaleY: 0.84,
    rotation: Math.PI / 10,
  },
];

/** Samples por segmento de spline (nodo -> nodo siguiente). */
const SEG_SAMPLES = 30;

/** Catmull-Rom cerrada: interpola entre p1 y p2 usando p0..p3. */
function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/** Convierte la definicion en nodos de control cartesianos ya escalados. */
function controlNodes(def: TrackDef): Pt[] {
  const cos = Math.cos(def.rotation);
  const sin = Math.sin(def.rotation);
  const rot = (x: number, y: number): Pt => ({ x: x * cos - y * sin, y: x * sin + y * cos });

  if (def.waypoints && def.waypoints.length > 0) {
    const cx = def.waypoints.reduce((a, p) => a + p[0], 0) / def.waypoints.length;
    const cy = def.waypoints.reduce((a, p) => a + p[1], 0) / def.waypoints.length;
    return def.waypoints.map(([x, y]) => rot((x - cx) * def.scaleX, (y - cy) * def.scaleY));
  }

  return (def.nodes ?? []).map(([deg, r]) => {
    const a = (deg * Math.PI) / 180;
    return rot(Math.cos(a) * r * def.scaleX, Math.sin(a) * r * def.scaleY);
  });
}

/** Pista lista para jugar: centerline densa + longitudes acumuladas. */
export class Track {
  readonly def: TrackDef;
  readonly theme: Theme;
  readonly pts: Pt[] = [];
  /** Curvatura absoluta normalizada [0,1] por punto (para colocar hazards). */
  readonly curvature: number[] = [];
  private readonly cum: number[] = [];
  readonly total: number;
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };

  constructor(def: TrackDef) {
    this.def = def;
    this.theme = themeFor(def.themeId);

    const nodes = controlNodes(def);
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const p0 = nodes[(i - 1 + n) % n];
      const p1 = nodes[i];
      const p2 = nodes[(i + 1) % n];
      const p3 = nodes[(i + 2) % n];
      for (let j = 0; j < SEG_SAMPLES; j++) {
        this.pts.push(catmull(p0, p1, p2, p3, j / SEG_SAMPLES));
      }
    }

    const m = this.pts.length;
    let acc = 0;
    for (let i = 0; i < m; i++) {
      this.cum.push(acc);
      const a = this.pts[i];
      const b = this.pts[(i + 1) % m];
      acc += Math.hypot(b.x - a.x, b.y - a.y);
    }
    this.total = acc;

    for (let i = 0; i < m; i++) {
      const a = this.pts[(i - 1 + m) % m];
      const b = this.pts[i];
      const c = this.pts[(i + 1) % m];
      const a1 = Math.atan2(b.y - a.y, b.x - a.x);
      const a2 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curvature.push(Math.min(1, Math.abs(d) / 0.28));
    }

    const xs = this.pts.map((p) => p.x);
    const ys = this.pts.map((p) => p.y);
    this.bounds = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  /** Punto y tangente (angulo) sobre la centerline en s en [0,1). */
  pointAt(s: number): { x: number; y: number; angle: number } {
    const m = this.pts.length;
    const target = (((s % 1) + 1) % 1) * this.total;
    let i = 0;
    while (i < m - 1 && this.cum[i + 1] < target) i++;
    const a = this.pts[i];
    const b = this.pts[(i + 1) % m];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = (target - this.cum[i]) / segLen;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  /** Proyecta un segmento [from,to) de la centerline y devuelve el mas cercano. */
  private scan(x: number, y: number, from: number, to: number): { s: number; dist: number } {
    const m = this.pts.length;
    let bestD2 = Infinity;
    let bestS = 0;
    for (let k = from; k <= to; k++) {
      const i = ((k % m) + m) % m;
      const a = this.pts[i];
      const b = this.pts[(i + 1) % m];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = (this.cum[i] + Math.sqrt(len2) * t) / this.total;
      }
    }
    return { s: bestS % 1, dist: Math.sqrt(bestD2) };
  }

  /**
   * Proyecta un punto sobre la centerline: progreso s en [0,1) y distancia.
   * Con `hint` (el s del frame anterior) busca solo en una ventana alrededor,
   * lo que evita saltos cuando dos tramos del circuito pasan cerca (espirales).
   * Si en la ventana el punto queda lejos del asfalto, reintenta global.
   */
  progressAt(x: number, y: number, hint?: number): { s: number; dist: number } {
    const m = this.pts.length;
    if (hint == null) return this.scan(x, y, 0, m - 1);
    const c = Math.floor((((hint % 1) + 1) % 1) * m);
    const w = Math.max(12, Math.round(m * 0.14));
    const local = this.scan(x, y, c - w, c + w);
    if (local.dist > this.def.width) {
      const global = this.scan(x, y, 0, m - 1);
      if (global.dist < local.dist) return global;
    }
    return local;
  }

  /** True si el punto esta sobre el asfalto. */
  onTrack(x: number, y: number, hint?: number): boolean {
    return this.progressAt(x, y, hint).dist <= this.def.width / 2;
  }
}

export function buildTrack(index: number): Track {
  const def = TRACK_DEFS[((index % TRACK_DEFS.length) + TRACK_DEFS.length) % TRACK_DEFS.length];
  return new Track(def);
}

/** Datos para el chip del selector: nombre, color y trazo SVG normalizado. */
export function trackPreview(index: number): { id: string; name: string; accent: string; d: string } {
  const t = buildTrack(index);
  const b = t.bounds;
  const W = 100;
  const H = 62;
  const pad = 9;
  const s = Math.min((W - pad * 2) / (b.maxX - b.minX), (H - pad * 2) / (b.maxY - b.minY));
  const ox = pad + (W - pad * 2 - (b.maxX - b.minX) * s) / 2 - b.minX * s;
  const oy = pad + (H - pad * 2 - (b.maxY - b.minY) * s) / 2 - b.minY * s;
  let d = "";
  for (let i = 0; i < t.pts.length; i += 2) {
    const px = (t.pts[i].x * s + ox).toFixed(1);
    const py = (t.pts[i].y * s + oy).toFixed(1);
    d += (i === 0 ? "M" : "L") + px + " " + py;
  }
  d += "Z";
  return { id: t.def.id, name: t.def.name, accent: t.theme.accent, d };
}
