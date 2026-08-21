import type { Socket } from "socket.io-client";
import type {
  WcEmoteId,
  WcGameover,
  WcRejectReason,
  WcState,
  WordChainTransport,
} from "./WordChainTransport";

/**
 * Transporte socket.io contra el namespace `/wordchain` del game server. Se conecta
 * con la lib cargada dinamicamente (no se incluye en juegos que no la usan) y anuncia
 * {code, nickname, roster} al conectar; el server fija el orden de turnos con el roster
 * (room.players() de Supabase, por joined_at).
 */
export class SocketTransport implements WordChainTransport {
  private socket: Socket | null = null;
  private stateCb: (s: WcState) => void = () => {};
  private invalidCb: (r: WcRejectReason) => void = () => {};
  private typingCb: (player: string, text: string) => void = () => {};
  private emoteCb: (player: string, emote: WcEmoteId) => void = () => {};
  private gameoverCb: (r: WcGameover) => void = () => {};

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
    const socket = io(`${base}/wordchain`, {
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("wc:join", { code: this.code, nickname: this.nickname, roster: this.roster });
    });
    socket.on("wc:state", (s: WcState) => this.stateCb(s));
    socket.on("wc:invalid", (m: { reason: WcRejectReason }) => this.invalidCb(m.reason));
    socket.on("wc:typing", (m: { player: string; text: string }) =>
      this.typingCb(m.player, m.text),
    );
    socket.on("wc:emote", (m: { player: string; emote: WcEmoteId }) =>
      this.emoteCb(m.player, m.emote),
    );
    socket.on("wc:gameover", (m: WcGameover) => this.gameoverCb(m));
  }

  onState(cb: (s: WcState) => void): void {
    this.stateCb = cb;
  }
  onInvalid(cb: (r: WcRejectReason) => void): void {
    this.invalidCb = cb;
  }
  onTyping(cb: (player: string, text: string) => void): void {
    this.typingCb = cb;
  }
  onEmote(cb: (player: string, emote: WcEmoteId) => void): void {
    this.emoteCb = cb;
  }
  onGameover(cb: (r: WcGameover) => void): void {
    this.gameoverCb = cb;
  }

  submit(word: string): void {
    this.socket?.emit("wc:submit", { word });
  }
  sendTyping(text: string): void {
    this.socket?.emit("wc:typing", { text });
  }
  sendEmote(emote: WcEmoteId): void {
    this.socket?.emit("wc:emote", { emote });
  }
  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
