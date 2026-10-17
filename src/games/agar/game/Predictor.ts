import type { AgClientConfig } from "./AgarProtocol";
import { ERROR_FADE_RATE, HISTORY_MS, SNAP_DIST } from "./constants";

export interface OwnCell {
  x: number;
  y: number;
  mass: number;
  /** Resto visual de la ultima correccion, que se disuelve en pantalla. */
  visX: number;
  visY: number;
}

interface SentInput {
  n: number;
  /** Instante local (ms, el del cuadro) en que se mando. */
  t: number;
  dx: number;
  dy: number;
}

/**
 * Prediccion de las celulas PROPIAS con reconciliacion por acuse de input.
 *
 * El jugador ve su celula moverse al instante, con la misma fisica que el server
 * (velocidad = speedBase * masa^-speedExp, recorte contra el borde). Cuando llega un
 * snapshot NO se tira la celula hacia la posicion del server con un lerp: eso es un
 * elastico, porque el snapshot dice donde estaba hace media vuelta de red. Lo que se
 * hace es partir de la posicion autoritativa y volver a aplicar los inputs que el
 * server todavia no habia escuchado (`n` = el ultimo que si, `a` = cuanto de el ya
 * aplico). Moviendose derecho no queda correccion; solo se corrige lo que el cliente
 * no podia predecir (comer, que cambia la masa y por lo tanto la velocidad).
 *
 * Es el esquema de Manchon (ver "reconciliar con acuse de input" en el CLAUDE.md
 * raiz). Todo itera por celula: al agregar dividir, cada fragmento se reconcilia solo.
 */
export class Predictor {
  readonly cells = new Map<number, OwnCell>();
  /** Vector del ultimo input enviado: el que el server esta aplicando. */
  dir = { x: 0, y: 0 };
  private inputs: SentInput[] = [];
  private cfg: AgClientConfig | null = null;

  setConfig(cfg: AgClientConfig): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.cells.clear();
    this.inputs = [];
    this.dir = { x: 0, y: 0 };
  }

  get alive(): boolean {
    return this.cells.size > 0;
  }

  /** Centro de masa dibujado (con el resto de correccion) y masa total. */
  center(): { x: number; y: number; mass: number } {
    let x = 0;
    let y = 0;
    let m = 0;
    for (const c of this.cells.values()) {
      x += (c.x + c.visX) * c.mass;
      y += (c.y + c.visY) * c.mass;
      m += c.mass;
    }
    return m > 0 ? { x: x / m, y: y / m, mass: m } : { x: 0, y: 0, mass: 0 };
  }

  recordInput(n: number, t: number, dx: number, dy: number): void {
    this.dir = { x: dx, y: dy };
    this.inputs.push({ n, t, dx, dy });
    // Red de seguridad: si el acuse no llega, la lista no puede crecer para siempre.
    while (this.inputs.length > 2 && this.inputs[0].t < t - HISTORY_MS) this.inputs.shift();
  }

  /** Avanza la prediccion un cuadro con el input ENVIADO (el mismo que reproduce `reconcile`). */
  advance(dt: number): void {
    const decay = Math.exp(-ERROR_FADE_RATE * dt);
    for (const c of this.cells.values()) {
      this.move(c, this.dir.x, this.dir.y, dt);
      c.visX *= decay;
      c.visY *= decay;
    }
  }

  /**
   * Reconciliacion contra el snapshot. `own` son las celulas propias del server
   * (`[id, x, y, masa]`), `ack` el ultimo input aplicado y `applied` cuantos ms de
   * el ya rigen. `until` es la hora del ultimo cuadro: la prediccion va por cuadros
   * y el proximo integra desde ahi.
   */
  reconcile(own: [number, number, number, number][], ack: number, applied: number, until: number): void {
    // Celulas que el server ya no tiene (comidas): afuera.
    const ids = new Set(own.map((c) => c[0]));
    for (const id of this.cells.keys()) if (!ids.has(id)) this.cells.delete(id);

    let from = this.inputs.findIndex((i) => i.n === ack);
    if (from > 0) this.inputs.splice(0, from);
    if (from >= 0) from = 0;
    // Acuse que ya no esta en la lista (red muy lenta) o todavia ninguno: se
    // reproducen los posteriores al acuse desde la posicion del server.
    const start = from >= 0 ? 0 : this.inputs.findIndex((i) => i.n > ack);

    for (const [id, sx, sy, mass] of own) {
      let x = sx;
      let y = sy;
      const probe: OwnCell = { x, y, mass, visX: 0, visY: 0 };
      if (start >= 0) {
        for (let i = start; i < this.inputs.length; i++) {
          const input = this.inputs[i];
          const t0 = i === start && from >= 0 ? input.t + applied : input.t;
          const t1 = i + 1 < this.inputs.length ? this.inputs[i + 1].t : until;
          const dt = (t1 - t0) / 1000;
          if (dt > 0) this.move(probe, input.dx, input.dy, dt);
        }
        x = probe.x;
        y = probe.y;
      }

      const cell = this.cells.get(id);
      if (!cell) {
        this.cells.set(id, { x, y, mass, visX: 0, visY: 0 });
        continue;
      }
      cell.mass = mass;
      const dx = x - cell.x;
      const dy = y - cell.y;
      if (dx === 0 && dy === 0) continue;
      cell.x = x;
      cell.y = y;
      // Un salto grande (reconexion) se muestra tal cual; uno chico se disuelve.
      if (Math.hypot(dx, dy) > SNAP_DIST) {
        cell.visX = 0;
        cell.visY = 0;
      } else {
        cell.visX -= dx;
        cell.visY -= dy;
      }
    }
  }

  private move(c: OwnCell, dx: number, dy: number, dt: number): void {
    const cfg = this.cfg;
    if (!cfg || (dx === 0 && dy === 0)) return;
    const speed = cfg.speedBase * Math.pow(c.mass, -cfg.speedExp);
    const r = Math.min(cfg.radiusK * Math.sqrt(c.mass), cfg.mapSize / 2);
    c.x = clamp(c.x + dx * speed * dt, r, cfg.mapSize - r);
    c.y = clamp(c.y + dy * speed * dt, r, cfg.mapSize - r);
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
