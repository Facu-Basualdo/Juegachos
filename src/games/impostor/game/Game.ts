import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { COUNTDOWN_LABELS, COUNTDOWN_STEP } from "./constants";
import { Hud } from "./Hud";
import { SocketTransport } from "./SocketTransport";
import { SoundEffects } from "./SoundEffects";
import type { ImGameover, ImPhase, ImState, ImYou } from "./ImpostorTransport";

type State = "message" | "countdown" | "playing" | "over";

/**
 * Impostor: juego SOLO de sala. Supabase maneja lobby / marcador / rejoin (via RoomMode);
 * el estado en-ronda (roles, palabra, pistas, votacion, adivinanza, puntaje) lo maneja el
 * game server autoritativo por socket.io. Sin sala o sin server no se puede jugar: se muestra
 * un cartel (excepcion deliberada a la degradacion del repo, ver CLAUDE.md, igual que Basta).
 */
export class Game {
  private readonly hud: Hud;
  private state: State = "message";

  private readonly room: RoomMode | null;
  private transport: SocketTransport | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;

  private lastCountdownIndex = -1;
  private latest: ImState | null = null;
  private prevPhase: ImPhase | null = null;
  private prevTurn: string | null = null;

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.hud.onClue((word) => this.transport?.sendClue(word));
    this.hud.onVote((target) => this.transport?.sendVote(target));
    this.hud.onGuess((word) => this.transport?.sendGuess(word));

    this.room = initRoomMode("impostor", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    if (!this.room) {
      if (isRoomMode()) {
        this.hud.showMessage(
          "No disponible",
          "Impostor necesita las credenciales de la sala y no estan configuradas.",
        );
      } else {
        this.hud.showMessage(
          "Solo en salas",
          "Impostor se juega con amigos en una sala. Cre&aacute; o un&iacute;te a una para jugar.",
          { label: "Ir a las salas", onClick: () => (window.location.href = "/rooms/") },
        );
      }
      return;
    }

    if (!isGameServerConfigured()) {
      this.hud.showMessage(
        "No disponible",
        "Impostor necesita el game server y no est&aacute; configurado (VITE_GAME_SERVER_URL).",
      );
      return;
    }

    this.hud.showMessage("Impostor", "Esper&aacute; a que empiece la ronda...");
  }

  // ---------- Countdown ----------

  private beginCountdown(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    this.state = "countdown";
    this.lastCountdownIndex = -1;
    this.prevPhase = null;
    this.prevTurn = null;
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
    transport.onYou((you) => this.onYou(you));
    transport.onGameover((r) => this.onGameover(r));
    this.transport = transport;
    void transport.connect();
  }

  private onState(s: ImState): void {
    this.latest = s;
    if (this.state === "playing") this.applyState(s);
  }

  private onYou(you: ImYou): void {
    this.hud.setYou(you);
    // El rol llega junto al reveal; re-renderizamos para que la ficha muestre la palabra.
    if (this.state === "playing" && this.latest) this.hud.render(this.latest, this.room?.me ?? "");
  }

  private applyState(s: ImState): void {
    if (this.prevPhase !== s.phase) {
      this.playPhaseSound(s.phase);
      this.prevPhase = s.phase;
    }
    if (s.phase === "clues" && s.turn === this.room?.me && this.prevTurn !== s.turn) {
      SoundEffects.playYourTurn();
    }
    this.prevTurn = s.phase === "clues" ? s.turn : null;
    this.hud.render(s, this.room?.me ?? "");
  }

  private playPhaseSound(phase: ImPhase): void {
    switch (phase) {
      case "reveal":
        SoundEffects.playReveal();
        break;
      case "voting":
        SoundEffects.playVoteOpen();
        break;
      case "guess":
        SoundEffects.playSting();
        break;
      default:
        break;
    }
  }

  private onGameover(result: ImGameover): void {
    if (this.state === "over") return;
    this.state = "over";

    const me = this.room?.me ?? "";
    const mine = result.ranking.find((r) => r.nickname === me);
    const place = mine?.place ?? result.ranking.length;
    if (place === 1) SoundEffects.playWin();
    else SoundEffects.playLose();

    // Puntaje placement-based (mayor = mejor). El RoomOverlay toma la pantalla con el
    // resultado de la ronda; no va al ranking global (como el resto de los juegos de sala).
    if (this.room) this.room.reportScore(Math.max(0, result.ranking.length - place));
  }

  /** Puntaje en vivo para el parcial por timeout de Supabase (rara vez se usa: el server
   *  termina la partida antes). Proxy: el total acumulado del jugador. */
  private liveScore(): number {
    if (!this.latest) return 0;
    return this.latest.players.find((p) => p.nickname === this.room?.me)?.total ?? 0;
  }
}
