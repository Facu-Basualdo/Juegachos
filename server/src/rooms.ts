import type { Namespace, Server, Socket } from "socket.io";

/**
 * Infra generica de salas del game server, reutilizable por cualquier juego que
 * necesite estado autoritativo en tiempo real (v1: Bomba Palabra; a futuro PONG,
 * rocket-arena). Supabase sigue siendo la fuente de verdad de lobby / marcador /
 * rejoin; el server solo maneja el estado EN-ronda en memoria y no toca la DB.
 *
 * Un `GameRoom` por (namespace, code): agrupa los sockets de esa sala, mantiene
 * el mapeo nickname<->socket (para turnos y estado "conectado") y expone el
 * broadcast que usa el sim. El `GameHub` crea/descarta rooms segun entran y salen
 * jugadores.
 */

/** Contrato que implementa cada juego. El GameRoom le reenvia los eventos. */
export interface RoomSim {
  /** Un jugador (re)conecto. `roster` es el orden declarado por el cliente
   * (room.players() de Supabase, por joined_at), para fijar el orden de turnos.
   * `meta` es el payload crudo del join, para el juego que necesite algo mas que
   * nickname + roster (Neon Drift lee de ahi la ronda, para no mezclar el estado
   * de una ronda con el de la siguiente). Los sims que no lo usan simplemente
   * declaran `join(nickname, roster)` y listo. */
  join(nickname: string, roster: string[], meta?: unknown): void;
  /** Un jugador se desconecto (todos sus sockets se fueron). */
  leave(nickname: string): void;
  /** Mensaje del cliente (cualquier evento salvo el de join). */
  message(nickname: string, event: string, payload: unknown): void;
  /** La sala se vacio: liberar timers, etc. */
  dispose(): void;
}

export class GameRoom {
  readonly code: string;
  private readonly nsp: Namespace;
  private readonly nickBySocket = new Map<string, string>();
  private readonly socketsByNick = new Map<string, Set<string>>();
  sim!: RoomSim;

  constructor(code: string, nsp: Namespace) {
    this.code = code;
    this.nsp = nsp;
  }

  add(socket: Socket, nickname: string): void {
    void socket.join(this.code);
    this.nickBySocket.set(socket.id, nickname);
    let set = this.socketsByNick.get(nickname);
    if (!set) {
      set = new Set();
      this.socketsByNick.set(nickname, set);
    }
    set.add(socket.id);
  }

  /** Saca un socket; devuelve el nickname si ese jugador quedo sin sockets. */
  remove(socketId: string): { nickname: string; gone: boolean } | null {
    const nickname = this.nickBySocket.get(socketId);
    if (!nickname) return null;
    this.nickBySocket.delete(socketId);
    const set = this.socketsByNick.get(nickname);
    set?.delete(socketId);
    const gone = !set || set.size === 0;
    if (gone) this.socketsByNick.delete(nickname);
    return { nickname, gone };
  }

  nicknameOf(socketId: string): string | undefined {
    return this.nickBySocket.get(socketId);
  }

  isConnected(nickname: string): boolean {
    return (this.socketsByNick.get(nickname)?.size ?? 0) > 0;
  }

  get empty(): boolean {
    return this.nickBySocket.size === 0;
  }

  broadcast(event: string, payload: unknown): void {
    this.nsp.to(this.code).emit(event, payload);
  }

  emitTo(nickname: string, event: string, payload: unknown): void {
    const ids = this.socketsByNick.get(nickname);
    if (!ids) return;
    for (const id of ids) this.nsp.sockets.get(id)?.emit(event, payload);
  }
}

interface JoinInfo {
  nickname: string;
  roster: string[];
}

/**
 * Registra un juego en su namespace. `joinEvent` es el evento con el que un
 * cliente se anuncia (trae nickname + roster); el resto de los eventos se
 * reenvian al sim con `onAny`.
 */
export function registerGame(
  io: Server,
  namespace: string,
  joinEvent: string,
  parseJoin: (payload: unknown) => JoinInfo | null,
  makeSim: (room: GameRoom) => RoomSim,
): void {
  const nsp = io.of(namespace);
  const rooms = new Map<string, GameRoom>();

  nsp.on("connection", (socket) => {
    let room: GameRoom | null = null;

    socket.on(joinEvent, (payload: unknown) => {
      if (room) return; // ya unido en este socket
      const info = parseJoin(payload);
      const code = sanitizeCode(payload);
      if (!info || !code) return;
      room = rooms.get(code) ?? null;
      if (!room) {
        room = new GameRoom(code, nsp);
        room.sim = makeSim(room);
        rooms.set(code, room);
      }
      room.add(socket, info.nickname);
      room.sim.join(info.nickname, info.roster, payload);
    });

    socket.onAny((event: string, payload: unknown) => {
      if (event === joinEvent || !room) return;
      const nickname = room.nicknameOf(socket.id);
      if (!nickname) return;
      room.sim.message(nickname, event, payload);
    });

    socket.on("disconnect", () => {
      if (!room) return;
      const res = room.remove(socket.id);
      if (res?.gone) room.sim.leave(res.nickname);
      if (room.empty) {
        room.sim.dispose();
        rooms.delete(room.code);
      }
      room = null;
    });
  });
}

/** Codigo de sala saneado (mismo criterio que el front: A-Z0-9, 4-8 chars). */
export function sanitizeCode(payload: unknown): string | null {
  const raw =
    payload && typeof payload === "object" && "code" in payload
      ? (payload as { code: unknown }).code
      : null;
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return code.length >= 4 ? code : null;
}
