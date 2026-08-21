import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../../../shared/supabase";
import type { MapPayload, RaceLink, RacePayload, VotePayload } from "./RaceTransport";

/** Backoff entre reintentos de re-suscripcion cuando el canal se cae (ms). */
const RETRY_BASE_MS = 700;
const RETRY_MAX_MS = 5000;

/**
 * Canal efimero de la carrera: broadcast puro (sin DB) de las posiciones de
 * cada auto y de la votacion de circuito previa, separado del RoomChannel para
 * no mezclar el trafico de alta frecuencia con el sync de salas. Un canal por
 * sala+ronda.
 *
 * **Es el fallback**: con `VITE_GAME_SERVER_URL` configurada el juego usa
 * [RaceSocket](RaceSocket.ts) (el game server), que no tiene el tope de
 * mensajes/s que motiva la mitad de las precauciones de abajo. Este camino queda
 * para el deploy sin game server (ver [RaceTransport](RaceTransport.ts)).
 *
 * Vigila el estado de la suscripcion y reconstruye el canal cuando se cae.
 * Realtime cierra el socket a mitad de ronda (una sala llena emitiendo
 * posiciones roza el tope de mensajes/s del canal), y un `subscribe()` pelado
 * sin callback de estado nunca se entera: el cliente sigue emitiendo contra un
 * canal muerto, todos los rivales quedan stale y se purgan, y uno termina la
 * carrera solo. Peor: `send()` sobre un canal caido cae en silencio al fallback
 * REST de realtime-js, un POST HTTP por heartbeat.
 */
export class RaceChannel implements RaceLink {
  private readonly code: string;
  private readonly round: number;
  private channel: RealtimeChannel | null = null;
  private readonly cbs: Array<(p: RacePayload) => void> = [];
  private readonly voteCbs: Array<(v: VotePayload) => void> = [];
  private readonly mapCbs: Array<(m: MapPayload) => void> = [];
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

  /** (Re)crea y suscribe el canal, reintentando con backoff si falla. */
  private open(): void {
    const supabase = getSupabase();
    if (!supabase || this.disposed) return;

    this.channel = supabase.channel(`race:${this.code}:${this.round}`, {
      config: { broadcast: { self: false } },
    });
    this.channel.on("broadcast", { event: "pos" }, ({ payload }) => {
      for (const cb of this.cbs) cb(payload as RacePayload);
    });
    this.channel.on("broadcast", { event: "vote" }, ({ payload }) => {
      for (const cb of this.voteCbs) cb(payload as VotePayload);
    });
    this.channel.on("broadcast", { event: "map" }, ({ payload }) => {
      for (const cb of this.mapCbs) cb(payload as MapPayload);
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

  send(payload: RacePayload): void {
    if (!this.channel || !this.ready) return;
    void this.channel.send({ type: "broadcast", event: "pos", payload });
  }

  // Los eventos de la votacion NO se bloquean con `ready`: son uno por jugador
  // y por carrera, asi que el fallback REST de realtime-js (un POST) es un
  // beneficio, no un problema — entrega el voto igual si el canal todavia no
  // termino de unirse. Lo que hay que bloquear es el chorro de posiciones.
  sendVote(payload: VotePayload): void {
    if (!this.channel) return;
    void this.channel.send({ type: "broadcast", event: "vote", payload });
  }

  /** Anuncio del circuito ganador (lo emite el anfitrion). */
  sendMap(payload: MapPayload): void {
    if (!this.channel) return;
    void this.channel.send({ type: "broadcast", event: "map", payload });
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
    if (!this.channel) return;
    const supabase = getSupabase();
    if (supabase) void supabase.removeChannel(this.channel);
  }
}
