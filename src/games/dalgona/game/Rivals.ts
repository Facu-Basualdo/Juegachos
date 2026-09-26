import { Candy } from "./Candy";
import { SHAPES, type ShapeId } from "./shapes";

/** Estado de un jugador tal como lo ven los demas. */
export type RivalStatus = "wait" | "choose" | "play" | "broken" | "done" | "time";

/**
 * Mensaje en vivo de Dalgona (`RoomMode.broadcastLive`). Plano y corto a proposito:
 * el canal de la sala tiene un tope de mensajes por segundo y lo comparten todos.
 */
export interface DgLive {
  [key: string]: string | number | boolean;
  /** Marca del juego: el canal de la sala es el mismo en todas las paginas. */
  g: "dg";
  /** Ronda de la sala, para descartar mensajes de la anterior. */
  r: number;
  st: RivalStatus;
  /** Lata elegida (0-3) o -1. */
  t: number;
  /** Figura (vacia hasta que se abre la lata). */
  sh: string;
  /** Tallado: un caracter 0-3 por tramo. */
  c: string;
  /** Aguja en coordenadas de galleta, si esta apretando (0/1) y si se ve (0/1). */
  x: number;
  y: number;
  p: number;
  v: number;
  /** Tension maxima y humedad, 0-1. */
  s: number;
  w: number;
  /** Tramo roto, o -1. */
  b: number;
  pts: number;
}

export interface Rival {
  name: string;
  status: RivalStatus;
  tin: number;
  candy: Candy | null;
  stress: number;
  /** Aguja suavizada (lo que se dibuja) y la ultima recibida. */
  nx: number;
  ny: number;
  tx: number;
  ty: number;
  pressed: boolean;
  /** La aguja esta sobre la pantalla (si no, no se dibuja). */
  needle: boolean;
  score: number;
  /** performance.now() del ultimo mensaje. */
  seenAt: number;
  /** Segundos desde que se rompio o salio su figura (para la animacion). */
  endT: number;
}

/** Sin noticias de un rival en este tiempo, se lo da por desconectado, en ms. */
export const RIVAL_STALE_MS = 8000;
/** Suavizado de la aguja de un rival hacia la ultima posicion recibida. */
const NEEDLE_EASE = 10;

/**
 * Lo que se sabe de los demas jugadores de la sala. No simula nada: aplica lo que
 * llega (el tallado por niveles, la tension maxima, la aguja) sobre una `Candy` de la
 * misma figura, que es lo que dibuja el Renderer. La grieta sale de `Candy.breakAt`,
 * que es determinista, asi que solo viaja el numero de tramo.
 */
export class Rivals {
  readonly list: Rival[];
  private readonly byName = new Map<string, Rival>();

  constructor(names: string[]) {
    this.list = names.map((name) => ({
      name,
      status: "wait" as RivalStatus,
      tin: -1,
      candy: null,
      stress: 0,
      nx: 0,
      ny: 0,
      tx: 0,
      ty: 0,
      pressed: false,
      needle: false,
      score: 0,
      seenAt: 0,
      endT: 0,
    }));
    for (const r of this.list) this.byName.set(r.name, r);
  }

  apply(name: string, m: DgLive): void {
    const r = this.byName.get(name);
    if (!r) return;
    r.seenAt = performance.now();
    // Una partida nueva (volver a elegir) borra la galleta anterior.
    if (m.st === "choose" && r.status !== "choose") r.candy = null;
    r.tin = m.t;
    r.stress = m.s;
    r.pressed = m.p === 1;
    // Al aparecer la aguja salta a su lugar en vez de deslizarse desde donde estaba.
    if (m.v === 1 && !r.needle) {
      r.nx = m.x;
      r.ny = m.y;
    }
    r.needle = m.v === 1;
    r.score = m.pts;
    const shape = SHAPES[m.sh as ShapeId];
    if (shape && (!r.candy || r.candy.shape.id !== shape.id)) {
      r.candy = new Candy(shape, 1);
      r.nx = r.tx = m.x;
      r.ny = r.ty = m.y;
    }
    r.tx = m.x;
    r.ty = m.y;
    if (r.candy) {
      if (m.c) r.candy.applyLevels(m.c);
      r.candy.wet = m.w;
      if (m.st === "broken" && m.b >= 0 && r.candy.broken < 0) r.candy.breakAt(m.b);
      if (m.st === "done") r.candy.done = true;
    }
    if ((m.st === "broken" || m.st === "done") && r.status !== m.st) r.endT = 0;
    r.status = m.st;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-NEEDLE_EASE * dt);
    for (const r of this.list) {
      r.nx += (r.tx - r.nx) * k;
      r.ny += (r.ty - r.ny) * k;
      if (r.status === "broken" || r.status === "done") r.endT += dt;
    }
  }

  stale(r: Rival): boolean {
    return performance.now() - r.seenAt > RIVAL_STALE_MS;
  }

  /** Alguien sigue eligiendo o tallando (y se sabe de el). */
  anyPlaying(): boolean {
    return this.list.some((r) => (r.status === "choose" || r.status === "play") && !this.stale(r));
  }

  /** Quienes eligieron cada lata (para ponerles el nombre abajo). */
  pickers(): string[][] {
    const out: string[][] = [[], [], [], []];
    for (const r of this.list) if (r.status === "choose" && r.tin >= 0 && r.tin < 4 && !this.stale(r)) out[r.tin].push(r.name);
    return out;
  }
}

/** Parsea un mensaje en vivo; null si no es de Dalgona o esta roto. */
export function parseLive(data: Record<string, unknown>, round: number): DgLive | null {
  if (data.g !== "dg" || data.r !== round || typeof data.st !== "string") return null;
  const num = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k]) ? (data[k] as number) : d);
  const st = data.st as RivalStatus;
  if (!["wait", "choose", "play", "broken", "done", "time"].includes(st)) return null;
  return {
    g: "dg",
    r: round,
    st,
    t: num("t", -1),
    sh: typeof data.sh === "string" ? data.sh : "",
    c: typeof data.c === "string" ? data.c.slice(0, 400) : "",
    x: num("x", 0),
    y: num("y", 0),
    p: num("p", 0),
    v: num("v", 0),
    s: num("s", 0),
    w: num("w", 0),
    b: num("b", -1),
    pts: num("pts", 0),
  };
}
