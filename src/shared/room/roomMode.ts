import { games, roomGames, coverUrl } from "../../games";
import { formatScore, getDirection } from "../scoring";
import { getNickname } from "../nickname";
import { getSupabase } from "../supabase";
import {
  castVote,
  closeRound,
  fetchRoomState,
  finishRoom,
  openVote,
  reportScore,
  resetRoom,
  sanitizeCode,
  startBriefing,
  startRound,
  takeOverHost,
  touchRoom,
  updateDeadline,
} from "./api";
import { RoomChannel } from "./channel";
import { RoomOverlay, type StripLight, type WaitingEntry } from "./RoomOverlay";
import { computeTotals, rankRound } from "./points";
import { clearRoomRuns } from "./roomRun";
import {
  formatRoundTimeLimit,
  HEARTBEAT_MS,
  NO_TIME_LIMIT,
  type RoomState,
  type RoomStatus,
} from "./types";

/**
 * Orquestador del modo sala dentro de cada juego. Contrato minimo por juego:
 *
 *   private readonly room = initRoomMode("<id>", { getScore: () => this.score });
 *   // input en estado "dead": if (this.room) return;   // una sola partida
 *   // game over: if (this.room) this.room.reportScore(this.score);
 *   //            else this.hud.showRanking("<id>", this.score);
 *
 * initRoomMode devuelve null sin `?room=` en la URL o sin Supabase, asi que
 * fuera del modo sala el juego no cambia en nada. En modo sala NO se envia el
 * puntaje al ranking global (las partidas cortadas por timeout lo
 * contaminarian).
 */

export interface RoomModeHooks {
  /** Puntaje actual de la partida en curso (para el parcial por timeout). */
  getScore: () => number;
  /**
   * Arranca la partida de la ronda (normalmente `beginCountdown`). El modo sala
   * lo dispara solo al empezar la ronda para que todos inicien juntos, sin que
   * cada jugador tenga que tocar Enter. Si no se pasa, el juego espera el input
   * manual como siempre.
   */
  onStart?: () => void;
  /**
   * Tras reportar el propio puntaje con la ronda aun en "playing", el juego puede
   * seguir mostrando algo propio en vez de la pantalla generica "esperando a los
   * demas". Devolver true para que se oculte ese overlay (el juego se hace cargo
   * de lo que se ve); false o ausente muestra la espera de siempre. Lo usa
   * Conecta 4: al terminar tu duelo 1v1 pasas a espectar otra partida de la ronda.
   */
  onReportedWaiting?: () => boolean;
}

export interface RoomMode {
  readonly active: true;
  /** Llamar en el game-over, donde fuera del modo sala va hud.showRanking. */
  reportScore(finalScore: number): void;

  // Contexto para juegos de tablero compartido (p.ej. Memoria). Los juegos
  // "cada uno en su pantalla" siguen usando solo reportScore.
  /** Codigo de la sala. */
  readonly code: string;
  /** Nickname propio. */
  readonly me: string;
  /** Numero de ronda que esta pagina esta jugando. */
  round(): number;
  /** Jugadores registrados en la sala (orden por joined_at, deterministico). */
  players(): string[];
  /**
   * Los jugadores registrados que estan conectados ahora mismo (presence), en el
   * mismo orden que `players()`. Lo usan los juegos por turnos para no regalarle
   * el turno a alguien que se fue: un desconectado no va a mover nunca, asi que
   * se lo saltea enseguida en vez de esperarle la ventana AFK entera.
   */
  presentPlayers(): string[];
  isHost(): boolean;
  /** Avisa al resto que hay cambios en la DB (broadcast "sync"). */
  ping(): void;
  /** Se dispara cuando otro cliente hizo ping (releer la DB). */
  onSync(cb: () => void): void;
  /**
   * Fin de la ronda en curso segun el `roomTimeLimitSec` del juego, o null si el
   * juego no declara tope. Incluye el margen de navegacion/countdown, asi que al
   * arrancar la partida el tiempo restante ronda el valor nominal del juego.
   */
  deadline(): Date | null;
  /**
   * Fase actual de la sala segun el ultimo snapshot. Los juegos que manejan su
   * propio arranque en sala (car-race, con su votacion de circuito) lo usan para
   * no largar hasta que la sala pasa a "playing" (recien despues del briefing).
   */
  status(): RoomStatus;
}

/** Variante fija que usa cada juego con variantes cuando corre en modo sala. */
export const ROOM_VARIANTS: Record<string, string> = {
  "sliding-puzzle": "3",
  "lights-out": "5",
  "click-the-number": "5",
};

/** Chequeo barato (sin red) de si la pagina corre en modo sala. */
export function isRoomMode(): boolean {
  return readRoomCode() !== null;
}

function readRoomCode(): string | null {
  const raw = new URLSearchParams(window.location.search).get("room");
  return raw ? sanitizeCode(raw) : null;
}

/** URL de un juego dentro de una sala. */
export function roomGameUrl(gameId: string, code: string): string {
  const game = games.find((g) => g.id === gameId);
  return game ? `${game.path}?room=${code}` : "/";
}

