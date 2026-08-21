import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../../../shared/supabase";

/** Position snapshot each client broadcasts ~10 times per second (room mode). */
export interface DodgePayload {
  /** Nickname of the sender. */
  p: string;
  x: number;
  y: number;
  /** Facing angle in radians. */
  a: number;
  /** False once the sender has been hit (drawn as a wreck). */
  alive: boolean;
}

/** Backoff between re-subscribe attempts after the channel drops (ms). */
const RETRY_BASE_MS = 700;
const RETRY_MAX_MS = 5000;

/**
 * Ephemeral per-room+round channel: pure broadcast (no DB) of every pirate's
 * position, kept separate from the RoomChannel so the high-frequency traffic
 * doesn't mix with the room sync. Same idea as Neon Drift's RaceChannel.
 *
 * Unlike RaceChannel it watches the subscription status and rebuilds the channel
 * when it drops. Realtime can and does close the socket mid-round (a full room
 * broadcasting positions sits near the server's per-second message cap), and a
 * bare `subscribe()` with no status callback never notices: the client keeps
 * sending into a dead channel and every rival goes stale, leaving you alone on
 * the island until the round ends. See this game's CLAUDE.md.
 */
export class DodgeChannel {
  private readonly code: string;
  private readonly round: number;
  private channel: RealtimeChannel | null = null;
  private readonly cbs: Array<(p: DodgePayload) => void> = [];
  /** True only while the channel is joined and can push over the websocket. */
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

  /** (Re)creates and subscribes the channel, retrying with backoff on failure. */
  private open(): void {
    const supabase = getSupabase();
    if (!supabase || this.disposed) return;

    this.channel = supabase.channel(`dodge:${this.code}:${this.round}`, {
      config: { broadcast: { self: false } },
    });
    this.channel.on("broadcast", { event: "pos" }, ({ payload }) => {
      for (const cb of this.cbs) cb(payload as DodgePayload);
    });
    this.channel.subscribe((status) => {
      if (this.disposed) return;
      if (status === "SUBSCRIBED") {
        this.ready = true;
        this.retries = 0;
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED: el canal murio. Dejamos de emitir
      // (un send() sobre un canal caido cae en silencio al fallback REST, un
      // POST HTTP por heartbeat) y lo reconstruimos.
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

  send(payload: DodgePayload): void {
    if (!this.channel || !this.ready) return;
    void this.channel.send({ type: "broadcast", event: "pos", payload });
  }

  onPos(cb: (p: DodgePayload) => void): void {
    this.cbs.push(cb);
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.teardown();
  }
}
