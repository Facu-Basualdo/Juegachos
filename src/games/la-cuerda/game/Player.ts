import type { Course, Plat } from "./Course";
import {
  AIR_ACCEL,
  BODY_HALF,
  BODY_HEIGHT,
  COYOTE_TIME,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  PHYSICS_STEP,
  SHOVE_ACCEL,
  SHOVE_STUN,
  SPEED,
  TERMINAL_VELOCITY,
} from "./constants";

export interface PlayerEvents {
  jumped: boolean;
  landed: number;
}

/**
 * El jugador propio, simulado en el cliente. Es el de Marea de Lava (Euler
 * semi-implicito con paso fijo, choque AABB eje por eje: X, despues Z, despues Y)
 * sin los topes de la pared: aca salirse del puente es caerse, y eso es el juego.
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
  private stun = 0;

  place(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
    this.stun = 0;
  }

  requestJump(): void {
    this.jumpBuffer = JUMP_BUFFER;
  }

  get moving(): boolean {
    return Math.hypot(this.vx, this.vz) > 0.4;
  }

  /**
   * Te empujaron (lo de Pista Loca): el envion reemplaza a la velocidad horizontal,
   * te levanta un poco del piso y por `SHOVE_STUN` casi no se controla el muñeco (si
   * no, el joystick lo frena en el acto y el empujon no mueve a nadie).
   */
  shove(vx: number, vy: number, vz: number): void {
    this.vx = vx;
    this.vz = vz;
    this.vy = Math.max(this.vy, vy);
    this.grounded = false;
    this.coyote = 0;
    this.stun = SHOVE_STUN;
  }

  /** Lo tiro la cuerda: sale volando para un costado y hacia donde iba la cuerda. */
  fling(side: number, along: number): void {
    this.grounded = false;
    this.vx = side * 5;
    this.vz = along * 7;
    this.vy = 9;
  }

  update(dt: number, dirX: number, dirZ: number, course: Course): PlayerEvents {
    const events: PlayerEvents = { jumped: false, landed: 0 };
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(left, PHYSICS_STEP);
      left -= step;
      this.step(step, dirX, dirZ, course, events);
    }
    if (Math.hypot(this.vx, this.vz) > 0.3) {
      let diff = Math.atan2(this.vx, this.vz) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 14);
    }
    return events;
  }

  /** Simula solo la caida (sin input ni frenado): el vuelo despues del golpe. */
  drift(dt: number, course: Course): void {
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(left, PHYSICS_STEP);
      left -= step;
      this.vy = Math.max(this.vy - GRAVITY * step, -TERMINAL_VELOCITY);
      this.x += this.vx * step;
      this.z += this.vz * step;
      const ny = this.y + this.vy * step;
      const hit = this.vy <= 0 ? this.hitPlat(this.x, ny, this.z, course.near()) : null;
      if (hit) {
        this.y = hit.y;
        this.vy = 0;
        this.vx *= 0.5;
        this.vz *= 0.5;
      } else {
        this.y = ny;
      }
    }
  }

  private step(dt: number, dirX: number, dirZ: number, course: Course, events: PlayerEvents): void {
    const near = course.near();
    this.stun = Math.max(0, this.stun - dt);
    const accel = this.stun > 0 ? SHOVE_ACCEL : this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (dirX * SPEED - this.vx) * k;
    this.vz += (dirZ * SPEED - this.vz) * k;

    // Horizontal, eje por eje: solo choca con los cantos (desde abajo del tablero).
    const nx = this.x + this.vx * dt;
    if (this.hits(nx, this.y, this.z, near)) this.vx = 0;
    else this.x = nx;
    const nz = this.z + this.vz * dt;
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
      this.y = hit.y - hit.h - BODY_HEIGHT - 1e-3;
    }
    this.vy = 0;
  }

  private hits(x: number, y: number, z: number, near: Plat[]): boolean {
    return this.hitPlat(x, y, z, near) !== null;
  }

  private hitPlat(x: number, y: number, z: number, near: Plat[]): Plat | null {
    for (const p of near) {
      if (Math.abs(p.x - x) >= p.w / 2 + BODY_HALF) continue;
      if (Math.abs(p.z - z) >= p.d / 2 + BODY_HALF) continue;
      if (y >= p.y - 1e-4 || y + BODY_HEIGHT <= p.y - p.h) continue;
      return p;
    }
    return null;
  }
}
