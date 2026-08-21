import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../supabase";

/**
 * Canal Realtime de una sala: presence (key = nickname) para saber quien esta
 * conectado, y broadcast de un unico evento "sync" que significa "algo cambio,
 * relee la DB". Cada pagina (lobby o juego) crea su propio RoomChannel al
 * cargar; navegar entre juegos tira el canal y el estado durable vive en
 * Postgres, asi que reconectar es solo volver a suscribirse.
 */
/**
 * Valores efimeros que un juego emite en vivo por el canal (posicion del
 * jugador, animacion, puntaje parcial). **No tocan la DB ni el puntaje oficial**:
 * si un paquete se pierde, se pierde. Pensado para lo cosmetico — ver a los
 * rivales moverse — a una tasa de unos pocos envios por segundo.
 */
export type LiveData = Record<string, number | string | boolean>;

export interface LiveMessage {
  player: string;
  data: LiveData;
}

export class RoomChannel {
  private readonly channel: RealtimeChannel | null;
  private readonly player: string;
  private readonly syncCbs: Array<() => void> = [];
  private readonly presenceCbs: Array<() => void> = [];
  private readonly liveCbs: Array<(live: LiveMessage) => void> = [];
  private tracked = false;

  constructor(code: string, player: string, opts: { track?: boolean } = {}) {
    this.player = player;
    const supabase = getSupabase();
    if (!supabase) {
      this.channel = null;
      return;
    }

    this.channel = supabase.channel(`room:${code}`, {
      config: {
        presence: { key: player },
        broadcast: { self: false },
      },
    });

    this.channel.on("broadcast", { event: "sync" }, () => {
      for (const cb of this.syncCbs) cb();
    });
    this.channel.on("broadcast", { event: "live" }, ({ payload }) => {
      const live = payload as LiveMessage;
      if (live && typeof live.player === "string" && live.data && typeof live.data === "object") {
        for (const cb of this.liveCbs) cb(live);
      }
    });
    this.channel.on("presence", { event: "sync" }, () => {
      for (const cb of this.presenceCbs) cb();
    });

    const track = opts.track ?? true;
    this.channel.subscribe((status) => {
      if (status === "SUBSCRIBED" && track) void this.track();
    });
  }

  /** Publica la presencia propia (idempotente). */
  async track(): Promise<void> {
    if (!this.channel || this.tracked) return;
    this.tracked = true;
    await this.channel.track({ at: Date.now() });
  }

  /** Avisa al resto de la sala que hay cambios en la DB. */
  ping(): void {
    if (!this.channel) return;
    void this.channel.send({ type: "broadcast", event: "sync", payload: {} });
  }

  /** Emite estado efimero propio al resto de la sala. */
  broadcastLive(data: LiveData): void {
    if (!this.channel) return;
    const payload: LiveMessage = { player: this.player, data };
    void this.channel.send({ type: "broadcast", event: "live", payload });
  }

  /** Se dispara cuando otro cliente hizo ping (releer la DB). */
  onSync(cb: () => void): void {
    this.syncCbs.push(cb);
  }

  /** Se dispara con cada estado en vivo emitido por otro jugador. */
  onLive(cb: (live: LiveMessage) => void): void {
    this.liveCbs.push(cb);
  }

  /** Se dispara cuando cambia la lista de presentes. */
  onPresence(cb: () => void): void {
    this.presenceCbs.push(cb);
  }

  /** Nicknames actualmente conectados al canal. */
  presentPlayers(): string[] {
    if (!this.channel) return [];
    return Object.keys(this.channel.presenceState());
  }

  dispose(): void {
    if (!this.channel) return;
    const supabase = getSupabase();
    if (supabase) void supabase.removeChannel(this.channel);
  }
}