/** Un juego al azar (para la primera ronda sin playlist). */
export function randomGameId(): string {
  return roomGames[Math.floor(Math.random() * roomGames.length)].id;
}

/**
 * Tope de tiempo de la ronda de un juego, en segundos. Ya no es un ajuste de la
 * sala: cada juego declara el suyo en su `meta.ts` (`roomTimeLimitSec`) y los que
 * no lo declaran (la mayoria) se juegan sin reloj, cerrando la ronda cuando todos
 * terminan su partida.
 */
export function roomTimeLimitFor(gameId: string): number {
  return games.find((g) => g.id === gameId)?.roomTimeLimitSec ?? NO_TIME_LIMIT;
}

/**
 * Margen extra sobre el tope de ronda para cubrir la navegacion entre paginas
 * y el countdown 3/2/1/YA de cada juego.
 */
const NAV_GRACE_SEC = 10;

/** Deadline de una ronda que arranca ahora, o null si el juego no tiene tope. */
export function computeRoundDeadline(roundTimeLimitSec: number): Date | null {
  if (roundTimeLimitSec === NO_TIME_LIMIT) return null;
  return new Date(Date.now() + (roundTimeLimitSec + NAV_GRACE_SEC) * 1000);
}

const TICK_MS = 500;
const POLL_MS = 5000;
/** Duracion de la votacion del proximo juego. */
export const VOTE_SECONDS = 20;
/**
 * Tope de lectura del briefing previo a cada ronda (de que va el juego + los
 * controles). Si nadie toca "Listo", la ronda arranca igual al vencer; si todos
 * los presentes marcan "Listo" antes, el host la arranca en el acto.
 */
export const BRIEFING_SECONDS = 10;
/** Marca de "listo" en room_votes (columna game_id) durante el briefing. */
const READY_VOTE = "ready";
/**
 * Cuando ya votaron todos los presentes, el host comprime la votacion a este
 * margen final en vez de esperar el tope completo (no tiene sentido dejar 10s
 * si ya voto todo el mundo).
 */
const VOTE_GRACE_MS = 3000;
/** Espera tras el deadline antes de cerrar, para que lleguen los parciales. */
const CLOSE_LAG_MS = 2500;
/** Cierre anticipado: todos los presentes reportaron y hay ausentes. */
const CLOSE_EARLY_GRACE_MS = 15000;
/** Ausencia continua del host antes de que otro jugador tome el control. */
const HOST_ABSENT_MS = 20000;
/**
 * Escalonado entre candidatos al control: el primero de la fila intenta a los
 * HOST_ABSENT_MS, el segundo unos segundos despues, etc. Evita que dos escriban
 * a la vez y cubre el caso del candidato cuya pestana esta en segundo plano (el
 * navegador le estrangula los timers y puede tardar en reaccionar).
 */
const TAKEOVER_STAGGER_MS = 5000;
/** Espera antes de reintentar un takeover que no se reflejo en la DB. */
const TAKEOVER_RETRY_MS = 10000;
/** Pausa en resultados antes de que el host abra la votacion. */
const RESULTS_TO_VOTE_MS = 5000;

export function initRoomMode(gameId: string, hooks: RoomModeHooks): RoomMode | null {
  const code = readRoomCode();
  if (!code || !getSupabase()) return null;

  const me = getNickname();
  if (!me) {
    // Nunca se unio: que pase por el lobby a elegir nombre. Stub inerte
    // mientras navega (la pagina se descarta enseguida).
    window.location.href = `/rooms/?code=${code}`;
    return {
      active: true,
      reportScore: () => {},
      code,
      me: "",
      round: () => 0,
      players: () => [],
      presentPlayers: () => [],
      isHost: () => false,
      ping: () => {},
      onSync: () => {},
      deadline: () => null,
      status: () => "lobby",
    };
  }

  const controller = new RoomModeController(gameId, code, me, hooks);
  void controller.boot();
  return controller;
}

class RoomModeController implements RoomMode {
  readonly active = true as const;

  private readonly overlay = new RoomOverlay();
  private channel: RoomChannel | null = null;
  private state: RoomState | null = null;
  /** Ronda que esta pagina esta jugando (fijada al cargar). */
  private myRound = 0;
  private reported = false;
  /** Reporte en vuelo: evita escrituras duplicadas concurrentes del mismo parcial. */
  private reporting = false;
  /**
   * Espectador: entro con la partida ya empezada, no esta registrado en la sala.
   * No juega ni puntua, solo mira hasta que termine (o vuelva al lobby, donde
   * recien podra sumarse). Se detecta al bootear (no esta en room_players y la
   * sala no esta en el lobby).
   */
  private spectator = false;
  /** El cartel de espectador ya se mostro (para no re-renderizar en cada poll). */
  private spectatorRendered = false;
  /** Fase+ronda cuya votacion ya se comprimio (evita reescribir el deadline). */
  private compressedVoteKey = "";
  /** Ya se disparo el auto-inicio de la partida para esta pagina/ronda. */
  private gameStarted = false;
  private navigating = false;
  private refreshing = false;
  private refreshQueued = false;
  /** Evita disparar dos veces una mutacion de host. */
  private actionInFlight = false;
  private voteScheduledForRound = 0;
  private hostAbsentSince: number | null = null;
  /** Ultimo intento de tomar el control (para no reescribir en cada tick). */
  private takeoverAt = 0;
  /** Cuando esta pagina vio por primera vez la ronda vigente en "playing"
   * (fallback de inicio de ronda para la gracia sin tope de tiempo). */
  private playingSinceRound = 0;
  private playingSince = 0;
  /** El tablero final ya se mostro en esta pagina (para no arrastrar al lobby). */
  private finalShown = false;
  /** El tablero final ya se renderizo una vez (evita re-render en cada poll). */
  private finalRendered = false;
  /** Ya se ofrecio el "volver a la sala" tras el reset de la sala. */
  private lobbyReturnRendered = false;
  /** Tabla final cacheada: el reset de la sala borra los puntajes de la DB. */
  private finalTotals: ReturnType<typeof computeTotals> | null = null;

