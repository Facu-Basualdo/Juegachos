import * as THREE from "three";
import { RAMP_BOTTOM, RAMP_TOP } from "./constants";

/**
 * La rampa como una sola recta en el plano YZ. Todo el juego (escalones,
 * muñeco, camara, colision con las puas) se posiciona con `t` en [0, 1]:
 * 0 = el pozo de puas de abajo, 1 = la boca de arriba.
 */

export const BOTTOM = new THREE.Vector3(...RAMP_BOTTOM);
export const TOP = new THREE.Vector3(...RAMP_TOP);

/** Vector completo de abajo hacia arriba (sin normalizar). */
export const RAMP_VEC = new THREE.Vector3().subVectors(TOP, BOTTOM);
export const RAMP_LENGTH = RAMP_VEC.length();
/** Unitario que apunta rampa arriba. */
export const RAMP_UP = RAMP_VEC.clone().normalize();
/** Normal de la superficie (hacia afuera de los escalones). */
export const RAMP_NORMAL = new THREE.Vector3(0, RAMP_UP.z * -1, RAMP_UP.y).normalize();
/** Inclinacion de la rampa respecto de la horizontal, en radianes. */
export const SLOPE_ANGLE = Math.atan2(RAMP_VEC.y, -RAMP_VEC.z);
/** Cuanto vale un escalon (en unidades de `t`) para una distancia dada. */
export function tPerDistance(distance: number): number {
  return distance / RAMP_LENGTH;
}

/** Punto de la superficie de la rampa en `t` (opcionalmente separado `lift`). */
export function rampPoint(t: number, out = new THREE.Vector3(), lift = 0): THREE.Vector3 {
  out.copy(RAMP_VEC).multiplyScalar(t).add(BOTTOM);
  if (lift !== 0) out.addScaledVector(RAMP_NORMAL, lift);
  return out;
}
