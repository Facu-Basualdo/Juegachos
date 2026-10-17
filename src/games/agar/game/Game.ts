import { getNickname, sanitizeNickname, setNickname } from "../../../shared/nickname";
import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { AgarSocket } from "./AgarSocket";
import type { AgClientConfig, AgDead, AgInit, AgJoin, AgPlayerInfo, AgSnap, AgTop } from "./AgarProtocol";
import {
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  INPUT_INTERVAL,
  INPUT_MIN_GAP,
  INPUT_TURN_EPS,
  INTERP_DELAY,
  MAX_DT,
  ZOOM_RATE,
} from "./constants";
import { Hud, type TopRow } from "./Hud";
import { InputController } from "./InputController";
import { Predictor } from "./Predictor";
import { Renderer, type Camera, type CellView, type PelletView } from "./Renderer";
import { SoundEffects } from "./SoundEffects";
import { Timeline } from "./Timeline";

/**
 * - `connecting`: esperando el `ag:init` (o, en sala, que arranque la ronda).
 * - `ready`: tarjeta de inicio, mirando la arena de fondo.
 * - `countdown`: 3 / 2 / 1 / YA; al terminar se pide aparecer.
 * - `spawning`: pedido el `ag:spawn`, esperando el `ag:spawned`.
 * - `playing`: celula viva.
 * - `dead`: tarjeta de muerte (publica) o mirando la ronda (sala).
 * - `over`: sala terminada (alguien llego a la meta).
 */
type State = "connecting" | "ready" | "countdown" | "spawning" | "playing" | "dead" | "over";

interface PlayerMeta {
  name: string;
  color: number;
  bot: boolean;
}

interface Pellet extends PelletView {
  /** Snapshot que la trajo: una baja vieja que sale de la cola no puede borrar un alta nueva. */
  seq: number;
}

/** Sin `ag:init` despues de esto (en sala) se da el server por perdido y se reporta. */
const SERVER_GRACE_MS = 12_000;
/** En sala: desconectado mas de esto, se reporta lo que habia y se deja la ronda seguir. */
const ROOM_GIVE_UP_MS = 20_000;

