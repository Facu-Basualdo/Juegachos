import type { VbSnap } from "./ViboritaProtocol";
import { CLOCK_DRIFT_RATE, EXTRAPOLATE_MS } from "./constants";
import { wrapAngle } from "./motion";

export interface SnapHead {
  owner: number;
  x: number;
  y: number;
  a: number;
  mass: number;
  boost: boolean;
}

interface Frame {
  /** Instante del snapshot traido al reloj local (ms). */
  t: number;
  heads: Map<number, SnapHead>;
}

/** Cuanto historial se guarda (ms). Sobra contra el retraso de interpolacion. */
const KEEP_MS = 800;
/** Cuantas muestras de demora se guardan para medir el jitter (~2 s a 40 Hz). */
const JITTER_SAMPLES = 80;

/**
 * Linea de tiempo de los snapshots, para dibujar a las DEMAS cabezas interpoladas.
 *
 * Cada snapshot se fecha con el reloj de la SIMULACION del server (`snap.t`) mas un
 * offset de reloj, nunca con la hora de llegada: fecharlo al llegar mete el jitter de
 * entrega adentro del movimiento. El offset se estima con el MINIMO de (llegada - t)
 * visto y se corrige lento hacia arriba por la deriva entre relojes (ver "Interpolar
 * sobre el reloj del server" en el CLAUDE.md raiz).
 */
export class Timeline {
  private frames: Frame[] = [];
  private clockOffset: number | null = null;
  /** Cuanto tarde llego cada snapshot respecto del mas rapido (ms), en anillo. */
  private readonly lateness: number[] = [];
  private lateIdx = 0;
  private jitterP95 = 0;
  private pushes = 0;

  reset(): void {
    this.frames = [];
    this.clockOffset = null;
    this.lateness.length = 0;
    this.lateIdx = 0;
    this.jitterP95 = 0;
  }

  /**
   * Jitter de llegada: el percentil 95 de cuanto mas tarde que el snapshot mas rapido
   * llegan los demas (ms). Es lo que tiene que cubrir el retraso de interpolacion para
   * que casi nunca falte el snapshot siguiente.
   */
  jitter(): number {
    return this.jitterP95;
  }

  private recordLateness(late: number): void {
    const v = Math.max(0, late);
    if (this.lateness.length < JITTER_SAMPLES) this.lateness.push(v);
    else this.lateness[this.lateIdx] = v;
    this.lateIdx = (this.lateIdx + 1) % JITTER_SAMPLES;
    // Ordenar 80 numeros cada 10 snapshots no cuesta nada.
    if (++this.pushes % 10 !== 0) return;
    const sorted = [...this.lateness].sort((a, b) => a - b);
    this.jitterP95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
  }

  /**
   * El instante de la simulacion del server que corresponde a un instante local, o
   * null si todavia no llego ningun snapshot. Es lo que viaja en cada input como
   * "lo que estaba viendo" (compensacion de lag).
   */
  serverTimeAt(local: number): number | null {
    return this.clockOffset === null ? null : local - this.clockOffset;
  }

  /** Agrega el snapshot y devuelve su instante en el reloj local (null si llego fuera de orden). */
  push(snap: VbSnap, now: number): number | null {
    const sample = now - snap.t;
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * CLOCK_DRIFT_RATE;
    const t = snap.t + this.clockOffset;
    this.recordLateness(now - t);

    const tail = this.frames[this.frames.length - 1];
    if (tail && t <= tail.t) return null;

    const heads = new Map<number, SnapHead>();
    const s = snap.s;
    for (let i = 0; i < s.length; i += 7) {
      heads.set(s[i], {
        owner: s[i + 1],
        x: s[i + 2],
        y: s[i + 3],
        a: s[i + 4] / 1000,
        mass: s[i + 5] / 10,
        boost: s[i + 6] === 1,
      });
    }
    this.frames.push({ t, heads });
    while (this.frames.length > 2 && this.frames[0].t < now - KEEP_MS) this.frames.shift();
    return t;
  }

  /**
   * Las cabezas en el instante local `rt` (ahora menos el retraso de interpolacion). Dibuja
   * las que estan en el snapshot de despues de `rt`: una que ya no esta ahi murio o
   * salio de la vista. Una que todavia no estaba en el snapshot de antes recien entra
   * y no se dibuja hasta que la interpolacion la alcance.
   */
  sample(rt: number, cb: (sid: number, head: SnapHead) => void): void {
    const frames = this.frames;
    if (frames.length === 0) return;
    let a = frames[0];
    let b = frames[frames.length - 1];
    if (rt <= a.t) {
      b = a;
    } else if (rt >= b.t) {
      // Buffer agotado: se sigue el ultimo tramo un rato en vez de plantarla en seco.
      a = frames.length > 1 ? frames[frames.length - 2] : b;
    } else {
      for (let i = frames.length - 1; i > 0; i--) {
        if (frames[i - 1].t <= rt && rt <= frames[i].t) {
          a = frames[i - 1];
          b = frames[i];
          break;
        }
      }
    }
    const span = b.t - a.t;
    const raw = span > 0 ? (rt - a.t) / span : 1;
    const f = Math.min(raw, span > 0 ? 1 + EXTRAPOLATE_MS / span : 1);

    const out: SnapHead = { owner: 0, x: 0, y: 0, a: 0, mass: 0, boost: false };
    for (const [sid, hb] of b.heads) {
      const ha = a.heads.get(sid);
      if (!ha) {
        if (a !== b) continue; // recien entra
        Object.assign(out, hb);
      } else {
        out.owner = hb.owner;
        out.x = ha.x + (hb.x - ha.x) * f;
        out.y = ha.y + (hb.y - ha.y) * f;
        out.a = ha.a + wrapAngle(hb.a - ha.a) * Math.min(f, 1);
        // La masa no se extrapola: crecer de mas y achicarse queda feo.
        out.mass = ha.mass + (hb.mass - ha.mass) * Math.min(f, 1);
        out.boost = f < 0.5 ? ha.boost : hb.boost;
      }
      cb(sid, out);
    }
  }
}
