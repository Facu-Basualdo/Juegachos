/**
 * Fisica de Pool: `simulateShot` toma el estado de la mesa y un tiro y devuelve TODO el
 * desenlace de una sola vez. Es una funcion pura (sin red, sin reloj, sin Math.random):
 * mismo estado + mismo tiro = mismo resultado, que es lo que deja que el server sea el
 * arbitro y que los clientes solo reproduzcan. Arquetipo "Billar / Pool" de
 * SIMULATION_ARCHITECTURE.md (seccion 3.5); decisiones y valores en
 * src/games/poolnight/CLAUDE.md.
 *
 * Como funciona:
 *  - Paso fijo (`STEP_DT`). Dentro de cada paso se buscan los eventos (choque bola-bola,
 *    banda, nudo de tronera, entrada a tronera) por TIEMPO DE IMPACTO, se avanza hasta el
 *    mas cercano, se resuelve y se sigue con el resto del paso. Nada de detectar
 *    solapamiento y empujar: a V_MAX la blanca recorre ~3 cm por paso.
 *  - El movimiento entre eventos es analitico: la bola DESLIZA (rozamiento cinetico hasta
 *    que la velocidad del punto de contacto con el paño se anula) y despues RUEDA
 *    (rodadura, casi nada) hasta frenar. Los dos son aceleracion constante, asi que el
 *    cliente puede evaluar la posicion en cualquier instante a partir de un `Segment`.
 *  - El spin entra por el punto de golpe del taco. Los choques conservan el spin
 *    horizontal (wx, wz): por eso el efecto de "seguir" y "retroceso" sale solo, porque
 *    despues del choque la bola queda deslizando contra su propio spin.
 *
 * Ejes (vista cenital): x a lo largo de la mesa (hacia la derecha en pantalla), z a lo
 * ancho (hacia ABAJO en pantalla, hacia quien mira), y vertical. El angulo es el de
 * atan2(z, x). "Derecha" del tirador es (-dirZ, dirX): si el render invierte algun eje,
 * se invierte aca el signo de `offsetX`, no la fisica.
 *
 * Zero allocations en el loop de pasos: todo vive en Float64Array preasignados. Se aloca
 * un objeto por EVENTO (un segmento, un evento), que son decenas por tiro, no por paso.
 */

// ---------------------------------------------------------------- constantes (valores de partida, NO medidos)

const G = 9.81;
export const BALL_R = 0.028575;
export const HALF_L = 1.27;
export const HALF_W = 0.635;

export const MU_SLIDE = 0.2;
export const MU_ROLL = 0.01;
export const E_BALL = 0.95;
export const E_CUSHION = 0.75;
export const MU_BALL = 0.05;
export const MU_CUSHION = 0.15;
/** Cuanto se apaga por segundo el spin lateral (rad/s^2). */
export const SPIN_Y_DECEL = 12;
export const V_MAX = 7;
/** Maximo corrimiento del punto de golpe, en fraccion del radio (mas alla se "pifia"). */
export const MAX_OFFSET = 0.5;
export const STEP_DT = 1 / 240;
export const MAX_SHOT_TIME = 40;

export const POCKET_SCALE = 1.15;
/** Distancia, a lo largo de la banda, entre la esquina y el nudo de la tronera de esquina. */
export const CORNER_GAP = 0.082 * POCKET_SCALE;
/** Semiancho de la boca de las troneras del medio. */
export const SIDE_GAP = 0.0635 * POCKET_SCALE;
export const KNUCKLE_R = 0.006;

export const BALL_COUNT = 16;
export const PHASE_REST = 0;
export const PHASE_SLIDE = 1;
export const PHASE_ROLL = 2;
export const PHASE_POCKETED = 3;

const U_EPS = 1e-6;
const V_EPS = 1e-4;
/**
 * Velocidad de acercamiento (m/s) por debajo de la cual dos cuerpos se consideran
 * "rozando" y no chocando. Buscar y resolver TIENEN que usar el mismo umbral: con
 * `b < 0` de un lado y `vn <= 0` del otro, una bola que roza a otra de costado quedaba
 * en un ciclo infinito (la busqueda la veia acercarse por un ulp y la resolucion no
 * hacia nada), que se vio en las roturas.
 */
