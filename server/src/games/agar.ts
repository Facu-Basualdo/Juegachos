import type { Server, Socket } from "socket.io";
import { sanitizeCode } from "../rooms.js";
import { AGAR_CONFIG } from "./agar-config.js";
import { Arena, type ArenaHost, type Player } from "./agar-arena.js";

/**
 * Agar (namespace `/agar`, prefijo `ag:`): capa de red y administrador de arenas.
 *
 * No usa `registerGame` de `rooms.ts` a proposito: ese molde es "una sala de Supabase
 * = un GameRoom con su roster", y la arena publica no tiene codigo ni roster — es un
 * mapa abierto que se va llenando y, al llenarse, abre otro. Las arenas de sala si
 * van por codigo + ronda, como Manchon.
 *
 * Todo lo que llega del cliente se valida aca antes de tocar la arena (forma, tipos,
 * rangos, nombres); la arena confia en lo que le pasa esta capa.
 */

export interface AgarStats {
  arenas: number;
  /** Conexiones en arenas publicas: el auto-update de la netbook no las espera. */
  publicSockets: number;
  roomSockets: number;
  bots: number;
}

export function registerAgar(io: Server): () => AgarStats {
  const nsp = io.of("/agar");
  /** Arenas publicas, en orden de creacion: se llena la primera con lugar. */
  const publicArenas: Arena[] = [];
  /** Arenas de sala por `CODIGO:ronda`. */
  const roomArenas = new Map<string, Arena>();
  let publicSeq = 0;

  const host: ArenaHost = {
    emit: (socketId, event, payload) => nsp.sockets.get(socketId)?.emit(event, payload),
    onEmpty: (arena) => {
      if (arena.kind === "public") {
        const i = publicArenas.indexOf(arena);
        if (i >= 0) publicArenas.splice(i, 1);
      } else {
        roomArenas.delete(arena.key);
      }
    },
  };

  function publicArenaWithRoom(): Arena {
    const free = publicArenas.find((a) => a.socketCount < AGAR_CONFIG.arena.maxSocketsPerArena);
    if (free) return free;
    const arena = new Arena(`P${++publicSeq}`, "public", host);
    publicArenas.push(arena);
    return arena;
  }

  nsp.on("connection", (socket: Socket) => {
    let arena: Arena | null = null;
    let player: Player | null = null;

    socket.on("ag:join", (payload: unknown) => {
      if (arena) return; // un join por socket
      const aspect = readAspect(payload);
      const mode = field(payload, "mode");

      if (mode === "public") {
        // Reconexion: el token recupera el jugador si sigue dentro de la gracia.
        const token = field(payload, "tk");
        if (typeof token === "string" && /^[0-9a-f]{24}$/.test(token)) {
          for (const candidate of publicArenas) {
            const found = candidate.findByToken(token);
            if (found && !found.socketId) {
              arena = candidate;
              player = found;
              arena.attach(found, socket.id, aspect);
              return;
            }
          }
        }
        arena = publicArenaWithRoom();
        player = arena.addHuman(socket.id, AGAR_CONFIG.names.fallback, aspect);
        return;
      }

      if (mode === "room") {
        const code = sanitizeCode(payload);
        const round = readInt(field(payload, "round"));
        const nickname = sanitizeName(field(payload, "nickname"));
        if (!code || round === null || round < 0 || round > 9999 || !nickname) return;
        const key = `${code}:${round}`;
        arena = roomArenas.get(key) ?? null;
        if (!arena) {
          arena = new Arena(key, "room", host);
          roomArenas.set(key, arena);
        }
        // En sala la identidad es el nickname de la sala: un F5 vuelve a su celula.
        const existing = arena.findByName(nickname);
        if (existing) {
          if (existing.socketId) nsp.sockets.get(existing.socketId)?.disconnect(true);
          player = existing;
          arena.attach(existing, socket.id, aspect);
        } else {
          player = arena.addHuman(socket.id, nickname, aspect);
        }
      }
    });

    socket.on("ag:spawn", (payload: unknown) => {
      if (!arena || !player) return;
      // En sala el nombre es el de la sala, no el que mande el cliente.
      const name = arena.kind === "room" ? player.name : sanitizeName(field(payload, "name"));
      arena.spawn(player, name || AGAR_CONFIG.names.fallback);
    });

    socket.on("ag:in", (payload: unknown) => {
      if (!arena || !player) return;
      if (!Array.isArray(payload) || payload.length !== 5) return;
      const [n, t, dx, dy, act] = payload as unknown[];
      if (!isInt(n) || n < 1 || !isFiniteNum(t) || !isFiniteNum(dx) || !isFiniteNum(dy) || !isInt(act)) return;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2 || act < 0 || act > 3) return;
      arena.input(player, n, t, dx, dy, act);
    });

    socket.on("ag:view", (payload: unknown) => {
      if (!arena || !player) return;
      arena.setAspect(player, readAspect(payload));
    });

    socket.on("disconnect", () => {
      if (arena && player && player.socketId === socket.id) arena.detach(player);
      arena = null;
      player = null;
    });
  });

  return () => {
    const all = [...publicArenas, ...roomArenas.values()];
    return {
      arenas: all.length,
      publicSockets: publicArenas.reduce((n, a) => n + a.socketCount, 0),
      roomSockets: [...roomArenas.values()].reduce((n, a) => n + a.socketCount, 0),
      bots: all.reduce((n, a) => n + a.botCount, 0),
    };
  };
}

// ------------------------------------------------------------------ validacion

/**
 * Nombre visible: sin caracteres de control ni simbolos raros (solo letras de
 * cualquier idioma, numeros, espacio y `_ - .`), espacios colapsados y largo maximo.
 * Devuelve "" si no queda nada.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .slice(0, 64)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} _.\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AGAR_CONFIG.names.maxLen)
    .trim();
}

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

function readAspect(payload: unknown): number {
  const raw = field(payload, "aspect");
  const { minAspect, maxAspect } = AGAR_CONFIG.view;
  return isFiniteNum(raw) ? Math.min(maxAspect, Math.max(minAspect, raw)) : 16 / 9;
}

function readInt(v: unknown): number | null {
  return isInt(v) ? v : null;
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
