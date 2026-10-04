import { NOISE_BUMP, NOISE_RUN, NOISE_WALK, STEP_RUN, STEP_WALK } from "./constants";
import { DIRS, type Maze } from "./Maze";

export interface PlayerEvents {
  /** Llego a una celda nueva (para el paso, el aceite, el ovillo). */
  arrived: boolean;
  /** Se choco contra una pared (golpe sordo y ruido). */
  bumped: boolean;
  /** Ruido que hizo este cuadro (radio en celdas), 0 si ninguno. */
  noise: number;
}

/**
 * La llama del jugador: se mueve de celda a celda, como el Minotauro. Mientras se
 * mantiene una direccion apretada sigue caminando; en un cruce prueba primero la
 * ultima direccion apretada y despues las otras que siguen apretadas, asi doblar en
 * una esquina sale natural aunque se suelte una tecla un toque tarde.
 *
 * El hilo de Ariadna es el recorrido: cada celda nueva se suma, y volver sobre el
 * hilo lo enrolla (si la celda nueva es la anteultima, se saca la ultima).
 */
export class Player {
  x: number;
  y: number;
  nx: number;
  ny: number;
  prog = 1;
  running = false;
  heading = 0;
  readonly thread: { x: number; y: number }[];
  private step = STEP_WALK;
  private bumpCooldown = 0;
  private readonly maze: Maze;

  constructor(maze: Maze) {
    this.maze = maze;
    this.x = this.nx = maze.start.x;
    this.y = this.ny = maze.start.y;
    this.thread = [{ x: this.x, y: this.y }];
  }

  get fx(): number {
    return this.x + (this.nx - this.x) * this.prog;
  }

  get fy(): number {
    return this.y + (this.ny - this.y) * this.prog;
  }

  /** La celda que "ocupa" ahora (la mas cercana). */
  get cx(): number {
    return this.prog < 0.5 ? this.x : this.nx;
  }

  get cy(): number {
    return this.prog < 0.5 ? this.y : this.ny;
  }

  /** `dirs`: direcciones apretadas (indices de DIRS), la ultima apretada primero. */
  update(dt: number, dirs: number[], run: boolean): PlayerEvents {
    const ev: PlayerEvents = { arrived: false, bumped: false, noise: 0 };
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    if (this.prog < 1) {
      this.prog = Math.min(1, this.prog + dt / this.step);
      if (this.prog < 1) return ev;
      this.x = this.nx;
      this.y = this.ny;
      ev.arrived = true;
      const t = this.thread;
      if (t.length >= 2 && t[t.length - 2].x === this.x && t[t.length - 2].y === this.y) t.pop();
      else t.push({ x: this.x, y: this.y });
    }
    if (!dirs.length) return ev;
    const d = dirs.find((k) => this.maze.open(this.x, this.y, k));
    if (d === undefined) {
      if (this.bumpCooldown <= 0) {
        this.bumpCooldown = 0.45;
        ev.bumped = true;
        ev.noise = NOISE_BUMP;
        this.heading = Math.atan2(DIRS[dirs[0]].dy, DIRS[dirs[0]].dx);
      }
      return ev;
    }
    this.running = run;
    this.step = run ? STEP_RUN : STEP_WALK;
    this.nx = this.x + DIRS[d].dx;
    this.ny = this.y + DIRS[d].dy;
    this.prog = 0;
    this.heading = Math.atan2(DIRS[d].dy, DIRS[d].dx);
    ev.noise = run ? NOISE_RUN : NOISE_WALK;
    return ev;
  }
}
