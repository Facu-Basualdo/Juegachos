import type { VbClientConfig } from "./ViboritaProtocol";
import { ERROR_FADE_RATE, HISTORY_MS, SNAP_DIST } from "./constants";
import { advanceHead, bodyLengthOf, speedOf, turnRateOf } from "./motion";
import { Trail } from "./Trail";

interface SentInput {
  n: number;
  /** Instante local (ms, el del cuadro) en que se mando. */
  t: number;
  angle: number;
  boost: boolean;
}

/**
 * Prediccion de la viborita PROPIA con reconciliacion por acuse de input.
 *
 * La cabeza se mueve al instante con la misma fisica que el server (giro limitado por
 * el largo, turbo si alcanza la masa) y con la misma integracion EXACTA
 * (`advanceHead`), asi que avanzar por cuadros da lo mismo que los pasos del server.
 * Cuando llega un snapshot se parte de la cabeza del server y se vuelven a aplicar
 * los inputs que todavia no habia escuchado (`n` = el ultimo que si, `a` = cuanto de
 * el ya aplico). Lo unico que queda por corregir es lo que no se puede predecir:
 * comer (cambia la masa y con ella el giro) y el turbo que se corta por falta de masa.
 *
 * El cuerpo propio sale de la estela de la cabeza PREDICHA, registrada en cada cuadro.
 */
export class Predictor {
  head: { x: number; y: number; a: number } | null = null;
  sid = -1;
  mass = 0;
  boosting = false;
  /** Resto visual de la ultima correccion, que se disuelve en pantalla. */
  visX = 0;
  visY = 0;
  readonly trail = new Trail();
  /** Ultimo input enviado: el que el server esta aplicando. */
  dir = { angle: 0, boost: false };
  /** Ida y vuelta medida con los acuses de input (ms), para el panel de red. */
  rtt = 0;
  private inputs: SentInput[] = [];
  private cfg: VbClientConfig | null = null;

  setConfig(cfg: VbClientConfig): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.head = null;
    this.sid = -1;
    this.inputs = [];
    this.visX = this.visY = 0;
  }

  get alive(): boolean {
    return this.head !== null;
  }

  /** Cuerpo entero que mando el server la primera vez (al aparecer o reconectar). */
  seed(sid: number, points: number[], now: number): void {
    this.sid = sid;
    this.trail.seed(points, now);
  }

  recordInput(n: number, t: number, angle: number, boost: boolean): void {
    this.dir = { angle, boost };
    this.inputs.push({ n, t, angle, boost });
    while (this.inputs.length > 2 && this.inputs[0].t < t - HISTORY_MS) this.inputs.shift();
  }

  /** Avanza un cuadro con el input ENVIADO (el mismo que reproduce `reconcile`). */
  advance(dt: number, now: number): void {
    const cfg = this.cfg;
    const h = this.head;
    if (!cfg || !h) return;
    this.boosting = this.dir.boost && this.mass >= cfg.boostMinMass;
    advanceHead(h, this.dir.angle, turnRateOf(cfg, this.mass), speedOf(cfg, this.mass, this.dir.boost), dt);
    this.trail.push(now, h.x, h.y);
    this.trail.trim(bodyLengthOf(cfg, this.mass) + 150);
    const decay = Math.exp(-ERROR_FADE_RATE * dt);
    this.visX *= decay;
    this.visY *= decay;
  }

  reconcile(sid: number, sx: number, sy: number, sa: number, mass: number, ack: number, applied: number, until: number): void {
    const cfg = this.cfg;
    if (!cfg) return;
    this.mass = mass;
    if (!this.head || sid !== this.sid) {
      this.sid = sid;
      this.head = { x: sx, y: sy, a: sa };
      if (this.trail.empty) this.trail.seed([sx, sy], until);
      this.visX = this.visY = 0;
      // Hasta que el jugador mueva el mouse sigue derecho, no hacia el angulo 0.
      if (this.inputs.length === 0) this.dir = { angle: sa, boost: false };
    }

    let from = this.inputs.findIndex((i) => i.n === ack);
    if (from > 0) this.inputs.splice(0, from);
    if (from >= 0) {
      from = 0;
      // Desde que se mando el input acusado hasta ahora, menos lo que el server ya lo
      // venia aplicando: la ida y vuelta (incluye el buffer de jitter del server).
      const sample = performance.now() - this.inputs[0].t - applied;
      if (sample > 0 && sample < HISTORY_MS) this.rtt = this.rtt === 0 ? sample : this.rtt + (sample - this.rtt) * 0.1;
    }
    // Acuse que ya no esta en la lista (red muy lenta) o todavia ninguno: se
    // reproducen los posteriores al acuse desde la cabeza del server.
    const start = from >= 0 ? 0 : this.inputs.findIndex((i) => i.n > ack);

    const h = { x: sx, y: sy, a: sa };
    if (start >= 0) {
      for (let i = start; i < this.inputs.length; i++) {
        const input = this.inputs[i];
        const t0 = i === start && from >= 0 ? input.t + applied : input.t;
        const t1 = i + 1 < this.inputs.length ? this.inputs[i + 1].t : until;
        const dt = (t1 - t0) / 1000;
        if (dt > 0) {
          advanceHead(h, input.angle, turnRateOf(cfg, mass), speedOf(cfg, mass, input.boost), dt);
        }
      }
    }

    const head = this.head;
    const dx = h.x - head.x;
    const dy = h.y - head.y;
    head.a = h.a;
    if (dx === 0 && dy === 0) return;
    head.x = h.x;
    head.y = h.y;
    if (Math.hypot(dx, dy) > SNAP_DIST) {
      // Salto grande (reconexion): se corre todo el cuerpo con la cabeza.
      this.trail.translate(dx, dy);
      this.visX = this.visY = 0;
    } else {
      this.visX -= dx;
      this.visY -= dy;
    }
  }
}
