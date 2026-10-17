import type { AgSnap } from "./AgarProtocol";
import { CLOCK_DRIFT_RATE, EXTRAPOLATE_MS } from "./constants";

export interface SnapCell {
  owner: number;
  x: number;
  y: number;
  mass: number;
}

interface Frame {
  /** Instante del snapshot traido al reloj local (ms). */
  t: number;
  cells: Map<number, SnapCell>;
}

/** Cuanto historial se guarda (ms). Sobra contra el INTERP_DELAY. */
const KEEP_MS = 800;

/**
 * Linea de tiempo de los snapshots, para dibujar a los DEMAS interpolados.
 *
 * Cada snapshot se fecha con el reloj de la SIMULACION del server (`snap.t`) mas un
 * offset de reloj, nunca con la hora de llegada: fecharlo al llegar mete el jitter de
 * entrega adentro del movimiento (dos snapshots pegados describen un paso entero en
 * 2 ms y la celula se ve pegando saltos). El offset se estima con el MINIMO de
 * (llegada - t) visto, que es la muestra que menos jitter comio, y se corrige lento
 * hacia arriba por la deriva entre relojes. Es el mismo esquema que PONG y Manchon
 * (ver "Interpolar sobre el reloj del server" en el CLAUDE.md raiz).
 */
export class Timeline {
  private frames: Frame[] = [];
  private clockOffset: number | null = null;

  reset(): void {
    this.frames = [];
    this.clockOffset = null;
  }

  /** Agrega el snapshot y devuelve su instante en el reloj local. */
  push(snap: AgSnap, now: number): number {
    const sample = now - snap.t;
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * CLOCK_DRIFT_RATE;
    const t = snap.t + this.clockOffset;

    const tail = this.frames[this.frames.length - 1];
    // Fuera de orden (llego despues que uno mas nuevo): se descarta.
    if (tail && t <= tail.t) return t;

    const cells = new Map<number, SnapCell>();
    const c = snap.c;
    for (let i = 0; i < c.length; i += 5) {
      cells.set(c[i], { owner: c[i + 1], x: c[i + 2], y: c[i + 3], mass: c[i + 4] });
    }
    this.frames.push({ t, cells });
    while (this.frames.length > 2 && this.frames[0].t < now - KEEP_MS) this.frames.shift();
    return t;
  }

  /**
   * Las celulas en el instante local `rt` (normalmente ahora - INTERP_DELAY). Dibuja
   * las que estan en el snapshot de despues de `rt`: una que ya no esta ahi se comio
   * o salio de la vista.
   */
  sample(rt: number, cb: (id: number, cell: SnapCell) => void): void {
    const frames = this.frames;
    if (frames.length === 0) return;
    let a = frames[0];
    let b = frames[frames.length - 1];
    if (rt <= a.t) {
      b = a;
    } else if (rt >= b.t) {
      // Buffer agotado (falto un snapshot): se sigue el ultimo tramo un rato, que es
      // casi siempre lo que la celula hizo, en vez de plantarla en seco.
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

    const out: SnapCell = { owner: 0, x: 0, y: 0, mass: 0 };
    for (const [id, cb2] of b.cells) {
      const ca = a.cells.get(id) ?? cb2;
      out.owner = cb2.owner;
      out.x = ca.x + (cb2.x - ca.x) * f;
      out.y = ca.y + (cb2.y - ca.y) * f;
      // La masa no se extrapola: crecer de mas y achicarse queda feo.
      out.mass = ca.mass + (cb2.mass - ca.mass) * Math.min(f, 1);
      cb(id, out);
    }
  }
}
