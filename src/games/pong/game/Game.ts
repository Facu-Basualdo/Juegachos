import {
  MAX_DT,
  PADDLE_HEIGHT,
  PADDLE_MARGIN,
  PADDLE_WIDTH,
  PLAYER_SPEED,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./constants";
import { Paddle } from "./Paddle";
import { Ball } from "./Ball";
import { Ai } from "./Ai";
import { Renderer } from "./Renderer";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { PongSocket } from "./PongSocket";
import type { PongMatchState } from "./PongProtocol";

type State = "ready" | "countdown" | "playing" | "dead";

/** Snapshot del server para interpolar entidades. `t` es el reloj de la simulacion
 *  del server (`pg:state.t`) llevado al reloj local con `clockOffset`. */
interface PongSnap {
  t: number;
  bx: number;
  by: number;
  oppY: number;
}

const BEST_KEY = "pong:best";
/** Puntaje que gana el match en sala (primero en llegar). Debe coincidir con el
 *  SCORE_LIMIT del server (`server/src/games/pong.ts`). */
const SCORE_LIMIT = 3;
/** 50 Hz: cada cliente manda su paleta al server. Frecuente a proposito: cuanto
 *  antes llega tu Y, mas fiel es la colision que resuelve el server. */
const BROADCAST_INTERVAL = 0.02;

const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;
/**
 * Interpolacion de entidades: la pelota y la paleta rival se renderizan a partir
 * de los snapshots del server reproducidos con este retraso (ms). Es la tecnica
 * estandar de netcode (estilo Source): absorbe el jitter de red y elimina el
 * stutter/rubber-band de predecir la pelota localmente (nunca "pasa" la paleta y
 * vuelve, porque solo se muestran posiciones reales del server).
 *
 * El retraso se aplica sobre la LINEA DE TIEMPO DEL SERVER (`pg:state.t`, ver
 * `pushSnap`), no sobre la hora de llegada del paquete: por eso NO tiene que
 * cubrir la latencia (esa ya la absorbe el offset de reloj), solo el espaciado
 * entre snapshots (TICK_MS = 16) mas el jitter de entrega. ~3 ticks alcanzan.
 * Antes eran 80 ms sobre la hora de llegada, que ademas de ir mas atrasado metia
 * el jitter directo en la velocidad dibujada de la pelota.
 */
const BALL_INTERP_DELAY = 50;
/** Salto (px) entre snapshots que delata un evento discreto (gol/relanzamiento):
 *  no se interpola a traves de el, se reinicia el buffer en la posicion nueva. */
const BALL_SNAP_DIST = 130;
/** Correccion por snapshot del offset de reloj hacia arriba (fraccion del error).
 *  Lenta a proposito: baja de golpe (un paquete rapido es informacion buena) y sube
 *  de a poco, para no seguirle el jitter a cada paquete lento. */
const CLOCK_DRIFT_RATE = 0.01;

/**
 * PONG. Solo (landing): 1 jugador contra la IA, endless por devoluciones. En
 * sala hay dos modos:
 *  - CON game server (VITE_GAME_SERVER_URL): PvP autoritativo. El server empareja
 *    de a dos (impar = vs IA), corre la fisica y difunde `pg:state`; el cliente
 *    solo controla su paleta y renderiza la pelota/rival interpolando snapshots.
 *  - SIN game server: cada jugador cae a un partido local contra la IA y reporta
 *    su puntaje (degradacion elegante para que la sala no quede trabada).
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly player = new Paddle(PADDLE_MARGIN);
  private readonly aiPaddle = new Paddle(VIEW_WIDTH - PADDLE_WIDTH - PADDLE_MARGIN);
  private readonly ai = new Ai(this.aiPaddle);
  private readonly ball = new Ball();
  private readonly renderer = new Renderer();
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomMode | null;
  private readonly isRoomMode: boolean;
  /** En sala con game server: PvP arbitrado por el server. */
  private readonly serverMode: boolean;
  private socket: PongSocket | null = null;
  /** Guarda contra doble conexion mientras `connectServer()` resuelve la URL. */
  private connecting = false;
  /** Se cayo a un partido local vs IA en esta ronda (server inalcanzable). */
  private serverFellBack = false;
  /** Momento del primer error de conexion del socket (0 = ninguno todavia). */
  private socketErrorAt = 0;

  /** Lado propio segun el server ("p1" izquierda / "p2" derecha); null hasta el 1er estado. */
  private side: "p1" | "p2" | null = null;
  private latest: PongMatchState | null = null;
  private hintFixed = false;

  private broadcastTimer = 0;

  /** Buffer de snapshots del server (pelota + paleta rival) para interpolar con
   *  BALL_INTERP_DELAY de retraso, en la linea de tiempo del server llevada al
   *  reloj local (ver `pushSnap` / `clockOffset`). */
  private snaps: PongSnap[] = [];
  private ballReady = false;
  /** Offset entre el reloj del server y el local: `tLocal = t + clockOffset`. Se
   *  estima con el MINIMO de (llegada - t) visto, que es la muestra menos afectada
   *  por el jitter (el paquete que viajo mas rapido). null hasta el 1er snapshot. */
  private clockOffset: number | null = null;

  private state: State = "ready";
  private score = 0;
  private opponentScore = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lastTime = 0;
  private deadFor = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;

  /** Mouse/touch follow: view-space Y the local paddle centers on, or inactive
   *  until the pointer is first used (keyboard-only players stay unaffected). */
  private pointerActive = false;
  private pointerTargetY = VIEW_HEIGHT / 2;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.showScore(false);
    this.hud.showStart();

    this.room = initRoomMode("pong", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });
    this.isRoomMode = this.room !== null;
    this.serverMode = this.isRoomMode && isGameServerConfigured();

    this.hud.setHintText(
      this.isRoomMode ? "esperando emparejamiento…" : "mouse / flechas / W S para mover",
    );

    this.input = new InputController(container, () => this.onAction());

    // El mouse (y el arrastre tactil) mueve la paleta local: sigue la Y del
    // cursor. El teclado tiene prioridad cuando hay una tecla apretada.
    this.canvas.addEventListener("pointermove", this.onPointerMove);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private onAction(): void {
    switch (this.state) {
      case "ready":
        // En modo server la ronda la arranca RoomMode (onStart) con el roster ya
        // cargado; ignorar el Enter manual evita conectar con un roster parcial.
        if (this.serverMode) return;
        this.beginCountdown();
        break;
      case "dead":
        if (this.room) return;
        if (this.deadFor > 0.6) this.beginCountdown();
        break;
    }
  }

  /** Conecta al game server cuando arranca la ronda (en el constructor la lista
   *  de jugadores todavia no cargo: boot() es async). El server empareja por el
   *  roster y responde con `pg:state`, de donde sale el lado propio.
   *
   *  Async porque resolver el server puede implicar un health check (ver
   *  `shared/server-status.ts`); `connecting` cubre la ventana del await, en la que
   *  `this.socket` todavia es null y una segunda llamada abriria un socket de mas.
   *  Si no responde ninguna URL, el `SERVER_ERROR_GRACE_MS` de siempre cae al
   *  partido local vs IA. */
  private async connectServer(): Promise<void> {
    if (!this.serverMode || this.socket || this.connecting || !this.room) return;
    this.connecting = true;
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.socket || !url) return;
    const socket = new PongSocket(
      url,
      this.room.code,
      this.room.me,
      this.room.players(),
    );
    socket.onState((s) => this.onServerState(s));
    socket.onError(() => {
      if (this.socketErrorAt === 0) this.socketErrorAt = performance.now();
    });
    this.socket = socket;
    void socket.connect();
  }

  private beginCountdown(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    if (this.serverMode) void this.connectServer();
    else if (this.isRoomMode) this.hud.setHintText("mouse / flechas / W S para mover (vs IA)");

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.serverFellBack = false;
    this.socketErrorAt = 0;
    this.player.reset();
    this.aiPaddle.reset();
    this.ball.reset();
    this.snaps.length = 0;
    this.ballReady = false;
    // El offset se re-estima por ronda: el socket se rearma y el server puede haber
    // reiniciado su simTime.
    this.clockOffset = null;
    this.hud.showScore(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.broadcastTimer = 0;

    if (this.serverMode) {
      // El server es duenio de la pelota y el puntaje; solo se sincroniza al
      // ultimo snapshot recibido (o el centro si aun no llego ninguno).
      this.hud.showScoreRoom(this.leftScore(), this.rightScore());
      if (this.latest) this.pushSnap(this.latest);
    } else if (this.isRoomMode) {
      // Sin server: partido local contra la IA (degradacion).
      this.score = 0;
      this.opponentScore = 0;
      this.hud.showScoreRoom(0, 0);
      this.ball.launch(true);
    } else {
      this.score = 0;
      this.opponentScore = 0;
      this.hud.setScore(0);
      this.hud.showScore(true);
      this.ball.launch(true);
    }
    this.hud.hide();
    this.hud.showCountdown(null);
  }

  private die(): void {
    if (this.state === "dead") return;
    this.state = "dead";
    this.deadFor = 0;
    SoundEffects.playLose();
    this.hud.showScore(false);
    if (!this.isRoomMode && this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.hud.showGameOver(this.score, this.best, this.opponentScore, this.isRoomMode);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("pong", this.score);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "playing") {
      if (this.serverMode && !this.serverFellBack) this.updateServer(dt);
      else if (this.isRoomMode) this.updateUnpaired(dt);
      else this.updateSolo(dt);
    } else if (this.state === "countdown") {
      this.updateCountdown(dt);
    } else if (this.state === "dead") {
      this.deadFor += dt;
    }
  }

  /** Moves a local paddle: keyboard direction when held, else follow the mouse.
   *  Last input wins: pressing a key disables mouse-follow until the mouse moves
   *  again, so releasing a key doesn't snap the paddle back to the cursor. */
  private movePlayer(paddle: Paddle, dir: number, dt: number): void {
    if (dir !== 0) {
      paddle.y += dir * PLAYER_SPEED * dt;
      paddle.clamp();
      this.pointerActive = false;
    } else if (this.pointerActive) {
      paddle.y = this.pointerTargetY - PADDLE_HEIGHT / 2;
      paddle.clamp();
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerTargetY = (e.clientY - rect.top) / this.cssScale - this.offsetY;
    this.pointerActive = true;
  };

  private updateSolo(dt: number): void {
    this.movePlayer(this.player, this.input.moveDir, dt);
    this.ai.update(dt, this.ball);
    this.ball.update(dt);
    this.checkCollisions();
  }

  private updateUnpaired(dt: number): void {
    this.movePlayer(this.player, this.input.moveDir, dt);
    this.ai.update(dt, this.ball);
    this.ball.update(dt);
    this.checkCollisionsRoom();
  }

  // ---------- Modo server (PvP autoritativo) ----------

  private onServerState(s: PongMatchState): void {
    const prev = this.latest;
    this.side = s.side;
    this.latest = s;

    if (!this.hintFixed) {
      this.hintFixed = true;
      this.hud.setHintText(
        s.vsAi
          ? "mouse / flechas / W S para mover (vs IA)"
          : s.side === "p1"
            ? "mouse / flechas / W S — sos J1 (izquierda)"
            : "mouse / flechas / W S — sos J2 (derecha)",
      );
    }

    this.score = s.side === "p1" ? s.p1Score : s.p2Score;
    this.opponentScore = s.side === "p1" ? s.p2Score : s.p1Score;

    if (this.state === "playing") {
      this.playSnapSounds(prev, s);
      this.pushSnap(s);
      if (s.phase === "over") this.die();
    }
  }

  /** Sonidos a partir del diff del snapshot autoritativo (el server no manda un
   *  evento por rebote: se infieren del contador de golpes y del puntaje). */
  private playSnapSounds(prev: PongMatchState | null, s: PongMatchState): void {
    if (!prev) return;
    if (s.p1Score !== prev.p1Score || s.p2Score !== prev.p2Score) {
      SoundEffects.playScore();
    } else if (s.ball.hits !== prev.ball.hits) {
      SoundEffects.playHit();
    }
  }

  /**
   * Agrega el snapshot al buffer de interpolacion, fechado con el reloj de la
   * SIMULACION del server (`s.t`, que avanza de a TICK_MS exactos) traido al reloj
   * local con `clockOffset`. Fecharlo con la hora de llegada — como se hacia antes —
   * mete el jitter de entrega en la interpolacion: dos snapshots que llegan pegados
   * dan un `span` de 2 ms para un movimiento de un tick entero, asi que la pelota se
   * dibuja pegando un salto y despues frenando. Ese era el temblor.
   *
   * Ante un salto grande de la pelota (gol/relanzamiento) reinicia el buffer para no
   * interpolar el teleport.
   */
  private pushSnap(s: PongMatchState): void {
    const oppY = s.side === "p1" ? s.p2Y : s.p1Y;
    const now = performance.now();

    let t: number;
    if (typeof s.t === "number") {
      // Estimacion del offset: el minimo (llegada - t) es la muestra que menos
      // jitter comio. Se corrige lento hacia arriba para tolerar la deriva entre
      // relojes sin quedar pegado a un minimo optimista de hace un rato.
      const sample = now - s.t;
      if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample;
      else this.clockOffset += (sample - this.clockOffset) * CLOCK_DRIFT_RATE;
      t = s.t + this.clockOffset;
    } else {
      // Server viejo sin `t` (no redeployado): se cae a la hora de llegada.
      t = now;
    }

    const last = this.snaps[this.snaps.length - 1];
    if (last && Math.hypot(s.ball.x - last.bx, s.ball.y - last.by) > BALL_SNAP_DIST) {
      this.snaps.length = 0;
    }
    // Fuera de orden (el snapshot llego despues que uno mas nuevo): se descarta.
    const tail = this.snaps[this.snaps.length - 1];
    if (tail && t <= tail.t) return;

    this.snaps.push({ t, bx: s.ball.x, by: s.ball.y, oppY });
    // Descarta lo viejo (queda sobrado para interpolar en renderTime = now - delay).
    const cutoff = now - 500;
    while (this.snaps.length > 2 && this.snaps[0].t < cutoff) this.snaps.shift();
    this.ballReady = true;
  }

  /** ~3s de errores de conexion sostenidos sin ningun estado -> se cae a vs IA. */
  private static readonly SERVER_ERROR_GRACE_MS = 3000;

  private updateServer(dt: number): void {
    if (!this.side) {
      // Sin estado todavia. Si el socket viene fallando (namespace inexistente,
      // CORS, URL mala), degradar a un partido local vs IA en vez de congelarse.
      if (this.socketErrorAt > 0 && performance.now() - this.socketErrorAt > Game.SERVER_ERROR_GRACE_MS) {
        this.fallbackToLocalAi();
      }
      return;
    }

    const myPaddle = this.side === "p1" ? this.player : this.aiPaddle;

    // Paleta propia: input local inmediato (no espera al server).
    this.movePlayer(myPaddle, this.input.moveDir, dt);

    // Pelota + paleta rival: interpolacion de snapshots (suave, sin overshoot).
    if (this.ballReady) this.renderFromSnaps();

    // Manda la paleta propia (frecuente, ver BROADCAST_INTERVAL).
    this.broadcastTimer += dt;
    if (this.broadcastTimer >= BROADCAST_INTERVAL) {
      this.broadcastTimer = 0;
      this.socket?.sendPaddle(myPaddle.y);
    }

    this.hud.showScoreRoom(this.leftScore(), this.rightScore());
  }

  /**
   * Ubica la pelota y la paleta rival interpolando el buffer en
   * renderTime = ahora - BALL_INTERP_DELAY. Las dos en la MISMA linea de tiempo,
   * asi el rebote se ve consistente (la pelota pega donde esta el rival dibujado).
   */
  private renderFromSnaps(): void {
    const snaps = this.snaps;
    if (snaps.length === 0) return;
    const rt = performance.now() - BALL_INTERP_DELAY;

    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    if (rt <= a.t) {
      b = a; // render-time anterior al buffer: clamp al mas viejo
    } else if (rt >= b.t) {
      a = b; // buffer agotado (falta red): clamp al mas nuevo
    } else {
      for (let i = snaps.length - 1; i > 0; i--) {
        if (snaps[i - 1].t <= rt && rt <= snaps[i].t) {
          a = snaps[i - 1];
          b = snaps[i];
          break;
        }
      }
    }

    const span = b.t - a.t;
    const f = span > 0 ? (rt - a.t) / span : 0;
    this.ball.x = a.bx + (b.bx - a.bx) * f;
    this.ball.y = a.by + (b.by - a.by) * f;
    const oppPaddle = this.side === "p1" ? this.aiPaddle : this.player;
    oppPaddle.y = a.oppY + (b.oppY - a.oppY) * f;
  }

  /** Degrada la ronda a un partido local contra la IA (server inalcanzable): el
   *  jugador sigue jugando y reporta su puntaje, la sala no queda trabada. */
  private fallbackToLocalAi(): void {
    this.serverFellBack = true;
    this.socket?.dispose();
    this.socket = null;
    this.side = null;
    this.score = 0;
    this.opponentScore = 0;
    this.player.reset();
    this.aiPaddle.reset();
    this.ball.reset();
    this.ball.launch(true);
    this.hud.setHintText("mouse / flechas / W S para mover (vs IA)");
    this.hud.showScoreRoom(0, 0);
  }

  private leftScore(): number {
    return this.side === "p1" ? this.score : this.opponentScore;
  }

  private rightScore(): number {
    return this.side === "p1" ? this.opponentScore : this.score;
  }

  private checkCollisions(): void {
    if (this.ball.left <= 0) { this.die(); return; }

    if (this.ball.right >= VIEW_WIDTH) {
      this.score++;
      this.hud.setScore(this.score);
      SoundEffects.playScore();
      this.ball.launch(true);
      return;
    }

    this.paddleCollisionPlayer();
    this.paddleCollisionAi();
    this.wallBounceSound();
  }

  private checkCollisionsRoom(): void {
    if (this.ball.left <= 0) {
      this.opponentScore++;
      this.hud.showScoreRoom(this.score, this.opponentScore);
      SoundEffects.playScore();
      if (this.score >= SCORE_LIMIT || this.opponentScore >= SCORE_LIMIT) { this.die(); return; }
      this.ball.launch(true);
      return;
    }

    if (this.ball.right >= VIEW_WIDTH) {
      this.score++;
      this.hud.showScoreRoom(this.score, this.opponentScore);
      SoundEffects.playScore();
      if (this.score >= SCORE_LIMIT || this.opponentScore >= SCORE_LIMIT) { this.die(); return; }
      this.ball.launch(false);
      return;
    }

    this.paddleCollisionPlayer();
    this.paddleCollisionAi();
    this.wallBounceSound();
  }

  private paddleCollisionPlayer(): void {
    if (
      this.ball.vx < 0 &&
      this.ball.left <= this.player.right &&
      this.ball.x > this.player.x &&
      this.ball.bottom > this.player.top &&
      this.ball.top < this.player.bottom
    ) {
      this.ball.x = this.player.right + this.ball.radius;
      this.ball.bouncePaddle(this.player);
      SoundEffects.playHit();
    }
  }

  private paddleCollisionAi(): void {
    if (
      this.ball.vx > 0 &&
      this.ball.right >= this.aiPaddle.left &&
      this.ball.x < this.aiPaddle.x + this.aiPaddle.w &&
      this.ball.bottom > this.aiPaddle.top &&
      this.ball.top < this.aiPaddle.bottom
    ) {
      this.ball.x = this.aiPaddle.left - this.ball.radius;
      this.ball.bouncePaddle(this.aiPaddle);
      SoundEffects.playHit();
    }
  }

  private wallBounceSound(): void {
    if (this.ball.top <= 0 || this.ball.bottom >= VIEW_HEIGHT) {
      SoundEffects.playWall();
    }
  }

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) this.start();
    else if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.clip();
    this.renderer.draw(ctx, this.player, this.aiPaddle, this.ball);
    ctx.restore();
  }

  private scale = 1;
  /** CSS pixels per view unit (scale without dpr), for mapping pointer input. */
  private cssScale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    const fit = Math.min(w / VIEW_WIDTH, h / VIEW_HEIGHT);
    this.scale = fit * dpr;
    this.cssScale = fit;
    this.offsetX = (w / fit - VIEW_WIDTH) / 2;
    this.offsetY = (h / fit - VIEW_HEIGHT) / 2;
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.input.dispose();
    this.socket?.dispose();
  }
}