  private readonly gameId: string;
  readonly code: string;
  readonly me: string;
  private readonly hooks: RoomModeHooks;
  /** Suscriptores del juego al broadcast "sync" (tableros compartidos). */
  private readonly gameSyncCbs: Array<() => void> = [];

  constructor(gameId: string, code: string, me: string, hooks: RoomModeHooks) {
    this.gameId = gameId;
    this.code = code;
    this.me = me;
    this.hooks = hooks;
  }

  async boot(): Promise<void> {
    // Tapar la pantalla ANTES del primer await. Entre que carga la pagina del
    // juego y que llega el estado de la sala hay unos cientos de ms en los que
    // el juego ya muestra su "presiona ENTER para jugar" y lo escucha: un Enter
    // o un toque ahi arrancaban la partida durante el briefing, corriendo detras
    // del cartel de "listos" (y reportando un puntaje de una ronda que para el
    // resto todavia no habia empezado). El overlay se traga ese input hasta que
    // la ronda pasa a "playing".
    this.overlay.showConnecting();

    const state = await fetchRoomState(this.code);
    if (!state) {
      this.overlay.showError("La sala no existe o no se pudo cargar.");
      return;
    }
    if (!state.players.includes(this.me)) {
      // No registrado: si la sala esta en juego, entra como espectador (mira sin
      // jugar); si esta en el lobby (o volvio a el), pasa a registrarse.
      if (state.room.status !== "lobby" && state.room.status !== "finished") {
        this.spectator = true;
      } else {
        this.navigate(`/rooms/?code=${this.code}`);
        return;
      }
    }

    this.myRound = state.room.current_round;
    this.reported = state.scores.some(
      (s) => s.round_no === this.myRound && s.player === this.me,
    );

    this.channel = new RoomChannel(this.code, this.me);
    this.channel.onSync(() => {
      void this.refresh();
      for (const cb of this.gameSyncCbs) cb();
    });
    this.channel.onPresence(() => this.applyState());

    this.applyState(state);

    window.setInterval(() => this.tick(), TICK_MS);
    window.setInterval(() => void this.refresh(), POLL_MS);
    // Heartbeat: mantiene viva la sala mientras se juega (los espectadores no
    // cuentan como gente, asi que no la sostienen). Sin esto la purga borraria
    // una sala en plena partida, ya que nadie esta mirando el lobby.
    if (!this.spectator) {
      void touchRoom(this.code);
      window.setInterval(() => void touchRoom(this.code), HEARTBEAT_MS);
    }
  }

  reportScore(finalScore: number): void {
    void this.submitScore(finalScore, true);
  }

  // ---------- Contexto para tableros compartidos ----------

  round(): number {
    return this.myRound;
  }

  players(): string[] {
    return this.state?.players ?? [];
  }

  presentPlayers(): string[] {
    const present = this.channel?.presentPlayers() ?? [];
    // Se filtra contra los registrados (y en su orden) para que la lista sea la
    // misma en todos los clientes: presence tambien lista espectadores.
    return (this.state?.players ?? []).filter((p) => present.includes(p));
  }

  ping(): void {
    this.channel?.ping();
  }

  onSync(cb: () => void): void {
    this.gameSyncCbs.push(cb);
  }

  deadline(): Date | null {
    const iso = this.state?.room.deadline;
    return iso ? new Date(iso) : null;
  }

  status(): RoomStatus {
    return this.state?.room.status ?? "lobby";
  }

  // ---------- Estado ----------

  private async refresh(): Promise<void> {
    if (this.navigating) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    const state = await fetchRoomState(this.code);
    this.refreshing = false;
    if (state) this.applyState(state);
    if (this.refreshQueued) {
      this.refreshQueued = false;
      void this.refresh();
    }
  }

