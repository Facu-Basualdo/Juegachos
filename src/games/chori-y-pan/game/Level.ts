import { COLS, ROWS } from "./constants";

/**
 * Formato de nivel. El mapa es texto (24 filas de 40 caracteres) y los mecanismos van
 * aparte, con coordenadas en celdas. Leyenda del mapa:
 *
 *   `#` piedra            `/` rampa que sube a la derecha   `\` rampa que sube a la izquierda
 *   `r` brasas (Chori pasa, el Pan se quema)
 *   `w` agua (el Pan pasa, el Chori se empapa)
 *   `g` chimichurri vencido (mata a los dos)
 *   `C` / `P` donde arrancan el Chori / el Pan
 *   `R` / `B` puerta del Chori / del Pan (la celda de abajo de la puerta)
 *   `a` aji (gema del Chori)      `o` cubito (gema del Pan)      `x` caja
 *   cualquier otra cosa: aire
 *
 * Los mecanismos se enlazan por **canal** (una letra): un canal esta activo si algun
 * boton de ese canal esta pisado o alguna palanca de ese canal esta para la derecha.
 */

export type Tile = "empty" | "solid" | "slopeR" | "slopeL" | "embers" | "water" | "goo";
export type Hero = "chori" | "pan";

export interface PlateDef {
  /** Celda del boton (apoya en el piso de esa celda). */
  x: number;
  y: number;
  ch: string;
}

export interface LeverDef {
  x: number;
  y: number;
  ch: string;
}

export interface GateDef {
  /** Rectangulo cerrado, en celdas. */
  x: number;
  y: number;
  w: number;
  h: number;
  ch: string;
  /** Hacia donde se corre al abrirse. */
  dir: "up" | "down" | "left" | "right";
  /** Abierta cuando el canal esta APAGADO. */
  invert?: boolean;
}

export interface LiftDef {
  /** Posicion con el canal apagado. */
  x: number;
  y: number;
  w: number;
  /** Recorrido (celdas) con el canal encendido. */
  dx: number;
  dy: number;
  ch: string;
  invert?: boolean;
}

export interface FanDef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Si tiene canal, solo sopla con el canal activo. */
  ch?: string;
}

export interface LevelDef {
  id: string;
  name: string;
  map: string[];
  plates?: PlateDef[];
  levers?: LeverDef[];
  gates?: GateDef[];
  lifts?: LiftDef[];
  fans?: FanDef[];
}

export interface ParsedLevel {
  def: LevelDef;
  tiles: Tile[];
  spawn: Record<Hero, { x: number; y: number }>;
  doors: Record<Hero, { x: number; y: number }>;
  gems: { x: number; y: number; hero: Hero }[];
  boxes: { x: number; y: number }[];
}

const TILE_OF: Record<string, Tile> = {
  "#": "solid",
  "/": "slopeR",
  "\\": "slopeL",
  r: "embers",
  w: "water",
  g: "goo",
};

export function parseLevel(def: LevelDef): ParsedLevel {
  if (def.map.length !== ROWS) throw new Error(`${def.id}: ${def.map.length} filas, se esperaban ${ROWS}`);
  const tiles: Tile[] = new Array(COLS * ROWS).fill("empty");
  const spawn = { chori: { x: 1, y: 1 }, pan: { x: 2, y: 1 } };
  const doors = { chori: { x: 1, y: 1 }, pan: { x: 2, y: 1 } };
  const gems: ParsedLevel["gems"] = [];
  const boxes: ParsedLevel["boxes"] = [];
  def.map.forEach((row, y) => {
    if (row.length !== COLS) throw new Error(`${def.id}: fila ${y} mide ${row.length}, se esperaban ${COLS}`);
    for (let x = 0; x < COLS; x++) {
      const c = row[x];
      const t = TILE_OF[c];
      if (t) tiles[y * COLS + x] = t;
      else if (c === "C") spawn.chori = { x, y };
      else if (c === "P") spawn.pan = { x, y };
      else if (c === "R") doors.chori = { x, y };
      else if (c === "B") doors.pan = { x, y };
      else if (c === "a") gems.push({ x, y, hero: "chori" });
      else if (c === "o") gems.push({ x, y, hero: "pan" });
      else if (c === "x") boxes.push({ x, y });
    }
  });
  return { def, tiles, spawn, doors, gems, boxes };
}
