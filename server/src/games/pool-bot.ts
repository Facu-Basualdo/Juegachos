import { BALL_COUNT, BALL_R, HALF_L, HALF_W, V_MAX, simulateShot, type BallPos, type Shot } from "./pool-physics.js";
import { FOOT_SPOT, HEAD_SPOT } from "./pool-rack.js";
import { groupOf, spotIsFree, type BotView } from "./pool-match.js";

/**
 * Bot de Pool. Corre en el server, FUERA de cualquier tick (una vez por turno), y decide
 * con la misma `simulateShot` que arbitra la partida:
 *
 *  1. Enumera tiros: cada bola propia x cada tronera, con la BOLA FANTASMA (el punto a 2R
 *     detras de la bola objetivo, en linea con la tronera), descartando los que tienen una
 *     bola en el camino o un angulo de corte imposible. Si no hay ninguno, o ademas de
 *     ellos, suma tiros de "contacto" suaves contra las bolas legales mas cercanas, para
 *     que el peor caso sea una jugada segura y no una falta.
 *  2. Se queda con los mejores por dificultad geometrica y simula cada uno varias veces
 *     con error de punteria (Monte Carlo acotado: legitimo aca porque esta fuera del loop,
 *     ver 6.4 de SIMULATION_ARCHITECTURE.md). Gana el de mayor valor esperado.
 *  3. Ejecuta con error: el tiro que sale NO es el planeado, asi que el bot falla a veces.
 *
 * Dos niveles: "parejo" (el bot de relleno) y "flojo" (el que cubre a un humano AFK o
 * desconectado: ni simula, apunta al mejor tiro geometrico con mucho error). Reglas, niveles
 * y numeros: src/games/poolnight/CLAUDE.md.
 */

export type BotLevel = "parejo" | "flojo";

interface LevelCfg {
  /** Error de punteria (desvio estandar, rad) y de potencia (fraccion). */
  angleSigma: number;
  powerSigma: number;
  /** Cuantos tiros geometricos se simulan, y con cuantas muestras de error cada uno. */
  simulate: number;
  samples: number;
  /** Cuanto "piensa" antes de tirar (ms), para que se sienta jugador y no maquina. */
  thinkMs: [number, number];
}

/** Valores de partida, NO calibrados: ver "Pendiente de tuning" en el CLAUDE.md del juego. */
const LEVELS: Record<BotLevel, LevelCfg> = {
  parejo: { angleSigma: 0.018, powerSigma: 0.05, simulate: 5, samples: 5, thinkMs: [1200, 2500] },
  flojo: { angleSigma: 0.05, powerSigma: 0.18, simulate: 0, samples: 0, thinkMs: [0, 250] },
};

export interface BotAction {
  /** Donde apoyar la blanca antes de tirar; null si no hace falta moverla. */
  place: { x: number; z: number } | null;
  shot: Shot;
  thinkMs: number;
  /** Angulo desde el que arranca el "apuntado" visible (el cliente barre hasta `shot.angle`). */
  startAngle: number;
}

// ---------------------------------------------------------------- troneras

interface Pocket {
  x: number;
  z: number;
  /** Direccion hacia afuera de la mesa (unitaria). */
  ox: number;
  oz: number;
  /** Cuanto se puede desviar del eje de la tronera una bola que entra (rad). */
  maxOff: number;
}

const SQ = Math.SQRT1_2;
const POCKETS: Pocket[] = [];
for (const sx of [1, -1]) {
  for (const sz of [1, -1]) POCKETS.push({ x: sx * HALF_L, z: sz * HALF_W, ox: sx * SQ, oz: sz * SQ, maxOff: 0.85 });
}
for (const sz of [1, -1]) POCKETS.push({ x: 0, z: sz * HALF_W, ox: 0, oz: sz, maxOff: 0.6 });

/** Un corte mas cerrado que esto no se intenta. */
const MAX_CUT = (72 * Math.PI) / 180;
/** Holgura de un camino libre: dos radios mas un pelo. */
const CLEAR = 2 * BALL_R + 0.004;

// ---------------------------------------------------------------- geometria