/**
 * Agar: el server (namespace `/agar`) simula todo; este cliente manda su input,
 * predice sus propias celulas e interpola a las demas. Ver
 * `server/src/games/agar-arena.ts`.
 *
 * Tres relojes conviven en pantalla, y es a proposito:
 *  - Las celulas PROPIAS van en el presente predicho (`Predictor`): el control
 *    responde al toque aunque el server este a 150 ms.
 *  - Las AJENAS van INTERP_DELAY en el pasado (`Timeline`), interpoladas entre dos
 *    snapshots reales: se mueven suave aunque los snapshots lleguen desparejos.
 *  - La COMIDA que desaparece se borra cuando la interpolacion llega al snapshot que
 *    lo informo: borrarla al llegar la hacia desaparecer antes de que la celula ajena
 *    (dibujada en el pasado) llegara a tocarla.
 *
 * Dos modos con el mismo juego: la arena PUBLICA (la de la landing: entras con un
 * nombre y reapareces al morir) y la de SALA (una vida por ronda, sin reloj; ver
 * `room` en `server/src/games/agar-config.ts`).
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly renderer = new Renderer();
  private readonly input: InputController;
  private readonly timeline = new Timeline();
  private readonly predictor = new Predictor();
  private readonly room: RoomMode | null;

  private socket: AgarSocket | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;
  private connectStartedAt = 0;
  /** Desde cuando esta caida la conexion (0 = conectado). */
  private offlineSince = 0;

  private cfg: AgClientConfig | null = null;
  private me = -1;
  private readonly players = new Map<number, PlayerMeta>();

  private state: State = "connecting";
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  /** Hora del ultimo cuadro (la de requestAnimationFrame). */
  private lastTime = 0;
  /** Masa maxima de la vida en curso (lo que se reporta y va al ranking). */
  private peak = 0;
  /** En sala, ya se reporto el puntaje de esta ronda. */
  private reported = false;
  /** El init dijo que se puede aparecer (en sala, false si ya se uso la vida). */
  private canSpawn = false;

  /** Comida conocida (el server manda altas y bajas en cada snapshot). */
  private readonly pellets = new Map<number, Pellet>();
  /** Bajas de comida esperando a que la interpolacion llegue a su snapshot. */
  private pendingDrops: { t: number; seq: number; ids: number[] }[] = [];
  private snapSeq = 0;
  /** Centro de la camara del espectador que manda el server. */
  private spectatorAt: { x: number; y: number } | null = null;

  private camera: Camera = { x: 0, y: 0, viewH: 1000 };

  private inputSeq = 0;
  private inputTimer = 0;

  private cssW = 0;
  private cssH = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.hud = new Hud(container);
    this.input = new InputController(container);

    this.resize();
    window.addEventListener("resize", this.resize);
    this.hud.onPlay((name) => this.onPlay(name));

    // Para medir en local (ver README): expone el juego a la consola / Playwright.
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __agar: Game }).__agar = this;

    this.room = initRoomMode("agar", {
      getScore: () => this.peak,
      onStart: () => this.onRoomStart(),
      // Muerto, se sigue mirando la arena en vez de la espera generica de la sala.
      onReportedWaiting: () => true,
    });
    this.hud.setRoom(this.room !== null);

    if (!this.room && isRoomMode()) {
      this.hud.showMessage("No disponible", "Las salas necesitan credenciales que no estan configuradas.");
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "Agar necesita el game server y no esta configurado (VITE_GAME_SERVER_URL).");
      return;
    }

    if (this.room) {
      this.hud.showMessage("Agar", "Espera a que empiece la ronda...");
    } else {
      this.hud.showMessage("Agar", "Conectando a la placa...");
      void this.connect();
    }

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ---------------------------------------------------------------- red

  /**
   * En la publica se conecta al cargar (la arena se ve de fondo en la tarjeta de
   * inicio); en sala, al arrancar la ronda, cuando el roster y la ronda ya cargaron.
   */
  private async connect(): Promise<void> {
    if (this.socket || this.connecting) return;
    this.connecting = true;
    this.connectStartedAt = performance.now();
    const url = await resolveGameServerUrl();
    this.connecting = false;
    if (this.socket) return;
    if (!url) {
      this.giveUp();
      return;
    }
    const socket = new AgarSocket(url, () => this.joinMessage());
    socket.onInit((init) => this.onInit(init));
    socket.onSnap((snap) => this.onSnap(snap));
    socket.onPlayers((msg) => this.onPlayers(msg));
    socket.onTop((top) => this.onTop(top));
    socket.onSpawned(() => this.startPlaying());
    socket.onDead((dead) => this.onDead(dead));
    socket.onOver((msg) => this.onOver(msg.winner, msg.mass));
    socket.onStatus((up) => this.onStatus(up));
    this.socket = socket;
    await socket.connect();
  }

  private joinMessage(): AgJoin {
    const aspect = this.aspect();
    if (this.room) {
      return { mode: "room", aspect, code: this.room.code, round: this.room.round(), nickname: this.room.me };
    }
    return { mode: "public", aspect };
  }

  private onStatus(up: boolean): void {
    if (up) {
      this.offlineSince = 0;
      this.hud.setBanner(null);
      return;
    }
    if (this.offlineSince === 0) this.offlineSince = performance.now();
    if (this.state !== "connecting") this.hud.setBanner("reconectando...");
  }

  /**
   * El server no contesta. En sala se reporta lo que habia: sin puntaje de este
   * jugador la ronda lo esperaria para siempre (el cierre anticipado solo cubre a los
   * desconectados de la SALA, y este sigue conectado a Supabase mirando un cartel).
   */
  private giveUp(): void {
    this.hud.showMessage("Sin conexion", "No se pudo conectar al game server.");
    this.hud.showPlaying(false);
    if (this.room && !this.reported) {
      this.reported = true;
      this.room.reportScore(Math.round(this.peak), { ranked: false });
    }
  }

  private onInit(init: AgInit): void {
    this.cfg = init.cfg;
    this.me = init.me;
    this.canSpawn = init.canSpawn;
    this.renderer.setConfig(init.cfg);
    this.predictor.setConfig(init.cfg);
    this.players.clear();
    this.onPlayers({ add: init.players });
    // Arena nueva o reconexion: el server vuelve a mandar toda la comida, y la
    // numeracion de inputs arranca de cero del otro lado.
    this.pellets.clear();
    this.pendingDrops = [];
    this.timeline.reset();
    this.predictor.reset();
    this.inputSeq = 0;

    if (init.alive) {
      this.startPlaying();
      return;
    }
    if (init.phase === "over") {
      this.toOver(null);
      return;
    }
    if (this.room) {
      // La vida de la sala ya se uso (F5 despues de morir): a mirar.
      if (!init.canSpawn) this.toSpectating();
      // Si no, el countdown que arranco `onRoomStart` termina y pide aparecer.
      return;
    }
    if (this.state === "connecting" || this.state === "playing" || this.state === "spawning") {
      this.toReady();
    }
  }

  private onSnap(snap: AgSnap): void {
    const now = performance.now();
    const t = this.timeline.push(snap, now);
    const seq = ++this.snapSeq;

    const add = snap.pa;
    if (add) {
      for (let i = 0; i < add.length; i += 4) {
        this.pellets.set(add[i], { x: add[i + 1], y: add[i + 2], color: add[i + 3], seq });
      }
    }
    if (snap.pd) this.pendingDrops.push({ t, seq, ids: snap.pd });
    this.spectatorAt = snap.cx !== undefined && snap.cy !== undefined ? { x: snap.cx, y: snap.cy } : null;

    if (this.state === "playing") {
      const own: [number, number, number, number][] = [];
      const c = snap.c;
      for (let i = 0; i < c.length; i += 5) if (c[i + 1] === this.me) own.push([c[i], c[i + 2], c[i + 3], c[i + 4]]);
      this.predictor.reconcile(own, snap.n, snap.a, this.lastTime);
      const mass = this.predictor.center().mass;
      if (mass > this.peak) this.peak = mass;
    }
  }

  private onPlayers(msg: { add?: AgPlayerInfo[]; del?: number[] }): void {
    for (const [id, name, color, bot] of msg.add ?? []) this.players.set(id, { name, color, bot: bot === 1 });
    for (const id of msg.del ?? []) this.players.delete(id);
  }

  private onTop(top: AgTop): void {
    const rows: TopRow[] = top.top.map(([id, mass]) => {
      const meta = this.players.get(id);
      return {
        name: meta?.name ?? "?",
        mass,
        stain: Renderer.stain(meta?.color ?? 0),
        mine: id === this.me,
      };
    });
    this.hud.setTop(rows, top.rank, top.alive);
  }

  /** Aplica las bajas de comida cuyo snapshot ya alcanzo la interpolacion. */
  private flushDrops(until: number): void {
    while (this.pendingDrops.length > 0 && this.pendingDrops[0].t <= until) {
      const { seq, ids } = this.pendingDrops.shift()!;
      for (const id of ids) {
        const p = this.pellets.get(id);
        if (p && p.seq < seq) this.pellets.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- flujo

  private toReady(): void {
    this.state = "ready";
    this.hud.showPlaying(false);
    this.hud.showStart(getNickname() ?? "");
  }

  /** Arena publica: "Jugar" (o Enter, o un toque) en la tarjeta de inicio o de muerte. */
  private onPlay(raw: string): void {
    if (this.room || (this.state !== "ready" && this.state !== "dead")) return;
    const name = sanitizeNickname(raw);
    // Se guarda como el nombre del sitio: es el mismo con el que va al ranking global.
    if (name) setNickname(name);
    this.beginCountdown();
  }

  /** Sala: RoomMode lo dispara al pasar la ronda a "playing" (todos juntos). */
  private onRoomStart(): void {
    if (this.state !== "connecting") return;
    void this.connect();
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hideCard();
    this.hud.setBanner(null);
  }

  private updateCountdown(dt: number, now: number): void {
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) {
      this.hud.showCountdown(null);
      this.requestSpawn();
      return;
    }
    if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
    if (this.room && !this.cfg && this.connectStartedAt > 0 && now - this.connectStartedAt > SERVER_GRACE_MS) {
      this.giveUp();
    }
  }

  /** Al terminar la cuenta. En sala puede que el `ag:init` todavia no haya llegado. */
  private requestSpawn(): void {
    if (!this.socket?.connected || !this.cfg) return; // se reintenta en el proximo cuadro
    if (!this.canSpawn) {
      this.toSpectating();
      return;
    }
    this.state = "spawning";
    this.socket.spawn(getNickname() ?? "");
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.hideCard();
    this.hud.showCountdown(null);
    this.hud.showPlaying(true);
    this.predictor.reset();
    this.inputTimer = INPUT_INTERVAL;
    this.input.enabled = true;
    this.peak = this.cfg?.startMass ?? 0;
  }

  private onDead(dead: AgDead): void {
    this.state = "dead";
    this.input.enabled = false;
    this.predictor.reset();
    this.hud.showPlaying(false);
    SoundEffects.playEaten();
    this.peak = Math.max(this.peak, dead.peak);
    const title = dead.reason === "afk" ? "Te disolviste" : `Te comio ${dead.by ?? "alguien"}`;
    const secs = Math.round(dead.ms / 1000);
    const stats = `masa maxima ${dead.peak}  ·  ${secs} s`;

    if (this.room) {
      this.report(dead.peak);
      // Una sola vida: se sigue mirando la arena, con el resultado arriba.
      this.toSpectating(`${title}. Masa maxima ${dead.peak}. Mirando la ronda...`);
      return;
    }
    this.hud.showDead(title, stats, true, getNickname() ?? "");
    this.hud.showRanking(dead.peak);
  }

  /** Sala: alguien llego a la meta. El que sigue vivo reporta lo suyo. */
  private onOver(winner: string, mass: number): void {
    if (this.state === "playing") this.report(Math.round(this.peak));
    this.toOver(`Gano ${winner} con ${mass} de masa`);
  }

  private toOver(banner: string | null): void {
    this.state = "over";
    this.input.enabled = false;
    this.predictor.reset();
    this.hud.showPlaying(false);
    this.hud.hideCard();
    this.hud.setBanner(banner ?? "La ronda termino");
  }

  private toSpectating(banner = "Ya usaste tu vida de esta ronda. Mirando..."): void {
    this.state = "dead";
    this.input.enabled = false;
    this.hud.showPlaying(false);
    this.hud.hideCard();
    this.hud.setBanner(banner);
  }

  private report(score: number): void {
    if (!this.room || this.reported) return;
    this.reported = true;
    this.room.reportScore(score);
  }

  // ---------------------------------------------------------------- bucle

  private tick = (now: number): void => {
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    const dt = Math.min(rawDt, MAX_DT);
    this.lastTime = now;

    if (this.state === "countdown") this.updateCountdown(dt, now);
    else if (this.state === "spawning" && this.countdownTime > 0) this.requestSpawnRetry(dt);
    if (this.state === "playing") {
      // Primero se avanza con el input vigente y despues se manda el nuevo, fechado en
      // este cuadro: exactamente los tramos que reproduce `reconcile`. Con el tiempo
      // REAL, sin el tope: el server movio la celula ese tiempo entero.
      this.predictor.advance(rawDt);
      this.sendInput(dt, now);
      this.hud.setMass(this.predictor.center().mass);
    }
    if (this.room && !this.reported && this.offlineSince > 0 && now - this.offlineSince > ROOM_GIVE_UP_MS) {
      this.giveUp();
    }
    this.flushDrops(now - INTERP_DELAY);
    this.updateCamera(dt);
    this.renderer.draw(this.ctx, this.cssW, this.cssH, this.camera, this.pellets, this.cellViews(now), now / 1000);

    requestAnimationFrame(this.tick);
  };

  /** Si el `ag:spawned` no vuelve (se perdio en un corte), se pide de nuevo. */
  private spawnWait = 0;
  private requestSpawnRetry(dt: number): void {
    this.spawnWait += dt;
    if (this.spawnWait < 2) return;
    this.spawnWait = 0;
    this.requestSpawn();
  }

  /** Vector de movimiento (modulo <= 1) desde la celula propia, que es el centro de la pantalla. */
  private moveVector(): { x: number; y: number } {
    const stick = this.input.stick;
    if (stick) return stick;
    const mouse = this.input.mouse;
    if (!mouse) return { x: 0, y: 0 };
    const dx = mouse.x - this.cssW / 2;
    const dy = mouse.y - this.cssH / 2;
    const len = Math.hypot(dx, dy);
    if (len < 1) return { x: 0, y: 0 };
    // A toda velocidad con el mouse a mas de un radio de distancia; mas cerca, frena.
    const full = Math.max(40, this.myRadius() * (this.cssH / this.camera.viewH));
    const mag = Math.min(1, len / full);
    return { x: (dx / len) * mag, y: (dy / len) * mag };
  }

  private sendInput(dt: number, now: number): void {
    this.inputTimer += dt;
    const v = this.moveVector();
    const dx = Math.round(v.x * 1000) / 1000;
    const dy = Math.round(v.y * 1000) / 1000;
    const act = this.input.consumeActions();
    const sent = this.predictor.dir;
    const turned = Math.abs(dx - sent.x) + Math.abs(dy - sent.y) > INPUT_TURN_EPS;
    if (act === 0 && this.inputTimer < INPUT_INTERVAL && !(turned && this.inputTimer >= INPUT_MIN_GAP)) return;
    this.inputTimer = 0;
    const n = ++this.inputSeq;
    // Fechado con el cuadro, no con performance.now(): la prediccion avanza por
    // cuadros y el replay tiene que cortar los tramos en los mismos instantes.
    this.predictor.recordInput(n, now, dx, dy);
    this.socket?.sendInput([n, Math.round(now * 10) / 10, dx, dy, act]);
  }

  // ---------------------------------------------------------------- vista

  private radiusOf(mass: number): number {
    return this.cfg ? this.cfg.radiusK * Math.sqrt(mass) : 0;
  }

  private myRadius(): number {
    return this.radiusOf(this.predictor.center().mass);
  }

  private updateCamera(dt: number): void {
    const cfg = this.cfg;
    if (!cfg) return;
    const k = 1 - Math.exp(-ZOOM_RATE * dt);
    let viewH: number;
    if (this.state === "playing" && this.predictor.alive) {
      const c = this.predictor.center();
      const r0 = this.radiusOf(cfg.startMass);
      viewH = cfg.viewBase * Math.pow(Math.max(this.radiusOf(c.mass), r0) / r0, cfg.viewExp);
      // Sobre la celula propia, sin suavizar: el mouse se mide desde el centro de la
      // pantalla, que tiene que ser la celula.
      this.camera.x = c.x;
      this.camera.y = c.y;
    } else {
      const at = this.spectatorAt ?? { x: cfg.mapSize / 2, y: cfg.mapSize / 2 };
      viewH = cfg.spectatorView;
      this.camera.x += (at.x - this.camera.x) * k;
      this.camera.y += (at.y - this.camera.y) * k;
    }
    // El zoom se suaviza: comer de golpe no puede pegar un salto de camara.
    this.camera.viewH += (viewH - this.camera.viewH) * k;
  }

  private cellViews(now: number): CellView[] {
    const views: CellView[] = [];
    if (!this.cfg) return views;
    const predicted = this.state === "playing";
    this.timeline.sample(now - INTERP_DELAY, (id, cell) => {
      // Las propias salen del predictor, no del pasado interpolado.
      if (predicted && cell.owner === this.me) return;
      const meta = this.players.get(cell.owner);
      views.push({
        id,
        x: cell.x,
        y: cell.y,
        r: this.radiusOf(cell.mass),
        color: meta?.color ?? 0,
        name: meta?.name ?? "",
        mine: cell.owner === this.me,
      });
    });
    if (predicted) {
      const meta = this.players.get(this.me);
      for (const [id, c] of this.predictor.cells) {
        views.push({
          id,
          x: c.x + c.visX,
          y: c.y + c.visY,
          r: this.radiusOf(c.mass),
          color: meta?.color ?? 0,
          name: meta?.name ?? "",
          mine: true,
        });
      }
    }
    return views;
  }

  private aspect(): number {
    return this.cssH > 0 ? this.cssW / this.cssH : 16 / 9;
  }

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.canvas.width = Math.floor(this.cssW * dpr);
    this.canvas.height = Math.floor(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.socket?.sendView(this.aspect());
  };
}
