import {
  AIR_ACCEL,
  BODY_H,
  BODY_R,
  COYOTE_TIME,
  FOOT_RADIUS,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  PHYSICS_STEP,
  PYLON_R,
  SHOVE_ACCEL,
  SHOVE_STUN,
  SPEED,
  STAGE_R,
  TERMINAL_VELOCITY,
} from "./constants";

export interface PlayerEvents {
  jumped: boolean;
  /** Velocidad vertical con la que aterrizo (0 si no aterrizo). */
  landed: number;
}

/**
 * El jugador propio, simulado en el cliente: Euler semi-implicito a paso fijo
 * (`PHYSICS_STEP`, 120 Hz), la fisica de Pista Loca con el piso de disco. Se sostiene
 * mientras la huella de los pies toque el escenario, asi que pararse en el filo
 * alcanza. La torre del centro es un cilindro solido: empuja hacia afuera.
 *
 * El juego es de saltos reactivos: todos los lasers rasantes se esquivan saltando.
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
  readonly ducking = false;
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

  /** Te empujaron: el envion reemplaza a la velocidad horizontal y por un rato no se controla. */
  shove(vx: number, vy: number, vz: number): void {
    this.vx = vx;
    this.vz = vz;
    this.vy = Math.max(this.vy, vy);
    this.grounded = false;
    this.coyote = 0;
    this.stun = SHOVE_STUN;
  }

  requestJump(): void {
    this.jumpBuffer = JUMP_BUFFER;
  }

  get bodyHeight(): number {
    return BODY_H;
  }

  get moving(): boolean {
    return Math.hypot(this.vx, this.vz) > 0.4;
  }

  update(dt: number, dirX: number, dirZ: number): PlayerEvents {
    const events: PlayerEvents = { jumped: false, landed: 0 };
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(left, PHYSICS_STEP);
      left -= step;
      this.step(step, dirX, dirZ, events);
    }
    if (Math.hypot(this.vx, this.vz) > 0.3) {
      let diff = Math.atan2(this.vx, this.vz) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 14);
    }
    return events;
  }

  private step(dt: number, dirX: number, dirZ: number, events: PlayerEvents): void {
    this.stun = Math.max(0, this.stun - dt);
    const speed = SPEED;
    const accel = this.stun > 0 ? SHOVE_ACCEL : this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (dirX * speed - this.vx) * k;
    this.vz += (dirZ * speed - this.vz) * k;

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.collide();

    if (this.grounded && !this.supported()) {
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
    // Aterriza solo si cruzo la tapa del escenario en este paso.
    if (this.vy <= 0 && this.y >= -1e-4 && ny <= 0 && this.supported()) {
      events.landed = -this.vy;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      return;
    }
    this.y = ny;
  }

  /**
   * La torre empuja hacia afuera; y cayendo por el costado del escenario, el cuerpo
   * no puede volver a meterse adentro de la tapa.
   */
  private collide(): void {
    const d = Math.hypot(this.x, this.z);
    if (this.y < 2.3) {
      const min = PYLON_R + BODY_R;
      if (d < min) {
        const nx = d > 1e-4 ? this.x / d : 1;
        const nz = d > 1e-4 ? this.z / d : 0;
        this.x = nx * min;
        this.z = nz * min;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= vn * nx;
          this.vz -= vn * nz;
        }
      }
    }
    if (this.y < -0.05 && this.y > -2 && d < STAGE_R + BODY_R) {
      const nx = this.x / d;
      const nz = this.z / d;
      this.x = nx * (STAGE_R + BODY_R);
      this.z = nz * (STAGE_R + BODY_R);
    }
  }

  /** La huella de los pies toca el escenario. */
  supported(x = this.x, z = this.z): boolean {
    return Math.hypot(x, z) < STAGE_R + FOOT_RADIUS * 0.6;
  }
}
