import type { Creature, LegSide } from "./Creature";

/**
 * Calidad del paso. Es SOLO devolucion (sonido, polvo, cartelito): no da bonus
 * ni penaliza. Quien decide si te caes es la fisica, igual que en el original.
 */
export type StepGrade = "apurado" | "bien" | "perfecto" | "tarde";

/**
 * Ventanas sobre `Creature.stanceTrailRatio()`: 0 = la cadera esta encima del
 * zapato apoyado, 1 = la pata ya no da mas. La ventana buena esta bien pasado
 * el medio a proposito — el paso hay que darlo cuando el cuerpo YA se fue
 * adelante del pie, no antes.
 */
const TRAIL_EARLY = 0.18;
const TRAIL_GOOD_LO = 0.42;
const TRAIL_GOOD_HI = 0.78;
const TRAIL_LATE = 0.94;

/** Dos toques mas juntos que esto son un doble disparo del navegador. */
const TAP_DEBOUNCE_MS = 55;

export interface StepResult {
  side: LegSide;
  grade: StepGrade;
  /** `stanceTrailRatio()` en el momento del toque (0..1). */
  trail: number;
}

/**
 * Alternancia estricta de piernas. Cada toque manda a balancearse a la pierna
 * que toca (izquierda -> derecha -> izquierda, sin excepcion) y deja a la otra
 * de apoyo; no existe forma de adelantar dos veces la misma.
 */
export class StepController {
  /** Pata que sale en el proximo toque. Arranca en la de atras. */
  private nextSwing: LegSide = 1;
  private lastTapAt = -Infinity;
  private steps = 0;
  private perfectStreak = 0;

  reset(): void {
    this.nextSwing = 1;
    this.lastTapAt = -Infinity;
    this.steps = 0;
    this.perfectStreak = 0;
  }

  stepCount(): number {
    return this.steps;
  }

  streak(): number {
    return this.perfectStreak;
  }

  /** Cual pata sale en el proximo toque (para el indicador del HUD). */
  pendingSide(): LegSide {
    return this.nextSwing;
  }

  /**
   * Procesa un toque. Devuelve null si fue rebote del navegador.
   * Nunca valida "timing": el paso siempre sale y la fisica decide el resto.
   */
  tap(creature: Creature, nowMs: number): StepResult | null {
    if (nowMs - this.lastTapAt < TAP_DEBOUNCE_MS) return null;
    this.lastTapAt = nowMs;

    const side = this.nextSwing;
    const stanceSide: LegSide = side === 0 ? 1 : 0;
    const trail = creature.stanceTrailRatio();

    creature.startSwing(side);
    this.nextSwing = stanceSide;
    this.steps++;

    const grade = gradeOf(trail);
    this.perfectStreak = grade === "perfecto" ? this.perfectStreak + 1 : 0;

    return { side, grade, trail };
  }
}

function gradeOf(trail: number): StepGrade {
  if (trail < TRAIL_EARLY) return "apurado";
  if (trail < TRAIL_GOOD_LO) return "bien";
  if (trail <= TRAIL_GOOD_HI) return "perfecto";
  if (trail <= TRAIL_LATE) return "bien";
  return "tarde";
}
