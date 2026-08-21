import {
  BEAM_HALF,
  BEAM_HIGH_BOTTOM,
  BEAM_HIGH_TOP,
  BEAM_LOW_TOP,
  BEAM_SPIN,
  FLOOR_W,
  PORCH,
  RUNNER_X,
} from "./constants";
import type { Runner } from "./Runner";

/** "low" = rasante, se salta. "high" = a la altura del pecho, se esquiva agachado. */
export type BeamKind = "low" | "high";

/** Una viga rodando de punta a punta de la sala. */
export class Beam {
  x: number;
  readonly dir: 1 | -1;
  readonly kind: BeamKind;
  readonly speed: number;
  /** Rotacion acumulada, para los pinchos. */
  spin = 0;
  /** Ya paso al corredor (a esa altura deja de poder matarte). */
  crossed = false;
  /** Solo una viga por evento suma punto: un par cuenta una vez. */
  readonly scores: boolean;

  constructor(x: number, dir: 1 | -1, kind: BeamKind, speed: number, scores = true) {
    this.x = x;
    this.dir = dir;
    this.kind = kind;
    this.speed = speed;
    this.scores = scores;
  }

  get zMin(): number {
    return this.kind === "low" ? 0 : BEAM_HIGH_BOTTOM;
  }

  get zMax(): number {
    return this.kind === "low" ? BEAM_LOW_TOP : BEAM_HIGH_TOP;
  }

  /** Fuera de la sala (incluida la antesala): se descarta. */
  get offMap(): boolean {
    return this.x < -PORCH - 1.5 || this.x > FLOOR_W + PORCH + 1.5;
  }

  update(dt: number): void {
    this.x += this.dir * this.speed * dt;
    this.spin += this.dir * this.speed * dt * BEAM_SPIN;
    if (!this.crossed) {
      this.crossed = this.dir === 1 ? this.x > RUNNER_X : this.x < RUNNER_X;
    }
  }

  /** Solape en el eje de rodadura con el hitbox del corredor. */
  overlapsX(halfWidth: number): boolean {
    return Math.abs(this.x - RUNNER_X) < BEAM_HALF + halfWidth;
  }

  /** True si esta viga, ahora mismo, atraviesa a este corredor. */
  hits(runner: Runner, halfWidth: number): boolean {
    if (!this.overlapsX(halfWidth)) return false;
    const feet = runner.feetZ;
    const head = feet + runner.height;
    return head > this.zMin && feet < this.zMax;
  }
}
