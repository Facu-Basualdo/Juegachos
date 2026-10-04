import {
  LOSE_SIGHT,
  MINO_INVESTIGATE,
  MINO_WANDER,
  SEARCH_TIME,
  SIGHT,
  chaseStepFor,
  smellFor,
} from "./constants";
import { DIRS, type Maze } from "./Maze";

export type MinoState = "sleep" | "wander" | "investigate" | "chase" | "search";

/** Lo que el juego le cuenta al Minotauro en cada cuadro. */
export interface Senses {
  /** Celda del jugador. */
  px: number;
  py: number;
  /** Ruidos de este cuadro: donde y a que radio se escucharon. */
  noises: { x: number; y: number; r: number }[];
}

/** Lo que paso este cuadro, para el sonido y la pantalla. */
export interface MinoEvents {
  roar: boolean;
  snort: boolean;
  step: boolean;
  woke: boolean;
}

/**
 * El Minotauro: metodo aprobado por el programador (A* + maquina de estados
 * jerarquica, ver CLAUDE.md). Se mueve de celda a celda con interpolacion, sin fisica;
 * en cada llegada a una celda decide la siguiente segun su estado.
 *
 *  - `sleep`: los primeros segundos del nivel. Un ruido fuerte cerca lo despierta.
 *  - `wander`: camina lento, sin volver para atras salvo en un callejon.
 *  - `investigate`: escucho algo; va con A* a donde sono, a paso medio, y bufa.
 *  - `chase`: te vio (pasillo recto hasta `SIGHT`) o te tiene pegado; brama y te sigue
 *    con A* re-planeado en cada celda, cada vez mas rapido nivel a nivel.
 *  - `search`: te perdio; va a donde te vio por ultima vez y husmea alrededor
 *    `SEARCH_TIME` antes de volver a deambular.
 *
 * El olfato (`smellFor`) cierra el circulo: sin pistas por un rato, va a donde estas.
 * Es lo que hace que un jugador quieto termine la partida solo.
 */
export class Minotaur {
  /** Celda de la que sale y celda a la que va; `prog` 0-1 entre las dos. */
  x: number;
  y: number;
  nx: number;
  ny: number;
  prog = 1;
  state: MinoState = "sleep";
  /** Hacia donde mira (radianes), para dibujarlo. */
  heading = Math.PI / 2;
  private step = MINO_WANDER;
  private sleepLeft: number;
  private target: { x: number; y: number } | null = null;
  private lastSeen: { x: number; y: number } | null = null;
  private lostFor = 0;
  private searchLeft = 0;
  private sinceClue = 0;
  private lastDir = -1;
  private readonly chaseStep: number;
  private readonly smell: number;
  private readonly rand: () => number;
  private readonly maze: Maze;

  constructor(maze: Maze, lair: { x: number; y: number }, level: number, sleep: number, rand: () => number) {
    this.maze = maze;
    this.x = this.nx = lair.x;
    this.y = this.ny = lair.y;
    this.sleepLeft = sleep;
    this.chaseStep = chaseStepFor(level);
    this.smell = smellFor(level);
    this.rand = rand;
  }

  /** Posicion interpolada (centro de celda = entero). */
  get fx(): number {
    return this.x + (this.nx - this.x) * ease(this.prog);
  }

  get fy(): number {
    return this.y + (this.ny - this.y) * ease(this.prog);
  }

  get awake(): boolean {
    return this.state !== "sleep";
  }

