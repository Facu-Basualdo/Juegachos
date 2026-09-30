/**
 * Mundo de colisiones de La Feria. Metodo aprobado por el programador (ver el
 * CLAUDE.md de la carpeta): controlador **cinematico** de paso fijo contra cajas,
 * cada cliente simula su muñeco y el server solo reenvia. Lo que se mueve (plataformas,
 * barredores, ganchos) es una **funcion del tiempo compartido** (`worldTime`, el reloj
 * del server): todas las pantallas lo ven en el mismo lugar sin mandarlo por la red,
 * como la lava de Marea de Lava.
 */

/** Caja con giro alrededor de Y. `x/y/z` es el centro; `hx/hy/hz`, medio tamaño en su marco. */
export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  cos: number;
  sin: number;
  /** false = no choca (tablon que se cayo). */
  active: boolean;
  /** Desplazamiento del ultimo paso (para llevar al que esta parado arriba). */
  dx: number;
  dy: number;
  dz: number;
}

/** Cilindro vertical (troncos, postes): solo empuja de costado. */
export interface Circle {
  x: number;
  z: number;
  r: number;
  /** Altura hasta donde llega (por encima se puede pasar). */
  top: number;
}

/** Algo que te empuja al tocarlo (barredor, gancho). Devuelve el impulso o null. */
export interface Hazard {
  hit(x: number, feet: number, z: number, radius: number, height: number): { vx: number; vy: number; vz: number } | null;
}

/** Algo que se mueve con el reloj compartido. */
export interface Animated {
  pose(t: number): void;
}

export function makeBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0): Box {
  return { x, y, z, hx, hy, hz, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), active: true, dx: 0, dy: 0, dz: 0 };
}

/** Pasa un punto del mundo al marco de la caja (convencion de rotation.y de three). */
export function toLocal(b: Box, wx: number, wz: number): { lx: number; lz: number } {
  const dx = wx - b.x;
  const dz = wz - b.z;
  return { lx: dx * b.cos - dz * b.sin, lz: dx * b.sin + dz * b.cos };
}

/** Pasa un vector del marco de la caja al mundo. */
export function toWorld(b: Box, lx: number, lz: number): { x: number; z: number } {
  return { x: lx * b.cos + lz * b.sin, z: -lx * b.sin + lz * b.cos };
}

export class CollisionWorld {
  readonly boxes: Box[] = [];
  readonly circles: Circle[] = [];
  readonly hazards: Hazard[] = [];
  readonly animated: Animated[] = [];
  /** Radio del alambrado: nadie sale del claro. */
  boundary = 24;

  /** Pone todo lo que se mueve en su lugar para el instante `t` (segundos del reloj compartido). */
  pose(t: number): void {
    for (const a of this.animated) a.pose(t);
  }
}

// ---------- Cosas que se mueven ----------

/** Plataforma que va y viene en linea recta: centro + eje * amp * sin(2 pi t / periodo + fase). */
export class MovingBox implements Animated {
  readonly box: Box;
  private readonly base: [number, number, number];
  private readonly axis: [number, number, number];
  private readonly period: number;
  private readonly phase: number;

  constructor(box: Box, base: [number, number, number], axis: [number, number, number], period: number, phase: number) {
    this.box = box;
    this.base = base;
    this.axis = axis;
    this.period = period;
    this.phase = phase;
  }

  pose(t: number): void {
    const s = Math.sin((2 * Math.PI * t) / this.period + this.phase);
    const nx = this.base[0] + this.axis[0] * s;
    const ny = this.base[1] + this.axis[1] * s;
    const nz = this.base[2] + this.axis[2] * s;
    this.box.dx = nx - this.box.x;
    this.box.dy = ny - this.box.y;
    this.box.dz = nz - this.box.z;
    this.box.x = nx;
    this.box.y = ny;
    this.box.z = nz;
  }
}

/**
 * Tablon que se cae y vuelve: firme `on` segundos de cada `period`, con `warn`
 * segundos de temblor antes de caerse (el aviso, se ve en `shake`).
 */
export class TimedBox implements Animated {
  readonly box: Box;
  /** 0 = firme, >0 = temblando (cuanto), -1 = caido. */
  shake = 0;
  private readonly period: number;
  private readonly on: number;
  private readonly phase: number;
  private readonly warn: number;

