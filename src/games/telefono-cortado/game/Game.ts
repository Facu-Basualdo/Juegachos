import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { COUNTDOWN_LABELS, COUNTDOWN_STEP } from "./constants";
import { Hud } from "./Hud";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";
import type { TcGameover, TcPhase, TcState, TcYou } from "./TelefonoTransport";

type State = "message" | "countdown" | "playing" | "over";

/**
 * Telefono Cortado: juego SOLO de sala. Supabase maneja lobby / marcador / rejoin
 * (via RoomMode); el estado en-ronda (frases, dibujos, adivinanzas, fases y puntaje)
 * lo maneja el game server autoritativo por socket.io. Sin sala o sin server no se
 * puede jugar: se muestra un cartel (excepcion deliberada a la degradacion del repo,
 * ver CLAUDE.md, igual que Basta / Bomba / Cadena).
 *
 * El server es indispensable por diseño, no por comodidad: es el unico que conoce las
 * frases secretas, y es lo que hace que adivinar valga algo (el cliente nunca recibe la
 * frase que tiene que adivinar hasta el reveal).
 */
export class Game {
  private readonly hud: Hud;
  private state: State = "message";

  private readonly room: RoomMode | null;
  private transport: SocketTransport | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;

  private lastCountdownIndex = -1;
  private latest: TcState | null = null;
  private you: TcYou | null = null;
  private prevPhase: TcPhase | null = null;

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.hud.onPhrase((text) => {
      this.transport?.sendPhrase(text);
      SoundEffects.playSubmit();
    });
    this.hud.onDrawing((image) => {
      this.transport?.sendDrawing(image);
      SoundEffects.playSubmit();
    });
    this.hud.onGuess((text) => this.transport?.sendGuess(text));

    this.room = initRoomMode("telefono-cortado", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Tel&eacute;fono Cortado necesita las credenciales de la sala y no est&aacute;n configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Tel&eacute;fono Cortado se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Tel&eacute;fono Cortado necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    this.hud.showMessage("Tel&eacute;fono Cortado", "Esper&aacute; a que empiece la ronda...");
  }

  // ---------- Countdown ----------

  private beginCountdown(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    this.state = "countdown";
    this.lastCountdownIndex = -1;
    this.prevPhase = null;
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
    if (this.latest) this.applyState(this.latest);
  }

  // ---------- Transporte ----------

  /** Async porque resolver el server puede implicar un health check (ver
   *  `shared/server-status.ts`); `connecting` cubre la ventana del await, en la que
   *  `this.transport` todavia es null y una segunda llamada abriria un socket de mas. */
  private async connect(): Promise<void> {
    if (this.transport || this.connecting || !this.room) return;
    this.connecting = true;
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.transport || !url) return;

    const transport = new SocketTransport(url, this.room.code, this.room.me, this.room.players());
    transport.onState((s) => this.onState(s));
    transport.onYou((you) => this.onYou(you));
    transport.onChain((chain) => this.hud.addChain(chain));
    transport.onGameover((r) => this.onGameover(r));
    this.transport = transport;
    void transport.connect();
  }

  private onState(s: TcState): void {
    this.latest = s;
    if (this.state === "playing") this.applyState(s);
  }

  private onYou(you: TcYou): void {
    // Un intento fallido llega como un `tc:you` con el mismo `solved: false` y el
    // ultimo intento en `submitted`: el server no manda un evento aparte porque no
    // hay nada que revelar (decir "fallaste" es todo lo que el cliente puede saber).
    const prev = this.you;
    if (you.phase === "guessing" && !you.solved && you.submitted && you.submitted !== prev?.submitted) {
      SoundEffects.playWrong();
      this.hud.showWrongGuess(you.submitted);
    }
    if (you.phase === "guessing" && you.solved && !prev?.solved) {
      SoundEffects.playCorrect();
    }

    this.you = you;
    if (this.state === "playing" && this.latest) this.applyState(this.latest);
  }

  private applyState(s: TcState): void {
    if (this.prevPhase !== s.phase) {
      if (s.phase === "reveal") SoundEffects.playReveal();
      else if (this.prevPhase !== null) SoundEffects.playPhase();
      this.prevPhase = s.phase;
    }
    this.hud.render(s, this.you, this.room?.me ?? "");
  }

  private onGameover(result: TcGameover): void {
    if (this.state === "over") return;
    this.state = "over";

    const me = this.room?.me ?? "";
    const mine = result.ranking.find((r) => r.nickname === me);
    const place = mine?.place ?? result.ranking.length;
    if (place === 1) SoundEffects.playWin();
    else SoundEffects.playLose();

    // Puntaje placement-based (mayor = mejor), como el resto de los juegos de sala con
    // server. El RoomOverlay toma la pantalla con el resultado; no va al ranking global.
    if (this.room) this.room.reportScore(Math.max(0, result.ranking.length - place));
  }

  /** Puntaje en vivo para el parcial por timeout de Supabase (rara vez se usa: el
   *  server termina la partida antes). Proxy: el total acumulado del jugador. */
  private liveScore(): number {
    if (!this.latest) return 0;
    return this.latest.players.find((p) => p.nickname === this.room?.me)?.total ?? 0;
  }
}
