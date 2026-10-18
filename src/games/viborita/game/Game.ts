import { getNickname, sanitizeNickname, setNickname } from "../../../shared/nickname";
import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { ViboritaSocket } from "./ViboritaSocket";
import type { VbClientConfig, VbDead, VbInit, VbJoin, VbPlayerInfo, VbSnap, VbTop } from "./ViboritaProtocol";
import {
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  INPUT_INTERVAL,
  INPUT_MIN_GAP,
  INPUT_TURN_EPS,
  INTERP_MARGIN_MS,
  INTERP_SPACINGS,
  MAX_DT,
  TRAIL_FORGET_MS,
  VIS_FADE_LEN,
  ZOOM_RATE,
} from "./constants";
import { Hud, type TopRow } from "./Hud";
import { InputController } from "./InputController";
import { bodyLengthOf, radiusOf, viewHeightOf, wrapAngle } from "./motion";
import { Predictor } from "./Predictor";
import { Renderer, type Camera, type PelletView, type SnakeView } from "./Renderer";
import { SoundEffects } from "./SoundEffects";
import { Timeline } from "./Timeline";
import { Trail } from "./Trail";

/**
 * - `connecting`: esperando el `vb:init` (o, en sala, que arranque la ronda).
 * - `ready`: tarjeta de inicio, mirando la arena de fondo.
 * - `countdown`: 3 / 2 / 1 / YA; al terminar se pide aparecer.
 * - `spawning`: pedido el `vb:spawn`, esperando el `vb:spawned`.
 * - `playing`: viborita viva.
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

/** Sin `vb:init` despues de esto (en sala) se da el server por perdido y se reporta. */
const SERVER_GRACE_MS = 12_000;
/** En sala: desconectado mas de esto, se reporta lo que habia y se deja la ronda seguir. */
const ROOM_GIVE_UP_MS = 20_000;

