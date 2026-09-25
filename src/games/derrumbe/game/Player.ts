import type { Arena } from "./Arena";
import {
  AIR_ACCEL,
  CELLS_PER_LAYER,
  COYOTE_TIME,
  FOOT_RADIUS,
  GRAVITY,
  GRID,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  LAYERS,
  PHYSICS_STEP,
  SPEED,
  TERMINAL_VELOCITY,
  cellCenterX,
  surfaceY,
  worldToCell,
} from "./constants";

/** Alto del cuerpo, para el choque lateral contra los bloques de un piso. */
const BODY_HEIGHT = 1.8;

export interface PlayerEvents {
  jumped: boolean;
  /** Velocidad vertical con la que aterrizo (0 si no aterrizo). */
  landed: number;
}

/**
 * El jugador propio, simulado en el cliente (el server solo reenvia la posicion;
 * ver el sim). La fisica es la de un plataformero voxel minimo:
 *
 *  - Horizontal con aceleracion (mucha en el piso, poca en el aire).
 *  - Gravedad, salto con coyote time y buffer de salto.
 *  - Apoyo por HUELLA: el jugador se sostiene si cualquier bloque toca el circulo
 *    de sus pies. Es la regla de TNT Run y tiene dos caras: se puede pararse en el
 *    filo de un agujero, pero el filo tambien se cae (ver `footprint`).
 *  - Choque lateral solo contra la losa del piso que el cuerpo esta atravesando
 *    (al caer por un agujero): los pisos estan a 8 bloques y no hay techo que
 *    chocar con la cabeza.
 */
export class Player {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Hacia donde mira (rad, 0 = +Z). */
  yaw = 0;
  grounded = false;
  /** Piso en el que esta parado (-1 en el aire). */
  groundLayer = -1;
  private coyote = 0;
  private jumpBuffer = 0;

  place(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
    this.groundLayer = -1;
  }

  requestJump(): void {
    this.jumpBuffer = JUMP_BUFFER;
  }

  get moving(): boolean {
    return Math.hypot(this.vx, this.vz) > 0.4;
  }

  /** `dirX/dirZ` es la direccion pedida en el mundo, de largo <= 1. */
  update(dt: number, dirX: number, dirZ: number, arena: Arena): PlayerEvents {
    const events: PlayerEvents = { jumped: false, landed: 0 };
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(left, PHYSICS_STEP);
      left -= step;
      this.step(step, dirX, dirZ, arena, events);
    }

    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0.3) {
      const target = Math.atan2(this.vx, this.vz);
      let diff = target - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 14);
    }
    return events;
  }

  private step(dt: number, dirX: number, dirZ: number, arena: Arena, events: PlayerEvents): void {
    // ---- Horizontal ----
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (dirX * SPEED - this.vx) * k;
    this.vz += (dirZ * SPEED - this.vz) * k;

    const nx = this.x + this.vx * dt;
    if (this.blockedAt(nx, this.z, arena)) this.vx = 0;
    else this.x = nx;
    const nz = this.z + this.vz * dt;
    if (this.blockedAt(this.x, nz, arena)) this.vz = 0;
    else this.z = nz;

    // ---- Apoyo ----
    if (this.grounded && !this.supported(this.groundLayer, this.x, this.z, arena)) {
      // Se fue el piso: arranca la caida, con un toque de margen para saltar igual.
      this.grounded = false;
      this.groundLayer = -1;
      this.coyote = COYOTE_TIME;
    }

    // ---- Salto ----
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
      this.groundLayer = -1;
      this.coyote = 0;
      this.jumpBuffer = 0;
      events.jumped = true;
    }

    if (this.grounded) return;

    // ---- Vertical ----
    this.vy = Math.max(this.vy - GRAVITY * dt, -TERMINAL_VELOCITY);
    const ny = this.y + this.vy * dt;
    if (this.vy <= 0) {
      for (let layer = 0; layer < LAYERS; layer++) {
        const s = surfaceY(layer);
        // Aterriza solo si cruzo la tapa en este paso: asi no se "engancha" en un
        // piso que ya tiene por encima de la cabeza.
        if (this.y >= s - 1e-4 && ny <= s && this.supported(layer, this.x, this.z, arena)) {
          events.landed = Math.max(events.landed, -this.vy);
          this.y = s;
          this.vy = 0;
          this.grounded = true;
          this.groundLayer = layer;
          return;
        }
      }
    }
    this.y = ny;
  }

  /** Algun bloque del piso `layer` toca la huella en (x, z). */
  supported(layer: number, x: number, z: number, arena: Arena): boolean {
    if (layer < 0) return false;
    return this.forEachTouched(x, z, (cx, cz) => arena.isSolid(layer, cx, cz));
  }

  /**
   * Las celdas enteras que toca la huella del piso en el que esta parado. Son las
   * que se prenden: pararse en el filo de dos bloques los tira a los dos, que es lo
   * que hace que no haya donde quedarse quieto.
   */
  footprint(arena: Arena): number[] {
    const cells: number[] = [];
    if (!this.grounded || this.groundLayer < 0) return cells;
    const layer = this.groundLayer;
    this.forEachTouched(this.x, this.z, (cx, cz) => {
      if (arena.isSolid(layer, cx, cz)) cells.push(layer * CELLS_PER_LAYER + cz * GRID + cx);
      return false;
    });
    return cells;
  }

  /** El cuerpo, en (x, z), se mete en un bloque de la losa que esta atravesando. */
  private blockedAt(x: number, z: number, arena: Arena): boolean {
    for (let layer = 0; layer < LAYERS; layer++) {
      const s = surfaceY(layer);
      // Losa del piso: [s - 1, s]. El cuerpo: [y, y + alto].
      if (!(this.y < s - 1e-3 && this.y + BODY_HEIGHT > s - 1)) continue;
      if (this.forEachTouched(x, z, (cx, cz) => arena.isSolid(layer, cx, cz))) return true;
    }
    return false;
  }

  /** Recorre las celdas cuyo cuadrado toca el circulo de la huella; corta al primer true. */
  private forEachTouched(
    x: number,
    z: number,
    fn: (cx: number, cz: number) => boolean,
  ): boolean {
    const r = FOOT_RADIUS;
    const minX = worldToCell(x - r);
    const maxX = worldToCell(x + r);
    const minZ = worldToCell(z - r);
    const maxZ = worldToCell(z + r);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const wx = cellCenterX(cx);
        const wz = cellCenterX(cz);
        // Punto del cuadrado mas cercano al centro de la huella.
        const px = Math.max(wx - 0.5, Math.min(x, wx + 0.5));
        const pz = Math.max(wz - 0.5, Math.min(z, wz + 0.5));
        if ((px - x) ** 2 + (pz - z) ** 2 >= r * r) continue;
        if (fn(cx, cz)) return true;
      }
    }
    return false;
  }
}
