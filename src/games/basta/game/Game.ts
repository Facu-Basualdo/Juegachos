import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { BastaAudio } from "./BastaAudio";
import { COUNTDOWN_LABELS, COUNTDOWN_STEP } from "./constants";
import { Hud } from "./Hud";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";
import type { BtGameover, BtPhase, BtState } from "./BastaTransport";

type State = "message" | "countdown" | "playing" | "over";

/** Cuanto se espera tras el ultimo tecleo para mandar la hoja al server (anti-spam). */
const FILL_DEBOUNCE_MS = 350;

/**
 * Basta / Tutti Frutti: juego SOLO de sala. Supabase maneja lobby / marcador /
 * rejoin (via RoomMode); el estado en-ronda (letra, respuestas, votacion, puntaje)
 * lo maneja el game server autoritativo por socket.io. Sin sala o sin server no se
 * puede jugar: se muestra un cartel (excepcion deliberada a la degradacion del repo,
 * ver CLAUDE.md, igual que Bomba/Cadena).
 */
export class Game {
  private readonly hud: Hud;
  private state: State = "message";

  private readonly room: RoomMode | null;
  private transport: SocketTransport | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;

  private lastCountdownIndex = -1;
  private latest: BtState | null = null;
  private prevPhase: BtPhase | null = null;
  /** Junto con `prevPhase`: dos letras seguidas entran a `filling` sin cambiar de fase. */
  private prevLetterIndex = -1;
  private fillTimer: number | null = null;

  constructor(root: HTMLElement) {
    // Se baja y decodifica ya: el BASTA tiene que sonar en el instante en que corta la
    // ronda, no medio segundo despues.
    BastaAudio.preload();
    this.hud = new Hud(root);
    this.hud.onFillChange(() => this.scheduleFill());
    this.hud.onBasta(() => this.onBasta());
    this.hud.onVoteSubmit((rejects) => this.transport?.sendVotes(rejects));

    this.room = initRoomMode("basta", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Basta necesita las credenciales de la sala y no estan configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Basta se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Basta necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    this.hud.showMessage("Basta", "Esper&aacute; a que empiece la ronda...");
  }

  // ---------- Countdown ----------

  private beginCountdown(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    this.state = "countdown";
    this.lastCountdownIndex = -1;
    this.prevPhase = null;
    this.prevLetterIndex = -1;
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
    transport.onYou((answers) => this.hud.setAnswers(answers));
    transport.onGameover((r) => this.onGameover(r));
    this.transport = transport;
    void transport.connect();
  }

  private onState(s: BtState): void {
    this.latest = s;
    if (this.state === "playing") this.applyState(s);
  }

  private applyState(s: BtState): void {
    // El render va primero para que el cartel de transicion tape una vista ya armada
    // (si no, el barrido descubre el tablero recien a mitad de camino).
    this.hud.render(s, this.room?.me ?? "");
    if (this.prevPhase !== s.phase || this.prevLetterIndex !== s.letterIndex) {
      this.onPhaseChange(s);
      this.prevPhase = s.phase;
      this.prevLetterIndex = s.letterIndex;
    }
  }

  /** Sonido + cartel de transicion en cada salto de fase (o de letra). */
  private onPhaseChange(s: BtState): void {
    switch (s.phase) {
      case "filling":
        // La primera letra ya viene anunciada por el countdown 3/2/1/YA.
        if (s.letterIndex > 0) {
          this.hud.showTransition(
            `LETRA ${s.letterIndex + 1}`,
            `Ahora con la ${s.letter ?? ""}`,
          );
        }
        break;
      case "grace":
        SoundEffects.playBasta();
        break;
      case "voting":
        SoundEffects.playVoteOpen();
        this.hud.showTransition("A VOTAR", "Tacha las que no valgan y confirma");
        break;
      case "reveal":
        SoundEffects.playReveal();
        this.hud.showTransition("PUNTAJE", "Se cerro la votacion");
        break;
      default:
        break;
    }
  }

  // ---------- Envio ----------

  private scheduleFill(): void {
    if (this.fillTimer !== null) window.clearTimeout(this.fillTimer);
    this.fillTimer = window.setTimeout(() => {
      this.fillTimer = null;
      this.transport?.sendFill(this.hud.getAnswers());
    }, FILL_DEBOUNCE_MS);
  }

  private onBasta(): void {
    if (this.state !== "playing") return;
    // Flush inmediato de la hoja para que el server valide las 7 llenas, luego BASTA.
    this.transport?.sendFill(this.hud.getAnswers());
    this.transport?.sendBasta();
  }

  private onGameover(result: BtGameover): void {
    if (this.state === "over") return;
    this.state = "over";
    if (this.fillTimer !== null) window.clearTimeout(this.fillTimer);

    const me = this.room?.me ?? "";
    const mine = result.ranking.find((r) => r.nickname === me);
    const place = mine?.place ?? result.ranking.length;
    if (place === 1) SoundEffects.playWin();
    else SoundEffects.playLose();

    // Puntaje placement-based (mayor = mejor). El RoomOverlay toma la pantalla con el
    // resultado de la ronda; no va al ranking global (como el resto de los juegos de sala).
    if (this.room) this.room.reportScore(Math.max(0, result.ranking.length - place));
  }

  /** Puntaje en vivo para el parcial por timeout de Supabase (rara vez se usa: el
   *  server termina la partida antes). Proxy: el total acumulado del jugador. */
  private liveScore(): number {
    if (!this.latest) return 0;
    return this.latest.players.find((p) => p.nickname === this.room?.me)?.total ?? 0;
  }
}