/**
 * Viborita (slither.io): el server (namespace `/viborita`) simula todo; este cliente
 * manda su input, predice su propia viborita e interpola a las demas. Ver
 * `server/src/games/viborita-arena.ts`.
 *
 * Tres relojes conviven en pantalla, y es a proposito:
 *  - La viborita PROPIA va en el presente predicho (`Predictor`): gira al toque aunque
 *    el server este a 150 ms.
 *  - Las AJENAS van unos 60 ms en el pasado (`Timeline`): la cabeza interpolada entre
 *    dos snapshots reales y el cuerpo armado con su estela (`Trail`) hasta ese mismo
 *    instante.
 *  - La COMIDA que desaparece se borra cuando la interpolacion llega al snapshot que
 *    lo informo, no al llegar.
 *
 * Dos modos con el mismo juego: la arena PUBLICA (entras con un nombre y reapareces
 * al morir) y la de SALA (una vida por ronda, sin reloj; ver `room` en
 * `server/src/games/viborita-config.ts`).
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
  private readonly touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  private socket: ViboritaSocket | null = null;
  /** Guarda contra doble conexion mientras `connect()` resuelve la URL. */
  private connecting = false;
  private connectStartedAt = 0;
  /** Desde cuando esta caida la conexion (0 = conectado). */
  private offlineSince = 0;

  private cfg: VbClientConfig | null = null;
  private me = -1;
  private readonly players = new Map<number, PlayerMeta>();
  /** Estela (= cuerpo) de cada viborita ajena, por id de viborita. */
  private readonly trails = new Map<number, Trail>();

  private state: State = "connecting";
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  /** Hora del ultimo cuadro (la de requestAnimationFrame). */
  private lastTime = 0;
  /** Largo maximo de la vida en curso (lo que se reporta y va al ranking). */
  private peak = 0;
  /** En sala, ya se reporto el puntaje de esta ronda. */
  private reported = false;
  /** El init dijo que se puede aparecer (en sala, false si ya se uso la vida). */
  private canSpawn = false;
  private wasBoosting = false;

  /** Comida conocida (el server manda altas y bajas en cada snapshot). */
  private readonly pellets = new Map<number, Pellet>();
  /** Bajas de comida esperando a que la interpolacion llegue a su snapshot. */
  private pendingDrops: { t: number; seq: number; ids: number[] }[] = [];
  private snapSeq = 0;
  /** Centro de la camara del espectador que manda el server. */
  private spectatorAt: { x: number; y: number } | null = null;

  private camera: Camera = { x: 0, y: 0, viewH: 1000 };
  /** Retraso de interpolacion de las demas (ms), segun la cadencia de snapshots del server. */
  private interpDelay = 110;
  private readonly bodyBuf: number[] = [];

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
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __vb: Game }).__vb = this;

    this.room = initRoomMode("viborita", {
      getScore: () => this.peak,
      onStart: () => this.onRoomStart(),
      // Muerto, se sigue mirando la arena en vez de la espera generica de la sala.
      onReportedWaiting: () => true,
    });
    this.hud.setRoom(this.room !== null);

    if (!this.room && isRoomMode()) {
      this.hud.showMessage("No disponible", "Las salas necesitan credenciales que no están configuradas.");
      return;
    }
    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "Viborita necesita el game server y no está configurado (VITE_GAME_SERVER_URL).");
      return;
    }

    if (this.room) {
      this.hud.showMessage("Viborita", "Esperá a que empiece la ronda...");
    } else {
      this.hud.showMessage("Viborita", "Conectando...");
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
    const socket = new ViboritaSocket(url, () => this.joinMessage());
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

  private joinMessage(): VbJoin {
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
    if (this.state !== "connecting") this.hud.setBanner("Reconectando...");
  }

  /**
   * El server no contesta. En sala se reporta lo que habia: sin puntaje de este
   * jugador la ronda lo esperaria para siempre.
   */
  private giveUp(): void {
    this.hud.showMessage("Sin conexión", "No se pudo conectar al game server.");
    this.hud.showPlaying(false);
    if (this.room && !this.reported) {
      this.reported = true;
      this.room.reportScore(Math.round(this.peak), { ranked: false });
    }
  }

  private onInit(init: VbInit): void {
    this.cfg = init.cfg;
    this.me = init.me;
    this.canSpawn = init.canSpawn;
    this.renderer.setConfig(init.cfg);
    this.predictor.setConfig(init.cfg);
    this.interpDelay = (INTERP_SPACINGS * 1000) / init.cfg.snapshotHz + INTERP_MARGIN_MS;
    this.players.clear();
    this.onPlayers({ add: init.players });
    // Arena nueva o reconexion: el server vuelve a mandar toda la comida y todos los
    // cuerpos, y la numeracion de inputs arranca de cero del otro lado.
    this.pellets.clear();
    this.pendingDrops = [];
    this.trails.clear();
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
      return;
    }
    if (this.state === "connecting" || this.state === "playing" || this.state === "spawning") {
      this.toReady();
    }
  }

  private onSnap(snap: VbSnap): void {
    const now = performance.now();
    const t = this.timeline.push(snap, now);
    const seq = ++this.snapSeq;

    const add = snap.pa;
    if (add) {
      for (let i = 0; i < add.length; i += 5) {
        this.pellets.set(add[i], { x: add[i + 1], y: add[i + 2], color: add[i + 3], mass: add[i + 4] / 10, seq });
      }
    }
    if (snap.pd) this.pendingDrops.push({ t: t ?? now, seq, ids: snap.pd });
    this.spectatorAt = snap.cx !== undefined && snap.cy !== undefined ? { x: snap.cx, y: snap.cy } : null;
    if (t === null || !this.cfg) return; // fuera de orden: las estelas no retroceden

    // Duenio de cada viborita del snapshot (para saber cual es la propia).
    const owners = new Map<number, number>();
    const s = snap.s;
    for (let i = 0; i < s.length; i += 7) owners.set(s[i], s[i + 1]);

    // Cuerpos enteros de las que este cliente recien empieza a ver.
    const k = snap.k;
    if (k) {
      for (let i = 0; i < k.length; ) {
        const sid = k[i];
        const count = k[i + 1];
        const pts = k.slice(i + 2, i + 2 + count * 2);
        i += 2 + count * 2;
        if (owners.get(sid) === this.me) {
          this.predictor.seed(sid, pts, now);
        } else {
          const trail = this.trails.get(sid) ?? new Trail();
          trail.seed(pts, t);
          this.trails.set(sid, trail);
        }
      }
    }

    for (let i = 0; i < s.length; i += 7) {
      const sid = s[i];
      const owner = s[i + 1];
      const x = s[i + 2];
      const y = s[i + 3];
      const mass = s[i + 5] / 10;
      if (owner === this.me && this.state === "playing") {
        this.predictor.reconcile(sid, x, y, s[i + 4] / 1000, mass, snap.n, snap.a, this.lastTime);
        if (mass > this.peak) this.peak = mass;
        continue;
      }
      const trail = this.trails.get(sid);
      if (!trail) continue; // sin cuerpo sembrado todavia
      trail.push(t, x, y);
      trail.lastSeen = now;
      trail.trim(bodyLengthOf(this.cfg, mass) + 200);
    }
    for (const [sid, trail] of this.trails) if (trail.lastSeen < now - TRAIL_FORGET_MS && trail.lastSeen > 0) this.trails.delete(sid);
  }

  private onPlayers(msg: { add?: VbPlayerInfo[]; del?: number[] }): void {
    for (const [id, name, color, bot] of msg.add ?? []) this.players.set(id, { name, color, bot: bot === 1 });
    for (const id of msg.del ?? []) this.players.delete(id);
  }

  private onTop(top: VbTop): void {
    const rows: TopRow[] = top.top.map(([id, mass]) => {
      const meta = this.players.get(id);
      return { name: meta?.name ?? "?", mass, color: Renderer.color(meta?.color ?? 0), mine: id === this.me };
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

  /** Al terminar la cuenta. En sala puede que el `vb:init` todavia no haya llegado. */
  private requestSpawn(): void {
    if (!this.socket?.connected || !this.cfg) return; // se reintenta en el proximo cuadro
    if (!this.canSpawn) {
      this.toSpectating();
      return;
    }
    this.state = "spawning";
    this.spawnWait = 0;
    this.socket.spawn(getNickname() ?? "");
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.hideCard();
    this.hud.showCountdown(null);
    this.hud.showPlaying(true);
    this.input.setTouchUi(this.touch);
    this.inputTimer = INPUT_INTERVAL;
    this.input.enabled = true;
    this.peak = this.cfg?.startMass ?? 0;
  }

  private stopPlaying(): void {
    this.input.enabled = false;
    this.input.setTouchUi(false);
    this.predictor.reset();
    this.hud.showPlaying(false);
  }

  private onDead(dead: VbDead): void {
    this.state = "dead";
    this.stopPlaying();
    SoundEffects.playCrash();
    this.peak = Math.max(this.peak, dead.peak);
    const title =
      dead.reason === "crash" ? `Chocaste con ${dead.by ?? "alguien"}` : dead.reason === "wall" ? "Te diste contra el borde" : "Te quedaste quieta";
    const stats = `Largo máximo ${dead.peak}  ·  ${Math.round(dead.ms / 1000)} s`;

    if (this.room) {
      this.report(dead.peak);
      // Una sola vida: se sigue mirando la arena, con el resultado arriba.
      this.toSpectating(`${title}. Largo máximo ${dead.peak}. Mirando la ronda...`);
      return;
    }
    // Sin nombre guardado la vida no entra al ranking (no hay a nombre de quien).
    const hint = getNickname() ? "" : "  ·  Poné tu nombre para el ranking";
    this.hud.showDead(title, stats + hint, true, getNickname() ?? "");
    this.hud.showRanking(dead.peak);
  }

  /** Sala: alguien llego a la meta. La que sigue viva reporta lo suyo. */
  private onOver(winner: string, mass: number): void {
    if (this.state === "playing") this.report(Math.round(this.peak));
    this.toOver(`Ganó ${winner} con ${mass} de largo`);
  }

  private toOver(banner: string | null): void {
    this.state = "over";
    this.stopPlaying();
    this.hud.hideCard();
    this.hud.setBanner(banner ?? "La ronda terminó");
  }

  private toSpectating(banner = "Ya usaste tu vida de esta ronda. Mirando..."): void {
    this.state = "dead";
    this.stopPlaying();
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
    else if (this.state === "spawning") this.requestSpawnRetry(dt);
    if (this.state === "playing") {
      // Primero se avanza con el input vigente y despues se manda el nuevo, fechado en
      // este cuadro: exactamente los tramos que reproduce `reconcile`. Con el tiempo
      // REAL, sin el tope: el server movio la viborita ese tiempo entero.
      this.predictor.advance(rawDt, now);
      this.sendInput(dt, now);
      const boosting = this.predictor.boosting;
      if (boosting && !this.wasBoosting) SoundEffects.playBoost();
      this.wasBoosting = boosting;
      this.hud.setLength(this.predictor.mass, boosting);
    }
    if (this.room && !this.reported && this.offlineSince > 0 && now - this.offlineSince > ROOM_GIVE_UP_MS) {
      this.giveUp();
    }
    this.flushDrops(now - this.interpDelay);
    this.updateCamera(dt);
    this.renderer.draw(this.ctx, this.cssW, this.cssH, this.camera, this.pellets.values(), this.snakeViews(now), now / 1000);
    if (this.state === "playing") this.drawJoystick();

    requestAnimationFrame(this.tick);
  };

  /** Si el `vb:spawned` no vuelve (se perdio en un corte), se pide de nuevo. */
  private spawnWait = 0;
  private requestSpawnRetry(dt: number): void {
    this.spawnWait += dt;
    if (this.spawnWait < 2) return;
    this.requestSpawn();
  }

  /** Hacia donde apunta el jugador: el mouse (desde la cabeza, que es el centro) o el joystick. */
  private targetAngle(): number {
    const stick = this.input.stick;
    if (stick) return Math.atan2(stick.y, stick.x);
    const mouse = this.input.mouse;
    const fallback = this.predictor.head?.a ?? 0;
    if (!mouse || this.input.joystick) return this.predictor.dir.angle ?? fallback;
    const dx = mouse.x - this.cssW / 2;
    const dy = mouse.y - this.cssH / 2;
    if (Math.hypot(dx, dy) < 4) return this.predictor.dir.angle;
    return Math.atan2(dy, dx);
  }

  private sendInput(dt: number, now: number): void {
    this.inputTimer += dt;
    const angle = Math.round(this.targetAngle() * 1000) / 1000;
    const boost = this.input.boost;
    const sent = this.predictor.dir;
    const changed = Math.abs(wrapAngle(angle - sent.angle)) > INPUT_TURN_EPS || boost !== sent.boost;
    if (this.inputTimer < INPUT_INTERVAL && !(changed && this.inputTimer >= INPUT_MIN_GAP)) return;
    this.inputTimer = 0;
    const n = ++this.inputSeq;
    // Fechado con el cuadro, no con performance.now(): la prediccion avanza por
    // cuadros y el replay tiene que cortar los tramos en los mismos instantes.
    this.predictor.recordInput(n, now, angle, boost);
    // Que instante del server estoy dibujando de las demas: el server juzga los choques
    // de mi cabeza contra eso (compensacion de lag), no contra el presente que no veo.
    const view = this.timeline.serverTimeAt(now - this.interpDelay);
    this.socket?.sendInput([n, Math.round(now * 10) / 10, angle, boost ? 1 : 0, view === null ? -1 : Math.round(view)]);
  }

  // ---------------------------------------------------------------- vista

  private updateCamera(dt: number): void {
    const cfg = this.cfg;
    if (!cfg) return;
    const k = 1 - Math.exp(-ZOOM_RATE * dt);
    let viewH: number;
    const head = this.predictor.head;
    if (this.state === "playing" && head) {
      viewH = viewHeightOf(cfg, this.predictor.mass);
      // Sobre la cabeza propia, sin suavizar: el angulo se mide desde el centro de la
      // pantalla, que tiene que ser la cabeza.
      this.camera.x = head.x + this.predictor.visX;
      this.camera.y = head.y + this.predictor.visY;
    } else {
      const at = this.spectatorAt ?? { x: cfg.mapRadius, y: cfg.mapRadius };
      viewH = cfg.spectatorView;
      this.camera.x += (at.x - this.camera.x) * k;
      this.camera.y += (at.y - this.camera.y) * k;
    }
    // El zoom se suaviza: crecer de golpe no puede pegar un salto de camara.
    this.camera.viewH += (viewH - this.camera.viewH) * k;
  }

  private snakeViews(now: number): SnakeView[] {
    const views: SnakeView[] = [];
    const cfg = this.cfg;
    if (!cfg) return views;
    const rt = now - this.interpDelay;
    const playing = this.state === "playing";
    this.timeline.sample(rt, (sid, head) => {
      // La propia sale del predictor, no del pasado interpolado.
      if (playing && head.owner === this.me) return;
      const trail = this.trails.get(sid);
      if (!trail) return;
      const points: number[] = [];
      trail.body(head.x, head.y, rt, bodyLengthOf(cfg, head.mass), points);
      const meta = this.players.get(head.owner);
      views.push({
        sid,
        points,
        r: radiusOf(cfg, head.mass),
        a: head.a,
        color: meta?.color ?? 0,
        name: meta?.name ?? "",
        boosting: head.boost,
        mine: false,
      });
    });

    const h = this.predictor.head;
    if (playing && h) {
      const points = this.bodyBuf;
      this.predictor.trail.body(h.x, h.y, Infinity, bodyLengthOf(cfg, this.predictor.mass), points);
      // El resto de la ultima correccion se reparte desde la cabeza hacia atras: la
      // cabeza no salta y el cuerpo no se dobla de golpe.
      const vx = this.predictor.visX;
      const vy = this.predictor.visY;
      if (vx !== 0 || vy !== 0) {
        let s = 0;
        for (let i = 0; i < points.length; i += 2) {
          if (i > 0) s += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
          const w = Math.max(0, 1 - s / VIS_FADE_LEN);
          if (w === 0) break;
          points[i] += vx * w;
          points[i + 1] += vy * w;
        }
      }
      const meta = this.players.get(this.me);
      views.push({
        sid: this.predictor.sid,
        points: points.slice(),
        r: radiusOf(cfg, this.predictor.mass),
        a: h.a,
        color: meta?.color ?? 0,
        name: meta?.name ?? "",
        boosting: this.predictor.boosting,
        mine: true,
      });
    }
    return views;
  }

  /** El joystick del celular, en pixeles de pantalla y en tinta (ver DESIGN.md). */
  private drawJoystick(): void {
    const stick = this.input.joystick;
    if (!stick) return;
    const range = this.input.joystickRange;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, range, 0, Math.PI * 2);
    ctx.stroke();
    const dx = stick.x - stick.originX;
    const dy = stick.y - stick.originY;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(len, range) / len;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(stick.originX + dx * k, stick.originY + dy * k, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
