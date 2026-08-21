import {
  GAP_JITTER,
  GAP_MIN,
  GAP_START,
  PAIR_CHANCE_MAX,
  PAIR_FROM_LEVEL,
  RAMP_SECONDS,
  RUNNER_HALF,
  RUNNER_X,
  SPAWN_DIST,
  SPEED_MAX,
  SPEED_START,
  STEP_SECONDS,
  mulberry32,
} from "./constants";
import { Beam, type BeamKind } from "./Beam";
import type { Runner } from "./Runner";

/** Lo que paso en un tick, para que el Game le ponga sonido y particulas. */
export interface FieldResult {
  /** Vigas nacidas este tick (rodadura + flecha de aviso en el borde). */
  spawned: Beam[];
  /** Eventos de viga que terminaron de cruzar al corredor (un par cuenta uno). */
  dodged: number;
  /** True el cuadro en que una viga atraviesa al corredor. */
  died: boolean;
}

/** Primera llegada: el arranque es holgado a proposito. */
const FIRST_ARRIVAL = 2.2;
/** Tope de spawns por tick, por si un dt raro adelanta varios huecos. */
const MAX_SPAWNS_PER_TICK = 4;

/**
 * Dificultad al segundo `t` de la partida. Sube por escalones (uno cada
 * STEP_SECONDS) hasta el maximo en RAMP_SECONDS y ahi se queda.
 */
function difficulty(t: number): { speed: number; gap: number; pairChance: number; level: number } {
  const level = Math.floor(t / STEP_SECONDS);
  const f = Math.min(1, level / (RAMP_SECONDS / STEP_SECONDS));
  const pairLevels = level - PAIR_FROM_LEVEL + 1;
  return {
    speed: SPEED_START + (SPEED_MAX - SPEED_START) * f,
    gap: GAP_START + (GAP_MIN - GAP_START) * f,
    pairChance: pairLevels > 0 ? Math.min(PAIR_CHANCE_MAX, pairLevels * 0.03) : 0,
    level,
  };
}

/**
 * Todas las vigas vivas, su agenda y la colision.
 *
 * La clave del ritmo: las vigas se agendan por CUANDO cruzan al corredor
 * (`nextArrival`), no por cuando nacen. Agendar el nacimiento haria que subir la
 * velocidad acercara las llegadas sin querer, y que el hueco real entre dos
 * acciones dependiera de la velocidad de cada una. Asi, en cambio, el hueco
 * entre dos decisiones del jugador es exactamente `gap`, y la velocidad solo
 * decide cuanto tiempo tenes para leer la viga que viene.
 */
export class BeamField {
  readonly beams: Beam[] = [];
  private rand: () => number = mulberry32(1);
  /** Reloj de la partida: la agenda entera cuelga de aca. */
  private t = 0;
  private nextArrival = FIRST_ARRIVAL;

  get elapsed(): number {
    return this.t;
  }

  reset(seed: number): void {
    this.beams.length = 0;
    this.rand = mulberry32(seed);
    this.t = 0;
    this.nextArrival = FIRST_ARRIVAL;
  }

  update(dt: number, runner: Runner | null): FieldResult {
    this.t += dt;
    const result: FieldResult = { spawned: [], dodged: 0, died: false };

    this.spawnDue(result);

    for (const beam of this.beams) {
      const wasCrossed = beam.crossed;
      beam.update(dt);
      if (!wasCrossed && beam.crossed && beam.scores) result.dodged++;
      if (runner && !runner.dead && !result.died && beam.hits(runner, RUNNER_HALF)) {
        result.died = true;
      }
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      if (this.beams[i].offMap) this.beams.splice(i, 1);
    }

    return result;
  }

  /** Suelta las vigas cuya llegada agendada ya entra en distancia de spawn. */
  private spawnDue(result: FieldResult): void {
    for (let n = 0; n < MAX_SPAWNS_PER_TICK; n++) {
      const d = difficulty(this.nextArrival);
      const lead = SPAWN_DIST / d.speed;
      if (this.t < this.nextArrival - lead) return;

      // Nace exactamente donde tiene que estar para cruzar en `nextArrival`.
      const remaining = Math.max(0, this.nextArrival - this.t);
      const kind: BeamKind = this.rand() < 0.5 ? "low" : "high";
      const dir: 1 | -1 = this.rand() < 0.5 ? 1 : -1;
      const offset = d.speed * remaining;

      const main = new Beam(RUNNER_X - dir * offset, dir, kind, d.speed, true);
      this.beams.push(main);
      result.spawned.push(main);

      // Par simetrico: misma clase de viga entrando por el otro lado y llegando
      // en el mismo instante. Es la misma accion a hacer, con el doble de teatro.
      if (d.pairChance > 0 && this.rand() < d.pairChance) {
        const twin = new Beam(RUNNER_X + dir * offset, (-dir) as 1 | -1, kind, d.speed, false);
        this.beams.push(twin);
        result.spawned.push(twin);
      }

      const jitter = (this.rand() * 2 - 1) * GAP_JITTER;
      this.nextArrival += Math.max(GAP_MIN * 0.85, d.gap + jitter);
    }
  }
}
