import type { Track } from "./tracks";

export interface Cone {
  x: number;
  y: number;
  /** Desplazamiento visual al ser golpeado (se desvanece en el Renderer). */
  ox: number;
  oy: number;
  /** Timestamp del ultimo golpe, para animar y evitar frenadas repetidas. */
  hitAt: number;
}

export interface Barrier {
  x: number;
  y: number;
  angle: number;
  /** Mitad del largo del muro (a lo largo de la pista). */
  half: number;
}

export interface BoostPad {
  x: number;
  y: number;
  angle: number;
}

export interface Obstacles {
  cones: Cone[];
  barriers: Barrier[];
  boosts: BoostPad[];
}

export const CONE_RADIUS = 15;
export const BARRIER_HALF_THICK = 12;
export const BOOST_RADIUS = 46;

/** PRNG determinista (mulberry32) a partir de una seed entera. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Curvatura [0,1] de la centerline en el progreso s. */
function curvatureAtS(track: Track, s: number): number {
  const m = track.pts.length;
  const idx = Math.floor((((s % 1) + 1) % 1) * m) % m;
  return track.curvature[idx];
}

/** Punto desplazado perpendicularmente a la pista (lane en px, + a la derecha). */
function offset(track: Track, s: number, lane: number): { x: number; y: number; angle: number } {
  const p = track.pointAt(s);
  const perp = p.angle + Math.PI / 2;
  return { x: p.x + Math.cos(perp) * lane, y: p.y + Math.sin(perp) * lane, angle: p.angle };
}

/**
 * Genera los obstaculos de una pista de forma determinista (misma seed -> mismo
 * layout, clave para el modo sala). En las rectas coloca:
 *  - boost pads (recompensa),
 *  - barreras parciales a un lado (obligan a trazar).
 * Sin conos (se sacaron a pedido: los circuitos quedan mas limpios). Deja libre
 * la zona de largada. `cones` se devuelve vacio para no tocar Renderer/Game.
 */
export function buildObstacles(track: Track, seed: number): Obstacles {
  const rand = rng(seed);
  const cones: Cone[] = [];
  const barriers: Barrier[] = [];
  const boosts: BoostPad[] = [];
  const half = track.def.width / 2;

  const STEP = 0.007;
  let cooldown = 0;

  for (let s = 0.06; s < 0.94; s += STEP) {
    if (cooldown > 0) {
      cooldown -= STEP;
      continue;
    }
    // Solo en rectas: boost o barrera parcial.
    if (curvatureAtS(track, s) < 0.12) {
      const roll = rand();
      if (roll < 0.34) {
        const p = offset(track, s, (rand() - 0.5) * half * 0.4);
        boosts.push({ x: p.x, y: p.y, angle: p.angle });
        cooldown = 0.1;
      } else if (roll < 0.64) {
        const side = rand() < 0.5 ? -1 : 1;
        const p = offset(track, s, side * half * 0.5);
        barriers.push({ x: p.x, y: p.y, angle: p.angle, half: half * 0.4 });
        cooldown = 0.12;
      }
    }
  }

  return { cones, barriers, boosts };
}
