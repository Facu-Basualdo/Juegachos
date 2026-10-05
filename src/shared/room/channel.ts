import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../supabase";
import type { RoomRow } from "./types";

/**
 * Canal Realtime de una sala: presence (key = nickname) para saber quien esta
 * conectado, y broadcast de un unico evento "sync" que significa "algo cambio,
 * relee la DB". Cada pagina (lobby o juego) crea su propio RoomChannel al
 * cargar; navegar entre juegos tira el canal y el estado durable vive en
 * Postgres, asi que reconectar es solo volver a suscribirse.
 *
 * El "sync" puede traer la fila de la sala tal como la dejo quien escribio (ver
 * `ping`): con eso los demas aplican la transicion de fase en el acto, sin esperar
 * la relectura, que igual se hace para traer el resto (jugadores, puntajes, votos).
 *
 * El canal se vigila (ver "Canales efimeros" en el CLAUDE.md raiz): un `subscribe()`
 * pelado no se entera de nada. Lo que hace realtime-js por su cuenta y lo que no
 * (verificado leyendo su codigo y cortando el websocket en una sala de prueba):
 *
 * - Si se cae el socket, el canal pasa a CHANNEL_ERROR y realtime-js lo vuelve a unir
 *   SOLO cuando el socket reconecta (y el callback de `subscribe` recibe otra vez
 *   SUBSCRIBED). Lo que NO hace es republicar la presencia ni avisar que se pudieron
 *   perder pings: eso lo hace esta clase al ver el SUBSCRIBED de la reunion.
 * - NO hay que desarmarlo y crear otro en ese momento (lo que hace el `DodgeChannel`
 *   que documenta el CLAUDE.md): `supabase.channel(topic)` devuelve el canal existente
 *   mientras no termine de sacarse, y `removeChannel` con el socket caido tarda; se
 *   terminaba re-suscribiendo el mismo objeto (que no hace nada), con los handlers
 *   duplicados, y el `unsubscribe` pendiente lo cerraba del todo.
 * - Un CLOSED que no provocamos (el server cerro el canal) si no se recupera solo: ahi
 *   se rearma, esperando a que el viejo haya salido de la lista.
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

/** Backoff entre intentos de rearmar un canal que el server cerro (ms). */
const RETRY_BASE_MS = 700;
const RETRY_MAX_MS = 5000;

export class RoomChannel {
  private readonly code: string;
  private readonly player: string;
  private readonly track: boolean;
  private channel: RealtimeChannel | null = null;
  /** Canal que el server cerro, mientras se rearma: el nuevo no puede ser este objeto. */
  private closedChannel: RealtimeChannel | null = null;
  private readonly syncCbs: Array<(room: RoomRow | null) => void> = [];
  private readonly presenceCbs: Array<() => void> = [];
  private readonly liveCbs: Array<(live: LiveMessage) => void> = [];
  private readonly reconnectCbs: Array<() => void> = [];
  /** True solo mientras el canal esta unido y puede empujar por el websocket. */
  private ready = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(code: string, player: string, opts: { track?: boolean } = {}) {
    this.code = code;
    this.player = player;
    this.track = opts.track ?? true;
    if (!getSupabase()) return;
    this.open();
    window.addEventListener("online", this.onOnline);
  }

  /**
   * Volvio la red del dispositivo. Sin esto la vuelta dependia del backoff propio del
   * socket de Realtime y del poll de 5 s. Se le pide al socket que reconecte ya (el
   * canal se reune solo al reconectar) y se avisa para releer por HTTP, que anda
   * apenas hay red, sin esperar al websocket.
   */
  private readonly onOnline = (): void => {
    if (this.disposed) return;
    const supabase = getSupabase();
    try {
      if (supabase && !supabase.realtime.isConnected()) supabase.realtime.connect();
    } catch {
      // El socket se reconecta solo igual, con su backoff.
    }
    for (const cb of this.reconnectCbs) cb();
  };

