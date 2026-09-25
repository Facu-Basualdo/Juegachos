import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../../../shared/supabase";

/**
 * Lo que viaja NO es la posicion de cada cuadro sino los QUIEBRES del trazo: el
 * punto donde el rival apreto o solto. Como la birome siempre va a 45 grados, la
 * linea entre dos quiebres es recta y el receptor la reconstruye exacta (ver
 * Trail). Resultado: un rival que no toca nada no genera trafico, salvo el
 * keepalive, y la sala llena queda muy por debajo del tope de ~100 msg/s por
 * canal de Realtime. Ver el CLAUDE.md raiz, "Canales efimeros".
 *
 * La latencia no afecta en nada al que juega: su trazo es local. Solo decide
 * cuanto en el pasado se dibuja a los rivales (REMOTE_DELAY_S).
 */
export interface InkPayload {
  /** Nickname del emisor. */
  p: string;
  /** Quiebres aplanados: [x, y, h, x, y, h, ...] (h = 1 subiendo). */
  v: number[];
  /** Puntaje (cm) al momento de mandar. */
  s: number;
  /** 1 si ya choco: el ultimo quiebre es el punto de la mancha. */
  d: 0 | 1;
}

const RETRY_BASE_MS = 700;
const RETRY_MAX_MS = 5000;

/**
 * Canal efimero por sala+ronda: broadcast puro (sin DB), separado del
 * RoomChannel. Vigila la suscripcion y la rearma con backoff cuando se cae; el
 * `send` solo sale con el canal unido (sin eso `RealtimeChannel.send` cae en
 * silencio a un POST REST por mensaje). Mismo patron que el DodgeChannel de
 * Cannon Dodge y el TempleChannel de Templo Rodante.
 */
export class InkChannel {
  private readonly code: string;
  private readonly round: number;
  private channel: RealtimeChannel | null = null;
  private readonly cbs: Array<(p: InkPayload) => void> = [];
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

    this.channel = supabase.channel(`birome:${this.code}:${this.round}`, {
      config: { broadcast: { self: false } },
    });
    this.channel.on("broadcast", { event: "ink" }, ({ payload }) => {
      for (const cb of this.cbs) cb(payload as InkPayload);
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

  /** False mientras el canal no esta unido: el que llama conserva su cola. */
  send(payload: InkPayload): boolean {
    if (!this.channel || !this.ready) return false;
    void this.channel.send({ type: "broadcast", event: "ink", payload });
    return true;
  }

  onInk(cb: (p: InkPayload) => void): void {
    this.cbs.push(cb);
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.teardown();
  }
}
