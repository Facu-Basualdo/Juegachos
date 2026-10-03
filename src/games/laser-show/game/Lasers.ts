import {
  BEAM_R,
  BODY_R,
  HIGH_Y,
  LOW_Y,
  MATCH_MS,
  PYLON_R,
  SPIN_REACH,
  STAGE_R,
  WALL_SPAN,
  WALL_WARN,
  ZONE_BLAST,
} from "./constants";

/**
 * El show: TODOS los lasers de la partida, generados de una vez con la semilla que
 * manda el server. Cada laser es una funcion cerrada del tiempo (ms desde la
 * largada): no hay fisica, no hay estado, y cualquier pantalla con la misma semilla y
 * el mismo reloj ve exactamente lo mismo (arquetipo "Saltos Reactivos" de
 * SIMULATION_ARCHITECTURE.md, aprobado por el programador).
 *
 * Tres familias:
 *  - `spin`: brazos que salen de la torre del centro y giran (barrida).
 *  - `wall`: una linea que cruza el escenario de punta a punta (pared).
 *  - `zone`: un circulo que avisa en el piso y despues estalla en columna (lluvia).
 *
 * Alturas: 0 = rasante (se salta), 1 = alto (se esquiva agachado).
 *
 * El choque (`hitsPlayer`) BARRE el intervalo entre el cuadro anterior y el actual
 * en vez de mirar solo el final: la punta de una barrida va a ~20 m/s y en un cuadro
 * atraviesa el cuerpo entero. Para barridas y paredes el barrido es analitico (no
 * por muestras).
 */

export type Height = 0 | 1;

export interface SpinLaser {
  kind: "spin";
  id: number;
  /** Aparece como fantasma (no mata) en `warn`; mata de `t0` a `t1`. */
  warn: number;
  t0: number;
  t1: number;
  /** Angulo del brazo 0 en `t0` (rad; el brazo apunta a (cos, sin) en x-z). */
  a0: number;
  /** Velocidad angular con signo (rad/s). */
  w: number;
  /** Altura de cada brazo; los brazos van repartidos parejo. */
  arms: Height[];
}

export interface WallLaser {
  kind: "wall";
  id: number;
  /** Aparece afuera en `t0`, arranca en `tm`, se va en `t1`. */
  t0: number;
  tm: number;
  t1: number;
  /** Hacia donde avanza (rad). La linea es perpendicular a esa direccion. */
  ang: number;
  /** m/s. */
  v: number;
  h: Height;
}

export interface ZoneLaser {
  kind: "zone";
  id: number;
  /** Avisa de `t0` a `t1`, estalla de `t1` a `t2`. */
  t0: number;
  t1: number;
  t2: number;
  x: number;
  z: number;
  r: number;
}

export type Laser = SpinLaser | WallLaser | ZoneLaser;

/** Una prueba del show: cuando arranca y como la anuncia el locutor. */
export interface Wave {
  t: number;
  title: string;
}

export interface Show {
  lasers: Laser[];
  waves: Wave[];
}

const TWO_PI = Math.PI * 2;

/** Dificultad 0..1 a los `t` ms: llega al tope a los 100 s. */
export function difficulty(t: number): number {
  return Math.max(0, Math.min(1, t / 100_000));
}

export function beamY(h: Height): number {
  return h === 0 ? LOW_Y : HIGH_Y;
}

/** Desde cuando se ve el laser. */
export function laserStart(l: Laser): number {
  return l.kind === "spin" ? l.warn : l.t0;
}

/** Hasta cuando se ve el laser. */
export function laserEnd(l: Laser): number {
  return l.kind === "zone" ? l.t2 : l.t1;
}

/** Angulo del brazo 0 de una barrida a los `t` ms (quieto durante el aviso). */
export function spinAngle(l: SpinLaser, t: number): number {
  const s = (Math.min(Math.max(t, l.t0), l.t1) - l.t0) / 1000;
  return l.a0 + l.w * s;
}

/** Distancia del centro a la linea de la pared, medida en su direccion de avance. */
export function wallOffset(l: WallLaser, t: number): number {
  const s = (Math.min(Math.max(t, l.tm), l.t1) - l.tm) / 1000;
  return -WALL_SPAN + l.v * s;
}