  /** Re-renderiza segun el ultimo snapshot (o uno nuevo si se pasa). */
  private applyState(state?: RoomState): void {
    if (state) this.state = state;
    if (!this.state || this.navigating) return;
    const room = this.state.room;

    // Ninguna ronda en curso: los snapshots de partida (roomRun) ya no valen. Hay
    // que tirarlos aca porque la revancha vuelve a numerar desde la ronda 1 y
    // reusaria la misma clave (ver clearRoomRuns).
    if (room.status === "lobby" || room.status === "finished") clearRoomRuns(this.code);

    if (this.spectator) {
      this.applySpectator(room);
      return;
    }

    if (room.status === "lobby") {
      // Solo quien todavia no vio el tablero final va directo al lobby. A los que
      // estan mirando los resultados NO se los arrastra cuando OTRO resetea la
      // sala (incluido el host): se quedan en el tablero final con su propio boton
      // "Volver a la sala". El que apreto el boton se navega solo (returnToLobby).
      if (!this.finalShown) {
        this.navigate(`/rooms/?code=${this.code}`);
        return;
      }
      if (!this.lobbyReturnRendered) {
        this.lobbyReturnRendered = true;
        this.overlay.setStrip(null);
        this.overlay.showFinal(this.finalTotals ?? [], this.me, {
          hostAction: {
            label: "Volver a la sala",
            onClick: () => this.navigate(`/rooms/?code=${this.code}`),
          },
          waitingText: null,
        });
      }
      return;
    }
    if (room.status === "finished") {
      // Se renderiza una sola vez (no en cada poll, para que no parpadee).
      // Cualquier jugador puede volver a la sala: no hay que esperar al anfitrion
      // (el que vuelve resetea la sala al lobby para todos).
      if (!this.finalRendered) {
        this.finalRendered = true;
        this.finalShown = true;
        if (!this.finalTotals) this.finalTotals = computeTotals(this.state);
        this.overlay.setStrip(null);
        this.overlay.showFinal(this.finalTotals, this.me, {
          hostAction: { label: "Volver a la sala", onClick: () => void this.returnToLobby() },
          waitingText: null,
        });
      }
      this.maybeTakeOverHost();
      return;
    }

    // Otra ronda u otro juego: esta pagina ya no es la vigente.
    if (room.current_round !== this.myRound || room.current_game !== this.gameId) {
      void this.leaveForCurrentRound();
      return;
    }

    switch (room.status) {
      case "briefing":
        // Antes de jugar: cada jugador lee de que va el juego y sus controles, y
        // marca "Listo". Todavia no se jugo, asi que no hay parcial que reportar.
        this.overlay.setStrip(null);
        this.renderBriefing();
        break;
      case "playing":
        if (this.playingSinceRound !== room.current_round) {
          this.playingSinceRound = room.current_round;
          this.playingSince = Date.now();
        }
        this.updateStrip();
        if (this.reported) {
          // El juego puede tomar la vista (p.ej. Conecta 4 espectando otra
          // partida); si no, la pantalla generica de espera.
          if (this.hooks.onReportedWaiting?.()) {
            this.overlay.hide();
          } else {
            this.renderWaiting();
          }
        } else {
          this.overlay.hide();
          this.autoStartGame();
        }
        if (this.isHost()) void this.maybeCloseRound();
        break;
      case "results":
        this.reportPartialIfNeeded();
        this.overlay.setStrip(null);
        this.renderResults();
        break;
      case "voting":
        this.reportPartialIfNeeded();
        this.overlay.setStrip(null);
        this.renderVoting();
        break;
    }
    this.maybeTakeOverHost();
  }

  /**
   * Vista del espectador: no juega ni escribe nada. Mira un cartel fijo mientras
   * la partida corre y el tablero final cuando termina; si la sala vuelve al
   * lobby, va a /rooms para poder sumarse a la revancha.
   */
  private applySpectator(room: RoomState["room"]): void {
    if (room.status === "lobby") {
      this.navigate(`/rooms/?code=${this.code}`);
      return;
    }
    if (room.status === "finished") {
      if (!this.finalRendered) {
        this.finalRendered = true;
        if (!this.finalTotals) this.finalTotals = computeTotals(this.state!);
        this.overlay.setStrip(null);
        this.overlay.showFinal(this.finalTotals, this.me, {
          hostAction: null,
          waitingText: "La partida termino",
        });
      }
      return;
    }
    // En juego: seguir a la pagina del juego vigente para mirar desde ahi.
    if (room.current_game && room.current_game !== this.gameId) {
      this.navigate(roomGameUrl(room.current_game, this.code));
      return;
    }
    this.updateStrip();
    if (!this.spectatorRendered) {
      this.spectatorRendered = true;
      this.overlay.showSpectator();
    }
  }

  /**
   * Arranca la partida en cuanto la ronda esta "playing" (una sola vez por
   * pagina), asi todos empiezan juntos sin tocar Enter. Los juegos que no pasan
   * `onStart` siguen esperando el input manual.
   */
  private autoStartGame(): void {
    if (this.gameStarted) return;
    this.gameStarted = true;
    this.hooks.onStart?.();
  }

  /**
   * Red de seguridad: si la ronda de esta pagina ya paso a resultados/votacion y
   * el jugador seguia vivo sin haber reportado (se perdio el submit por deadline
   * del tick, p.ej. si el host cerro la ronda antes), manda el parcial con el
   * puntaje en curso para que no quede como ausente (0 puntos). El upsert de
   * reportScore igual cuenta en el ranking/totales, que se recalculan de la DB.
   */
  private reportPartialIfNeeded(): void {
    if (this.reported || this.myRound <= 0) return;
    void this.submitScore(this.hooks.getScore(), false);
  }