interface Candidate {
  angle: number;
  /** Velocidad inicial de la blanca. */
  speed: number;
  /** Menor es mas facil. Solo ordena; el valor real sale de simular. */
  difficulty: number;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function pathClear(balls: BallPos[], ax: number, az: number, bx: number, bz: number, ignoreA: number, ignoreB: number): boolean {
  for (let i = 0; i < BALL_COUNT; i++) {
    if (i === ignoreA || i === ignoreB || !balls[i].alive) continue;
    if (distToSegment(balls[i].x, balls[i].z, ax, az, bx, bz) < CLEAR) return false;
  }
  return true;
}

/** Bolas a las que el equipo puede apuntarle: las suyas, o la 8 si ya limpio el grupo. */
function legalTargets(view: BotView, balls: BallPos[]): number[] {
  const out: number[] = [];
  if (view.groupsLeft[view.team] === 0) {
    if (balls[8].alive) out.push(8);
    return out;
  }
  for (let i = 1; i < BALL_COUNT; i++) if (i !== 8 && balls[i].alive && groupOf(i) === view.team) out.push(i);
  return out;
}

function speedFor(dCue: number, dObj: number): number {
  return Math.min(V_MAX * 0.75, 1.3 + 1.7 * dObj + 0.5 * dCue);
}

/** Tiros "a la tronera": cada bola legal x cada tronera con camino libre y corte posible. */
function pocketShots(balls: BallPos[], targets: number[]): Candidate[] {
  const cue = balls[0];
  const out: Candidate[] = [];
  for (const id of targets) {
    const o = balls[id];
    for (const p of POCKETS) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const dObj = Math.hypot(dx, dz);
      if (dObj < 1e-6) continue;
      const ux = dx / dObj;
      const uz = dz / dObj;
      // La bola tiene que poder entrar por esa boca desde donde viene.
      if (Math.acos(Math.max(-1, Math.min(1, ux * p.ox + uz * p.oz))) > p.maxOff) continue;
      const gx = o.x - ux * 2 * BALL_R;
      const gz = o.z - uz * 2 * BALL_R;
      const cx = gx - cue.x;
      const cz = gz - cue.z;
      const dCue = Math.hypot(cx, cz);
      if (dCue < 1e-6) continue;
      const cut = Math.acos(Math.max(-1, Math.min(1, (cx * ux + cz * uz) / dCue)));
      if (cut > MAX_CUT) continue;
      if (!pathClear(balls, cue.x, cue.z, gx, gz, 0, id)) continue;
      if (!pathClear(balls, o.x, o.z, p.x, p.z, id, 0)) continue;
      const difficulty = (cut / (Math.PI / 2)) * 3 + (dCue + dObj) * 0.8;
      out.push({ angle: Math.atan2(cz, cx), speed: speedFor(dCue, dObj), difficulty });
    }
  }
  out.sort((a, b) => a.difficulty - b.difficulty);
  return out;
}

