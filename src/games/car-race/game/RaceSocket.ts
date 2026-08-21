import type { Socket } from "socket.io-client";
import type { MapPayload, RaceLink, RacePayload, VotePayload } from "./RaceTransport";

/**
 * Transporte socket.io contra el namespace `/carrace` del game server. Se conecta
 * con la lib cargada dinamicamente (no pesa en los juegos que no la usan) y se
 * anuncia con {code, nickname, roster, round}; el server hace de relay puro de las
 * posiciones y recuerda la votacion de circuito de la ronda.
 *
 * Reemplaza al broadcast de Supabase ([RaceChannel](RaceChannel.ts)) cuando hay
 * game server configurado. Que compra:
 *
 * - **No hay tope de mensajes/s.** Supabase topea ~100 por canal y una sala llena
 *   lo rozaba (8 x 10/s = 80/s); al pasarse cerraba el socket y todos los rivales
 *   desaparecian. Por eso aca la cadencia sube (`NET_SEND_SERVER_MS`).
 * - **Reconexion de fabrica.** socket.io reconecta solo con backoff, asi que el bug
 *   de "el canal murio y nadie se entero" deja de ser codigo nuestro.
 * - **El que llega tarde se entera del circuito votado**: el server le reenvia el
 *   `cr:map` ya anunciado al conectar (con Supabase el anuncio era efimero y el que
 *   no estaba caia al circuito por seed, no al votado).
 * - **No se puede mover el auto ajeno**: el server estampa el nickname del emisor.
 */
export class RaceSocket implements RaceLink {
  private socket: Socket | null = null;
  private readonly cbs: Array<(p: RacePayload) => void> = [];
  private readonly voteCbs: Array<(v: VotePayload) => void> = [];
  private readonly mapCbs: Array<(m: MapPayload) => void> = [];

  private readonly serverUrl: string;
  private readonly code: string;
  private readonly nickname: string;
  private readonly roster: string[];
  private readonly round: number;

  constructor(serverUrl: string, code: string, nickname: string, roster: string[], round: number) {
    this.serverUrl = serverUrl;
    this.code = code;
    this.nickname = nickname;
    this.roster = roster;
    this.round = round;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/carrace`, {
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    // Tambien en cada reconexion: el server responde con la votacion al dia, asi
    // que un corte no deja al jugador corriendo en otro circuito que el resto.
    socket.on("connect", () => {
      socket.emit("cr:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
    });

    socket.on("cr:pos", (p: RacePayload) => {
      for (const cb of this.cbs) cb(p);
    });
    socket.on("cr:vote", (v: VotePayload) => {
      for (const cb of this.voteCbs) cb(v);
    });
    socket.on("cr:map", (m: MapPayload) => {
      for (const cb of this.mapCbs) cb(m);
    });
  }

  send(payload: RacePayload): void {
    // El `p` lo estampa el server con el nickname del socket; no se manda.
    const { p: _p, ...pos } = payload;
    this.socket?.emit("cr:pos", pos);
  }

  sendVote(payload: VotePayload): void {
    this.socket?.emit("cr:vote", { m: payload.m });
  }

  sendMap(payload: MapPayload): void {
    this.socket?.emit("cr:map", { m: payload.m });
  }

  onPos(cb: (p: RacePayload) => void): void {
    this.cbs.push(cb);
  }

  onVote(cb: (v: VotePayload) => void): void {
    this.voteCbs.push(cb);
  }

  onMap(cb: (m: MapPayload) => void): void {
    this.mapCbs.push(cb);
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
