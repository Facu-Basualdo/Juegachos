import type { Plat, Tower } from "./Tower";
import {
  AIR_ACCEL,
  BODY_HALF,
  BODY_HEIGHT,
  COYOTE_TIME,
  DEPTH_HALF,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  PHYSICS_STEP,
  SPEED,
  TERMINAL_VELOCITY,
  WALL_HALF,
} from "./constants";

export interface PlayerEvents {
  jumped: boolean;
  landed: number;
}

/**
 * El jugador propio, simulado en el cliente. A diferencia de Derrumbe (grilla), aca
 * las plataformas son cajas sueltas, asi que el choque es AABB contra AABB, eje por
 * eje: X, despues Z, despues Y. En Y distingue caer sobre la tapa (aterriza) de pegar
 * con la cabeza abajo de una plataforma (corta el salto).
 */
export class Player {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = Math.PI;
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

  update(dt: number, dirX: number, dirZ: number, tower: Tower): PlayerEvents {
    const events: PlayerEvents = { jumped: false, landed: 0 };
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(left, PHYSICS_STEP);
      left -= step;
      this.step(step, dirX, dirZ, tower, events);
    }
    if (Math.hypot(this.vx, this.vz) > 0.3) {
      let diff = Math.atan2(this.vx, this.vz) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 14);
    }
    return events;
  }

  private step(dt: number, dirX: number, dirZ: number, tower: Tower, events: PlayerEvents): void {
    const near = tower.near(this.y - 3, this.y + BODY_HEIGHT + 3);
    const k = 1 - Math.exp(-(this.grounded ? GROUND_ACCEL : AIR_ACCEL) * dt);
    this.vx += (dirX * SPEED - this.vx) * k;
    this.vz += (dirZ * SPEED - this.vz) * k;

    // Horizontal, eje por eje, sin salirse de la pared.
    const nx = Math.max(-WALL_HALF - 1, Math.min(WALL_HALF + 1, this.x + this.vx * dt));
    if (this.hits(nx, this.y, this.z, near)) this.vx = 0;
    else this.x = nx;
    const nz = Math.max(-DEPTH_HALF - 0.6, Math.min(DEPTH_HALF + 1.2, this.z + this.vz * dt));
    if (this.hits(this.x, this.y, nz, near)) this.vz = 0;
    else this.z = nz;

    // Apoyo: una sonda apenas debajo de los pies.
    if (this.grounded && !this.hits(this.x, this.y - 0.05, this.z, near)) {
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
    const hit = this.hitPlat(this.x, ny, this.z, near);
    if (!hit) {
      this.y = ny;
      return;
    }
    if (this.vy <= 0) {
      events.landed = Math.max(events.landed, -this.vy);
      this.y = hit.y;
      this.grounded = true;
    } else {
      // Cabezazo contra la plataforma de arriba.
      this.y = hit.y - hit.h - BODY_HEIGHT - 1e-3;
    }
    this.vy = 0;
  }

  /** Hay algo debajo (x, z) y la caja de la plataforma mas alta bajo `y` (para la sombra). */
  groundBelow(x: number, y: number, z: number, tower: Tower): number | null {
    let best: number | null = null;
    for (const p of tower.near(y - 40, y + 0.05)) {
      if (p.y > y + 0.05) continue;
      if (Math.abs(p.x - x) > p.w / 2 || Math.abs(p.z - z) > p.d / 2) continue;
      if (best === null || p.y > best) best = p.y;
    }
    return best;
  }

  private hits(x: number, y: number, z: number, near: Plat[]): boolean {
    return this.hitPlat(x, y, z, near) !== null;
  }

  private hitPlat(x: number, y: number, z: number, near: Plat[]): Plat | null {
    for (const p of near) {
      if (Math.abs(p.x - x) >= p.w / 2 + BODY_HALF) continue;
      if (Math.abs(p.z - z) >= p.d / 2 + BODY_HALF) continue;
      // Caja del jugador [y, y + alto] contra [tapa - grosor, tapa].
      if (y >= p.y - 1e-4 || y + BODY_HEIGHT <= p.y - p.h) continue;
      return p;
    }
    return null;
  }
}
