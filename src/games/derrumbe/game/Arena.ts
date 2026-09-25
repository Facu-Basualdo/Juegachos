import {
  ARENA_RADIUS,
  CELLS_PER_LAYER,
  CELL_COUNT,
  CENTER,
  FALL_DELAY_MS,
  GRID,
  LAYERS,
  RESTORE_AFTER_MS,
} from "./constants";

/** Estado de una celda: fuera del circulo, entera, pisada (cayendo) o caida. */
export const NONE = 0;
export const INTACT = 1;
export const TRIGGERED = 2;
export const REMOVED = 3;

/**
 * Copia local del piso. El server es el duenio (ver `server/src/games/derrumbe.ts`);
 * esta copia existe para que el piso responda sin esperar la red:
 *
 *  - Los pasos PROPIOS se predicen: el bloque empieza a titilar apenas se pisa y
 *    cae a los FALL_DELAY_MS, igual que en el server.
 *  - Los pasos AJENOS llegan en el snapshot (`f`) y caen FALL_DELAY_MS despues de
 *    llegar, o sea con un retraso de media latencia respecto al server. Para el que
 *    esta parado encima es invisible: la mecha dura bastante mas que eso.
 *  - Una vez por segundo llega el tablero entero (`doom`) y `reconcile` cura
 *    cualquier desacuerdo en las dos direcciones.
 *
 * Los tiempos son de `performance.now()` (reloj local): no hace falta sincronizar
 * relojes con el server porque todo es "caer en X ms desde que me entere".
 */
export class Arena {
  readonly state = new Uint8Array(CELL_COUNT);
  /** Momento local en que cae cada celda pisada. */
  private readonly removeAt = new Float64Array(CELL_COUNT);
  /** Momento local en que se piso cada celda (para no restaurar una prediccion en viaje). */
  private readonly triggeredAt = new Float64Array(CELL_COUNT);
  /** Celdas que forman parte del piso, en orden de indice. */
  readonly mask: number[] = [];
  /** Celdas pisadas todavia en pie, para no recorrer las 2500 en cada frame. */
  private readonly fusing = new Set<number>();

  constructor() {
    for (let layer = 0; layer < LAYERS; layer++) {
      for (let z = 0; z < GRID; z++) {
        for (let x = 0; x < GRID; x++) {
          if (Math.hypot(x - CENTER, z - CENTER) <= ARENA_RADIUS) {
            const idx = layer * CELLS_PER_LAYER + z * GRID + x;
            this.mask.push(idx);
            this.state[idx] = INTACT;
          }
        }
      }
    }
  }

  /** Hay bloque (entero o con la mecha prendida) en esa celda. */
  isSolid(layer: number, x: number, z: number): boolean {
    if (layer < 0 || layer >= LAYERS || x < 0 || x >= GRID || z < 0 || z >= GRID) return false;
    const s = this.state[layer * CELLS_PER_LAYER + z * GRID + x];
    return s === INTACT || s === TRIGGERED;
  }

  isSolidIndex(idx: number): boolean {
    const s = this.state[idx];
    return s === INTACT || s === TRIGGERED;
  }

  /** Prende la mecha de una celda entera. Devuelve false si ya estaba pisada o caida. */
  trigger(idx: number, now: number, delay = FALL_DELAY_MS): boolean {
    if (this.state[idx] !== INTACT) return false;
    this.state[idx] = TRIGGERED;
    this.removeAt[idx] = now + delay;
    this.triggeredAt[idx] = now;
    this.fusing.add(idx);
    return true;
  }

  /** Progreso de la mecha, 0 (recien pisada) a 1 (a punto de caer). */
  fuse(idx: number, now: number): number {
    if (this.state[idx] !== TRIGGERED) return 0;
    const left = this.removeAt[idx] - now;
    return 1 - Math.max(0, Math.min(1, left / FALL_DELAY_MS));
  }

  /** Celdas con la mecha prendida (para animarlas). */
  get fusingCells(): ReadonlySet<number> {
    return this.fusing;
  }

  /** Hace caer lo que se quedo sin mecha; devuelve las celdas que cayeron recien. */
  update(now: number): number[] {
    const fallen: number[] = [];
    for (const idx of this.fusing) {
      if (this.removeAt[idx] > now) continue;
      this.state[idx] = REMOVED;
      this.fusing.delete(idx);
      fallen.push(idx);
    }
    return fallen;
  }

  /**
   * Aplica el tablero completo del server (hex, un bit por celda pisada o caida).
   * Devuelve las celdas que hubo que restaurar, para volver a dibujarlas.
   *
   * - El server la da por pisada y aca sigue entera: se prende la mecha, pero corta
   *   (la mitad), porque del lado del server ya viene cayendo hace rato.
   * - El server la da por entera y aca ya cayo: se restaura, salvo que la
   *   prediccion sea reciente — ese paso propio puede estar todavia viajando al
   *   server, y restaurarlo haria titilar el bloque entre dos estados.
   */
  reconcile(hex: string, now: number, initial = false): number[] {
    const restored: number[] = [];
    for (const idx of this.mask) {
      const byte = parseInt(hex.substr((idx >> 3) * 2, 2), 16) || 0;
      const doomed = (byte & (1 << (idx & 7))) !== 0;
      const s = this.state[idx];
      if (doomed && s === INTACT) {
        if (initial) this.state[idx] = REMOVED;
        else this.trigger(idx, now, FALL_DELAY_MS / 2);
      } else if (!doomed && s !== INTACT && now - this.triggeredAt[idx] > RESTORE_AFTER_MS) {
        this.state[idx] = INTACT;
        this.fusing.delete(idx);
        restored.push(idx);
      }
    }
    return restored;
  }
}
