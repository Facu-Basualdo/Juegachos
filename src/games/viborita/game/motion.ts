import type { VbClientConfig } from "./ViboritaProtocol";

/**
 * Formulas de Viborita del lado del cliente. Los NUMEROS vienen del server en el
 * `vb:init` (`VbClientConfig`); las formulas estan duplicadas de
 * `server/src/games/viborita-config.ts` por la regla de decoupling: si cambian alla,
 * cambian aca.
 */

export function radiusOf(cfg: VbClientConfig, mass: number): number {
  return cfg.rBase + cfg.rK * Math.sqrt(mass);
}

export function bodyLengthOf(cfg: VbClientConfig, mass: number): number {
  return cfg.lenBase + cfg.lenK * mass;
}

export function turnRateOf(cfg: VbClientConfig, mass: number): number {
  return cfg.turnBase / (1 + mass / cfg.turnMassK);
}

/** Velocidad real: el turbo solo anda con masa suficiente (el server decide igual). */
export function speedOf(cfg: VbClientConfig, mass: number, boost: boolean): number {
  return boost && mass >= cfg.boostMinMass ? cfg.boostSpeed : cfg.speed;
}

export function pelletRadiusOf(mass: number): number {
  return 4 + Math.sqrt(mass) * 2;
}

export function viewHeightOf(cfg: VbClientConfig, mass: number): number {
  const r0 = radiusOf(cfg, cfg.startMass);
  return cfg.viewBase * Math.pow(Math.max(radiusOf(cfg, mass), r0) / r0, cfg.viewExp);
}

/**
 * Avanza una cabeza `dt` segundos girando hacia `target` a `omega` rad/s como mucho.
 * Integracion EXACTA (arco hasta alinearse, despues recta): da lo mismo partida por
 * cuadros, por pasos del server o por tramos de input, que es lo que hace que la
 * prediccion y la reconciliacion coincidan con el server. Copia de `advanceHead` del
 * server.
 */
export function advanceHead(
  h: { x: number; y: number; a: number },
  target: number,
  omega: number,
  v: number,
  dt: number,
): void {
  if (dt <= 0) return;
  const diff = wrapAngle(target - h.a);
  const turnTime = omega > 0 ? Math.abs(diff) / omega : Infinity;
  const arcTime = Math.min(dt, turnTime);
  if (arcTime > 1e-9 && diff !== 0) {
    const s = diff > 0 ? 1 : -1;
    const a1 = h.a + s * omega * arcTime;
    const k = v / (s * omega);
    h.x += k * (Math.sin(a1) - Math.sin(h.a));
    h.y -= k * (Math.cos(a1) - Math.cos(h.a));
    h.a = turnTime <= dt ? target : a1;
  }
  const straight = dt - (diff !== 0 ? arcTime : 0);
  if (straight > 0) {
    h.x += Math.cos(h.a) * v * straight;
    h.y += Math.sin(h.a) * v * straight;
  }
  h.a = wrapAngle(h.a);
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