/** El haz a altura `y0` toca un cuerpo con los pies en `y` y este alto? */
function heightOverlap(h: Height, y: number, bodyH: number): boolean {
  const by = beamY(h);
  return by + BEAM_R > y && by - BEAM_R < y + bodyH;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * El laser `l` toco al jugador (pies en `y`, alto `bodyH`) en algun momento entre
 * `tPrev` y `tNow`? Solo cuenta el tramo en que el laser es letal.
 */
export function hitsPlayer(l: Laser, tPrev: number, tNow: number, x: number, y: number, z: number, bodyH: number): boolean {
  if (l.kind === "zone") {
    if (Math.max(tPrev, l.t1) > Math.min(tNow, l.t2)) return false;
    return Math.hypot(x - l.x, z - l.z) < l.r + BODY_R && y < 6;
  }
  const reach = BODY_R + BEAM_R;
  if (l.kind === "wall") {
    const a = Math.max(tPrev, l.tm);
    const b = Math.min(tNow, l.t1);
    if (a > b || !heightOverlap(l.h, y, bodyH)) return false;
    const sa = wallOffset(l, a);
    const sb = wallOffset(l, b);
    const p = x * Math.cos(l.ang) + z * Math.sin(l.ang);
    return p >= Math.min(sa, sb) - reach && p <= Math.max(sa, sb) + reach;
  }
  const a = Math.max(tPrev, l.t0);
  const b = Math.min(tNow, l.t1);
  if (a > b) return false;
  const d = Math.hypot(x, z);
  if (d > SPIN_REACH + reach) return false;
  // Angulo que ocupa el cuerpo visto desde el centro.
  const hw = d <= reach ? Math.PI : Math.asin(Math.min(1, reach / d));
  const thA = spinAngle(l, a);
  const span = spinAngle(l, b) - thA;
  const width = Math.abs(span) + 2 * hw;
  const phi = Math.atan2(z, x);
  const n = l.arms.length;
  for (let k = 0; k < n; k++) {
    if (!heightOverlap(l.arms[k], y, bodyH)) continue;
    if (width >= TWO_PI) return true;
    const start = thA + (k * TWO_PI) / n;
    const lo = span >= 0 ? start - hw : start + span - hw;
    if (mod(phi - lo, TWO_PI) <= width) return true;
  }
  return false;
}

/** PRNG chico y determinista (mulberry32): misma semilla, mismo show en todas las pantallas. */
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

type Template = "sweep" | "wall" | "double" | "cross" | "zones";

/**
 * Arma el show entero. Arranca con una presentacion fija que enseña las tres cosas
 * (saltar una pared rasante, agacharse ante una alta, salir de la lluvia) y despues
 * encadena pruebas al azar que se aceleran y se superponen con la dificultad.
 *
 * Reglas que mantienen el show jugable:
 *  - Nunca dos barridas a la vez.
 *  - Entre dos brazos seguidos de una barrida pasan al menos `MIN_ARM_GAP` s.
 *  - En una pared doble, la segunda viene a `MIN_DOUBLE_GAP_M` metros de la primera:
 *    da para caer del salto y agacharse (o al reves).
 */
export function buildShow(seed: number): Show {
  const rand = rng(seed);
  const lasers: Laser[] = [];
  const waves: Wave[] = [];
  let id = 0;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const randH = (): Height => (rand() < 0.5 ? 0 : 1);

  const addWall = (t: number, ang: number, v: number, h: Height): number => {
    const tm = t + WALL_WARN;
    const t1 = tm + ((2 * WALL_SPAN) / v) * 1000;
    lasers.push({ kind: "wall", id: id++, t0: t, tm, t1, ang, v, h });
    return t1;
  };

  const addZones = (t: number, count: number, r: number, warn: number): void => {
    const placed: { x: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      // Separadas entre si, asi no se apilan todas en un rincon y queda lugar libre.
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 12; tries++) {
        const d = Math.sqrt(rand()) * (STAGE_R - 1);
        const a = rand() * TWO_PI;
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
        if (placed.every((p) => Math.hypot(p.x - x, p.z - z) > r * 1.6)) break;
      }
      placed.push({ x, z });
      const stagger = i * 70;
      lasers.push({
        kind: "zone",
        id: id++,
        t0: t + stagger,
        t1: t + stagger + warn,
        t2: t + stagger + warn + ZONE_BLAST,
        x: round2(x),
        z: round2(z),
        r,
      });
    }
  };

  // ---- Presentacion: una de cada ----
  let t = 1200;
  const introAng = rand() * TWO_PI;
  waves.push({ t, title: "¡SALTÁ EL ROJO!" });
  addWall(t, introAng, 4.2, 0);
  t += 3600;
  waves.push({ t, title: "¡AGACHATE AL CELESTE!" });
  addWall(t, introAng + Math.PI, 4.2, 1);
  t += 3800;
  waves.push({ t, title: "¡LLUVIA DE RAYOS!" });
  addZones(t, 3, 1.9, 1700);
  t += 2900;

  // ---- El show ----
  const MIN_ARM_GAP = 0.6;
  const MIN_DOUBLE_GAP_M = 3.4;
  let spinUntil = 0;

  while (t < MATCH_MS - 1500) {
    const d = difficulty(t);
    const options: [Template, number][] = [
      ["sweep", t >= spinUntil ? 3 : 0],
      ["wall", 3],
      ["double", d > 0.12 ? 2 : 0],
      ["cross", d > 0.35 ? 2 : 0],
      ["zones", 2],
    ];
    const total = options.reduce((s, [, w]) => s + w, 0);
    let roll = rand() * total;
    let kind: Template = "wall";
    for (const [k, w] of options) {
      roll -= w;
      if (roll <= 0 && w > 0) {
        kind = k;
        break;
      }
    }
    const breath = 700 - 550 * d;

    if (kind === "sweep") {
      let n: number;
      if (d < 0.3) n = 1;
      else if (d < 0.6) n = rand() < 0.5 ? 1 : 2;
      else n = rand() < 0.5 ? 2 : 3;
      if (d > 0.85 && rand() < 0.3) n = 4;
      const mixed = n > 1 && d > 0.45 && rand() < 0.5;
      const base = randH();
      const arms: Height[] = Array.from({ length: n }, (_, k) => (mixed ? ((k % 2) as Height) : base));
      let speed = (1.0 + 1.4 * d) * (0.9 + 0.2 * rand());
      speed = Math.min(speed, TWO_PI / (n * MIN_ARM_GAP));
      const w = rand() < 0.5 ? speed : -speed;
      const warn = 1200 - 400 * d;
      const dur = 6000 + 3000 * rand();
      const t0 = t + warn;
      lasers.push({ kind: "spin", id: id++, warn: t, t0, t1: t0 + dur, a0: rand() * TWO_PI, w, arms });
      spinUntil = t0 + dur + 500;
      waves.push({ t, title: n === 1 ? "¡BARRIDA!" : n === 2 ? "¡DOBLE BARRIDA!" : n === 3 ? "¡HÉLICE!" : "¡MOLINO!" });
      // Al principio la barrida va sola; despues se le cruzan otras pruebas encima.
      t += warn + dur * (d < 0.35 ? 1 : 0.85 - 0.5 * d) + breath;
    } else if (kind === "wall") {
      const v = (4.5 + 6.5 * d) * (0.9 + 0.2 * rand());
      const h = randH();
      addWall(t, rand() * TWO_PI, v, h);
      waves.push({ t, title: h === 0 ? "¡PARED RASANTE!" : "¡PARED ALTA!" });
      t += 1700 - 700 * d + breath;
    } else if (kind === "double") {
      const v = (4.5 + 5.5 * d) * (0.9 + 0.2 * rand());
      const ang = rand() * TWO_PI;
      const h = randH();
      const gap = Math.max(650, (MIN_DOUBLE_GAP_M / v) * 1000);
      addWall(t, ang, v, h);
      addWall(t + gap, ang, v, (1 - h) as Height);
      waves.push({ t, title: "¡PARED DOBLE!" });
      t += gap + 1700 - 700 * d + breath;
    } else if (kind === "cross") {
      const v = (4.5 + 5 * d) * (0.9 + 0.2 * rand());
      const ang = rand() * TWO_PI;
      const second = ang + pick([Math.PI / 2, -Math.PI / 2, Math.PI]);
      addWall(t, ang, v, randH());
      addWall(t, second, v, randH());
      waves.push({ t, title: "¡CRUZADAS!" });
      t += 2000 - 600 * d + breath;
    } else {
      const count = 3 + Math.round(3 * d);
      const warn = 1700 - 700 * d;
      addZones(t, count, round2(1.9 - 0.3 * d), warn);
      waves.push({ t, title: "¡LLUVIA DE RAYOS!" });
      t += warn + 700 + breath;
    }
  }

  lasers.sort((a, b) => laserStart(a) - laserStart(b));
  return { lasers, waves };
}

/** Radio del haz que se dibuja desde la torre: arranca en su borde. */
export const SPIN_FROM = PYLON_R;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
