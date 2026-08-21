import {
  DUCK_H,
  DUCK_MIN,
  JUMP_GRAVITY,
  JUMP_SPEED,
  RUNNER_X,
  STAND_H,
  TUNIC_COLORS,
} from "./constants";

export type Pose = "run" | "jump" | "duck" | "dead";

/**
 * Un corredor: el tuyo y tambien cada rival de la sala. Es la MISMA clase para
 * los dos, y esa es la razon por la que el canal de sala puede ser tan barato:
 * el rival no manda su altura cuadro a cuadro, manda "salto" y el cliente corre
 * esta misma parabola. Ver TempleChannel / Game.applyRemote.
 */
export class Runner {
  /** Carril (profundidad). La x es siempre RUNNER_X: la viga cruza a todos junto. */
  readonly x = RUNNER_X;
  y: number;
  color: string;
  name: string;

  /** Altura de los pies. 0 = en el piso. */
  feetZ = 0;
  private vz = 0;
  /** True mientras la tecla / el dedo siguen apretados. */
  private duckHeld = false;
  /** Resto del minimo de agachada, para que un toque corto igual sirva. */
  private duckTimer = 0;
  dead = false;
  /** Fase del ciclo de trote, para el bamboleo. */
  phase = 0;
  /** Tiempo desde que murio, para el desplome. */
  deadFor = 0;

  constructor(y: number, color = TUNIC_COLORS[0], name = "") {
    this.y = y;
    this.color = color;
    this.name = name;
  }

  reset(): void {
    this.feetZ = 0;
    this.vz = 0;
    this.duckHeld = false;
    this.duckTimer = 0;
    this.dead = false;
    this.phase = 0;
    this.deadFor = 0;
  }

  get airborne(): boolean {
    return this.feetZ > 0 || this.vz > 0;
  }

  get ducking(): boolean {
    return !this.dead && (this.duckHeld || this.duckTimer > 0);
  }

  get height(): number {
    return this.ducking ? DUCK_H : STAND_H;
  }

  get pose(): Pose {
    if (this.dead) return "dead";
    if (this.airborne) return "jump";
    return this.ducking ? "duck" : "run";
  }

  /** Salta. Sin doble salto: solo cuenta con los pies en el piso. */
  jump(): boolean {
    if (this.dead || this.airborne) return false;
    this.vz = JUMP_SPEED;
    this.feetZ = 0.0001;
    return true;
  }

  duckStart(): void {
    if (this.dead) return;
    this.duckHeld = true;
    this.duckTimer = DUCK_MIN;
  }

  duckEnd(): void {
    this.duckHeld = false;
  }

  kill(): void {
    this.dead = true;
    this.duckHeld = false;
    this.duckTimer = 0;
    this.deadFor = 0;
  }

  /** Avanza la fisica. Devuelve true el cuadro en que toca el piso. */
  update(dt: number): boolean {
    if (this.dead) {
      this.deadFor += dt;
      // El cuerpo cae aunque lo hayan volteado en el aire.
      if (this.feetZ > 0) {
        this.vz -= JUMP_GRAVITY * dt;
        this.feetZ = Math.max(0, this.feetZ + this.vz * dt);
        if (this.feetZ === 0) this.vz = 0;
      }
      return false;
    }

    if (this.duckTimer > 0) this.duckTimer = Math.max(0, this.duckTimer - dt);

    let landed = false;
    if (this.airborne) {
      this.vz -= JUMP_GRAVITY * dt;
      this.feetZ += this.vz * dt;
      if (this.feetZ <= 0) {
        this.feetZ = 0;
        this.vz = 0;
        landed = true;
      }
    } else {
      this.phase += dt * (this.ducking ? 4 : 9);
    }
    return landed;
  }
}
