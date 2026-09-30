import {
  AIR_ACCEL,
  BODY_HEIGHT,
  BODY_RADIUS,
  COYOTE_TIME,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  KNOCK_LOCK,
  PHYSICS_STEP,
  SPEED,
  STEP_UP,
  TERMINAL_VELOCITY,
} from "./constants";
import { toLocal, toWorld, type Box, type CollisionWorld } from "./Physics";

/** Cuanto por encima del borde de arriba cuenta como "venia de arriba" (aterrizar). */
const LAND_EPS = 0.08;
/** Hasta cuanto baja pegado al piso al caminar (bajar un escalon no es una caida). */
const SNAP_DOWN = 0.3;

/**
 * Muñeco propio, cinematico y de paso fijo (metodo aprobado para La Feria, ver su
 * CLAUDE.md). Por paso:
 *
 * 1. El mundo se pone en el instante del paso (`world.pose`), y si estaba parado
 *    sobre algo que se mueve, lo acompaña (se le suma el desplazamiento de la caja).
 * 2. Velocidad horizontal que acelera hacia la pedida (poco control si recien lo
 *    empujaron), salto con coyote time y buffer, gravedad.
 * 3. Se mueve y resuelve contra cada caja por la menor penetracion, con tres casos
 *    antes: venia de arriba -> aterriza, venia de abajo -> cabezazo, estaba apoyado
 *    y es un escalon bajo -> se sube solo.
 * 4. Troncos, alambrado, piso, y al final lo que empuja (barredores, ganchos).
 *
 * La posicion `y` son los pies.
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
  /** Apoyado en el piso del claro (no en una caja): corta la carrera de la torre. */
  onGround = true;
  /** Caja sobre la que esta parado (null en el piso o en el aire). */
  standingOn: Box | null = null;
  /** Reaparecio en este paso (el Hub lo avisa). */
  respawned = false;
  /** Lo empujaron en este paso (el Hub hace el ruido / el cartel). */
  knocked = false;

  private spawnX = 0;
  private spawnZ = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private knockLock = 0;
  private acc = 0;
  private simTime: number | null = null;

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
    this.standingOn = null;
  }

  respawn(): void {
    this.placeAt(this.spawnX, 0, this.spawnZ);
    this.respawned = true;
  }

  /**
   * `dir`: pedido en el plano (x este, z sur), de largo <= 1. `now`: segundos del
   * reloj compartido (lo que se mueve en el mundo es funcion de eso).
   */
  update(dt: number, dir: { x: number; z: number }, jump: boolean, world: CollisionWorld, now: number): void {
    if (jump) this.jumpBuffer = JUMP_BUFFER;
    this.acc += dt;
    // El reloj de la simulacion sigue al compartido; si se desfasa (pestaña dormida), se reengancha.
    if (this.simTime === null || Math.abs(this.simTime + this.acc - now) > 0.3) this.simTime = now - this.acc;
    while (this.acc >= PHYSICS_STEP) {
      this.acc -= PHYSICS_STEP;
      this.simTime += PHYSICS_STEP;
      this.step(PHYSICS_STEP, dir, world, this.simTime);
    }
  }

  private step(h: number, dir: { x: number; z: number }, world: CollisionWorld, t: number): void {
    world.pose(t);

    // Parado sobre algo que se mueve: viaja con eso.
    const on = this.standingOn;
    if (on && on.active) {
      this.x += on.dx;
      this.y += on.dy;
      this.z += on.dz;
    }

    const control = this.knockLock > 0 ? 0.12 : 1;
    this.knockLock = Math.max(0, this.knockLock - h);
    const accel = (this.grounded ? GROUND_ACCEL : AIR_ACCEL) * control;
    const k = Math.min(1, (accel * h * 1.6) / SPEED);
    this.vx += (dir.x * SPEED - this.vx) * k;
    this.vz += (dir.z * SPEED - this.vz) * k;
    this.moving = Math.hypot(dir.x, dir.z) > 0.05;

    const wasGrounded = this.grounded;
    this.coyote = wasGrounded ? COYOTE_TIME : Math.max(0, this.coyote - h);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - h);
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.knockLock <= 0) {
      this.vy = JUMP_VELOCITY;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }
    this.vy = Math.max(-TERMINAL_VELOCITY, this.vy - GRAVITY * h);

    const prevFeet = this.y;
    const prevHead = this.y + BODY_HEIGHT;
    this.x += this.vx * h;
    this.z += this.vz * h;
    this.y += this.vy * h;
    this.grounded = false;
    this.onGround = false;
    this.standingOn = null;

    for (const b of world.boxes) {
      if (b.active) this.resolveBox(b, prevFeet, prevHead, wasGrounded);
    }
    this.resolveCircles(world);
    this.resolveBoundary(world);

    // Piso del claro.
    if (this.y <= 0) {
      this.y = 0;
      if (this.vy < 0) this.vy = 0;
      this.grounded = true;
      this.onGround = true;
    }

    // Caminando: bajar un escalon chico no es una caida.
    if (wasGrounded && !this.grounded && this.vy <= 0 && this.knockLock <= 0) this.snapDown(world);

    this.knocked = false;
    if (this.knockLock <= 0) {
      for (const hz of world.hazards) {
        const imp = hz.hit(this.x, this.y, this.z, BODY_RADIUS, BODY_HEIGHT);
        if (!imp) continue;
        this.vx = imp.vx;
        this.vy = imp.vy;
        this.vz = imp.vz;
        this.knockLock = KNOCK_LOCK;
        this.grounded = false;
        this.standingOn = null;
        this.knocked = true;
        break;
      }
    }

    // Red por si algo sale mal (no deberia: el alambrado y el piso lo contienen).
    if (this.y < -20 || !Number.isFinite(this.x + this.y + this.z)) this.respawn();
  }

  private resolveBox(b: Box, prevFeet: number, prevHead: number, wasGrounded: boolean): void {
    const top = b.y + b.hy;
    const bottom = b.y - b.hy;
    if (this.y >= top || this.y + BODY_HEIGHT <= bottom) return;
    const { lx, lz } = toLocal(b, this.x, this.z);
    const penX = b.hx + BODY_RADIUS - Math.abs(lx);
    const penZ = b.hz + BODY_RADIUS - Math.abs(lz);
    if (penX <= 0 || penZ <= 0) return;

    if (prevFeet >= top - LAND_EPS - Math.max(0, b.dy)) {
      // Venia de arriba: aterriza.
      this.y = top;
      if (this.vy < 0) this.vy = 0;
      this.grounded = true;
      this.standingOn = b;
      return;
    }
    if (prevHead <= bottom + LAND_EPS && this.vy > 0) {
      // Cabezazo contra la panza de la caja.
      this.y = bottom - BODY_HEIGHT;
      this.vy = 0;
      return;
    }
    if (wasGrounded && top - this.y <= STEP_UP) {
      this.y = top;
      this.grounded = true;
      this.standingOn = b;
      return;
    }
    // De costado: se empuja por el eje de menor penetracion, en el marco de la caja.
    let px = 0;
    let pz = 0;
    if (penX < penZ) px = lx >= 0 ? penX : -penX;
    else pz = lz >= 0 ? penZ : -penZ;
    const w = toWorld(b, px, pz);
    this.x += w.x;
    this.z += w.z;
    const len = Math.hypot(w.x, w.z);
    if (len > 0) {
      const nx = w.x / len;
      const nz = w.z / len;
      const into = this.vx * nx + this.vz * nz;
      if (into < 0) {
        this.vx -= into * nx;
        this.vz -= into * nz;
      }
    }
  }

  private resolveCircles(world: CollisionWorld): void {
    for (const c of world.circles) {
      if (this.y >= c.top) continue;
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

  /** Alambrado: nadie sale del claro. */
  private resolveBoundary(world: CollisionWorld): void {
    const d = Math.hypot(this.x, this.z);
    const max = world.boundary - BODY_RADIUS;
    if (d <= max) return;
    this.x *= max / d;
    this.z *= max / d;
  }

  private snapDown(world: CollisionWorld): void {
    let best = this.y - SNAP_DOWN <= 0 ? 0 : -Infinity;
    let box: Box | null = null;
    for (const b of world.boxes) {
      if (!b.active) continue;
      const top = b.y + b.hy;
      if (top > this.y || top < this.y - SNAP_DOWN || top <= best) continue;
      const { lx, lz } = toLocal(b, this.x, this.z);
      if (Math.abs(lx) > b.hx + BODY_RADIUS * 0.6 || Math.abs(lz) > b.hz + BODY_RADIUS * 0.6) continue;
      best = top;
      box = b;
    }
    if (best === -Infinity) return;
    this.y = best;
    this.vy = 0;
    this.grounded = true;
    this.onGround = box === null;
    this.standingOn = box;
  }
}
