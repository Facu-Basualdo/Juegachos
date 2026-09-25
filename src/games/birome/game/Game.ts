import {
  C_BLUE,
  FIELD_BOT,
  FIELD_TOP,
  MAX_DT,
  NET_FLUSH_MS,
  NET_KEEPALIVE_MS,
  PEN_SCREEN_X,
  PX_PER_CM,
  REMOTE_DELAY_S,
  REMOTE_STALE_MS,
  RIVAL_INKS,
  SLOPE,
  SUBSTEP,
  VIEW_H,
  VIEW_W,
  hashStr,
  speedAt,
} from "./constants";
import { Course } from "./Course";
import { Trail } from "./Trail";
import { Renderer, type PenView, type Splat } from "./Renderer";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { InkChannel, type InkPayload } from "./InkChannel";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { getSupabase } from "../../../shared/supabase";
import { fetchRoomState } from "../../../shared/room/api";

type State = "ready" | "countdown" | "playing" | "dead";

const BEST_KEY = "birome:best";

/** Cuenta regresiva previa a la partida: una etiqueta cada COUNTDOWN_STEP segundos. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

const SHAKE_DURATION = 0.35;
const SHAKE_MAGNITUDE = 10;
/** Tope de quiebres en cola si el canal esta caido (no crece sin limite). */
const MAX_QUEUE_VERTS = 240;

/**
 * Un rival de la sala. Su trazo se arma con los quiebres que manda; la punta se
 * adelanta localmente desde el ultimo punto conocido con la misma `speedAt`,
 * dibujada REMOTE_DELAY_S en el pasado para que los quiebres en viaje lleguen a
 * tiempo y la linea no tenga que corregirse a la vista.
 */
interface Remote {
  name: string;
  trail: Trail;
  /** Ultima x confirmada por la red y cuando llego (performance.now). */
  anchorX: number;
  anchorAt: number;
  headX: number;
  score: number;
  dead: boolean;
  lastAt: number;
  started: boolean;
}

