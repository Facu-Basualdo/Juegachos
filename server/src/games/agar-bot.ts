import { AGAR_CONFIG } from "./agar-config.js";

/**
 * IA de los bots de Agar: Utility AI (SIMULATION_ARCHITECTURE.md, 1.2.C). Cada vez
 * que piensa (10 Hz), el bot puntua tres deseos — huir del que se lo puede comer,
 * perseguir al que se puede comer, comer comida — y sigue el que mas vale. Sin arbol
 * de comportamiento ni busqueda: para una celula que solo elige hacia donde ir, una
 * funcion de utilidad por deseo alcanza y no tiene estados que se traben.
 *
 * Son a proposito mediocres: ven menos que un jugador, reaccionan a 10 Hz y se
 * distraen con la comida. Estan para que la arena no este vacia y para que el que se
 * queda quieto en una sala termine comido, no para ganar.
 */

export interface BotCell {
  x: number;
  y: number;
  mass: number;
  r: number;
}

export interface BotWorld {
  size: number;
  /** Celulas ajenas con el centro en el rectangulo (las propias ya filtradas). */
  queryCells(x0: number, y0: number, x1: number, y1: number, cb: (cell: BotCell) => void): void;
  queryPellets(x0: number, y0: number, x1: number, y1: number, cb: (p: { x: number; y: number }) => void): void;
}

export interface BotBrain {
  /** Rumbo de paseo cuando no hay nada que hacer, y hasta cuando dura (simTime). */
  wanderAngle: number;
  wanderUntil: number;
}

export function newBrain(): BotBrain {
  return { wanderAngle: Math.random() * Math.PI * 2, wanderUntil: 0 };
}

/** Radio de vision del bot: algo menos que la mitad de lo que ve un jugador. */
function sight(r: number): number {
  return 380 + r * 3;
}

/** Decide el vector de movimiento (modulo <= 1). */
export function botSteer(me: BotCell, brain: BotBrain, world: BotWorld, simTime: number): { x: number; y: number } {
  const range = sight(me.r);
  const { ratio } = AGAR_CONFIG.eat;

  let fleeX = 0;
  let fleeY = 0;
  let threat = 0;
  let prey: BotCell | null = null;
  let preyScore = 0;

  world.queryCells(me.x - range, me.y - range, me.x + range, me.y + range, (other) => {
    const dx = other.x - me.x;
    const dy = other.y - me.y;
    const dist = Math.hypot(dx, dy) || 1;
    const gap = dist - me.r - other.r;
    if (other.mass >= me.mass * ratio) {
      // Amenaza: cuanto mas cerca, mas urgente (1 pegado, 0 en el borde de la vista).
      const u = clamp01(1 - gap / range);
      threat = Math.max(threat, u);
      fleeX -= (dx / dist) * u;
      fleeY -= (dy / dist) * u;
    } else if (me.mass >= other.mass * ratio) {
      // Presa: vale por la masa que da y por lo cerca que esta.
      const u = (other.mass / me.mass) * clamp01(1 - gap / range);
      if (u > preyScore) {
        preyScore = u;
        prey = other;
      }
    }
  });

  // Huir pesa mas que todo: sobrevivir vale mas que cualquier bocado.
  if (threat > 0.3) return avoidWalls(normalize(fleeX, fleeY), me, world.size);

  // Una presa que vale al menos lo que un par de bocados de comida.
  const target = prey as BotCell | null;
  if (target && preyScore > 0.08) return normalize(target.x - me.x, target.y - me.y);

  // Comida: la mas cercana en un radio chico.
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  const near = 260 + me.r;
  world.queryPellets(me.x - near, me.y - near, me.x + near, me.y + near, (p) => {
    const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });
  const food = best as { x: number; y: number } | null;
  if (food) return normalize(food.x - me.x, food.y - me.y);

  // Nada a la vista: pasear con un rumbo que cambia cada tanto.
  if (simTime >= brain.wanderUntil) {
    brain.wanderAngle += (Math.random() - 0.5) * 2;
    brain.wanderUntil = simTime + 1500 + Math.random() * 2500;
  }
  return avoidWalls({ x: Math.cos(brain.wanderAngle), y: Math.sin(brain.wanderAngle) }, me, world.size);
}

/** Cerca de un borde, se dobla hacia adentro en vez de quedarse frotando contra el. */
function avoidWalls(v: { x: number; y: number }, me: BotCell, size: number): { x: number; y: number } {
  const margin = me.r + 150;
  let x = v.x;
  let y = v.y;
  if (me.x < margin) x += 1;
  if (me.x > size - margin) x -= 1;
  if (me.y < margin) y += 1;
  if (me.y > size - margin) y -= 1;
  return normalize(x, y);
}

function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  return len > 1e-6 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
