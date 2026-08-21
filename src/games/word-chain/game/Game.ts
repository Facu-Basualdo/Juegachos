import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { COUNTDOWN_LABELS, COUNTDOWN_STEP } from "./constants";
import { EmoteAudio } from "./EmoteAudio";
import { Hud } from "./Hud";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";
import type { WcEmoteId, WcGameover, WcRejectReason, WcState } from "./WordChainTransport";

type State = "message" | "countdown" | "playing" | "over";

const REJECT_MESSAGES: Record<WcRejectReason, string> = {
  "not-a-word": "no esta en el diccionario",
  "wrong-initial": "no empieza con la letra",
  "already-used": "ya se uso esa palabra",
  "not-your-turn": "no es tu turno",
};

/** Lo que cambio entre dos snapshots del server, para sonar y animar una sola vez. */
interface StateDiff {
  /** Palabra recien aceptada (eslabon forjado), si la hay. */
  accepted: { player: string; word: string } | null;
  /** A alguien se le corto la cadena (se le acabo el reloj). */
  snapped: boolean;
  /** Cambio el jugador de turno. */
  turnChanged: boolean;
}

/**
 * Cadena de Palabras: juego SOLO de sala. Supabase maneja lobby / marcador / rejoin
 * (via RoomMode); el estado en-ronda (turno, reloj, letra, validacion contra el
 * diccionario) lo maneja el game server autoritativo por socket.io. Sin sala o sin
 * server configurado no se puede jugar: se muestra un cartel (excepcion deliberada a
 * la degradacion del repo, ver CLAUDE.md).
 */
export class Game {
  private readonly hud: Hud;
  private state: State = "message";

  private readonly room: RoomMode | null;
  private transport: SocketTransport | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;

  private lastCountdownIndex = -1;

  private latest: WcState | null = null;
  private prev: WcState | null = null;
  private lastAcceptSeq = 0;
  /** Fallback del reloj para un server viejo (solo manda `deadline`). */
  private clockFallbackDeadline: number | null = null;
  private clockFallbackTotal = 0;
  /** Ultima palabra aceptada por cada jugador (se muestra bajo su avatar). */
  private readonly lastWords = new Map<string, string>();

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.hud.onSubmit((word) => this.onSubmitWord(word));
    this.hud.onType((text) => this.transport?.sendTyping(text));
    this.hud.onEmote((id) => this.transport?.sendEmote(id));

    this.room = initRoomMode("word-chain", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      // Sin ?room= (o sin Supabase): el juego es solo de sala.
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Cadena de Palabras necesita las credenciales de la sala y no estan configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Cadena de Palabras se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Cadena de Palabras necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    // Los samples de las reacciones se bajan ya, mientras se espera la ronda (el
    // briefing dura 10s): al primer emote tienen que estar decodificados.
    EmoteAudio.preload();

    // En sala: RoomMode dispara onStart al pasar a "playing" y arranca el countdown.
    this.hud.showMessage("Cadena de Palabras", "Esper&aacute; a que empiece la ronda...");
  }

  // ---------- Countdown ----------

  private beginCountdown(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    this.state = "countdown";
    this.lastCountdownIndex = -1;
    this.lastWords.clear();
    this.lastAcceptSeq = 0;
    void this.connect();

    let i = 0;
    const step = () => {
      if (i >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.startPlaying();
        return;
      }
      if (i !== this.lastCountdownIndex) {
        this.lastCountdownIndex = i;
        SoundEffects.playCountdownTick();
      }
      this.hud.showCountdown(COUNTDOWN_LABELS[i]);
      i += 1;
      window.setTimeout(step, COUNTDOWN_STEP);
    };
    step();
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.showStage();
    this.hud.setEmotesEnabled(true);
    if (this.latest) this.applyState(this.latest);
  }

  // ---------- Transporte ----------

