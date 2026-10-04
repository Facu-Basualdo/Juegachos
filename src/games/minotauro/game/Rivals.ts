/** Estado de otro jugador de la sala, tal como lo ven los demas. */
export interface Rival {
  name: string;
  level: number;
  x: number;
  y: number;
  /** Posicion suavizada (lo que se dibuja). */
  sx: number;
  sy: number;
  alive: boolean;
  score: number;
  seenAt: number;
}

/**
 * Mensaje en vivo de Minotauro (`RoomMode.broadcastLive`). Plano y corto: el canal de
 * la sala tiene un tope de mensajes por segundo y lo comparten todos.
 */
export interface MnLive {
  [key: string]: string | number | boolean;
  /** Marca del juego: el canal de la sala es el mismo en todas las paginas. */
  g: "mn";
  r: number;
  lv: number;
  x: number;
  y: number;
  a: number;
  s: number;
}

/** Sin noticias en este tiempo, se lo deja de dibujar (ms). */
const STALE_MS = 8000;
const EASE = 9;

/**
 * Los otros Teseos: cada jugador baja SUS laberintos (los mismos para todos, por la
 * semilla de la ronda), con su propio Minotauro. De los demas solo llega en que nivel
 * estan, por donde van y si siguen vivos, y se dibujan como llamas palidas cuando
 * comparten nivel con uno. Es una carrera, no un juego cooperativo: nadie choca con
 * nadie.
 */
export class Rivals {
  readonly list: Rival[];
  private readonly byName = new Map<string, Rival>();

  constructor(names: string[]) {
    this.list = names.map((name) => ({ name, level: 1, x: 0, y: 0, sx: 0, sy: 0, alive: true, score: 0, seenAt: 0 }));
    for (const r of this.list) this.byName.set(r.name, r);
  }

  apply(name: string, m: MnLive): void {
    const r = this.byName.get(name);
    if (!r) return;
    if (m.lv !== r.level || r.seenAt === 0) {
      r.sx = m.x;
      r.sy = m.y;
    }
    r.level = m.lv;
    r.x = m.x;
    r.y = m.y;
    r.alive = m.a === 1;
    r.score = m.s;
    r.seenAt = performance.now();
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-EASE * dt);
    for (const r of this.list) {
      r.sx += (r.x - r.sx) * k;
      r.sy += (r.y - r.sy) * k;
    }
  }

  fresh(r: Rival): boolean {
    return performance.now() - r.seenAt < STALE_MS;
  }
}

export function parseLive(data: Record<string, unknown>, round: number): MnLive | null {
  if (data.g !== "mn" || data.r !== round) return null;
  const num = (k: string) => (typeof data[k] === "number" && Number.isFinite(data[k]) ? (data[k] as number) : null);
  const lv = num("lv");
  const x = num("x");
  const y = num("y");
  if (lv === null || x === null || y === null) return null;
  return { g: "mn", r: round, lv, x, y, a: num("a") ?? 1, s: num("s") ?? 0 };
}
