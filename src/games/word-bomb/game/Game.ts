import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { COUNTDOWN_LABELS, COUNTDOWN_STEP } from "./constants";
import { EmoteAudio } from "./EmoteAudio";
import { Hud } from "./Hud";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";
import type { WbEmoteId, WbGameover, WbRejectReason, WbState } from "./WordBombTransport";

type State = "message" | "countdown" | "playing" | "over";

const REJECT_MESSAGES: Record<WbRejectReason, string> = {
  "not-a-word": "no esta en el diccionario",
  "missing-fragment": "no contiene el fragmento",
  "already-used": "ya se uso esa palabra",
  "not-your-turn": "no es tu turno",
};

/**
 * Bomba Palabra: juego SOLO de sala. Supabase maneja lobby / marcador / rejoin
 * (via RoomMode); el estado en-ronda (turno, mecha, vidas, validacion contra el
 * diccionario) lo maneja el game server autoritativo por socket.io. Sin sala o
 * sin server configurado no se puede jugar: se muestra un cartel (excepcion
 * deliberada a la degradacion del repo, ver CLAUDE.md).
 */
export class Game {
  private readonly hud: Hud;
  private state: State = "message";

  private readonly room: RoomMode | null;
  private transport: SocketTransport | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;

  private lastCountdownIndex = -1;

  private latest: WbState | null = null;
  private prev: WbState | null = null;
  private lastAcceptSeq = 0;
  /** Fallback de la mecha para un server viejo (solo manda `deadline`). */
  private fuseFallbackDeadline: number | null = null;
  private fuseFallbackTotal = 0;
  /** Ultima palabra aceptada por cada jugador (se muestra bajo su avatar). */
  private readonly lastWords = new Map<string, string>();

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.hud.onSubmit((word) => this.onSubmitWord(word));
    this.hud.onType((text) => this.transport?.sendTyping(text));
    this.hud.onEmote((id) => this.transport?.sendEmote(id));

    this.room = initRoomMode("word-bomb", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      // Sin ?room= (o sin Supabase): el juego es solo de sala.
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Bomba Palabra necesita las credenciales de la sala y no estan configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Bomba Palabra se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Bomba Palabra necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    // Los samples de las reacciones se bajan ya, mientras se espera la ronda (el
    // briefing dura 10s): al primer emote tienen que estar decodificados.
    EmoteAudio.preload();

    // En sala: RoomMode dispara onStart al pasar a "playing" y arranca el countdown.
    this.hud.showMessage("Bomba Palabra", "Esper&aacute; a que empiece la ronda...");
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

  private onState(s: WbState): void {
    this.latest = s;
    if (this.state === "playing") this.applyState(s);
  }

  private applyState(s: WbState): void {
    const me = this.room?.me ?? "";
    const turnPlayer = s.turn;
    const myTurn = s.phase === "playing" && turnPlayer === me;

    // Sonidos por diff contra el estado anterior (y actualiza las ultimas palabras).
    this.playDiffSounds(s);

    this.hud.render({
      players: s.players.map((p) => ({
        nickname: p.nickname,
        lives: p.lives,
        alive: p.alive,
        connected: p.connected,
        isTurn: s.phase === "playing" && p.nickname === turnPlayer,
        isMe: p.nickname === me,
        lastWord: this.lastWords.get(p.nickname) ?? "",
      })),
      fragment: s.fragment,
      myTurn,
      usedCount: s.usedCount,
    });

    // Mecha visible: todos ven cuanto le queda a la bomba en cada turno.
    this.updateFuse(s);

    this.prev = s;
  }

  /**
   * Alimenta el anillo de la mecha. Prefiere `fuseMs`/`fuseTotalMs` del server
   * (anclados a performance.now() en la Hud, sin drift de reloj). Si el server es
   * viejo y no los manda, cae al `deadline` (epoch absoluto) computando el restante
   * con el reloj local — funciona igual, con un leve drift posible entre maquinas.
   */
  private updateFuse(s: WbState): void {
    if (s.phase !== "playing") {
      this.hud.clearFuse();
      this.fuseFallbackDeadline = null;
      return;
    }
    if (s.fuseMs != null && s.fuseTotalMs != null && s.fuseTotalMs > 0) {
      this.hud.setFuse(s.fuseMs, s.fuseTotalMs);
      return;
    }
    if (s.deadline != null) {
      const remaining = Math.max(0, s.deadline - Date.now());
      // El total es el restante observado al aparecer un deadline nuevo (los
      // snapshots llegan al empezar el turno, asi que es ~la mecha completa).
      if (s.deadline !== this.fuseFallbackDeadline) {
        this.fuseFallbackDeadline = s.deadline;
        this.fuseFallbackTotal = Math.max(remaining, 1);
      }
      this.hud.setFuse(remaining, this.fuseFallbackTotal);
      return;
    }
    this.hud.clearFuse();
  }

  private playDiffSounds(s: WbState): void {
    // Palabra aceptada nueva: se guarda como ultima de ese jugador y se sella bajo su avatar.
    if (s.lastAccepted && s.lastAccepted.seq > this.lastAcceptSeq) {
      this.lastAcceptSeq = s.lastAccepted.seq;
      this.lastWords.set(s.lastAccepted.player, s.lastAccepted.word);
      SoundEffects.playAccept();
      this.hud.flashAccept(s.lastAccepted.player, s.lastAccepted.word);
    }
    if (!this.prev) return;
    // Vida perdida en algun jugador -> exploto la mecha.
    const before = new Map(this.prev.players.map((p) => [p.nickname, p.lives]));
    for (const p of s.players) {
      const was = before.get(p.nickname);
      if (was !== undefined && p.lives < was) {
        SoundEffects.playExplode();
        this.hud.flashExplosion();
        break;
      }
    }
    // Cambio de turno (sin palabra aceptada por medio ya cubierto arriba).
    if (this.prev.turn !== s.turn && s.phase === "playing") SoundEffects.playTurn();
  }

  /**
   * Reaccion de cualquier jugador — vivo, eliminado o el de turno. Es puramente
   * cosmetica: le cambia la cara al personaje por un instante y no toca el estado de
   * la partida. La propia tambien se pinta con el eco del server (no optimista), asi
   * lo que ve uno es lo mismo que ven los demas y manda el cooldown del server.
   */
  private onEmote(player: string, emote: WbEmoteId): void {
    if (this.state !== "playing") return;
    SoundEffects.playEmote(emote);
    this.hud.showEmote(player, emote);
  }

  private onInvalid(reason: WbRejectReason): void {
    SoundEffects.playReject();
    this.hud.flashReject(REJECT_MESSAGES[reason]);
  }

  private onSubmitWord(word: string): void {
    if (this.state !== "playing") return;
    this.transport?.submit(word);
    this.hud.clearInput();
  }

  private onGameover(result: WbGameover): void {
    if (this.state === "over") return;
    this.state = "over";
    this.hud.setInputEnabled(false);
    this.hud.setEmotesEnabled(false);
    this.hud.clearFuse();

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

  private placementScore(result: WbGameover, place: number): number {
    return Math.max(0, result.ranking.length - place);
  }

  /** Puntaje en vivo para el parcial por timeout de Supabase (rara vez se usa:
   * la partida casi siempre termina por eliminacion antes del tope de ronda).
   * Proxy: cuantos jugadores ya quedaron afuera (a los que sobrevivi). */
  private liveScore(): number {
    if (!this.latest) return 0;
    return this.latest.players.filter((p) => !p.alive).length;
  }
}