  constructor(box: Box, period: number, on: number, phase: number, warn = 0.7) {
    this.box = box;
    this.period = period;
    this.on = on;
    this.phase = phase;
    this.warn = warn;
  }

  pose(t: number): void {
    const k = (((t / this.period + this.phase) % 1) + 1) % 1;
    const tIn = k * this.period;
    this.box.active = tIn < this.on;
    this.box.dx = this.box.dy = this.box.dz = 0;
    if (!this.box.active) this.shake = -1;
    else if (tIn > this.on - this.warn) this.shake = (tIn - (this.on - this.warn)) / this.warn;
    else this.shake = 0;
  }
}

/** Barra que gira alrededor de un eje vertical (dos brazos opuestos) y te barre. */
export class Sweeper implements Animated, Hazard {
  angle = 0;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly length: number;
  readonly thick: number;
  private readonly speed: number;
  private readonly phase: number;

  constructor(x: number, y: number, z: number, length: number, speed: number, phase: number, thick = 0.2) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.length = length;
    this.speed = speed;
    this.phase = phase;
    this.thick = thick;
  }

  pose(t: number): void {
    this.angle = this.speed * t + this.phase;
  }

  hit(px: number, feet: number, pz: number, radius: number, height: number): { vx: number; vy: number; vz: number } | null {
    if (feet > this.y + this.thick || feet + height < this.y - this.thick) return null;
    const ux = Math.cos(this.angle);
    const uz = -Math.sin(this.angle);
    const dx = px - this.x;
    const dz = pz - this.z;
    const along = Math.max(-this.length, Math.min(this.length, dx * ux + dz * uz));
    const cx = this.x + ux * along;
    const cz = this.z + uz * along;
    const d = Math.hypot(px - cx, pz - cz);
    if (d > radius + this.thick) return null;
    // Te empuja en el sentido en que gira el brazo que te toco, y un poco hacia afuera.
    const side = Math.sign(along) || 1;
    const spin = Math.sign(this.speed);
    // Velocidad de un punto del brazo: derivada de (cos a, -sin a) = (-sin a, -cos a) = (uz, -ux).
    const tx = uz * side * spin;
    const tz = -ux * side * spin;
    const ox = d > 0.001 ? (px - cx) / d : tx;
    const oz = d > 0.001 ? (pz - cz) / d : tz;
    const k = 9.5;
    return { vx: (tx * 0.8 + ox * 0.4) * k, vy: 4.5, vz: (tz * 0.8 + oz * 0.4) * k };
  }
}

/**
 * Gancho colgando que se balancea en un plano vertical (direccion `ux, uz`):
 * angulo = amp * sin(w t + fase). La bola esta a `length` del pivote.
 */
export class Pendulum implements Animated, Hazard {
  bx = 0;
  by = 0;
  bz = 0;
  theta = 0;
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly ux: number;
  readonly uz: number;
  readonly length: number;
  readonly radius: number;
  private readonly amp: number;
  private readonly w: number;
  private readonly phase: number;
  private omega = 0;

  constructor(
    pivot: [number, number, number],
    dir: [number, number],
    length: number,
    amp: number,
    w: number,
    phase: number,
    radius = 0.55,
  ) {
    [this.px, this.py, this.pz] = pivot;
    [this.ux, this.uz] = dir;
    this.length = length;
    this.amp = amp;
    this.w = w;
    this.phase = phase;
    this.radius = radius;
  }

  pose(t: number): void {
    this.theta = this.amp * Math.sin(this.w * t + this.phase);
    this.omega = this.amp * this.w * Math.cos(this.w * t + this.phase);
    const s = Math.sin(this.theta);
    this.bx = this.px + this.ux * s * this.length;
    this.bz = this.pz + this.uz * s * this.length;
    this.by = this.py - Math.cos(this.theta) * this.length;
  }

  hit(px: number, feet: number, pz: number, radius: number, height: number): { vx: number; vy: number; vz: number } | null {
    // Distancia de la bolsa al eje del cuerpo (un segmento vertical).
    const cy = Math.max(feet + radius, Math.min(feet + height - radius, this.by));
    const d = Math.hypot(px - this.bx, cy - this.by, pz - this.bz);
    if (d > radius + this.radius) return null;
    const dir = Math.sign(this.omega) || 1;
    const k = 10.5;
    return { vx: this.ux * dir * k, vy: 5, vz: this.uz * dir * k };
  }
}
