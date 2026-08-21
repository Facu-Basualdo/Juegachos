import { ORIGIN_X, ORIGIN_Y, TILE_HH, TILE_HW, Z_SCALE } from "./constants";

/**
 * Proyeccion isometrica del juego. Un unico lugar donde vive la formula: todo
 * lo que dibuja el renderer pasa por aca, asi mover la camara es cambiar
 * ORIGIN_X / ORIGIN_Y en constants y nada mas.
 */
export function isoX(x: number, y: number): number {
  return ORIGIN_X + (x - y) * TILE_HW;
}

export function isoY(x: number, y: number, z = 0): number {
  return ORIGIN_Y + (x + y) * TILE_HH - z * Z_SCALE;
}

/** Altura en pixeles de una distancia vertical del mundo. */
export function isoZ(z: number): number {
  return z * Z_SCALE;
}