/** Orquesta el canvas, la maquina de estados, el bucle y la vista de la sala. */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly course = new Course();
  private readonly trail = new Trail();
  private readonly renderer = new Renderer();
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomMode | null;
  private readonly me: string;

  // --- Punta propia ---
  private x = 0;
  private y = (FIELD_TOP + FIELD_BOT) / 2;
  private holding = false;

  // --- Sala ---
  private channel: InkChannel | null = null;
  private readonly remotes = new Map<string, Remote>();
  private roomSeed = 0;
  private roomPlayers: string[] = [];
  /** Quiebres propios pendientes de mandar, aplanados [x, y, h, ...]. */
  private queue: number[] = [];
  private lastSentAt = 0;
  private netTimer: ReturnType<typeof setInterval> | null = null;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lastTime = 0;
  private deadFor = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private shakeTime = 0;
  private camX = -PEN_SCREEN_X;
  private readonly splats: Splat[] = [];

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.showScore(false);
    this.hud.showStart();

    this.room = initRoomMode("birome", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
      onReportedWaiting: () => this.state === "dead",
    });
    this.me = this.room?.me ?? "";
    if (this.room) void this.setupRoom();

    this.input = new InputController(container, {
      onAction: () => this.onAction(),
      onHoldChange: (held) => this.onHoldChange(held),
    });

    this.course.reset(this.newSeed());
    this.course.ensure(VIEW_W * 2);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------------- input

  private onAction(): void {
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;
      case "dead":
        // En sala se juega una sola partida por ronda: sin reintento.
        if (this.room) return;
        if (this.deadFor > 0.5) this.beginCountdown();
        break;
    }
  }

  /**
   * Cada cambio de apretado es un QUIEBRE del trazo: se guarda en el propio y se
   * encola para la red. Entre dos quiebres la linea es recta a 45, asi que esto
   * es todo lo que un rival necesita para dibujarla exacta.
   */
  private onHoldChange(held: boolean): void {
    if (this.state !== "playing") return;
    if (held === this.holding) return;
    this.holding = held;
    this.addVertex();
    SoundEffects.playScratch(held);
  }

  private addVertex(): void {
    const h = this.holding ? 1 : 0;
    this.trail.push(this.x, this.y, h);
    if (!this.channel) return;
    this.queue.push(round1(this.x), round1(this.y), h);
    if (this.queue.length > MAX_QUEUE_VERTS * 3) this.queue.splice(0, this.queue.length - MAX_QUEUE_VERTS * 3);
  }

  // -------------------------------------------------------------------- sala

  private newSeed(): number {
    if (this.room) return this.roomSeed || (hashStr(`${this.room.code}:${this.room.round()}`) >>> 0);
    return (Math.random() * 2 ** 31) >>> 0;
  }

  /** Trae la ronda, deriva la semilla compartida y abre el canal de quiebres. */
  private async setupRoom(): Promise<void> {
    if (!this.room || !getSupabase()) return;
    const code = this.room.code;
    const state = await fetchRoomState(code);
    const round = state?.room.current_round ?? this.room.round();
    // Misma semilla en todos los clientes: los tachones que ves esquivar a los
    // demas son exactamente los mismos que te vienen a vos.
    this.roomSeed = hashStr(`${code}:${round}`) >>> 0;
    this.roomPlayers = state?.players ?? this.room.players();
    if (this.state === "ready") {
      this.course.reset(this.roomSeed);
      this.course.ensure(VIEW_W * 2);
    }
    this.channel = new InkChannel(code, round);
    this.channel.onInk((p) => this.onRemoteInk(p));
    this.netTimer = setInterval(() => this.flush(), NET_FLUSH_MS);
  }

  /**
   * Manda la cola de quiebres (a lo sumo cada NET_FLUSH_MS) y, si no hubo nada
   * que mandar en NET_KEEPALIVE_MS, reafirma la posicion actual como quiebre:
   * esta sobre la linea, asi que no la deforma, y repara cualquier quiebre que
   * se haya perdido. Corre en setInterval y no en el rAF, que el navegador
   * frena en pestanas de fondo.
   */
  private flush(): void {
    if (!this.channel) return;
    if (this.state === "ready" || this.state === "countdown") return;
    const now = performance.now();
    if (this.queue.length === 0) {
      if (now - this.lastSentAt < NET_KEEPALIVE_MS) return;
      const lx = this.trail.lastX;
      if (this.state === "dead") this.queue.push(round1(lx), round1(this.trail.yAt(lx)), this.holding ? 1 : 0);
      else this.queue.push(round1(this.x), round1(this.y), this.holding ? 1 : 0);
    }
    const sent = this.channel.send({
      p: this.me,
      v: this.queue,
      s: this.score,
      d: this.state === "dead" ? 1 : 0,
    });
    if (!sent) return;
    this.queue = [];
    this.lastSentAt = now;
  }

  private onRemoteInk(p: InkPayload): void {
    if (!p || p.p === this.me || !Array.isArray(p.v) || p.v.length < 3) return;
    const now = performance.now();
    let r = this.remotes.get(p.p);
    // Un x muy para atras es una partida nueva (el rival recargo la pagina).
    if (r && p.v[0] < r.trail.lastX - 200) {
      this.remotes.delete(p.p);
      r = undefined;
    }
    if (!r) {
      r = {
        name: p.p,
        trail: new Trail(),
        anchorX: p.v[0],
        anchorAt: now,
        headX: p.v[0],
        score: 0,
        dead: false,
        lastAt: now,
        started: false,
      };
      this.remotes.set(p.p, r);
    }
    for (let i = 0; i + 2 < p.v.length; i += 3) r.trail.push(p.v[i], p.v[i + 1], p.v[i + 2]);
    r.anchorX = r.trail.lastX;
    r.anchorAt = now;
    r.score = p.s;
    r.lastAt = now;
    if (!r.started) {
      r.started = true;
      r.headX = r.anchorX;
    }
    if (p.d === 1 && !r.dead) {
      r.dead = true;
      const x = r.trail.lastX;
      const y = r.trail.yAt(x);
      const color = this.inkFor(p.p);
      this.splats.push({ x, y, color, seed: hashStr(p.p), age: 0 });
      this.renderer.burst(x, y, color);
    }
  }

  /** Tinta de cada rival por asiento: la misma en todas las pantallas (a uno
   * mismo siempre se lo ve en azul). */
  private inkFor(player: string): string {
    const list = this.roomPlayers.length ? this.roomPlayers : (this.room?.players() ?? []);
    const idx = list.indexOf(player);
    return RIVAL_INKS[(idx >= 0 ? idx : hashStr(player)) % RIVAL_INKS.length];
  }

  private updateRemotes(dt: number): void {
    const now = performance.now();
    for (const [name, r] of this.remotes) {
      if (now - r.lastAt > REMOTE_STALE_MS) {
        this.remotes.delete(name);
        continue;
      }
      if (r.dead) {
        r.headX = r.trail.lastX;
        continue;
      }
      // Donde deberia ir la punta (en el pasado de REMOTE_DELAY_S): se adelanta
      // desde el ultimo punto confirmado con la misma velocidad que el propio.
      const since = (now - r.anchorAt) / 1000 - REMOTE_DELAY_S;
      const target = r.anchorX + speedAt(r.anchorX) * since;
      r.headX += speedAt(r.headX) * dt;
      r.headX += (target - r.headX) * Math.min(1, dt * 3);
      r.headX = Math.max(r.headX, r.trail.xs[0] ?? r.headX);
    }
  }

  // ------------------------------------------------------------------ partida

  private beginCountdown(): void {
    this.course.reset(this.newSeed());
    this.x = 0;
    this.y = (FIELD_TOP + FIELD_BOT) / 2;
    this.holding = false;
    this.trail.clear();
    this.queue = [];
    this.input.clear();
    this.splats.length = 0;
    this.renderer.clearDrops();
    this.score = 0;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.shakeTime = 0;
    this.camX = -PEN_SCREEN_X;
    this.course.ensure(VIEW_W * 2);
    this.hud.setScore(0);
    this.hud.showScore(false);
    this.hud.hideSpectate();
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.hud.showScore(true);
    this.hud.showCountdown(null);
    // Si el jugador ya venia apretando durante el countdown, larga subiendo.
    this.holding = this.input.isHeld;
    this.addVertex();
    this.lastSentAt = 0;
  }

  private die(): void {
    this.state = "dead";
    this.deadFor = 0;
    this.shakeTime = SHAKE_DURATION;
    // El ultimo quiebre es el punto del choque: el rival pone la mancha ahi.
    this.addVertex();
    this.splats.push({ x: this.x, y: this.y, color: C_BLUE, seed: hashStr(this.me || "yo"), age: 0 });
    this.renderer.burst(this.x, this.y, C_BLUE);
    SoundEffects.playSplat();
    this.hud.showScore(false);
    this.flush();

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }

    if (this.room) {
      this.hud.showSpectate(this.score);
      this.room.reportScore(this.score);
    } else {
      this.hud.showGameOver(this.score, this.best);
      this.hud.showRanking("birome", this.score);
    }
  }

  // --------------------------------------------------------------------- loop

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    this.renderer.update(dt);
    for (const s of this.splats) s.age += dt;
    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);

    if (this.state === "playing") this.advance(dt);
    else if (this.state === "countdown") this.updateCountdown(dt);
    else if (this.state === "dead") this.deadFor += dt;

    this.updateRemotes(dt);
    this.updateCamera(dt);
    this.course.ensure(this.camX + VIEW_W + 400);
  }

  /** Integra la punta en subpasos fijos: la pendiente es exacta y no se saltea un tachon fino. */
  private advance(dt: number): void {
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(SUBSTEP, left);
      left -= step;
      const dx = speedAt(this.x) * step;
      this.x += dx;
      this.y += (this.holding ? -SLOPE : SLOPE) * dx;
      this.course.ensure(this.x + VIEW_W);
      if (this.course.hits(this.x, this.y)) {
        this.y = Math.max(FIELD_TOP, Math.min(FIELD_BOT, this.y));
        this.updateScore();
        this.die();
        return;
      }
    }
    this.updateScore();
  }

  private updateScore(): void {
    const cm = Math.floor(this.x / PX_PER_CM);
    if (cm === this.score) return;
    if (Math.floor(cm / 100) > Math.floor(this.score / 100)) SoundEffects.playMilestone();
    this.score = cm;
    this.hud.setScore(cm);
  }

  /**
   * La camara sigue la punta propia. Muerto en sala, se pasa al rival vivo que
   * va mas adelante (el recorrido es el mismo para todos), y si no queda nadie
   * se queda en la mancha propia.
   */
  private updateCamera(dt: number): void {
    let focus = this.x;
    if (this.state === "dead" && this.room) {
      let lead = -Infinity;
      for (const r of this.remotes.values()) if (!r.dead && r.started) lead = Math.max(lead, r.headX);
      if (lead > -Infinity) focus = lead;
    }
    const target = focus - PEN_SCREEN_X;
    if (this.state === "playing") this.camX = target;
    else this.camX += (target - this.camX) * Math.min(1, dt * 2.5);
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
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.translate(window.innerWidth / 2, window.innerHeight / 2);
    if (this.rotated) ctx.rotate(-Math.PI / 2);
    ctx.scale(this.fit, this.fit);
    ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
    if (this.shakeTime > 0) {
      const amt = SHAKE_MAGNITUDE * (this.shakeTime / SHAKE_DURATION);
      ctx.translate((Math.random() * 2 - 1) * amt, (Math.random() * 2 - 1) * amt);
    }
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    const pens: PenView[] = [];
    for (const r of this.remotes.values()) {
      if (!r.started) continue;
      pens.push({
        trail: r.trail,
        headX: r.headX,
        headY: clampField(r.trail.yAt(r.headX)),
        color: this.inkFor(r.name),
        self: false,
        dead: r.dead,
        name: r.name,
        score: r.score,
      });
    }
    // Antes de largar la punta propia se muestra quieta en la largada.
    const ownTrail = this.trail.length ? this.trail : null;
    pens.push({
      trail: ownTrail ?? this.idleTrail(),
      headX: this.x,
      headY: this.y,
      color: C_BLUE,
      self: true,
      dead: this.state === "dead",
      name: this.me,
      score: this.score,
    });
    this.renderer.draw(ctx, this.camX, this.course, pens, this.splats, !!this.room, this.rotated);
    ctx.restore();
  }

  private readonly idle = new Trail();
  private idleTrail(): Trail {
    this.idle.clear();
    this.idle.push(this.x, this.y, 0);
    return this.idle;
  }

  // --- Escalado del canvas: la vista fija entra en la ventana, con bandas. ---
  /**
   * En vertical la hoja se dibuja ROTADA 90 grados y la birome sube por la
   * pantalla: una hoja apaisada en un celular parado entra como una franja de un
   * cuarto de pantalla (mismo recurso que Manchon). El input no cambia: es un
   * solo boton en cualquier lado. Al girar el telefono se apaga solo.
   */
  private rotated = false;
  private fit = 1;

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.rotated = h > w * 1.15;
    this.fit = this.rotated ? Math.min(w / VIEW_H, h / VIEW_W) : Math.min(w / VIEW_W, h / VIEW_H);
    document.body.classList.toggle("is-rotated", this.rotated);
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
    if (this.netTimer !== null) clearInterval(this.netTimer);
    this.channel?.dispose();
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampField(y: number): number {
  return Math.max(FIELD_TOP, Math.min(FIELD_BOT, y));
}