const APPROACH_EPS = 1e-9;
/** Lo mismo expresado sobre `b = dp . dv` en la busqueda (con 2x de margen sobre la resolucion). */
const PAIR_B_EPS = 2 * APPROACH_EPS * 2 * BALL_R;
const KNUCKLE_B_EPS = 2 * APPROACH_EPS * (BALL_R + KNUCKLE_R);
const MAX_ITER = 128;
const SLIDE_DECEL = MU_SLIDE * G;
const ROLL_DECEL = MU_ROLL * G;
const SPIN_K = 5 / (2 * BALL_R);

// ---------------------------------------------------------------- tipos

export interface BallPos {
  x: number;
  z: number;
  alive: boolean;
}

export interface Shot {
  /** Direccion del tiro, atan2(z, x). */
  angle: number;
  /** 0 a 1; la velocidad inicial es `power * V_MAX`. */
  power: number;
  /** Punto de golpe lateral, -1 a 1 (positivo = derecha del tirador). */
  offsetX: number;
  /** Punto de golpe vertical, -1 a 1 (positivo = arriba: "seguir"; negativo = "retroceso"). */
  offsetY: number;
}

/** Estado de una bola desde `t` en adelante, hasta el proximo segmento de la misma bola. */
export interface Segment {
  b: number;
  t: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  ph: number;
}

export type ShotEventKind = "cue" | "ball" | "cushion" | "pocket";

export interface ShotEvent {
  t: number;
  kind: ShotEventKind;
  /** Bola protagonista (en "ball", la de menor indice). */
  a: number;
  /** La otra bola de un choque bola-bola; -1 si no aplica. */
  b: number;
  /** Velocidad de impacto contra la normal (para el volumen del sonido). */
  speed: number;
  x: number;
  z: number;
}

export interface ShotResult {
  /** Solo las bolas que se movieron; las demas se quedan donde estaban. */
  segments: Segment[];
  events: ShotEvent[];
  duration: number;
  final: BallPos[];
  /** Ids de bola embocadas, en orden. */
  pocketed: number[];
  /** Primera bola que toco la blanca; -1 si no toco ninguna. */
  firstContact: number;
  /** Veces que un paso agoto MAX_ITER (si no es 0, algo esta mal). */
  capHits: number;
  timedOut: boolean;
}

/** Vista de solo lectura del estado interno, para los chequeos de los tests. */
export interface StepView {
  now: number;
  x: Float64Array;
  z: Float64Array;
  vx: Float64Array;
  vz: Float64Array;
  wx: Float64Array;
  wy: Float64Array;
  wz: Float64Array;
  ph: Uint8Array;
}

export interface SimulateOptions {
  /** Se llama al final de cada paso fijo. */
  onStep?: (view: StepView) => void;
}

// ---------------------------------------------------------------- geometria de la mesa

interface Face {
  /** 0: la normal va por x; 1: va por z. */
  axis: 0 | 1;
  sign: 1 | -1;
  /** Coordenada del CENTRO de la bola cuando toca la banda. */
  wall: number;
  lo: number;
  hi: number;
}

const FACES: Face[] = [];
for (const s of [1, -1] as const) {
  // Bandas cortas (en x = +-HALF_L): de esquina a esquina menos las bocas.
  FACES.push({ axis: 0, sign: s, wall: s * (HALF_L - BALL_R), lo: -(HALF_W - CORNER_GAP), hi: HALF_W - CORNER_GAP });
  // Bandas largas (en z = +-HALF_W): dos tramos cada una, separados por la tronera del medio.
  FACES.push({ axis: 1, sign: s, wall: s * (HALF_W - BALL_R), lo: SIDE_GAP, hi: HALF_L - CORNER_GAP });
  FACES.push({ axis: 1, sign: s, wall: s * (HALF_W - BALL_R), lo: -(HALF_L - CORNER_GAP), hi: -SIDE_GAP });
}

