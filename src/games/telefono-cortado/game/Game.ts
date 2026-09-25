import { initRoomMode, isRoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { CONNECT_TIMEOUT_MS, COUNTDOWN_LABELS, COUNTDOWN_STEP } from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
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

  private readonly room: RoomLink | null;
  private transport: SocketTransport | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;
  /** Vence si el server nunca manda un estado (ver `CONNECT_TIMEOUT_MS`). */
  private connectTimer: number | null = null;

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

    this.room =
      initRoomMode("telefono-cortado", {
        getScore: () => this.liveScore(),
        onStart: () => this.beginCountdown(),
      }) ?? devRoom(() => this.beginCountdown());

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
    if (this.state !== "message") return;
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
    // Un F5 con la partida ya terminada recibe el gameover durante el countdown: el
    // puntaje ya se reporto, pero igual se muestra la galeria.
    if (this.state === "countdown") this.state = "playing";
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
    this.armConnectTimeout();
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.transport || !url) return;

    const transport = new SocketTransport(
      url,
      this.room.code,
      this.room.me,
      this.room.players(),
      this.room.round(),
    );
    transport.onState((s) => this.onState(s));
    transport.onYou((you) => this.onYou(you));
    transport.onChain((chain) => this.hud.addChain(chain));
    transport.onGameover((r) => this.onGameover(r));
    transport.onConnection((up) => this.hud.setConnection(up || this.latest === null));
    this.transport = transport;
    void transport.connect();
  }

  /**
   * Sin `roomTimeLimitSec` (el server arbitra las fases), si el server no contesta
   * nunca la ronda de la sala quedaria colgada para siempre: nadie reporta. Pasado el
   * tope sin un solo estado, se avisa y se reporta un cero para que la sala siga.
   */
  private armConnectTimeout(): void {
    if (this.connectTimer !== null) return;
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (this.latest || this.state === "over") return;
      this.state = "over";
      this.hud.showMessage(
        "Sin conexi&oacute;n",
        "No se pudo conectar con el servidor del juego. Esta ronda no suma puntos.",
      );
      this.room?.reportScore(0);
    }, CONNECT_TIMEOUT_MS);
  }

  private onState(s: TcState): void {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.latest = s;
    this.hud.setConnection(true);
    if (this.state === "playing" || this.state === "over") this.applyState(s);
  }

  private onYou(you: TcYou): void {
    // Un intento fallido llega como un `tc:you` con `attempts` mas alto y sin
    // `solved`: el server no manda un evento aparte porque no hay nada que revelar.
    // Solo contra la tarea anterior de la MISMA fase: tras un F5 la primera que llega
    // ya trae los intentos viejos y no tiene que sonar como un fallo nuevo.
    const prev = this.you && this.you.phase === you.phase ? this.you : null;
    if (prev && you.phase === "guessing") {
      if (!you.solved && you.attempts > prev.attempts) {
        SoundEffects.playWrong();
        this.hud.showWrongGuess(you.submitted ?? "", you.close);
      }
      if (you.solved && !prev.solved) SoundEffects.playCorrect();
    }

    this.you = you;
    if ((this.state === "playing" || this.state === "over") && this.latest) this.applyState(this.latest);
  }

  private applyState(s: TcState): void {
    if (this.prevPhase !== s.phase) {
      if (s.phase === "reveal") SoundEffects.playReveal();
      else if (this.prevPhase !== null && s.phase !== "over") SoundEffects.playPhase();
      this.prevPhase = s.phase;
    }
    // La tarea de otra fase no vale para esta: se pinta "cargando" hasta que llegue
    // la que corresponde (el server la manda antes del estado, pero no se asume).
    const you = this.you && this.you.phase === s.phase ? this.you : null;
    this.hud.render(s, you, this.room?.me ?? "");
  }

  private onGameover(result: TcGameover): void {
    if (this.state === "over") return;
    this.state = "over";

    const me = this.room?.me ?? "";
    const mine = result.ranking.find((r) => r.nickname === me);
    // El que no estaba sentado (entro tarde) mira y no suma.
    if (mine) {
      if (mine.place === 1) SoundEffects.playWin();
      else SoundEffects.playLose();
    }
    const place = mine?.place ?? result.ranking.length;

    // Puntaje placement-based (mayor = mejor), como el resto de los juegos de sala con
    // server. El RoomOverlay toma la pantalla con el resultado.
    // El puesto va aparte al ranking global, que en este juego cuenta victorias
    // (el que no figura en el ranking, p.ej. entro tarde, no suma).
    if (this.room) {
      this.room.reportScore(
        Math.max(0, result.ranking.length - place),
        mine ? { place, players: result.ranking.length } : { ranked: false },
      );
    }
  }

  /** Puntaje en vivo para el parcial (si el jugador se va antes del gameover): el
   *  placement segun los totales de ahora, en la misma escala que el reporte final.
   *  Con el total crudo, un parcial de 250 le ganaria a un final de 3. */
  private liveScore(): number {
    const players = this.latest?.players ?? [];
    const mine = players.find((p) => p.nickname === this.room?.me);
    if (!mine) return 0;
    const place = 1 + players.filter((p) => p.total > mine.total).length;
    return Math.max(0, players.length - place);
  }
}
