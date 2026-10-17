import { isGameServerConfigured, resolveGameServerUrl } from "../../../shared/server-status";
import { AgarSocket } from "./AgarSocket";
import type { AgClientConfig, AgInit, AgPlayerInfo, AgSnap } from "./AgarProtocol";
import {
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  INPUT_INTERVAL,
  INPUT_MIN_GAP,
  INPUT_TURN_EPS,
  MAX_DT,
} from "./constants";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { Renderer, type Camera, type CellView } from "./Renderer";
import { SoundEffects } from "./SoundEffects";

type State = "connecting" | "ready" | "countdown" | "playing" | "dead";

interface PlayerMeta {
  name: string;
  color: number;
  bot: boolean;
}

/**
 * Agar: el server (namespace `/agar`) simula todo y este cliente manda su input y
 * dibuja. Ver `server/src/games/agar-arena.ts`.
 */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly renderer = new Renderer();
  private readonly input: InputController;

  private socket: AgarSocket | null = null;
  private cfg: AgClientConfig | null = null;
  private me = -1;
  private readonly players = new Map<number, PlayerMeta>();

  private state: State = "connecting";
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = 0;

  private latest: AgSnap | null = null;
  private camera: Camera = { x: 0, y: 0, viewH: 1000 };

  private inputSeq = 0;
  private inputTimer = 0;
  private sentDir = { x: 0, y: 0 };

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
    socket.onSnap((snap) => (this.latest = snap));
    socket.onPlayers((msg) => this.onPlayers(msg));
    socket.onSpawned(() => this.startPlaying());
    socket.onDead(() => this.onDead());
    socket.onStatus((up) => this.hud.setBanner(up || this.state === "connecting" ? null : "Reconectando..."));
    this.socket = socket;
    await socket.connect();
  }

  private onInit(init: AgInit): void {
    this.cfg = init.cfg;
    this.me = init.me;
    this.renderer.setConfig(init.cfg);
    this.players.clear();
    this.onPlayers({ add: init.players });
    if (init.alive) {
      this.startPlaying();
    } else if (this.state === "connecting") {
      this.state = "ready";
      this.hud.showMessage("Agar", "Comete la comida y a las celulas mas chicas.", "ENTER o toca para jugar");
    }
  }

  private onPlayers(msg: { add?: AgPlayerInfo[]; del?: number[] }): void {
    for (const [id, name, color, bot] of msg.add ?? []) this.players.set(id, { name, color, bot: bot === 1 });
    for (const id of msg.del ?? []) this.players.delete(id);
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
    this.inputTimer = INPUT_INTERVAL;
    this.input.enabled = true;
  }

  private onDead(): void {
    this.state = "dead";
    this.input.enabled = false;
    this.hud.showMessage("Te comieron", "Volve a intentarlo.", "ENTER o toca para jugar");
  }

  // ---------------------------------------------------------------- bucle

  private tick = (now: number): void => {
    const dt = Math.min(Math.max(0, (now - this.lastTime) / 1000), MAX_DT);
    this.lastTime = now;

    if (this.state === "countdown") this.updateCountdown(dt);
    if (this.state === "playing") this.sendInput(dt, now);
    this.updateCamera();
    this.renderer.draw(this.ctx, this.cssW, this.cssH, this.camera, this.cellViews());

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
    // A toda velocidad con el mouse a mas de un radio de distancia; mas cerca, frena.
    const scale = this.cssH / this.camera.viewH;
    const full = Math.max(40, this.myRadius() * scale);
    if (len < 1) return { x: 0, y: 0 };
    const mag = Math.min(1, len / full);
    return { x: (dx / len) * mag, y: (dy / len) * mag };
  }

  private sendInput(dt: number, now: number): void {
    this.inputTimer += dt;
    const v = this.moveVector();
    const dx = Math.round(v.x * 1000) / 1000;
    const dy = Math.round(v.y * 1000) / 1000;
    const act = this.input.consumeActions();
    const turned = Math.abs(dx - this.sentDir.x) + Math.abs(dy - this.sentDir.y) > INPUT_TURN_EPS;
    if (act === 0 && this.inputTimer < INPUT_INTERVAL && !(turned && this.inputTimer >= INPUT_MIN_GAP)) return;
    this.inputTimer = 0;
    this.sentDir = { x: dx, y: dy };
    this.socket?.sendInput([++this.inputSeq, Math.round(now * 10) / 10, dx, dy, act]);
  }

  // ---------------------------------------------------------------- vista

  private myCells(): { x: number; y: number; mass: number }[] {
    const out: { x: number; y: number; mass: number }[] = [];
    const c = this.latest?.c;
    if (!c) return out;
    for (let i = 0; i < c.length; i += 5) {
      if (c[i + 1] === this.me) out.push({ x: c[i + 2], y: c[i + 3], mass: c[i + 4] });
    }
    return out;
  }

  private myRadius(): number {
    if (!this.cfg) return 0;
    let mass = 0;
    for (const cell of this.myCells()) mass += cell.mass;
    return this.cfg.radiusK * Math.sqrt(mass);
  }

  private updateCamera(): void {
    const cfg = this.cfg;
    if (!cfg) return;
    const mine = this.myCells();
    if (this.state === "playing" && mine.length > 0) {
      let x = 0;
      let y = 0;
      let m = 0;
      for (const cell of mine) {
        x += cell.x * cell.mass;
        y += cell.y * cell.mass;
        m += cell.mass;
      }
      const r0 = cfg.radiusK * Math.sqrt(cfg.startMass);
      this.camera = {
        x: x / m,
        y: y / m,
        viewH: cfg.viewBase * Math.pow(Math.max(this.myRadius(), r0) / r0, cfg.viewExp),
      };
      return;
    }
    this.camera = { x: cfg.mapSize / 2, y: cfg.mapSize / 2, viewH: cfg.spectatorView };
  }

  private cellViews(): CellView[] {
    const views: CellView[] = [];
    const c = this.latest?.c;
    if (!c || !this.cfg) return views;
    for (let i = 0; i < c.length; i += 5) {
      const owner = c[i + 1];
      const meta = this.players.get(owner);
      views.push({
        id: c[i],
        x: c[i + 2],
        y: c[i + 3],
        r: this.cfg.radiusK * Math.sqrt(c[i + 4]),
        color: meta?.color ?? 0,
        name: meta?.name ?? "",
        mine: owner === this.me,
      });
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