/** Los "nudos": las puntas de banda que bordean cada boca, como circulos chicos fijos. */
export const KNUCKLES = new Float64Array(12 * 2);
{
  let k = 0;
  const put = (x: number, z: number) => {
    KNUCKLES[k++] = x;
    KNUCKLES[k++] = z;
  };
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      put(sx * (HALF_L - CORNER_GAP), sz * HALF_W);
      put(sx * HALF_L, sz * (HALF_W - CORNER_GAP));
    }
  }
  for (const sz of [1, -1]) {
    put(SIDE_GAP, sz * HALF_W);
    put(-SIDE_GAP, sz * HALF_W);
  }
}
const KNUCKLE_COUNT = KNUCKLES.length / 2;
const KNUCKLE_SUM = BALL_R + KNUCKLE_R;

// ---------------------------------------------------------------- el simulador

const EV_BALL = 1;
const EV_FACE = 2;
const EV_KNUCKLE = 3;
const EV_POT = 4;

class Sim {
  readonly x = new Float64Array(BALL_COUNT);
  readonly z = new Float64Array(BALL_COUNT);
  readonly vx = new Float64Array(BALL_COUNT);
  readonly vz = new Float64Array(BALL_COUNT);
  readonly wx = new Float64Array(BALL_COUNT);
  readonly wy = new Float64Array(BALL_COUNT);
  readonly wz = new Float64Array(BALL_COUNT);
  readonly ph = new Uint8Array(BALL_COUNT);

  private now = 0;
  private segs: Segment[] = [];
  private evs: ShotEvent[] = [];
  private potted: number[] = [];
  private firstContact = -1;
  private capHits = 0;

  // Resultado de findEvent (campos y no un objeto: no se aloca nada por paso).
  private evT = 0;
  private evKind = 0;
  private evA = 0;
  private evB = 0;

  private readonly view: StepView = {
    now: 0,
    x: this.x,
    z: this.z,
    vx: this.vx,
    vz: this.vz,
    wx: this.wx,
    wy: this.wy,
    wz: this.wz,
    ph: this.ph,
  };