  /** Reporta el parcial si hacia falta y navega a la ronda vigente. */
  private async leaveForCurrentRound(): Promise<void> {
    const room = this.state!.room;
    if (!this.reported && this.myRound > 0) {
      await this.submitScore(this.hooks.getScore(), false);
    }
    this.navigate(roomGameUrl(room.current_game ?? "", this.code));
  }

  private async submitScore(score: number, finished: boolean): Promise<void> {
    // Un espectador no puntua nunca (no esta registrado en la sala).
    if (this.spectator) return;
    // Red de seguridad contra la partida largada antes de tiempo: si MI ronda
    // todavia no arranco (la sala esta en su briefing, o ni siquiera se leyo el
    // estado), el puntaje no vale y se descarta. Sin latchear `reported`, asi
    // cuando la ronda pase a "playing" el jugador la juega de verdad (onStart
    // reinicia la partida) en vez de quedarse esperando con un cero puesto. Se
    // compara contra la ronda propia a proposito: un briefing de la ronda
    // SIGUIENTE no invalida el parcial de la que esta cerrando.
    const room = this.state?.room;
    if (this.myRound <= 0 || !room) return;
    if (room.current_round === this.myRound && room.status === "briefing") return;
    // No re-reportar si ya se confirmo, ni lanzar una segunda escritura mientras
    // hay una en vuelo (varios caminos llaman aca: muerte, timeout del tick, parcial
    // al cambiar de fase, navegacion).
    if (this.reported || this.reporting) return;
    this.reporting = true;
    this.renderWaiting();
    const ok = await reportScore(this.code, this.myRound, this.me, score, finished);
    this.reporting = false;
    // Solo latchear "reportado" si la escritura funciono: ante un fallo transitorio
    // (red / RLS / score no finito) queda para reintentar en el proximo tick o al
    // pasar a resultados, en vez de perder el puntaje y contar como ausente.
    if (ok) {
      this.reported = true;
      this.channel?.ping();
    }
    void this.refresh();
  }

  private navigate(url: string): void {
    if (this.navigating) return;
    this.navigating = true;
    window.location.href = url;
  }

  isHost(): boolean {
    return this.state?.room.host === this.me;
  }

  private deadlineMs(): number | null {
    const iso = this.state?.room.deadline;
    return iso ? new Date(iso).getTime() : null;
  }

  private totalRounds(): number {
    const settings = this.state!.room.settings;
    return settings.playlist ? settings.playlist.length : settings.totalRounds;
  }

  private roundScores() {
    return this.state!.scores.filter((s) => s.round_no === this.state!.room.current_round);
  }

  private gameTitle(gameId: string): string {
    return games.find((g) => g.id === gameId)?.title ?? gameId;
  }

  // ---------- Ticker ----------

  private tick(): void {
    if (!this.state || this.navigating) return;
    const room = this.state.room;

    // El espectador solo mantiene vivo el contador del strip mientras hay ronda.
    if (this.spectator) {
      if (room.status !== "lobby" && room.status !== "finished") this.updateStrip();
      return;
    }

    const deadline = this.deadlineMs();
    const now = Date.now();

    if (room.status === "playing") {
      this.updateStrip();
      if (deadline !== null) {
        this.overlay.setTimeText(`La ronda termina en ${formatClock(deadline - now)}`);
        if (!this.reported && now >= deadline) {
          void this.submitScore(this.hooks.getScore(), false);
        }
        if (this.isHost() && now >= deadline + CLOSE_LAG_MS) {
          void this.maybeCloseRound(true);
        }
      }
    } else if (room.status === "briefing") {
      if (deadline !== null) {
        this.overlay.setTimeText(`Empieza en ${formatClock(deadline - now)}`);
      }
      // El host cierra el briefing al vencer el tope o cuando todos estan listos.
      if (this.isHost()) void this.maybeFinishBriefing(deadline !== null && now >= deadline);
    } else if (room.status === "voting") {
      if (this.isHost()) this.maybeCompressVote();
      if (deadline !== null) {
        this.overlay.setTimeText(formatClock(deadline - now));
        // Sin CLOSE_LAG en las votaciones: no hay parciales que esperar, asi
        // cierra apenas vence (incluido el deadline comprimido a pocos segundos).
        if (this.isHost() && now >= deadline) void this.closeVoting();
      }
    }

    this.maybeTakeOverHost();
  }

  private updateStrip(): void {
    const room = this.state!.room;
    const deadline = this.deadlineMs();
    const time = deadline !== null ? ` - ${formatClock(deadline - Date.now())}` : "";
    this.overlay.setStrip(
      `SALA ${this.code} - Ronda ${room.current_round}/${this.totalRounds()}${time}`,
      this.stripLights(),
    );
  }