  /** Crea y suscribe el canal. */
  private open(): void {
    const supabase = getSupabase();
    if (!supabase || this.disposed) return;

    const channel = supabase.channel(`room:${this.code}`, {
      config: {
        presence: { key: this.player },
        broadcast: { self: false },
      },
    });
    // Todavia esta en la lista el canal anterior (cerrado, sacandose): suscribirlo de
    // nuevo no haria nada y le duplicaria los handlers. Se reintenta mas tarde.
    if (channel === this.closedChannel) {
      this.scheduleRecreate();
      return;
    }
    this.closedChannel = null;
    this.channel = channel;

    channel.on("broadcast", { event: "sync" }, ({ payload }) => {
      const room = readRoom(payload, this.code);
      for (const cb of this.syncCbs) cb(room);
    });
    channel.on("broadcast", { event: "live" }, ({ payload }) => {
      const live = payload as LiveMessage;
      if (live && typeof live.player === "string" && live.data && typeof live.data === "object") {
        for (const cb of this.liveCbs) cb(live);
      }
    });
    channel.on("presence", { event: "sync" }, () => {
      for (const cb of this.presenceCbs) cb();
    });

    channel.subscribe((status) => {
      // Avisos de un canal que ya se reemplazo (o que se esta desarmando): ignorarlos.
      if (this.disposed || channel !== this.channel) return;
      if (status === "SUBSCRIBED") {
        this.ready = true;
        this.retries = 0;
        // La presencia vive en la conexion: tras reunirse (socket nuevo) no esta.
        if (this.track) void channel.track({ at: Date.now() });
        // Releer en CADA suscripcion, la primera incluida: la pagina lee la sala antes
        // de que el canal termine de unirse (cientos de ms, a veces segundos), y un
        // "sync" mandado en esa ventana no llega; tras una caida, lo mismo.
        for (const cb of this.reconnectCbs) cb();
        return;
      }
      this.ready = false;
      // CHANNEL_ERROR / TIMED_OUT: realtime-js reune el canal solo (ver arriba).
      if (status === "CLOSED") {
        this.closedChannel = channel;
        this.channel = null;
        this.scheduleRecreate();
      }
    });
  }

  /** Rearma un canal que el server cerro, con backoff. */
  private scheduleRecreate(): void {
    if (this.disposed || this.retryTimer !== null) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.retries, RETRY_MAX_MS);
    this.retries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const supabase = getSupabase();
      const closed = this.closedChannel;
      if (!supabase || this.disposed) return;
      // Sacarlo de la lista antes de pedir otro (channel() devuelve el existente).
      const removal = closed ? supabase.removeChannel(closed) : Promise.resolve("ok");
      void removal.catch(() => "error").then(() => this.open());
    }, delay);
  }

  private teardown(): void {
    const channel = this.channel;
    this.channel = null;
    this.ready = false;
    const supabase = getSupabase();
    if (supabase && channel) void supabase.removeChannel(channel);
  }

  /**
   * Avisa al resto de la sala que hay cambios en la DB. Con `room` (la fila tal
   * como quedo despues de escribirla) los demas aplican la transicion sin esperar
   * la relectura. No se corta con el canal caido (o todavia uniendose, que es lo
   * normal justo al cargar una pagina): va por REST (`httpSend`), que igual llega,
   * porque un aviso de cambio de fase no se puede perder.
   */
  ping(room?: RoomRow | null): void {
    // Mientras se rearma un canal cerrado, el viejo sirve igual para el envio por REST
    // (solo usa el topic).
    const channel = this.channel ?? this.closedChannel;
    if (!channel) return;
    const payload = room ? { room } : {};
    if (this.ready && channel === this.channel) {
      void channel.send({ type: "broadcast", event: "sync", payload });
      return;
    }
    // httpSend necesita un Realtime reciente; si lo rechaza, el fallback implicito de send().
    channel.httpSend("sync", payload).catch(() => {
      void channel.send({ type: "broadcast", event: "sync", payload });
    });
  }

  /**
   * Emite estado efimero propio al resto de la sala. Con el canal caido se
   * descarta (es cosmetico): mandarlo igual seria un POST HTTP por envio.
   */
  broadcastLive(data: LiveData): void {
    if (!this.channel || !this.ready) return;
    const payload: LiveMessage = { player: this.player, data };
    void this.channel.send({ type: "broadcast", event: "live", payload });
  }

  /**
   * Se dispara cuando otro cliente hizo ping (releer la DB). `room` es la fila de
   * la sala si el ping la trajo; puede ser mas vieja que la que ya se tiene (ver
   * `isStaleRoom`), el que la aplica decide.
   */
  onSync(cb: (room: RoomRow | null) => void): void {
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

  /**
   * Se dispara cuando hay que releer porque se pudo perder un "sync": cada vez que el
   * canal queda unido (la primera vez tambien: lo que se mando mientras se unia no
   * llego) y apenas vuelve la red del dispositivo.
   */
  onReconnect(cb: () => void): void {
    this.reconnectCbs.push(cb);
  }

  /** Nicknames actualmente conectados al canal. */
  presentPlayers(): string[] {
    if (!this.channel) return [];
    return Object.keys(this.channel.presenceState());
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("online", this.onOnline);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.teardown();
  }
}

/** La fila de la sala que trae un "sync", validada lo justo para usarla. */
function readRoom(payload: unknown, code: string): RoomRow | null {
  if (!payload || typeof payload !== "object") return null;
  const room = (payload as { room?: unknown }).room;
  if (!room || typeof room !== "object") return null;
  const r = room as Partial<RoomRow>;
  if (r.code !== code || typeof r.status !== "string" || typeof r.current_round !== "number") return null;
  return r as RoomRow;
}
