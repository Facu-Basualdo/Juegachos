import { CELLS, GRID } from "./constants";

/**
 * La pista en el cliente: el color de cada celda y si el bloque sigue en pie. El
 * dibujo lo manda el server (`PlState.pattern`); la caida la hace cada cliente al
 * recibir el paso "drop" (ver el sim para el porque).
 */
export class Floor {
  readonly colors = new Int8Array(CELLS);
  readonly solid = new Uint8Array(CELLS).fill(1);
  /** Dibujo aplicado, para no rearmar la pista con cada mensaje. */
  pattern = "";

  /** Aplica un dibujo nuevo y vuelve a poner todos los bloques. */
  setPattern(pattern: string): void {
    this.pattern = pattern;
    for (let i = 0; i < CELLS; i++) {
      this.colors[i] = (pattern.charCodeAt(i) - 48) | 0;
      this.solid[i] = 1;
    }
  }

  /** Cae todo lo que no es del color pedido. Devuelve las celdas que cayeron. */
  drop(color: number): number[] {
    const fallen: number[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (this.solid[i] && this.colors[i] !== color) {
        this.solid[i] = 0;
        fallen.push(i);
      }
    }
    return fallen;
  }

  isSolid(x: number, z: number): boolean {
    if (x < 0 || x >= GRID || z < 0 || z >= GRID) return false;
    return this.solid[z * GRID + x] === 1;
  }
}