  /**
   * Una luz por jugador para el strip: verde mientras sigue vivo (presente y sin
   * reportar), roja cuando muere / termina su partida (reporto su puntaje) y gris
   * cuando se fue de la partida (desconectado). Solo tiene sentido mientras se
   * juega la ronda vigente.
   */
  private stripLights(): StripLight[] {
    const state = this.state;
    if (!state) return [];
    const present = this.channel?.presentPlayers() ?? [];
    const done = new Set(this.roundScores().map((s) => s.player));
    return state.players.map((player) => ({
      me: player === this.me,
      state: done.has(player) ? "dead" : present.includes(player) ? "alive" : "left",
    }));
  }

  // ---------- Vistas ----------

  private renderWaiting(): void {
    const state = this.state;
    const present = this.channel?.presentPlayers() ?? [];
    const done = new Set(state ? this.roundScores().map((s) => s.player) : [this.me]);
    const players = state?.players ?? [this.me];

    const entries: WaitingEntry[] = players.map((player) => ({
      player,
      state: done.has(player) ? "done" : present.includes(player) ? "playing" : "offline",
    }));
    this.overlay.showWaiting(entries, this.me);
  }

  private renderResults(): void {
    const state = this.state!;
    const room = state.room;
    const ranked = rankRound(this.gameId, state.players, this.roundScores());

    // En juegos "lower" el parcial de quien no llego a terminar no significa nada
    // (rankRound ya los empata a todos detras de los que terminaron): mostrarlo
    // formateado daba numeros de fantasia como "9999 ms" o "3 mov" para alguien
    // que ni resolvio el tablero. Se muestra "sin terminar" en su lugar.
    const partialIsReal = getDirection(this.gameId) === "higher";

    const rows = ranked.map((r) => ({
      rank: r.rank,
      player: r.player,
      scoreText:
        r.score === null
          ? "sin jugar"
          : r.finished
            ? formatScore(this.gameId, r.score)
            : partialIsReal
              ? `${formatScore(this.gameId, r.score)} (parcial)`
              : "sin terminar",
      points: r.points,
    }));

    const isLast = room.current_round >= this.totalRounds();
    const playlist = room.settings.playlist;

    let hostAction: { label: string; onClick: () => void } | null = null;
    let waitingText: string | null = "Esperando al anfitrion...";

    if (this.isHost()) {
      if (isLast) {
        hostAction = { label: "Ver resultados finales", onClick: () => void this.finish() };
      } else if (playlist) {
        hostAction = {
          label: "Siguiente juego",
          onClick: () => void this.startNextRound(playlist[room.current_round]),
        };
      } else {
        // Sin playlist: la votacion arranca sola tras una pausa para leer.
        waitingText = "La votacion arranca en unos segundos...";
        this.scheduleVote();
      }
    } else if (!isLast && !playlist) {
      waitingText = "La votacion arranca en unos segundos...";
    }

    this.overlay.showResults({
      roundNo: room.current_round,
      totalRounds: this.totalRounds(),
      gameTitle: this.gameTitle(this.gameId),
      rows,
      totals: computeTotals(state),
      me: this.me,
      hostAction,
      waitingText,
    });
  }

  private renderVoting(): void {
    const state = this.state!;
    const room = state.room;
    const optionIds = room.vote_options ?? [];
    const voteRound = room.current_round + 1;

    const votes = state.votes.filter(
      (v) => v.round_no === voteRound && optionIds.includes(v.game_id),
    );
    const counts: Record<string, number> = {};
    for (const v of votes) counts[v.game_id] = (counts[v.game_id] ?? 0) + 1;
    const myVote = votes.find((v) => v.player === this.me)?.game_id ?? null;

    this.overlay.showVoting({
      round: voteRound,
      options: optionIds.map((id) => {
        const game = games.find((g) => g.id === id);
        return { id, title: game?.title ?? id, accent: game?.accent, cover: coverUrl(id) };
      }),
      counts,
      myVote,
      onVote: (id) => {
        void castVote(this.code, voteRound, this.me, id).then((ok) => {
          if (ok) this.channel?.ping();
          void this.refresh();
        });
      },
    });

    if (this.isHost()) this.maybeCompressVote();
  }

  /** Briefing previo a la ronda: de que va el juego + controles + boton "Listo". */
  private renderBriefing(): void {
    const state = this.state!;
    const room = state.room;
    const round = room.current_round;
    const game = games.find((g) => g.id === this.gameId);

    const ready = new Set(
      state.votes
        .filter((v) => v.round_no === round && v.game_id === READY_VOTE)
        .map((v) => v.player),
    );
    const readyCount = state.players.filter((p) => ready.has(p)).length;

    const limit = roomTimeLimitFor(this.gameId);

    this.overlay.showBriefing({
      round,
      roundNo: room.current_round,
      totalRounds: this.totalRounds(),
      gameTitle: this.gameTitle(this.gameId),
      description: game?.description ?? "",
      controls: game?.controls ?? "",
      // Solo los juegos con tope declarado avisan el reloj; el resto no lo tiene.
      timeLimit: limit === NO_TIME_LIMIT ? "" : formatRoundTimeLimit(limit),
      readyCount,
      totalPlayers: state.players.length,
      iAmReady: ready.has(this.me),
      onReady: () => {
        void castVote(this.code, round, this.me, READY_VOTE).then((ok) => {
          if (ok) this.channel?.ping();
          void this.refresh();
        });
      },
    });

    if (this.isHost()) void this.maybeFinishBriefing();
  }