  run(state: BallPos[], shot: Shot, opts?: SimulateOptions): ShotResult {
    if (state.length !== BALL_COUNT) throw new Error(`simulateShot: se esperaban ${BALL_COUNT} bolas`);
    if (!state[0].alive) throw new Error("simulateShot: la blanca no esta en la mesa");

    this.now = 0;
    this.segs = [];
    this.evs = [];
    this.potted = [];
    this.firstContact = -1;
    this.capHits = 0;
    for (let i = 0; i < BALL_COUNT; i++) {
      this.x[i] = state[i].x;
      this.z[i] = state[i].z;
      this.vx[i] = this.vz[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
      this.ph[i] = state[i].alive ? PHASE_REST : PHASE_POCKETED;
    }

    this.strike(shot);

    let timedOut = false;
    while (!this.allResting()) {
      if (this.now >= MAX_SHOT_TIME) {
        timedOut = true;
        break;
      }
      this.step();
      if (opts?.onStep) {
        this.view.now = this.now;
        opts.onStep(this.view);
      }
    }
    if (timedOut) {
      for (let i = 0; i < BALL_COUNT; i++) {
        if (this.ph[i] === PHASE_SLIDE || this.ph[i] === PHASE_ROLL) {
          this.vx[i] = this.vz[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
          this.ph[i] = PHASE_REST;
          this.emit(i, this.now);
        }
      }
    }

    const final: BallPos[] = [];
    for (let i = 0; i < BALL_COUNT; i++) {
      final.push({ x: this.x[i], z: this.z[i], alive: this.ph[i] !== PHASE_POCKETED });
    }
    return {
      segments: this.segs,
      events: this.evs,
      duration: this.now,
      final,
      pocketed: this.potted,
      firstContact: this.firstContact,
      capHits: this.capHits,
      timedOut,
    };
  }

  // ------------------------------------------------------------ golpe del taco

  private strike(shot: Shot): void {
    const dx = Math.cos(shot.angle);
    const dz = Math.sin(shot.angle);
    let a = Number.isFinite(shot.offsetX) ? shot.offsetX : 0;
    let b = Number.isFinite(shot.offsetY) ? shot.offsetY : 0;
    const len = Math.hypot(a, b);
    if (len > MAX_OFFSET) {
      a = (a / len) * MAX_OFFSET;
      b = (b / len) * MAX_OFFSET;
    }
    const power = Number.isFinite(shot.power) ? Math.min(1, Math.max(0, shot.power)) : 0;
    const V = power * V_MAX;
    this.vx[0] = V * dx;
    this.vz[0] = V * dz;
    // omega = (5V / 2R) * [ a * y + b * (dz, 0, -dx) ]: el top spin (b > 0) coincide con
    // el giro de rodar hacia adelante, y b = 0.4 da rodadura pura (u = 0).
    const k = SPIN_K * V;
    this.wy[0] = k * a;
    this.wx[0] = k * b * dz;
    this.wz[0] = -k * b * dx;
    this.settle(0);
    this.emit(0, 0);
    this.evs.push({ t: 0, kind: "cue", a: 0, b: -1, speed: V, x: this.x[0], z: this.z[0] });
  }

  // ------------------------------------------------------------ un paso fijo

  private step(): void {
    let rem = STEP_DT;
    let iter = 0;
    while (rem > 1e-12) {
      this.findEvent(rem);
      if (this.evKind === 0) {
        this.advanceAll(rem);
        this.now += rem;
        return;
      }
      const t = this.evT;
      this.advanceAll(t);
      this.now += t;
      rem -= t;
      this.resolve();
      if (++iter >= MAX_ITER) {
        this.capHits++;
        this.advanceAll(rem);
        this.now += rem;
        return;
      }
    }
  }

  private allResting(): boolean {
    for (let i = 0; i < BALL_COUNT; i++) {
      const p = this.ph[i];
      if (p === PHASE_SLIDE || p === PHASE_ROLL) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ movimiento analitico

  private advanceAll(d: number): void {
    if (d <= 0) return;
    for (let i = 0; i < BALL_COUNT; i++) {
      const p = this.ph[i];
      if (p === PHASE_SLIDE || p === PHASE_ROLL) this.advanceBall(i, d);
    }
  }

  private advanceBall(i: number, total: number): void {
    let d = total;
    let elapsed = 0;
    while (d > 1e-15) {
      if (this.ph[i] === PHASE_SLIDE) {
        const ux = this.vx[i] + BALL_R * this.wz[i];
        const uz = this.vz[i] - BALL_R * this.wx[i];
        const um = Math.hypot(ux, uz);
        if (um < U_EPS) {
          this.toRoll(i, this.now + elapsed);
          continue;
        }
        const ts = um / (3.5 * SLIDE_DECEL);
        const h = Math.min(d, ts);
        const nx = ux / um;
        const nz = uz / um;
        const ax = -SLIDE_DECEL * nx;
        const az = -SLIDE_DECEL * nz;
        this.x[i] += this.vx[i] * h + 0.5 * ax * h * h;
        this.z[i] += this.vz[i] * h + 0.5 * az * h * h;
        this.vx[i] += ax * h;
        this.vz[i] += az * h;
        const k = SPIN_K * SLIDE_DECEL;
        this.wx[i] += k * nz * h;
        this.wz[i] -= k * nx * h;
        this.decayWy(i, h);
        elapsed += h;
        d -= h;
        if (ts <= h) this.toRoll(i, this.now + elapsed);
      } else if (this.ph[i] === PHASE_ROLL) {
        const s = Math.hypot(this.vx[i], this.vz[i]);
        if (s < V_EPS) {
          this.toRest(i, this.now + elapsed);
          return;
        }
        const tr = s / ROLL_DECEL;
        const h = Math.min(d, tr);
        const ux = this.vx[i] / s;
        const uz = this.vz[i] / s;
        const dist = s * h - 0.5 * ROLL_DECEL * h * h;
        this.x[i] += ux * dist;
        this.z[i] += uz * dist;
        const s2 = Math.max(0, s - ROLL_DECEL * h);
        this.vx[i] = ux * s2;
        this.vz[i] = uz * s2;
        this.wx[i] = this.vz[i] / BALL_R;
        this.wz[i] = -this.vx[i] / BALL_R;
        this.decayWy(i, h);
        elapsed += h;
        d -= h;
        if (tr <= h) {
          this.toRest(i, this.now + elapsed);
          return;
        }
      } else {
        return;
      }
    }
  }

  private decayWy(i: number, h: number): void {
    const w = this.wy[i];
    if (w === 0) return;
    const dw = SPIN_Y_DECEL * h;
    this.wy[i] = Math.abs(w) <= dw ? 0 : w - Math.sign(w) * dw;
  }

  private toRoll(i: number, t: number): void {
    this.ph[i] = PHASE_ROLL;
    this.wx[i] = this.vz[i] / BALL_R;
    this.wz[i] = -this.vx[i] / BALL_R;
    this.emit(i, t);
  }

  private toRest(i: number, t: number): void {
    this.ph[i] = PHASE_REST;
    this.vx[i] = this.vz[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
    this.emit(i, t);
  }

  /** Decide la fase de una bola cuya velocidad o spin acaban de cambiar de golpe. */
  private settle(i: number): void {
    const ux = this.vx[i] + BALL_R * this.wz[i];
    const uz = this.vz[i] - BALL_R * this.wx[i];
    if (Math.hypot(ux, uz) < U_EPS) {
      if (Math.hypot(this.vx[i], this.vz[i]) < V_EPS) {
        this.vx[i] = this.vz[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
        this.ph[i] = PHASE_REST;
      } else {
        this.ph[i] = PHASE_ROLL;
        this.wx[i] = this.vz[i] / BALL_R;
        this.wz[i] = -this.vx[i] / BALL_R;
      }
    } else {
      this.ph[i] = PHASE_SLIDE;
    }
  }

  private emit(i: number, t: number): void {
    this.segs.push({
      b: i,
      t,
      x: this.x[i],
      z: this.z[i],
      vx: this.vx[i],
      vz: this.vz[i],
      wx: this.wx[i],
      wy: this.wy[i],
      wz: this.wz[i],
      ph: this.ph[i],
    });
  }

  // ------------------------------------------------------------ busqueda del proximo evento

  /**
   * Busca el evento mas cercano dentro de `rem`. Para el tiempo de impacto trata cada
   * bola con velocidad constante durante el paso (la aceleracion es <= 2 m/s^2, o sea
   * ~0.02 mm de error en 4 ms); las posiciones despues se avanzan EXACTO.
   */
  private findEvent(rem: number): void {
    let best = rem;
    let kind = 0;
    let ea = 0;
    let eb = 0;
    const { x, z, vx, vz, ph } = this;

    for (let i = 0; i < BALL_COUNT; i++) {
      const pi = ph[i];
      if (pi !== PHASE_SLIDE && pi !== PHASE_ROLL) continue;

      // Bola contra bola. Si las dos se mueven, el par se cuenta una sola vez (i < j).
      for (let j = 0; j < BALL_COUNT; j++) {
        if (j === i) continue;
        const pj = ph[j];
        if (pj === PHASE_POCKETED) continue;
        if ((pj === PHASE_SLIDE || pj === PHASE_ROLL) && j < i) continue;
        const dpx = x[j] - x[i];
        const dpz = z[j] - z[i];
        const dvx = vx[j] - vx[i];
        const dvz = vz[j] - vz[i];
        const c = dpx * dpx + dpz * dpz - 4 * BALL_R * BALL_R;
        const b = dpx * dvx + dpz * dvz;
        let t: number;
        if (b >= -PAIR_B_EPS) continue;
        if (c <= 0) {
          t = 0;
        } else {
          const a = dvx * dvx + dvz * dvz;
          const disc = b * b - a * c;
          if (disc < 0) continue;
          t = (-b - Math.sqrt(disc)) / a;
          if (t < 0) t = 0;
        }
        if (t < best || (kind === 0 && t <= best)) {
          best = t;
          kind = EV_BALL;
          ea = i;
          eb = j;
        }
      }

      // Bandas.
      for (let f = 0; f < FACES.length; f++) {
        const face = FACES[f];
        const s = face.sign;
        const pa = face.axis === 0 ? x[i] : z[i];
        const pt = face.axis === 0 ? z[i] : x[i];
        const va = face.axis === 0 ? vx[i] : vz[i];
        const vt = face.axis === 0 ? vz[i] : vx[i];
        const approach = s * va;
        if (approach <= 1e-12) continue;
        const gap = (face.wall - pa) * s;
        const t = gap > 0 ? gap / approach : 0;
        if (t > best || (kind !== 0 && t >= best)) continue;
        const q = pt + vt * t;
        if (q < face.lo || q > face.hi) continue;
        best = t;
        kind = EV_FACE;
        ea = i;
        eb = f;
      }

      // Nudos de las troneras.
      for (let k = 0; k < KNUCKLE_COUNT; k++) {
        const dpx = KNUCKLES[2 * k] - x[i];
        const dpz = KNUCKLES[2 * k + 1] - z[i];
        const c = dpx * dpx + dpz * dpz - KNUCKLE_SUM * KNUCKLE_SUM;
        const b = -(dpx * vx[i] + dpz * vz[i]);
        let t: number;
        if (b >= -KNUCKLE_B_EPS) continue;
        if (c <= 0) {
          t = 0;
        } else {
          const a = vx[i] * vx[i] + vz[i] * vz[i];
          const disc = b * b - a * c;
          if (disc < 0) continue;
          t = (-b - Math.sqrt(disc)) / a;
          if (t < 0) t = 0;
        }
        if (t > best || (kind !== 0 && t >= best)) continue;
        best = t;
        kind = EV_KNUCKLE;
        ea = i;
        eb = k;
      }

      // Entrada a tronera: el centro cruza el borde de la mesa (solo se puede por una boca,
      // porque en todo el resto la banda frena a la bola antes).
      for (let side = 0; side < 4; side++) {
        let t: number;
        if (side === 0) {
          if (vx[i] <= 0) continue;
          t = Math.max(0, (HALF_L - x[i]) / vx[i]);
        } else if (side === 1) {
          if (vx[i] >= 0) continue;
          t = Math.max(0, (-HALF_L - x[i]) / vx[i]);
        } else if (side === 2) {
          if (vz[i] <= 0) continue;
          t = Math.max(0, (HALF_W - z[i]) / vz[i]);
        } else {
          if (vz[i] >= 0) continue;
          t = Math.max(0, (-HALF_W - z[i]) / vz[i]);
        }
        if (t > best || (kind !== 0 && t >= best)) continue;
        best = t;
        kind = EV_POT;
        ea = i;
        eb = side;
      }
    }

    this.evT = best;
    this.evKind = kind;
    this.evA = ea;
    this.evB = eb;
  }

  // ------------------------------------------------------------ resolucion de eventos

  private resolve(): void {
    switch (this.evKind) {
      case EV_BALL:
        this.collideBalls(this.evA, this.evB);
        break;
      case EV_FACE: {
        const f = FACES[this.evB];
        const i = this.evA;
        if (f.axis === 0) {
          this.x[i] = f.wall;
          this.bounceStatic(i, f.sign, 0, E_CUSHION);
        } else {
          this.z[i] = f.wall;
          this.bounceStatic(i, 0, f.sign, E_CUSHION);
        }
        break;
      }
      case EV_KNUCKLE: {
        const i = this.evA;
        const k = this.evB;
        let nx = KNUCKLES[2 * k] - this.x[i];
        let nz = KNUCKLES[2 * k + 1] - this.z[i];
        const d = Math.hypot(nx, nz) || 1;
        nx /= d;
        nz /= d;
        if (d < KNUCKLE_SUM) {
          this.x[i] -= nx * (KNUCKLE_SUM - d);
          this.z[i] -= nz * (KNUCKLE_SUM - d);
        }
        this.bounceStatic(i, nx, nz, E_CUSHION);
        break;
      }
      case EV_POT:
        this.pocket(this.evA);
        break;
    }
  }

  private collideBalls(i: number, j: number): void {
    let nx = this.x[j] - this.x[i];
    let nz = this.z[j] - this.z[i];
    const d = Math.hypot(nx, nz) || 1;
    nx /= d;
    nz /= d;
    const vn = (this.vx[i] - this.vx[j]) * nx + (this.vz[i] - this.vz[j]) * nz;
    if (vn <= APPROACH_EPS) return;

    if (i === 0 && this.firstContact < 0) this.firstContact = j;
    if (j === 0 && this.firstContact < 0) this.firstContact = i;

    // Normal: masas iguales, restitucion E_BALL.
    const jn = ((1 + E_BALL) * vn) / 2;
    this.vx[i] -= jn * nx;
    this.vz[i] -= jn * nz;
    this.vx[j] += jn * nx;
    this.vz[j] += jn * nz;

    // Tangencial (rozamiento entre bolas): da el "throw" y se lleva el spin lateral. Un
    // impulso tangencial jt cambia la velocidad relativa del contacto en 7 jt (2 jt de las
    // velocidades y 5 jt del giro de las dos bolas), asi que jt no puede pasar de ut / 7.
    const tx = nz;
    const tz = -nx;
    const ut = (this.vx[i] - this.vx[j]) * tx + (this.vz[i] - this.vz[j]) * tz + BALL_R * (this.wy[i] + this.wy[j]);
    const jt = -Math.sign(ut) * Math.min(MU_BALL * jn, Math.abs(ut) / 7);
    this.vx[i] += jt * tx;
    this.vz[i] += jt * tz;
    this.vx[j] -= jt * tx;
    this.vz[j] -= jt * tz;
    const dw = SPIN_K * jt;
    this.wy[i] += dw;
    this.wy[j] += dw;

    // Si quedaron solapadas por redondeo, se separan por igual.
    if (d < 2 * BALL_R) {
      const push = (2 * BALL_R - d) / 2;
      this.x[i] -= nx * push;
      this.z[i] -= nz * push;
      this.x[j] += nx * push;
      this.z[j] += nz * push;
    }

    this.settle(i);
    this.settle(j);
    const px = (this.x[i] + this.x[j]) / 2;
    const pz = (this.z[i] + this.z[j]) / 2;
    this.evs.push({ t: this.now, kind: "ball", a: Math.min(i, j), b: Math.max(i, j), speed: vn, x: px, z: pz });
    this.emit(i, this.now);
    this.emit(j, this.now);
  }

  /** Rebote contra algo fijo; (nx, nz) es la normal que va de la bola hacia el obstaculo. */
  private bounceStatic(i: number, nx: number, nz: number, e: number): void {
    const vn = this.vx[i] * nx + this.vz[i] * nz;
    if (vn <= APPROACH_EPS) return;
    this.vx[i] -= (1 + e) * vn * nx;
    this.vz[i] -= (1 + e) * vn * nz;

    // Rozamiento con la banda: acopla la velocidad tangencial con el spin lateral.
    // Un impulso jt cambia el contacto en 3.5 jt (jt de la velocidad y 2.5 jt del giro).
    const tx = nz;
    const tz = -nx;
    const ut = this.vx[i] * tx + this.vz[i] * tz + BALL_R * this.wy[i];
    const jt = -Math.sign(ut) * Math.min(MU_CUSHION * (1 + e) * vn, Math.abs(ut) / 3.5);
    this.vx[i] += jt * tx;
    this.vz[i] += jt * tz;
    this.wy[i] += SPIN_K * jt;

    this.settle(i);
    this.evs.push({ t: this.now, kind: "cushion", a: i, b: -1, speed: vn, x: this.x[i], z: this.z[i] });
    this.emit(i, this.now);
  }

  private pocket(i: number): void {
    this.ph[i] = PHASE_POCKETED;
    this.vx[i] = this.vz[i] = this.wx[i] = this.wy[i] = this.wz[i] = 0;
    this.potted.push(i);
    this.evs.push({ t: this.now, kind: "pocket", a: i, b: -1, speed: 0, x: this.x[i], z: this.z[i] });
    this.emit(i, this.now);
  }
}

const sim = new Sim();

/**
 * Simula un tiro completo. `state` son las 16 bolas (0 = blanca) y no se modifica.
 * Lanza si la blanca no esta en la mesa: quien llama tiene que ponerla antes.
 */
export function simulateShot(state: BallPos[], shot: Shot, opts?: SimulateOptions): ShotResult {
  return sim.run(state, shot, opts);
}
