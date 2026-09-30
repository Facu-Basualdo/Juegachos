import {
  AIR_ACCEL,
  BODY_RADIUS,
  COYOTE_TIME,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  PHYSICS_STEP,
  RESPAWN_Y,
  SPEED,
  STEP_UP,
  TERMINAL_VELOCITY,
} from "./constants";
import type { Collider } from "./Island";

/** Lo que el muñeco necesita saber del lugar. */
export interface Ground {
  readonly colliders: Collider[];
  groundAt(x: number, z: number): number;
}

/**
 * Muñeco propio, cinematico (el metodo aprobado para la Isla, ver su CLAUDE.md):
 * velocidad horizontal que acelera hacia la pedida, gravedad simple, piso por
 * altura (`groundAt`) y empuje contra circulos. Nada compite en la isla, asi que
 * cada cliente simula lo suyo y el server solo reenvia la posicion.
 *
 * Se integra en pasos fijos de PHYSICS_STEP para que caminar y saltar se sientan
 * igual a 30 o a 144 fps.
 */
export class Player {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = Math.PI;
  grounded = true;
  moving = false;
  /** Se cayo de la isla y reaparecio en este paso (el Hub hace el efecto). */
  respawned = false;

  private spawnX = 0;
  private spawnZ = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private acc = 0;

  setSpawn(x: number, z: number): void {
    this.spawnX = x;
    this.spawnZ = z;
  }

  placeAt(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.grounded = true;
  }

  respawn(): void {
    this.placeAt(this.spawnX, 6, this.spawnZ);
    this.grounded = false;
    this.respawned = true;
  }

  /** `dir`: pedido en el plano (x este, z sur), de largo <= 1. */
  update(dt: number, dir: { x: number; z: number }, jump: boolean, ground: Ground): void {
    if (jump) this.jumpBuffer = JUMP_BUFFER;
    this.acc += dt;
    while (this.acc >= PHYSICS_STEP) {
      this.acc -= PHYSICS_STEP;
      this.step(PHYSICS_STEP, dir, ground);
    }
  }

  private step(h: number, dir: { x: number; z: number }, ground: Ground): void {
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const tx = dir.x * SPEED;
    const tz = dir.z * SPEED;
    const k = Math.min(1, accel * h / SPEED);
    this.vx += (tx - this.vx) * k * 1.6;
    this.vz += (tz - this.vz) * k * 1.6;

    // En primera persona el muñeco mira hacia donde mira la camara (`yaw` lo pone el Hub).
    this.moving = Math.hypot(dir.x, dir.z) > 0.05;

    // Horizontal, con escalon: se sube solo a lo que no pasa de STEP_UP.
    const nx = this.x + this.vx * h;
    const nz = this.z + this.vz * h;
    const g = ground.groundAt(nx, nz);
    if (g - this.y <= STEP_UP) {
      this.x = nx;
      this.z = nz;
    }
    this.pushOut(ground.colliders);

    // Vertical.
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - h);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - h);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }

    const floor = ground.groundAt(this.x, this.z);
    if (this.grounded && floor > -Infinity && this.y - floor < 0.35 && this.vy <= 0) {
      // Pegado al piso: bajar de la plataforma no es una caida.
      this.y = floor;
      this.vy = 0;
    } else {
      this.vy = Math.max(-TERMINAL_VELOCITY, this.vy - GRAVITY * h);
      const ny = this.y + this.vy * h;
      if (this.vy <= 0 && floor > -Infinity && ny <= floor && this.y >= floor - STEP_UP) {
        this.y = floor;
        this.vy = 0;
        this.grounded = true;
      } else {
        this.y = ny;
        this.grounded = false;
      }
    }

    if (this.y < RESPAWN_Y) this.respawn();
  }

  private pushOut(colliders: Collider[]): void {
    for (const c of colliders) {
      const dx = this.x - c.x;
      const dz = this.z - c.z;
      const min = c.r + BODY_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.0001;
      this.x = c.x + (dx / d) * min;
      this.z = c.z + (dz / d) * min;
    }
  }
}