  // ---------- Logica de host ----------

  private async hostAction(action: () => Promise<unknown>): Promise<void> {
    if (this.actionInFlight) return;
    this.actionInFlight = true;
    try {
      await action();
      this.channel?.ping();
      await this.refresh();
    } finally {
      this.actionInFlight = false;
    }
  }

  /** Cierra la ronda si todos reportaron, vencio el tope, o solo faltan ausentes. */
  private async maybeCloseRound(deadlinePassed = false): Promise<void> {
    const state = this.state;
    if (!state || state.room.status !== "playing") return;

    const done = new Set(this.roundScores().map((s) => s.player));
    const allReported = state.players.every((p) => done.has(p));

    let onlyAbsentMissing = false;
    if (!allReported) {
      const present = this.channel?.presentPlayers() ?? [];
      const presentAllDone = state.players
        .filter((p) => present.includes(p))
        .every((p) => done.has(p));
      // Inicio de ronda = cuando esta pagina la vio en "playing". No se deriva
      // del deadline porque con tiempo votado / sin tope el deadline no lo refleja.
      // Gracia para que la presencia se estabilice tras la navegacion.
      onlyAbsentMissing =
        presentAllDone &&
        done.has(this.me) &&
        Date.now() - this.playingSince > CLOSE_EARLY_GRACE_MS;
    }

    if (!allReported && !deadlinePassed && !onlyAbsentMissing) return;
    await this.hostAction(() => closeRound(this.code));
  }

  private scheduleVote(): void {
    const round = this.state!.room.current_round;
    if (this.voteScheduledForRound === round) return;
    this.voteScheduledForRound = round;

    window.setTimeout(() => {
      void (async () => {
        // Revalidar contra la DB: pudo cambiar el host o la fase mientras tanto.
        const fresh = await fetchRoomState(this.code);
        if (!fresh || fresh.room.status !== "results" || fresh.room.host !== this.me) return;
        if (fresh.room.current_round !== round) return;
        this.state = fresh;
        const options = pickVoteOptions();
        const deadline = new Date(Date.now() + VOTE_SECONDS * 1000);
        await this.hostAction(() => openVote(this.code, options, deadline));
      })();
    }, RESULTS_TO_VOTE_MS);
  }

  /**
   * Si ya votaron todos los jugadores presentes, el host adelanta el deadline a
   * VOTE_GRACE_MS (unos segundos) en vez de esperar el tope completo: no tiene
   * sentido dejar la cuenta corriendo cuando no falta nadie por votar. Solo
   * cuenta a los presentes (a los ausentes no se los espera). Se escribe una
   * sola vez por fase+ronda.
   */
  private maybeCompressVote(): void {
    const state = this.state;
    if (!state || !this.isHost()) return;
    const room = state.room;
    if (room.status !== "voting") return;

    const options = room.vote_options ?? [];
    if (options.length === 0) return;
    // El voto del proximo juego se guarda en la ronda siguiente.
    const voteRound = room.current_round + 1;
    const voters = new Set(
      state.votes
        .filter((v) => v.round_no === voteRound && options.includes(v.game_id))
        .map((v) => v.player),
    );

    const present = this.channel?.presentPlayers() ?? [];
    const registeredPresent = state.players.filter((p) => present.includes(p));
    const allPresentVoted =
      registeredPresent.length > 0 && registeredPresent.every((p) => voters.has(p));
    if (!allPresentVoted) return;

    const key = `${room.status}:${room.current_round}`;
    if (this.compressedVoteKey === key) return;
    this.compressedVoteKey = key;

    const target = Date.now() + VOTE_GRACE_MS;
    const current = this.deadlineMs();
    // Solo escribir si realmente acorta (con un pequeno margen para no rebotar).
    if (current !== null && current <= target + 250) return;
    void this.hostAction(() => updateDeadline(this.code, new Date(target)));
  }

  private async closeVoting(): Promise<void> {
    const state = this.state;
    if (!state || state.room.status !== "voting" || this.actionInFlight) return;
    const options = state.room.vote_options ?? [];
    if (options.length === 0) return;

    const voteRound = state.room.current_round + 1;
    const counts = new Map<string, number>();
    for (const v of state.votes) {
      if (v.round_no === voteRound && options.includes(v.game_id)) {
        counts.set(v.game_id, (counts.get(v.game_id) ?? 0) + 1);
      }
    }
    const max = Math.max(0, ...counts.values());
    const top = max > 0 ? options.filter((id) => counts.get(id) === max) : options;
    const winner = top[Math.floor(Math.random() * top.length)];
    await this.startNextRound(winner);
  }

  /**
   * Arranca la siguiente ronda por su briefing: se fija el juego y se pasa a
   * 'briefing' para que todos lean de que va antes de jugar. Al cerrarlo (todos
   * listos o vencido el tope) recien arranca la partida (finishBriefing).
   */
  private async startNextRound(gameId: string): Promise<void> {
    const state = this.state;
    if (!state) return;
    const roundNo = state.room.current_round + 1;
    const deadline = new Date(Date.now() + BRIEFING_SECONDS * 1000);
    await this.hostAction(() => startBriefing(this.code, roundNo, gameId, deadline));
  }

