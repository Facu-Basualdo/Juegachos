import type { Server } from "socket.io";
import { GameRoom, registerGame, type RoomSim } from "../rooms.js";
import type { CrPos } from "../protocol.js";

/**
 * Neon Drift en sala: el server es un RELAY, no un arbitro. Cada cliente corre su
 * propia carrera (misma pista y mismos obstaculos, derivados de un seed compartido)
 * y difunde su posicion ~16 veces por segundo; el server la reenvia al resto. No hay
 * fisica ni puntaje aca: los puntajes los sigue reportando cada cliente a Supabase,
 * y el lobby / marcador / rejoin siguen siendo de la DB.
 *
 * Por que existe: el canal de broadcast de Supabase topea ~100 mensajes/s por canal y
 * una sala llena lo rozaba (8 jugadores x 10/s = 80/s). Al pasarse, Realtime cerraba
 * el socket, el cliente no se enteraba (un `subscribe()` sin callback de estado es
 * mudo) y TODOS los rivales desaparecian de la pantalla. Aca el tope es el server,
 * socket.io reconecta solo, y de yapa se puede subir la cadencia.
 *
 * Lo unico que el sim recuerda es la votacion de circuito de la ronda, para
 * reenviarsela al que se conecta tarde (ver `join`).
 */

/** Tope defensivo del indice de circuito (el cliente tiene 6; esto solo descarta
 *  basura, no valida contra la lista real: el server no conoce las pistas). */
const MAX_TRACK_INDEX = 64;

export class CarRaceSim implements RoomSim {
  private readonly room: GameRoom;
  /** Ronda en curso. El estado (votos / circuito) es de ESTA ronda y de ninguna otra. */
  private round = -1;
  /** Circuito ya decidido de la ronda, o null si la votacion sigue abierta. */
  private mapIdx: number | null = null;
  /** Voto de cada jugador (nickname -> indice de circuito). */
  private readonly votes = new Map<string, number>();
  /** Ronda declarada por cada jugador, para descartar mensajes de una ronda vieja. */
  private readonly roundByPlayer = new Map<string, number>();

  constructor(room: GameRoom) {
    this.room = room;
  }

  join(nickname: string, _roster: string[], meta?: unknown): void {
    const round = readInt(meta, "round") ?? 0;
    this.roundByPlayer.set(nickname, round);

    // Entre rondas la sala no siempre se vacia (los clientes navegan de la pagina de
    // una ronda a la siguiente y no todos a la vez), asi que el GameRoom puede
    // sobrevivir con los votos de la ronda anterior adentro. Una ronda mas nueva los
    // descarta.
    if (round > this.round) {
      this.round = round;
      this.votes.clear();
      this.mapIdx = null;
    }
    if (round !== this.round) return;

    // Al que llega tarde (o reconecta tras un F5 / una caida) se le pone al dia la
    // votacion. Esto es lo que el modelo de Supabase no podia dar: ahi el anuncio del
    // circuito era un broadcast efimero, y el que no estaba cuando paso se quedaba sin
    // el y caia al circuito por defecto (por seed), que podia no ser el votado.
    if (this.mapIdx !== null) {
      this.room.emitTo(nickname, "cr:map", { m: this.mapIdx });
      return;
    }
    for (const [player, m] of this.votes) {
      this.room.emitTo(nickname, "cr:vote", { p: player, m });
    }
  }

  leave(nickname: string): void {
    this.roundByPlayer.delete(nickname);
    // El voto NO se borra: el que voto y se fue (o esta recargando) ya opino, y el
    // anfitrion cuenta sobre los votos emitidos.
  }

  message(nickname: string, event: string, payload: unknown): void {
    // Mensaje de una ronda que ya no es la de la sala: se descarta.
    if ((this.roundByPlayer.get(nickname) ?? -1) !== this.round) return;

    switch (event) {
      case "cr:pos": {
        const pos = parsePos(payload);
        if (!pos) return;
        // El nickname lo estampa el server, no el cliente: nadie mueve el auto ajeno.
        // Va a toda la sala, emisor incluido (socket.io no tiene el `self: false` de
        // Supabase); el cliente ya descarta su propio snapshot por nickname.
        this.room.broadcast("cr:pos", { ...pos, p: nickname } satisfies CrPos);
        return;
      }
      case "cr:vote": {
        const m = readInt(payload, "m");
        if (m === null || m < 0 || m > MAX_TRACK_INDEX) return;
        if (this.mapIdx !== null) return; // la votacion ya cerro
        this.votes.set(nickname, m);
        this.room.broadcast("cr:vote", { p: nickname, m });
        return;
      }
      case "cr:map": {
        const m = readInt(payload, "m");
        if (m === null || m < 0 || m > MAX_TRACK_INDEX) return;
        // El primer anuncio manda. El anfitrion es quien lo emite, pero si se cayo
        // cualquiera puede cerrar la votacion (el tally es determinista); fijarlo con
        // el primero evita que dos anuncios en carrera manden a media sala a otra pista.
        if (this.mapIdx !== null) return;
        this.mapIdx = m;
        this.room.broadcast("cr:map", { m });
        return;
      }
    }
  }

  dispose(): void {
    // Sin timers ni simulacion: no hay nada que liberar.
  }
}

/** Snapshot de posicion saneado (sin el `p`, que lo pone el server). */
function parsePos(payload: unknown): Omit<CrPos, "p"> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const x = num(p.x);
  const y = num(p.y);
  const a = num(p.a);
  const l = num(p.l);
  const s = num(p.s);
  if (x === null || y === null || a === null || l === null || s === null) return null;
  return { x, y, a, l, s, f: p.f === true };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readInt(payload: unknown, key: string): number | null {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  }
  return null;
}

/** Roster + nickname del mensaje de join. */
function parseJoin(payload: unknown): { nickname: string; roster: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const nickname = typeof p.nickname === "string" ? p.nickname : null;
  if (!nickname) return null;
  const roster = Array.isArray(p.roster)
    ? p.roster.filter((x): x is string => typeof x === "string")
    : [];
  return { nickname, roster };
}

/** Engancha el juego en el namespace `/carrace`. */
export function registerCarRace(io: Server): void {
  registerGame(io, "/carrace", "cr:join", parseJoin, (room) => new CarRaceSim(room));
}
