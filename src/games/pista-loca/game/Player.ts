import type { Floor } from "./Floor";
import {
  AIR_ACCEL,
  COYOTE_TIME,
  FOOT_RADIUS,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  PHYSICS_STEP,
  SPEED,
  TERMINAL_VELOCITY,
  cellCenter,
  worldToCell,
} from "./constants";

const BODY_HEIGHT = 1.8;

export interface PlayerEvents {
  jumped: boolean;
  /** Velocidad vertical con la que aterrizo (0 si no aterrizo). */
  landed: number;
}

/**
 * El jugador propio, simulado en el cliente (la misma fisica que Derrumbe, con un
 * solo piso a la altura 0). Apoyo por HUELLA: se sostiene si cualquier bloque toca
 * el circulo de sus pies, asi que pararse en el filo de un bloque del color pedido
 * alcanza, como en el original.
 */
export class Player {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  grounded = false;
  private coyote = 0;
  private jumpBuffer = 0;

  place(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
  }

  requestJump(): void {
    this.jumpBuffer = JUMP_BUFFER;
  }

  get moving(): boolean {
    return Math.hypot(this.vx, this.vz) > 0.4;
  }

  update(dt: number, dirX: number, dirZ: number, floor: Floor): PlayerEvents {
    const events: PlayerEvents = { jumped: false, landed: 0 };
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(left, PHYSICS_STEP);
      left -= step;
      this.step(step, dirX, dirZ, floor, events);
    }
    if (Math.hypot(this.vx, this.vz) > 0.3) {
      let diff = Math.atan2(this.vx, this.vz) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 14);
    }
    return events;
  }

  private step(dt: number, dirX: number, dirZ: number, floor: Floor, events: PlayerEvents): void {
    const k = 1 - Math.exp(-(this.grounded ? GROUND_ACCEL : AIR_ACCEL) * dt);
    this.vx += (dirX * SPEED - this.vx) * k;
    this.vz += (dirZ * SPEED - this.vz) * k;

    const nx = this.x + this.vx * dt;
    if (this.blockedAt(nx, this.z, floor)) this.vx = 0;
    else this.x = nx;
    const nz = this.z + this.vz * dt;
    if (this.blockedAt(this.x, nz, floor)) this.vz = 0;
    else this.z = nz;

    if (this.grounded && !this.supported(this.x, this.z, floor)) {
      this.grounded = false;
      this.coyote = COYOTE_TIME;
    }

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      events.jumped = true;
    }
    if (this.grounded) return;

    this.vy = Math.max(this.vy - GRAVITY * dt, -TERMINAL_VELOCITY);
    const ny = this.y + this.vy * dt;
    // Aterriza solo si cruzo la tapa de la pista en este paso.
    if (this.vy <= 0 && this.y >= -1e-4 && ny <= 0 && this.supported(this.x, this.z, floor)) {
      events.landed = -this.vy;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      return;
    }
    this.y = ny;
  }

  /** Algun bloque en pie toca la huella en (x, z). */
  supported(x: number, z: number, floor: Floor): boolean {
    return this.touches(x, z, (cx, cz) => floor.isSolid(cx, cz));
  }

  /** Cayendo por un hueco, el cuerpo no puede meterse de costado en un bloque. */
  private blockedAt(x: number, z: number, floor: Floor): boolean {
    if (!(this.y < -1e-3 && this.y + BODY_HEIGHT > -1)) return false;
    return this.touches(x, z, (cx, cz) => floor.isSolid(cx, cz));
  }

  private touches(x: number, z: number, fn: (cx: number, cz: number) => boolean): boolean {
    const r = FOOT_RADIUS;
    for (let cz = worldToCell(z - r); cz <= worldToCell(z + r); cz++) {
      for (let cx = worldToCell(x - r); cx <= worldToCell(x + r); cx++) {
        const wx = cellCenter(cx);
        const wz = cellCenter(cz);
        const px = Math.max(wx - 0.5, Math.min(x, wx + 0.5));
        const pz = Math.max(wz - 0.5, Math.min(z, wz + 0.5));
        if ((px - x) ** 2 + (pz - z) ** 2 >= r * r) continue;
        if (fn(cx, cz)) return true;
      }
    }
    return false;
  }
}
