import { VIBORITA_CONFIG as C, wrapAngle } from "./viborita-config.js";

/**
 * IA de los bots de Viborita: Utility AI (SIMULATION_ARCHITECTURE.md, 1.2.C) con
 * sondas hacia adelante.
 *
 * Cada vez que piensa (10 Hz) el bot elige un DESEO — cortarle el paso a una mas
 * chica que tiene cerca, ir a la comida que mas vale, o pasear — y despues lo pasa
 * por las SONDAS: tira rayos en abanico desde la cabeza y mide cuanto puede avanzar
 * por cada uno sin tocar un cuerpo ajeno ni el borde. Si el rumbo deseado esta
 * tapado, toma el rayo mas libre que se parezca a lo que queria. Es lo que hace que
 * no se suicide contra la primera viborita que cruza.
 *
 * Son a proposito mediocres (ven poco, reaccionan a 10 Hz, no encierran): estan para
 * que la arena no este vacia y para cortarle el paso al que se queda dando vueltas.
 */

export interface BotSnake {
  x: number;
  y: number;
  a: number;
  mass: number;
  r: number;
}

export interface BotWorld {
  /** Radio del mapa (el centro es (R, R)). */
  R: number;
  /** Segmentos AJENOS con el centro en el rectangulo: (x, y, radio del cuerpo). */
  querySegments(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number, r: number) => void): void;
  queryPellets(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number, mass: number) => void): void;
  /** Cabezas ajenas: (x, y, angulo, masa). */
  queryHeads(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number, a: number, mass: number) => void): void;
}

export interface BotBrain {
  wanderAngle: number;
  wanderUntil: number;
}

export function newBrain(): BotBrain {
  return { wanderAngle: Math.random() * Math.PI * 2, wanderUntil: 0 };
}

/** Rumbos que se sondean, relativos al actual (rad). */
const PROBES = [-1.5, -1.1, -0.75, -0.4, 0, 0.4, 0.75, 1.1, 1.5];

export function botSteer(me: BotSnake, brain: BotBrain, world: BotWorld, simTime: number): { angle: number; boost: boolean } {
  let desired = me.a;
  let boost = false;

  // ---- Deseo ----
  const sight = 320 + me.r * 6;
  let prey: { x: number; y: number; a: number } | null = null;
  let preyDist = Infinity;
  world.queryHeads(me.x - sight, me.y - sight, me.x + sight, me.y + sight, (x, y, a, mass) => {
    if (mass > me.mass * 0.8) return;
    const d = Math.hypot(x - me.x, y - me.y);
    if (d < preyDist) {
      preyDist = d;
      prey = { x, y, a };
    }
  });
  const target = prey as { x: number; y: number; a: number } | null;
  if (target && me.mass > 30) {
    // Cortarle el paso: apuntar adelante de su cabeza, no a su cabeza.
    const lead = 90 + me.r * 3;
    desired = Math.atan2(target.y + Math.sin(target.a) * lead - me.y, target.x + Math.cos(target.a) * lead - me.x);
    boost = me.mass > 60 && preyDist < 260;
  } else {
    let best: { x: number; y: number } | null = null;
    let bestScore = 0;
    const near = 260 + me.r * 4;
    world.queryPellets(me.x - near, me.y - near, me.x + near, me.y + near, (x, y, mass) => {
      const d = Math.hypot(x - me.x, y - me.y) + 20;
      // Lo que vale dividido lo que cuesta llegar, castigando lo que queda atras.
      const behind = Math.abs(wrapAngle(Math.atan2(y - me.y, x - me.x) - me.a)) > 1.6 ? 0.4 : 1;
      const score = (mass / d) * behind;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    });
    const food = best as { x: number; y: number } | null;
    if (food) {
      desired = Math.atan2(food.y - me.y, food.x - me.x);
    } else {
      if (simTime >= brain.wanderUntil) {
        brain.wanderAngle = me.a + (Math.random() - 0.5) * 2;
        brain.wanderUntil = simTime + 1200 + Math.random() * 2000;
      }
      desired = brain.wanderAngle;
    }
  }

  // ---- Sondas ----
  // Las cabezas ajenas cercanas son obstaculos que se mueven: se proyectan un poco
  // hacia adelante, que es donde van a estar cuando el bot llegue. Sin esto dos bots
  // que van a la misma comida se chocaban de frente.
  const heads: { x: number; y: number; r: number }[] = [];
  const hs = 300 + me.r * 4;
  world.queryHeads(me.x - hs, me.y - hs, me.x + hs, me.y + hs, (x, y, a, mass) => {
    const r = C.snake.rBase + C.snake.rK * Math.sqrt(mass);
    for (const ahead of [0, 40, 80]) heads.push({ x: x + Math.cos(a) * ahead, y: y + Math.sin(a) * ahead, r: r + 10 });
  });
  const look = (boost ? 200 : 130) + me.r * 6;
  let bestAngle = desired;
  let bestValue = -Infinity;
  let desiredFree = 0;
  const freeOf = (angle: number): number => clearance(me, angle, look, world, heads);
  desiredFree = freeOf(desired);
  if (desiredFree >= look) return { angle: desired, boost };

  for (const off of PROBES) {
    const angle = me.a + off;
    const free = freeOf(angle);
    // Libre manda; a igualdad, lo mas parecido a lo que queria.
    const value = free - Math.abs(wrapAngle(angle - desired)) * 20;
    if (value > bestValue) {
      bestValue = value;
      bestAngle = angle;
    }
  }
  // Acorralado de cerca: acelerar puede salvarlo.
  const panic = desiredFree < me.r * 3 && me.mass > C.boost.minMass + 5;
  return { angle: wrapAngle(bestAngle), boost: boost || panic };
}

/** Cuanto se puede avanzar en esa direccion sin tocar un cuerpo ajeno ni el borde. */
function clearance(
  me: BotSnake,
  angle: number,
  look: number,
  world: BotWorld,
  heads: { x: number; y: number; r: number }[],
): number {
  const step = Math.max(10, me.r);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pad = me.r + 6;
  for (let d = step; d <= look; d += step) {
    const x = me.x + cos * d;
    const y = me.y + sin * d;
    if (Math.hypot(x - world.R, y - world.R) + pad > world.R) return d - step;
    let hit = false;
    const q = pad + 40;
    world.querySegments(x - q, y - q, x + q, y + q, (sx, sy, sr) => {
      if (!hit && (sx - x) ** 2 + (sy - y) ** 2 < (sr + pad) ** 2) hit = true;
    });
    if (hit) return d - step;
    for (const h of heads) if ((h.x - x) ** 2 + (h.y - y) ** 2 < (h.r + pad) ** 2) return d - step;
  }
  return look;
}
