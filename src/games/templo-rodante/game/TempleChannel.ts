import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../../../shared/supabase";

/**
 * Lo que se transmite NO es una posicion sino un EVENTO de pose. El rival no
 * manda su altura cuadro a cuadro: manda "salte" y el cliente que recibe corre
 * la misma parabola con las mismas constantes (`Runner`), asi que la animacion
 * sale identica con dos o tres mensajes por segundo en vez de diez. Por eso este
 * canal ni se acerca al tope de mensajes/s de Realtime con la sala llena
 * (8 jugadores x ~3/s = ~24/s contra ~100/s), que es el limite que obligo a
 * Neon Drift a mudarse al game server. Ver el CLAUDE.md raiz, "Canales efimeros".
 */
export type PoseEvent = "jump" | "duck" | "stand" | "dead";

export interface TemplePayload {
  /** Nickname del emisor. */
  p: string;
  /** Pose que arranca (o se reafirma en el keepalive). */
  e: PoseEvent;
  /** Vigas esquivadas hasta ahora, para el marcador de al lado del rival. */
  s: number;
}

/** Espera entre reintentos de re-suscripcion cuando el canal se cae (ms). */
const RETRY_BASE_MS = 700;
const RETRY_MAX_MS = 5000;

/**
 * Canal efimero por sala+ronda: broadcast puro (sin DB), separado del
 * RoomChannel para que este trafico no se mezcle con el sync de la sala.
 *
 * Vigila el estado de la suscripcion y reconstruye el canal cuando se cae: un
 * `subscribe()` pelado nunca se entera de que murio, y el cliente sigue mandando
 * a un canal muerto (que ademas cae en silencio a un POST REST por mensaje)
 * mientras los rivales se le congelan y desaparecen. Mismo patron que el
 * DodgeChannel de Cannon Dodge.
 */
export class TempleChannel {
  private readonly code: string;
  private readonly round: number;
  private channel: RealtimeChannel | null = null;
  private readonly cbs: Array<(p: TemplePayload) => void> = [];
  /** True solo mientras el canal esta unido y puede empujar por el websocket. */
  private ready = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(code: string, round: number) {
    this.code = code;
    this.round = round;
    if (!getSupabase()) return;
    this.open();
  }

  private open(): void {
    const supabase = getSupabase();
    if (!supabase || this.disposed) return;

    this.channel = supabase.channel(`temple:${this.code}:${this.round}`, {
      config: { broadcast: { self: false } },
    });
    this.channel.on("broadcast", { event: "pose" }, ({ payload }) => {
      for (const cb of this.cbs) cb(payload as TemplePayload);
    });
    this.channel.subscribe((status) => {
      if (this.disposed) return;
      if (status === "SUBSCRIBED") {
        this.ready = true;
        this.retries = 0;
        return;
      }
      this.ready = false;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.scheduleReopen();
      }
    });
  }

  private scheduleReopen(): void {
    if (this.disposed || this.retryTimer !== null) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.retries, RETRY_MAX_MS);
    this.retries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.teardown();
      this.open();
    }, delay);
  }

  private teardown(): void {
    if (!this.channel) return;
    const supabase = getSupabase();
    if (supabase) void supabase.removeChannel(this.channel);
    this.channel = null;
    this.ready = false;
  }

  send(payload: TemplePayload): void {
    if (!this.channel || !this.ready) return;
    void this.channel.send({ type: "broadcast", event: "pose", payload });
  }

  onPose(cb: (p: TemplePayload) => void): void {
    this.cbs.push(cb);
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.teardown();
  }
}
