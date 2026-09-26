import {
  BODY_HALF,
  BODY_HEIGHT,
  BRIDGE_HALF,
  GAP_FAR,
  GAP_NEAR,
  GOAL_Z,
  PAD_DEPTH,
  PAD_HALF,
  ROPE_AXIS_Y,
  ROPE_END_X,
  ROPE_THICK,
  ropeRadius,
  type Rope,
} from "./constants";

export type PlatKind = "pad" | "bridge" | "goal";

/** Una plataforma: caja con la tapa en `y`. */
export interface Plat {
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  h: number;
  kind: PlatKind;
}

/** Paso maximo de angulo al barrer la cuerda (rad): ~0.1 m en la punta. */
const SWEEP_STEP = 0.02;

/**
 * El recorrido: plataforma de salida, puente angosto con un tramo roto debajo de la
 * primera cuerda, y plataforma de meta. Fijo (no hay semilla: en la serie el puente
 * es siempre el mismo y lo que cambia es el ritmo de las cuerdas).
 */
export class Course {
  readonly plats: Plat[] = [
    { x: 0, z: PAD_DEPTH / 2, y: 0, w: PAD_HALF * 2, d: PAD_DEPTH, h: 1.2, kind: "pad" },
    { x: 0, z: GAP_NEAR / 2, y: 0, w: BRIDGE_HALF * 2, d: -GAP_NEAR, h: 0.5, kind: "bridge" },
    {
      x: 0,
      z: (GAP_FAR + GOAL_Z) / 2,
      y: 0,
      w: BRIDGE_HALF * 2,
      d: GAP_FAR - GOAL_Z,
      h: 0.5,
      kind: "bridge",
    },
    { x: 0, z: GOAL_Z - PAD_DEPTH / 2, y: 0, w: PAD_HALF * 2, d: PAD_DEPTH, h: 1.2, kind: "goal" },
  ];

  near(): Plat[] {
    return this.plats;
  }

  /** Tapa mas alta debajo de (x, z) por debajo de `y`, o null si abajo esta el vacio. */
  groundBelow(x: number, y: number, z: number): number | null {
    let best: number | null = null;
    for (const p of this.plats) {
      if (p.y > y + 0.05) continue;
      if (Math.abs(p.x - x) > p.w / 2 || Math.abs(p.z - z) > p.d / 2) continue;
      if (best === null || p.y > best) best = p.y;
    }
    return best;
  }
}

/**
 * La cuerda `rope` le pega a la caja del jugador (pies en `y`) en algun momento del
 * giro de `from` a `to` (rad)? El giro puede ir para cualquier lado (`dir`). Se barre el arco en pasos chicos en vez de mirar solo el
 * final: en la punta la cuerda llega a ~25 m/s y en un cuadro atraviesa el cuerpo
 * entero.
 *
 * La cuerda vive en el plano y-z (gira alrededor del eje x que une a los muñecos):
 * el punto de la cuerda a la altura `x` del jugador esta en
 * (z, y) = (rope.z + r sin(th), ROPE_AXIS_Y - r cos(th)).
 */
export function ropeHits(rope: Rope, from: number, to: number, x: number, y: number, z: number): boolean {
  if (Math.abs(x) > ROPE_END_X) return false;
  const r = ropeRadius(x);
  // Una vuelta entera ya pasa por todos lados: con la pestaña dormida el arco puede
  // sumar miles de vueltas y no hace falta barrerlas todas.
  if (Math.abs(to - from) > Math.PI * 2) from = to - Math.sign(to - from) * Math.PI * 2;
  const span = to - from;
  const steps = Math.max(1, Math.ceil(Math.abs(span) / SWEEP_STEP));
  const reach = BODY_HALF + ROPE_THICK;
  for (let i = 0; i <= steps; i++) {
    const th = from + (span * i) / steps;
    const rz = rope.z + r * Math.sin(th);
    if (Math.abs(rz - z) > reach) continue;
    const ry = ROPE_AXIS_Y - r * Math.cos(th);
    if (ry > y - ROPE_THICK && ry < y + BODY_HEIGHT + ROPE_THICK) return true;
  }
  return false;
}
