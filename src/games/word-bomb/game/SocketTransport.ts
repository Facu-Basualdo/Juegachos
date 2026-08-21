import type { Socket } from "socket.io-client";
import type {
  WbEmoteId,
  WbGameover,
  WbRejectReason,
  WbState,
  WordBombTransport,
} from "./WordBombTransport";

/**
 * Transporte socket.io contra el namespace `/wordbomb` del game server. Se
 * conecta con la lib cargada dinamicamente (no se incluye en juegos que no la
 * usan) y anuncia {code, nickname, roster} al conectar; el server fija el orden
 * de turnos con el roster (room.players() de Supabase, por joined_at).
 */
export class SocketTransport implements WordBombTransport {
  private socket: Socket | null = null;
  private stateCb: (s: WbState) => void = () => {};
  private invalidCb: (r: WbRejectReason) => void = () => {};
  private typingCb: (player: string, text: string) => void = () => {};
  private emoteCb: (player: string, emote: WbEmoteId) => void = () => {};
  private gameoverCb: (r: WbGameover) => void = () => {};

  private readonly serverUrl: string;
  private readonly code: string;
  private readonly nickname: string;
  private readonly roster: string[];

  constructor(serverUrl: string, code: string, nickname: string, roster: string[]) {
    this.serverUrl = serverUrl;
    this.code = code;
    this.nickname = nickname;
    this.roster = roster;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/wordbomb`, {
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("wb:join", { code: this.code, nickname: this.nickname, roster: this.roster });
    });
    socket.on("wb:state", (s: WbState) => this.stateCb(s));
    socket.on("wb:invalid", (m: { reason: WbRejectReason }) => this.invalidCb(m.reason));
    socket.on("wb:typing", (m: { player: string; text: string }) =>
      this.typingCb(m.player, m.text),
    );
    socket.on("wb:emote", (m: { player: string; emote: WbEmoteId }) =>
      this.emoteCb(m.player, m.emote),
    );
    socket.on("wb:gameover", (m: WbGameover) => this.gameoverCb(m));
  }

  onState(cb: (s: WbState) => void): void {
    this.stateCb = cb;
  }
  onInvalid(cb: (r: WbRejectReason) => void): void {
    this.invalidCb = cb;
  }
  onTyping(cb: (player: string, text: string) => void): void {
    this.typingCb = cb;
  }
  onEmote(cb: (player: string, emote: WbEmoteId) => void): void {
    this.emoteCb = cb;
  }
  onGameover(cb: (r: WbGameover) => void): void {
    this.gameoverCb = cb;
  }

  submit(word: string): void {
    this.socket?.emit("wb:submit", { word });
  }
  sendTyping(text: string): void {
    this.socket?.emit("wb:typing", { text });
  }
  sendEmote(emote: WbEmoteId): void {
    this.socket?.emit("wb:emote", { emote });
  }
  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