  /**
   * Cierra el briefing si vencio el tope o si todos los jugadores presentes ya
   * marcaron "Listo" (a los ausentes no se los espera). Solo el host.
   */
  private async maybeFinishBriefing(deadlinePassed = false): Promise<void> {
    const state = this.state;
    if (!state || state.room.status !== "briefing" || !this.isHost()) return;

    const round = state.room.current_round;
    const ready = new Set(
      state.votes
        .filter((v) => v.round_no === round && v.game_id === READY_VOTE)
        .map((v) => v.player),
    );
    const present = this.channel?.presentPlayers() ?? [];
    const registeredPresent = state.players.filter((p) => present.includes(p));
    const allPresentReady =
      registeredPresent.length > 0 && registeredPresent.every((p) => ready.has(p));

    if (!deadlinePassed && !allPresentReady) return;
    await this.finishBriefing();
  }

  /**
   * Sale del briefing hacia la partida, con el tope de tiempo que declare el juego
   * (o sin reloj, que es lo normal). El reloj de la ronda recien arranca aca, asi
   * que el briefing no le come tiempo a la partida.
   */
  private async finishBriefing(): Promise<void> {
    const state = this.state;
    if (!state || state.room.status !== "briefing" || this.actionInFlight) return;
    const round = state.room.current_round;
    const gameId = state.room.current_game ?? this.gameId;
    const deadline = computeRoundDeadline(roomTimeLimitFor(gameId));
    await this.hostAction(() => startRound(this.code, round, gameId, deadline));
  }

  private async finish(): Promise<void> {
    await this.hostAction(() => finishRoom(this.code));
  }

  /**
   * "Volver a la sala" desde el tablero final. Lo puede tocar cualquier jugador
   * (no solo el anfitrion): resetea la sala al lobby para todos y lleva a quien
   * lo apreto directo al lobby, sin tener que esperar a que el lider vuelva.
   */
  private async returnToLobby(): Promise<void> {
    await this.hostAction(() => resetRoom(this.code));
    this.navigate(`/rooms/?code=${this.code}`);
  }

  // ---------- Migracion de host ----------

  /**
   * Si el host se fue, otro jugador toma el control **solo**, sin que nadie
   * apriete nada. Es lo que impide que la sala quede injugable: como todas las
   * transiciones de fase (cerrar la ronda, cerrar el briefing, cerrar la
   * votacion) y los destrabes de los juegos de tablero compartido los escribe
   * unicamente el host, si el host desaparece nadie avanza y la sala se congela.
   *
   * Antes esto era un boton manual ("tomar el control") y no alcanzaba: solo se
   * ofrecia en fases "estables" — durante `playing` hacia falta haber reportado —
   * y el overlay esta oculto mientras se juega, asi que en el caso mas comun (el
   * host se va en plena ronda) el boton no llegaba a dibujarse nunca.
   *
   * El candidato se elige deterministicamente: el primero de `presentPlayers()`
   * (orden joined_at) que no sea el host ausente. El escalonado por posicion
   * evita escrituras simultaneas y cubre al candidato dormido.
   */
  private maybeTakeOverHost(): void {
    const state = this.state;
    // Un espectador no puede tomar el control (no es jugador de la sala).
    if (!state || this.spectator || this.isHost() || state.room.status === "lobby") {
      this.hostAbsentSince = null;
      return;
    }

    const present = this.presentPlayers();
    if (present.includes(state.room.host)) {
      this.hostAbsentSince = null;
      return;
    }
    // Sin presencia propia (canal recien suscripto, o caido) no se decide nada:
    // si la lista esta vacia para todos, nadie se autoproclama host.
    if (!present.includes(this.me)) return;

    if (this.hostAbsentSince === null) {
      this.hostAbsentSince = Date.now();
      return;
    }
    const rank = present.filter((p) => p !== state.room.host).indexOf(this.me);
    if (rank < 0) return;
    if (Date.now() - this.hostAbsentSince < HOST_ABSENT_MS + rank * TAKEOVER_STAGGER_MS) return;
    if (Date.now() - this.takeoverAt < TAKEOVER_RETRY_MS) return;

    this.takeoverAt = Date.now();
    void takeOverHost(this.code, this.me).then((ok) => {
      if (ok) this.channel?.ping();
      void this.refresh();
    });
  }
}

/** Cuantos candidatos se ofrecen en cada votacion de juego. */
export const VOTE_OPTION_COUNT = 5;

/**
 * Candidatos al azar para la votacion del proximo juego. Los ya jugados entran
 * al sorteo igual que el resto: una sala puede repetir un juego (incluso el de
 * la ronda recien terminada) si lo votan. Los candidatos de una misma votacion
 * si son distintos entre si.
 */
export function pickVoteOptions(): string[] {
  const pool = roomGames.map((g) => g.id);

  const picked: string[] = [];
  while (picked.length < VOTE_OPTION_COUNT && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool[i]);
    pool.splice(i, 1);
  }
  return picked;
}

/** "1:43" a partir de milisegundos restantes (piso 0:00). */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
