import { BALL_COUNT, BALL_R, HALF_L, type BallPos } from "./pool-physics.js";

/** PRNG chico y determinista (mulberry32): el rack depende solo de la semilla del partido. */
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

/** Blanca en el punto de cabeza (el cuarto de mesa del lado del tirador). */
export const HEAD_SPOT = { x: -HALF_L / 2, z: 0 };
/** Punta del triangulo, en el punto de pie. */
export const FOOT_SPOT = { x: HALF_L / 2, z: 0 };

const RACK_GAP = 0.0006;
const RACK_JITTER = 0.0002;

/**
 * Arma la mesa para la rotura: la 8 al centro del triangulo, una lisa y una rayada en
 * las dos puntas de atras, y el resto sorteado con `seed`. Las bolas quedan separadas
 * por un hueco de 0.6 mm (mas un temblor de 0.2 mm) para que no arranquen solapadas.
 */
export function makeRack(seed: number): BallPos[] {
  const rnd = mulberry32(seed);
  const balls: BallPos[] = [];
  for (let i = 0; i < BALL_COUNT; i++) balls.push({ x: 0, z: 0, alive: true });
  balls[0].x = HEAD_SPOT.x;
  balls[0].z = HEAD_SPOT.z;

  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  shuffle(solids, rnd);
  shuffle(stripes, rnd);
  const cornerA = solids.pop() as number;
  const cornerB = stripes.pop() as number;
  const rest = [...solids, ...stripes];
  shuffle(rest, rnd);
  const swap = rnd() < 0.5;

  const rowDx = Math.sqrt(3) * BALL_R + RACK_GAP;
  const colDz = 2 * BALL_R + RACK_GAP;
  let n = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c <= r; c++) {
      let id: number;
      if (r === 2 && c === 1) id = 8;
      else if (r === 4 && c === 0) id = swap ? cornerB : cornerA;
      else if (r === 4 && c === 4) id = swap ? cornerA : cornerB;
      else id = rest[n++];
      balls[id].x = FOOT_SPOT.x + r * rowDx + (rnd() - 0.5) * RACK_JITTER;
      balls[id].z = FOOT_SPOT.z + (c - r / 2) * colDz + (rnd() - 0.5) * RACK_JITTER;
    }
  }
  return balls;
}

function shuffle<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}