  update(dt: number, s: Senses): MinoEvents {
    const ev: MinoEvents = { roar: false, snort: false, step: false, woke: false };
    // La celda "actual" para percibir es la mas cercana a donde esta.
    const cx = this.prog < 0.5 ? this.x : this.nx;
    const cy = this.prog < 0.5 ? this.y : this.ny;

    if (this.state === "sleep") {
      this.sleepLeft -= dt;
      const loud = s.noises.find((n) => n.r >= 4 && dist(cx, cy, n.x, n.y) <= n.r * 0.8);
      if (this.sleepLeft > 0 && !loud) return ev;
      ev.woke = true;
      this.state = "wander";
      if (loud) this.investigate(loud.x, loud.y, ev);
    }

    // ---- Percepcion ----
    this.sinceClue += dt;
    const sees = this.maze.sees(cx, cy, s.px, s.py, SIGHT) || (Math.abs(cx - s.px) + Math.abs(cy - s.py) <= 1 && this.adjacentOpen(cx, cy, s.px, s.py));
    if (sees) {
      this.lastSeen = { x: s.px, y: s.py };
      this.lostFor = 0;
      this.sinceClue = 0;
      if (this.state !== "chase") {
        this.state = "chase";
        ev.roar = true;
      }
    } else if (this.state === "chase") {
      this.lostFor += dt;
      // Un pasillo con una esquina no lo despista: lo sigue un ratito por inercia.
      if (this.lostFor > LOSE_SIGHT) {
        this.state = "search";
        this.target = this.lastSeen;
        this.searchLeft = SEARCH_TIME;
      }
    }
    if (this.state !== "chase") {
      const heard = s.noises.find((n) => dist(cx, cy, n.x, n.y) <= n.r);
      if (heard) {
        this.sinceClue = 0;
        this.investigate(heard.x, heard.y, ev);
      } else if (this.sinceClue > this.smell) {
        this.sinceClue = 0;
        this.investigate(s.px, s.py, ev);
      }
    }
    if (this.state === "search" && this.target === null) {
      this.searchLeft -= dt;
      if (this.searchLeft <= 0) this.state = "wander";
    }

    // ---- Movimiento ----
    this.prog += dt / this.step;
    if (this.prog >= 1) {
      this.prog = 1;
      this.x = this.nx;
      this.y = this.ny;
      this.decide(s);
      if (this.nx !== this.x || this.ny !== this.y) {
        this.prog = 0;
        ev.step = true;
        this.heading = Math.atan2(this.ny - this.y, this.nx - this.x);
      }
    }
    return ev;
  }

  private investigate(x: number, y: number, ev: MinoEvents): void {
    if (this.state !== "investigate") ev.snort = true;
    this.state = "investigate";
    this.target = { x: Math.round(x), y: Math.round(y) };
  }

  private adjacentOpen(ax: number, ay: number, bx: number, by: number): boolean {
    for (let d = 0; d < 4; d++) {
      if (ax + DIRS[d].dx === bx && ay + DIRS[d].dy === by) return this.maze.open(ax, ay, d);
    }
    return ax === bx && ay === by;
  }

  /** En cada celda: a donde va despues. */
  private decide(s: Senses): void {
    let next: { x: number; y: number } | null = null;
    switch (this.state) {
      case "chase": {
        this.step = this.chaseStep;
        next = this.maze.path(this.x, this.y, s.px, s.py)[0] ?? null;
        break;
      }
      case "investigate":
      case "search": {
        this.step = this.state === "search" ? MINO_INVESTIGATE * 1.15 : MINO_INVESTIGATE;
        if (this.target) {
          if (this.target.x === this.x && this.target.y === this.y) {
            // Llego a donde sono (o a donde te vio): husmea alrededor.
            this.target = null;
            this.state = "search";
            this.searchLeft = SEARCH_TIME;
          } else {
            next = this.maze.path(this.x, this.y, this.target.x, this.target.y)[0] ?? null;
          }
        }
        if (!next) next = this.wanderStep();
        break;
      }
      case "wander":
        this.step = MINO_WANDER;
        next = this.wanderStep();
        break;
      default:
        return;
    }
    if (next) {
      this.lastDir = DIRS.findIndex((d) => d.dx === next!.x - this.x && d.dy === next!.y - this.y);
      this.nx = next.x;
      this.ny = next.y;
    }
  }

  /** Deambular: cualquier salida menos volver por donde vino, salvo en un callejon. */
  private wanderStep(): { x: number; y: number } | null {
    const back = this.lastDir >= 0 ? (this.lastDir + 2) % 4 : -1;
    const options: number[] = [];
    for (let d = 0; d < 4; d++) if (this.maze.open(this.x, this.y, d) && d !== back) options.push(d);
    if (!options.length && back >= 0 && this.maze.open(this.x, this.y, back)) options.push(back);
    if (!options.length) return null;
    const d = options[Math.floor(this.rand() * options.length)];
    return { x: this.x + DIRS[d].dx, y: this.y + DIRS[d].dy };
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Paso con un poco de peso: arranca y frena, no se desliza. */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