  /** Async porque resolver el server puede implicar un health check (ver
   *  `shared/server-status.ts`); `connecting` cubre la ventana del await, en la
   *  que `this.transport` todavia es null y una segunda llamada abriria un
   *  socket de mas. */
  private async connect(): Promise<void> {
    if (this.transport || this.connecting || !this.room) return;
    this.connecting = true;
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.transport || !url) return;
    const transport = new SocketTransport(
      url,
      this.room.code,
      this.room.me,
      this.room.players(),
    );
    transport.onState((s) => this.onState(s));
    transport.onInvalid((r) => this.onInvalid(r));
    transport.onTyping((player, text) => {
      // El propio tipeo ya se muestra local al instante; ignorar su eco del
      // server (llega con lag y pisaria lo recien escrito -> parpadeo).
      if (this.state === "playing" && player !== this.room?.me) {
        this.hud.showTyping(player, text);
      }
    });
    transport.onEmote((player, emote) => this.onEmote(player, emote));
    transport.onGameover((r) => this.onGameover(r));
    this.transport = transport;
    void transport.connect();
  }

  private onState(s: WcState): void {
    this.latest = s;
    if (this.state === "playing") this.applyState(s);
  }

  private applyState(s: WcState): void {
    const me = this.room?.me ?? "";
    const turnPlayer = s.turn;
    const myTurn = s.phase === "playing" && turnPlayer === me;

    // 1) Diff contra el snapshot anterior (tambien actualiza las ultimas palabras).
    const diff = this.diff(s);

    // 2) Render con el estado ya actualizado.
    this.hud.render({
      players: s.players.map((p) => ({
        nickname: p.nickname,
        alive: p.alive,
        connected: p.connected,
        links: p.links,
        isTurn: s.phase === "playing" && p.nickname === turnPlayer,
        isMe: p.nickname === me,
        lastWord: this.lastWords.get(p.nickname) ?? "",
      })),
      letter: s.letter,
      myTurn,
      chainLength: s.chainLength,
    });

    // 3) Recien ahora los sellos y sonidos: `render` acaba de reconstruir todas las
    // tarjetas, asi que animarlas antes seria pintar sobre nodos ya descartados.
    this.playDiff(diff);

    // Reloj visible: todos ven cuanto le queda al turno.
    this.updateClock(s);

    this.prev = s;
  }

  /**
   * Alimenta el anillo del reloj. Prefiere `clockMs`/`clockTotalMs` del server
   * (anclados a performance.now() en la Hud, sin drift de reloj). Si el server es
   * viejo y no los manda, cae al `deadline` (epoch absoluto) computando el restante
   * con el reloj local — funciona igual, con un leve drift posible entre maquinas.
   */
  private updateClock(s: WcState): void {
    if (s.phase !== "playing") {
      this.hud.clearClock();
      this.clockFallbackDeadline = null;
      return;
    }
    if (s.clockMs != null && s.clockTotalMs != null && s.clockTotalMs > 0) {
      this.hud.setClock(s.clockMs, s.clockTotalMs);
      return;
    }
    if (s.deadline != null) {
      const remaining = Math.max(0, s.deadline - Date.now());
      // El total es el restante observado al aparecer un deadline nuevo (los
      // snapshots llegan al empezar el turno, asi que es ~el reloj completo).
      if (s.deadline !== this.clockFallbackDeadline) {
        this.clockFallbackDeadline = s.deadline;
        this.clockFallbackTotal = Math.max(remaining, 1);
      }
      this.hud.setClock(remaining, this.clockFallbackTotal);
      return;
    }
    this.hud.clearClock();
  }

  /** Que cambio respecto del snapshot anterior. Actualiza `lastWords` de paso. */
  private diff(s: WcState): StateDiff {
    let accepted: StateDiff["accepted"] = null;
    if (s.lastAccepted && s.lastAccepted.seq > this.lastAcceptSeq) {
      this.lastAcceptSeq = s.lastAccepted.seq;
      this.lastWords.set(s.lastAccepted.player, s.lastAccepted.word);
      accepted = { player: s.lastAccepted.player, word: s.lastAccepted.word };
    }
    if (!this.prev) return { accepted, snapped: false, turnChanged: false };

    // Con una sola vida, dejar de estar "alive" es la eliminacion: se corto la cadena.
    const wasAlive = new Map(this.prev.players.map((p) => [p.nickname, p.alive]));
    const snapped = s.players.some((p) => wasAlive.get(p.nickname) === true && !p.alive);
    const turnChanged = this.prev.turn !== s.turn && s.phase === "playing";
    return { accepted, snapped, turnChanged };
  }

  /** Sonidos y animaciones de lo que cambio (una sola vez por snapshot). */
  private playDiff(diff: StateDiff): void {
    if (diff.accepted) {
      SoundEffects.playAccept();
      this.hud.flashAccept(diff.accepted.player, diff.accepted.word);
    }
    if (diff.snapped) {
      SoundEffects.playSnap();
      this.hud.flashSnap();
    }
    // Un turno que cambia por una palabra aceptada ya sono con el martillazo.
    if (diff.turnChanged && !diff.accepted && !diff.snapped) SoundEffects.playTurn();
  }

  /**
   * Reaccion de cualquier jugador — vivo, eliminado o el de turno. Es puramente
   * cosmetica: le cambia la cara al personaje por un instante y no toca el estado de
   * la partida. La propia tambien se pinta con el eco del server (no optimista), asi
   * lo que ve uno es lo mismo que ven los demas y manda el cooldown del server.
   */
  private onEmote(player: string, emote: WcEmoteId): void {
    if (this.state !== "playing") return;
    SoundEffects.playEmote(emote);
    this.hud.showEmote(player, emote);
  }

  private onInvalid(reason: WcRejectReason): void {
    SoundEffects.playReject();
    this.hud.flashReject(REJECT_MESSAGES[reason]);
  }

  private onSubmitWord(word: string): void {
    if (this.state !== "playing") return;
    this.transport?.submit(word);
    this.hud.clearInput();
  }

  private onGameover(result: WcGameover): void {
    if (this.state === "over") return;
    this.state = "over";
    this.hud.setInputEnabled(false);
    this.hud.setEmotesEnabled(false);
    this.hud.clearClock();

    const me = this.room?.me ?? "";
    const mine = result.ranking.find((r) => r.nickname === me);
    const place = mine?.place ?? result.ranking.length;
    if (place === 1) SoundEffects.playWin();
    else SoundEffects.playLose();

    // Puntaje placement-based (mayor = mejor): sobrevivir mas suma mas. El
    // RoomOverlay toma la pantalla con el resultado de la ronda.
    if (this.room) this.room.reportScore(this.placementScore(result, place));
  }

  // ---------- Puntaje ----------

  private placementScore(result: WcGameover, place: number): number {
    return Math.max(0, result.ranking.length - place);
  }

  /** Puntaje en vivo para el parcial por timeout de Supabase (rara vez se usa: la
   * partida casi siempre termina por eliminacion antes del tope de ronda). Proxy:
   * cuantos jugadores ya quedaron afuera (a los que sobrevivi). */
  private liveScore(): number {
    if (!this.latest) return 0;
    return this.latest.players.filter((p) => !p.alive).length;
  }
}