/** Tiros de contacto: pegarle suave a la bola legal mas cercana. Es la jugada segura. */
function contactShots(balls: BallPos[], targets: number[]): Candidate[] {
  const cue = balls[0];
  const near = targets
    .map((id) => ({ id, d: Math.hypot(balls[id].x - cue.x, balls[id].z - cue.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const out: Candidate[] = [];
  for (const { id, d } of near) {
    if (!pathClear(balls, cue.x, cue.z, balls[id].x, balls[id].z, 0, id)) continue;
    const angle = Math.atan2(balls[id].z - cue.z, balls[id].x - cue.x);
    for (const speed of [1.1 + d * 0.5, 2.2 + d * 0.8]) out.push({ angle, speed: Math.min(V_MAX * 0.6, speed), difficulty: 50 + d });
  }
  return out;
}

/** Que tan buena es la mejor jugada geometrica desde una posicion de blanca dada (para elegir donde apoyarla). */
function bestDifficulty(balls: BallPos[], targets: number[]): number {
  const shots = pocketShots(balls, targets);
  return shots.length > 0 ? shots[0].difficulty : 99;
}

// ---------------------------------------------------------------- valor de un resultado

function valueOf(view: BotView, pocketed: number[], firstContact: number): number {
  const cueIn = pocketed.includes(0);
  const foul = cueIn || firstContact < 0;
  let v = 0;
  let own = 0;
  for (const id of pocketed) {
    if (id === 0) continue;
    if (id === 8) {
      v += view.groupsLeft[view.team] === 0 && !cueIn ? 20 : -20;
    } else if (groupOf(id) === view.team) {
      v += 1;
      own++;
    } else {
      v -= 0.6;
    }
  }
  if (foul) v -= 2;
  else if (own > 0) v += 0.5;
  return v;
}

// ---------------------------------------------------------------- azar

function gauss(rnd: () => number): number {
  const u = Math.max(1e-12, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

function randomIn(rnd: () => number, lo: number, hi: number): number {
  return lo + rnd() * (hi - lo);
}

// ---------------------------------------------------------------- decision

/**
 * Elige que hacer en un turno. `rnd` es el generador del bot (inyectado para que los
 * tests sean reproducibles). No modifica `view`.
 */
export function chooseBotAction(view: BotView, level: BotLevel, rnd: () => number): BotAction {
  const cfg = LEVELS[level];
  const thinkMs = randomIn(rnd, cfg.thinkMs[0], cfg.thinkMs[1]);
  const mustPlace = !view.balls[0].alive;
  const balls = view.balls.map((b) => ({ ...b }));

  // La rotura: la blanca NO se mueve (sale del punto de cabeza); le pega a la punta del triangulo con fuerza.
  if (view.breakShot) {
    const cue = view.balls[0];
    const angle = Math.atan2(FOOT_SPOT.z - cue.z, FOOT_SPOT.x - cue.x) + gauss(rnd) * cfg.angleSigma * 0.5;
    const shot: Shot = { angle, power: Math.min(1, 0.92 + gauss(rnd) * 0.03), offsetX: 0, offsetY: 0 };
    return { place: null, shot, thinkMs, startAngle: angle + randomIn(rnd, -0.5, 0.5) };
  }

  // Donde apoyar la blanca (solo si esta en mano). Se prueban lugares al azar y gana el que
  // deja el mejor tiro geometrico; "flojo" no se esmera.
  let place: BotAction["place"] = null;
  if (view.cueInHand || mustPlace) {
    const tgt = legalTargets(view, balls);
    let bestScore = Infinity;
    const wanted = level === "parejo" ? 40 : 4;
    let found = 0;
    for (let k = 0; k < wanted * 8 && found < wanted; k++) {
      const x = randomIn(rnd, -(HALF_L - 0.1), HALF_L - 0.1);
      const z = randomIn(rnd, -(HALF_W - 0.1), HALF_W - 0.1);
      if (!spotIsFree(balls, 0, x, z)) continue;
      found++;
      balls[0] = { x, z, alive: true };
      const score = level === "parejo" ? bestDifficulty(balls, tgt) : rnd();
      if (score < bestScore) {
        bestScore = score;
        place = { x, z };
      }
    }
    if (place === null) place = { x: HEAD_SPOT.x, z: 0 };
    balls[0] = { x: place.x, z: place.z, alive: true };
  }

  const targets = legalTargets(view, balls);
  const cands = [...pocketShots(balls, targets), ...contactShots(balls, targets)];

  // Sin ningun candidato (todo bloqueado): le pega a lo que pueda, suave.
  if (cands.length === 0) {
    const any = (targets.length > 0 ? targets : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter((i) => balls[i].alive))[0];
    const angle = any === undefined ? 0 : Math.atan2(balls[any].z - balls[0].z, balls[any].x - balls[0].x);
    return finish(place, { angle, power: 0.3, offsetX: 0, offsetY: 0 }, cfg, rnd, thinkMs);
  }

  let chosen: Candidate;
  if (cfg.simulate === 0) {
    chosen = cands[0];
  } else {
    // Los mejores tiros a la tronera, cada uno a tres potencias, mas los de contacto: se
    // simula cada uno con error y se queda con el de mayor valor esperado.
    const pockets = cands.filter((c) => c.difficulty < 50).slice(0, cfg.simulate);
    const pool: Candidate[] = [];
    for (const c of pockets) for (const f of [0.8, 1, 1.3]) pool.push({ ...c, speed: Math.min(V_MAX * 0.85, c.speed * f) });
    pool.push(...cands.filter((c) => c.difficulty >= 50));
    let best = -Infinity;
    chosen = pool[0];
    for (const c of pool) {
      let sum = 0;
      for (let s = 0; s < cfg.samples; s++) {
        const noisy: Shot = {
          angle: c.angle + gauss(rnd) * cfg.angleSigma,
          power: clamp01((c.speed * (1 + gauss(rnd) * cfg.powerSigma)) / V_MAX),
          offsetX: 0,
          offsetY: 0,
        };
        const r = simulateShot(balls, noisy);
        sum += valueOf(view, r.pocketed, r.firstContact);
      }
      const mean = sum / cfg.samples;
      if (mean > best) {
        best = mean;
        chosen = c;
      }
    }
  }

  return finish(place, { angle: chosen.angle, power: clamp01(chosen.speed / V_MAX), offsetX: 0, offsetY: 0 }, cfg, rnd, thinkMs);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Aplica el error de ejecucion: el tiro que sale no es el planeado. */
function finish(place: BotAction["place"], shot: Shot, cfg: LevelCfg, rnd: () => number, thinkMs: number): BotAction {
  const out: Shot = {
    angle: shot.angle + gauss(rnd) * cfg.angleSigma,
    power: clamp01(shot.power * (1 + gauss(rnd) * cfg.powerSigma)),
    offsetX: shot.offsetX,
    offsetY: shot.offsetY,
  };
  return { place, shot: out, thinkMs, startAngle: out.angle + randomIn(rnd, -0.6, 0.6) };
}
