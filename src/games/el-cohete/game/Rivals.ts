/**
 * Mensaje en vivo de El Cohete (`RoomMode.broadcastLive`). Plano y corto: el canal de
 * la sala tiene un tope de mensajes por segundo y lo comparten todos. Se manda solo
 * cuando cambia algo (apuesta, se bajo, exploto) mas un keepalive.
 */
export interface CkLive {
  [key: string]: string | number | boolean;
  /** Marca del juego: el canal de la sala es el mismo en todas las paginas. */
  g: "ck";
  r: number;
  /** Vuelo (1..FLIGHTS). */
  f: number;
  /** Apuesta en este vuelo (0 = no apostó). */
  b: number;
  /** Multiplicador al que se bajo x100 (0 = sigue arriba o no apostó, -1 = exploto con él). */
  c: number;
  /** Fichas que tiene. */
  k: number;
}

export interface Rival {
  name: string;
  seat: number;
  flight: number;
  bet: number;
  cash: number;
  chips: number;
  seenAt: number;
}

const STALE_MS = 10000;

/** Los otros jugadores de la sala: mismo cohete, cada uno con sus fichas. */
export class Rivals {
  readonly list: Rival[];
  private readonly byName = new Map<string, Rival>();

  constructor(names: string[], seats: number[], chips: number) {
    this.list = names.map((name, i) => ({ name, seat: seats[i], flight: 0, bet: 0, cash: 0, chips, seenAt: 0 }));
    for (const r of this.list) this.byName.set(r.name, r);
  }

  /** Aplica un mensaje. Devuelve el rival si en este mensaje se bajo (para el paracaidas). */
  apply(name: string, m: CkLive): Rival | null {
    const r = this.byName.get(name);
    if (!r) return null;
    const jumped = m.c > 0 && (r.flight !== m.f || r.cash <= 0);
    r.flight = m.f;
    r.bet = m.b;
    r.cash = m.c;
    r.chips = m.k;
    r.seenAt = performance.now();
    return jumped ? r : null;
  }

  fresh(r: Rival): boolean {
    return performance.now() - r.seenAt < STALE_MS;
  }
}

export function parseLive(data: Record<string, unknown>, round: number): CkLive | null {
  if (data.g !== "ck" || data.r !== round) return null;
  const num = (k: string) => (typeof data[k] === "number" && Number.isFinite(data[k]) ? (data[k] as number) : null);
  const f = num("f");
  const b = num("b");
  const c = num("c");
  const k = num("k");
  if (f === null || b === null || c === null || k === null) return null;
  return { g: "ck", r: round, f, b, c, k };
}
