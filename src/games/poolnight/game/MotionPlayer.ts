import { BALL_R, G, MU_ROLL, MU_SLIDE, SPIN_Y_DECEL } from "./constants";
import type { BiSegment } from "./PoolProtocol";

/** Estado de una bola en un instante: posicion, velocidad angular y fase. */
export interface Pose {
  x: number;
  z: number;
  wx: number;
  wy: number;
  wz: number;
  /** 0 quieta, 1 desliza, 2 rueda, 3 embocada. */
  ph: number;
  /** Segundos desde el tramo que se esta evaluando (para animar la caida a la tronera). */
  since: number;
}

export function newPose(): Pose {
  return { x: 0, z: 0, wx: 0, wy: 0, wz: 0, ph: 0, since: 0 };
}

const SPIN_K = (5 * MU_SLIDE * G) / (2 * BALL_R);

/**
 * Evalua los tramos de movimiento de un tiro (`bi:play.segs`). NO decide nada: no tiene
 * logica de colision, solo la ley de movimiento entre dos eventos, que es analitica (la
 * bola DESLIZA con aceleracion constante hasta que la velocidad del punto de contacto con
 * el paño se anula, y despues RUEDA con desaceleracion constante). Es la misma ley que usa
 * el server para integrar, asi que en cualquier instante la posicion coincide con la suya
 * (medido: 0.25 mm de error maximo en los empalmes, ver el CLAUDE.md del juego).
 *
 * Una bola sin tramos, o antes de su primer tramo, esta donde estaba: `evaluate` devuelve
 * false y quien llama usa la posicion previa al tiro.
 */
export class MotionPlayer {
  private readonly segs: BiSegment[][] = Array.from({ length: 16 }, () => []);
  private readonly cursor: number[] = new Array<number>(16).fill(0);

  load(segs: BiSegment[]): void {
    this.clear();
    for (const s of segs) this.segs[s[0]].push(s);
  }

  clear(): void {
    for (let i = 0; i < 16; i++) {
      this.segs[i].length = 0;
      this.cursor[i] = 0;
    }
  }

  /** La bola tiene al menos un tramo en este tiro. */
  moves(ball: number): boolean {
    return this.segs[ball].length > 0;
  }

  /** Escribe en `out` la pose de la bola `ball` a los `t` segundos del arranque; false si todavia no se mueve. */
  evaluate(ball: number, t: number, out: Pose): boolean {
    const list = this.segs[ball];
    if (list.length === 0 || t < list[0][1]) return false;
    let k = this.cursor[ball];
    if (list[k][1] > t) k = 0;
    while (k + 1 < list.length && list[k + 1][1] <= t) k++;
    this.cursor[ball] = k;

    const s = list[k];
    let dt = t - s[1];
    out.since = dt;
    let x = s[2];
    let z = s[3];
    let vx = s[4];
    let vz = s[5];
    let wx = s[6];
    let wy = s[7];
    let wz = s[8];
    out.ph = s[9];

    if (s[9] === 0 || s[9] === 3) {
      out.x = x;
      out.z = z;
      out.wx = out.wy = out.wz = 0;
      return true;
    }

    if (s[9] === 1) {
      const ux = vx + BALL_R * wz;
      const uz = vz - BALL_R * wx;
      const um = Math.hypot(ux, uz);
      if (um > 1e-9) {
        const ts = um / (3.5 * MU_SLIDE * G);
        const h = Math.min(dt, ts);
        const nx = ux / um;
        const nz = uz / um;
        const ax = -MU_SLIDE * G * nx;
        const az = -MU_SLIDE * G * nz;
        x += vx * h + 0.5 * ax * h * h;
        z += vz * h + 0.5 * az * h * h;
        vx += ax * h;
        vz += az * h;
        wx += SPIN_K * nz * h;
        wz -= SPIN_K * nx * h;
        dt -= h;
        if (dt > 0) {
          // Ya paso a rodar: el spin horizontal sale de la velocidad.
          wx = vz / BALL_R;
          wz = -vx / BALL_R;
        }
      }
    }

    if (dt > 0) {
      const sp = Math.hypot(vx, vz);
      if (sp > 1e-9) {
        const tr = sp / (MU_ROLL * G);
        const h = Math.min(dt, tr);
        const dist = sp * h - 0.5 * MU_ROLL * G * h * h;
        x += (vx / sp) * dist;
        z += (vz / sp) * dist;
        const sp2 = Math.max(0, sp - MU_ROLL * G * h);
        vx = (vx / sp) * sp2;
        vz = (vz / sp) * sp2;
        wx = vz / BALL_R;
        wz = -vx / BALL_R;
      } else {
        wx = wz = 0;
      }
    }

    const decay = SPIN_Y_DECEL * (t - s[1]);
    wy = Math.abs(wy) <= decay ? 0 : wy - Math.sign(wy) * decay;
    out.x = x;
    out.z = z;
    out.wx = wx;
    out.wy = wy;
    out.wz = wz;
    return true;
  }
}
