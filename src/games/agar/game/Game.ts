import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { AgarSocket } from "./AgarSocket";
import type { AgClientConfig, AgInit, AgPlayerInfo, AgSnap } from "./AgarProtocol";
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
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { Predictor } from "./Predictor";
import { Renderer, type Camera, type CellView, type PelletView } from "./Renderer";
import { SoundEffects } from "./SoundEffects";
import { Timeline } from "./Timeline";

type State = "connecting" | "ready" | "countdown" | "playing" | "dead";

interface PlayerMeta {
  name: string;
  color: number;
  bot: boolean;
}

interface Pellet extends PelletView {
  /** Snapshot que la trajo: una baja vieja que sale de la cola no puede borrar un alta nueva. */
  seq: number;
}

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
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly renderer = new Renderer();
  private readonly input: InputController;
  private readonly timeline = new Timeline();
  private readonly predictor = new Predictor();

  private socket: AgarSocket | null = null;
  private cfg: AgClientConfig | null = null;
  private me = -1;
  private readonly players = new Map<number, PlayerMeta>();

  private state: State = "connecting";
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  /** Hora del ultimo cuadro (la de requestAnimationFrame). */
  private lastTime = 0;

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
    window.addEventListener("keydown", this.onKeyDown);
    container.addEventListener("pointerdown", this.onPointerDown);

    if (!isGameServerConfigured()) {
      this.hud.showMessage("No disponible", "Agar necesita el game server y no esta configurado (VITE_GAME_SERVER_URL).");
      return;
    }
    // Para medir en local (ver README): expone el juego a la consola / Playwright.
    if (new URLSearchParams(location.search).has("debug")) (window as unknown as { __agar: Game }).__agar = this;
    this.hud.showMessage("Agar", "Conectando...");
    void this.connect();

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ---------------------------------------------------------------- red

  private async connect(): Promise<void> {
    const url = await resolveGameServerUrl();
    if (!url) {
      this.hud.showMessage("Sin conexion", "No se pudo conectar al game server.");
      return;
    }
    const socket = new AgarSocket(url, () => ({ mode: "public", aspect: this.aspect() }));
    socket.onInit((init) => this.onInit(init));
    socket.onSnap((snap) => this.onSnap(snap));
    socket.onPlayers((msg) => this.onPlayers(msg));
    socket.onSpawned(() => this.startPlaying());
    socket.onDead((dead) => this.onDead(dead.peak, dead.by));
    socket.onStatus((up) => this.hud.setBanner(up || this.state === "connecting" ? null : "Reconectando..."));
    this.socket = socket;
    await socket.connect();
  }

  private onInit(init: AgInit): void {
    this.cfg = init.cfg;
    this.me = init.me;
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
    } else if (this.state === "connecting" || this.state === "playing") {
      this.state = "ready";
      this.hud.showMessage("Agar", "Comete la comida y a las celulas mas chicas.", "ENTER o toca para jugar");
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
    }
  }

  private onPlayers(msg: { add?: AgPlayerInfo[]; del?: number[] }): void {
    for (const [id, name, color, bot] of msg.add ?? []) this.players.set(id, { name, color, bot: bot === 1 });
    for (const id of msg.del ?? []) this.players.delete(id);
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

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Enter") this.tryStart();
  };

  private onPointerDown = (): void => {
    this.tryStart();
  };

  private tryStart(): void {
    if (this.state === "ready" || this.state === "dead") this.beginCountdown();
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hideMessage();
  }

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) {
      this.hud.showCountdown(null);
      this.socket?.spawn("Celula");
      return;
    }
    if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.hideMessage();
    this.hud.showCountdown(null);
    this.predictor.reset();
    this.inputTimer = INPUT_INTERVAL;
    this.input.enabled = true;
  }

  private onDead(peak: number, by: string | null): void {
    this.state = "dead";
    this.input.enabled = false;
    this.predictor.reset();
    this.hud.showMessage(by ? `Te comio ${by}` : "Te disolviste", `Masa maxima: ${peak}`, "ENTER o toca para jugar");
  }

  // ---------------------------------------------------------------- bucle

  private tick = (now: number): void => {
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    const dt = Math.min(rawDt, MAX_DT);
    this.lastTime = now;

    if (this.state === "countdown") this.updateCountdown(dt);
    if (this.state === "playing") {
      // Primero se avanza con el input vigente y despues se manda el nuevo, fechado en
      // este cuadro: exactamente los tramos que reproduce `reconcile`. Con el tiempo
      // REAL, sin el tope: el server movio la celula ese tiempo entero.
      this.predictor.advance(rawDt);
      this.sendInput(dt, now);
    }
    this.flushDrops(now - INTERP_DELAY);
    this.updateCamera(dt);
    this.renderer.draw(this.ctx, this.cssW, this.cssH, this.camera, this.pellets, this.cellViews(now));

    requestAnimationFrame(this.tick);
  };

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
    let target: Camera;
    if (this.state === "playing" && this.predictor.alive) {
      const c = this.predictor.center();
      const r0 = this.radiusOf(cfg.startMass);
      const viewH = cfg.viewBase * Math.pow(Math.max(this.radiusOf(c.mass), r0) / r0, cfg.viewExp);
      // Sobre la celula propia, sin suavizar: el mouse se mide desde el centro de la
      // pantalla, que tiene que ser la celula.
      target = { x: c.x, y: c.y, viewH };
      this.camera.x = target.x;
      this.camera.y = target.y;
    } else {
      const at = this.spectatorAt ?? { x: cfg.mapSize / 2, y: cfg.mapSize / 2 };
      target = { x: at.x, y: at.y, viewH: cfg.spectatorView };
      const k = 1 - Math.exp(-ZOOM_RATE * dt);
      this.camera.x += (target.x - this.camera.x) * k;
      this.camera.y += (target.y - this.camera.y) * k;
    }
    // El zoom si se suaviza: comer de golpe no puede pegar un salto de camara.
    const k = 1 - Math.exp(-ZOOM_RATE * dt);
    this.camera.viewH += (target.viewH - this.camera.viewH) * k;
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
