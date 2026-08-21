import type { Socket } from "socket.io-client";
import type { PtInit, PtSplat, PtState } from "./PaintTurfProtocol";

/**
 * Transporte socket.io contra el namespace `/paintturf` del game server. Se
 * conecta con la lib cargada dinamicamente (no pesa en los juegos que no la usan)
 * y anuncia {code, nickname, roster, round} al conectar.
 *
 * La `round` va en el join porque el estado del server esta scopeado por ronda:
 * entre rondas los clientes navegan de una pagina a la otra y no todos a la vez,
 * asi que el room del server puede sobrevivir con el tablero de la ronda anterior
 * adentro (mismo gotcha que Neon Drift).
 */
export class PaintTurfSocket {
  private socket: Socket | null = null;
  private initCb: (init: PtInit) => void = () => {};
  private stateCb: (state: PtState) => void = () => {};
  private splatCb: (splat: PtSplat) => void = () => {};
  private errorCb: () => void = () => {};

  private readonly serverUrl: string;
  private readonly code: string;
  private readonly nickname: string;
  private readonly roster: string[];
  private readonly round: number;

  constructor(
    serverUrl: string,
    code: string,
    nickname: string,
    roster: string[],
    round: number,
  ) {
    this.serverUrl = serverUrl;
    this.code = code;
    this.nickname = nickname;
    this.roster = roster;
    this.round = round;
  }

  async connect(): Promise<void> {
    const { io } = await import("socket.io-client");
    const base = this.serverUrl.replace(/\/$/, "");
    const socket = io(`${base}/paintturf`, {
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("pt:join", {
        code: this.code,
        nickname: this.nickname,
        roster: this.roster,
        round: this.round,
      });
    });
    socket.on("pt:init", (init: PtInit) => this.initCb(init));
    socket.on("pt:state", (state: PtState) => this.stateCb(state));
    socket.on("pt:splat", (splat: PtSplat) => this.splatCb(splat));
    // Namespace inexistente / CORS / URL mala: el server no responde nunca. El
    // cliente lo usa para mostrar el cartel en vez de quedarse congelado.
    socket.on("connect_error", () => this.errorCb());
  }

  onInit(cb: (init: PtInit) => void): void {
    this.initCb = cb;
  }

  onState(cb: (state: PtState) => void): void {
    this.stateCb = cb;
  }

  onSplat(cb: (splat: PtSplat) => void): void {
    this.splatCb = cb;
  }

  onError(cb: () => void): void {
    this.errorCb = cb;
  }

  /** Direccion deseada (el server la normaliza) y, opcionalmente, el salpicon. */
  sendInput(dx: number, dy: number, splat: boolean): void {
    if (splat) this.socket?.emit("pt:input", { dx, dy, s: true });
    else this.socket?.emit("pt:input", { dx, dy });
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
