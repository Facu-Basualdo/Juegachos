import {
  FLOOR_D,
  FLOOR_W,
  MAX_DT,
  NET_KEEPALIVE_MS,
  REMOTE_STALE_MS,
  TUNIC_COLORS,
  VIEW_H,
  VIEW_W,
  hashStr,
  laneFor,
} from "./constants";
import { Runner } from "./Runner";
import { BeamField } from "./BeamField";
import { Particles } from "./Particles";
import { Renderer, WARNING_LIFE, type RunnerView, type Warning } from "./Renderer";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { TempleChannel, type PoseEvent, type TemplePayload } from "./TempleChannel";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { getSupabase } from "../../../shared/supabase";
import { fetchRoomState } from "../../../shared/room/api";

type State = "ready" | "countdown" | "playing" | "dead";

const BEST_KEY = "templo-rodante:best";

/** Cuenta regresiva previa a la partida: una etiqueta cada COUNTDOWN_STEP segundos. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** Sacudon de camara al morir. */
const SHAKE_DURATION = 0.5;
const SHAKE_MAGNITUDE = 20;

/** Un rival de la sala: su corredor, su marcador y cuando se supo de el. */
interface Remote {
  runner: Runner;
  score: number;
  lastAt: number;
}

/** Orquesta el canvas, la maquina de estados y el bucle de juego. */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly runner = new Runner(laneFor(0, 1));
  private readonly field = new BeamField();
  private readonly renderer = new Renderer();
  private readonly particles = new Particles();
  private readonly hud: Hud;
  private readonly input: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;
  private readonly me: string;

  // --- Vista en vivo de la sala (modelo Cannon Dodge) ---
  /** Canal efimero de poses (null fuera de sala). */
  private channel: TempleChannel | null = null;
  private readonly remotes = new Map<string, Remote>();
  /** Semilla compartida de la sala+ronda: todos reciben las mismas vigas. */
  private roomSeed = 0;
  private roomPlayers: string[] = [];
  /** Keepalive de pose. Va sobre setInterval y no sobre el rAF: el navegador
   * frena el rAF en pestanas de fondo y el jugador desapareceria para el resto. */
  private netTimer: ReturnType<typeof setInterval> | null = null;

  private state: State = "ready";
  /** Vigas esquivadas: es el puntaje. */
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lastTime = 0;
  private deadFor = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private shakeTime = 0;
  private readonly warnings: Warning[] = [];
  /** Acumulador para las chispas que la viga rasante arranca del piso. */
  private sparkClock = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.showScore(false);
    this.hud.showStart();

    this.room = initRoomMode("templo-rodante", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
      onReportedWaiting: () => this.state === "dead",
    });
    this.me = this.room?.me ?? "";
    this.runner.name = this.me;
    if (this.room) void this.setupRoom();

    this.input = new InputController(container, {
      onAction: () => this.onAction(),
      onJump: () => this.onJump(),
      onDuckStart: () => this.onDuckStart(),
      onDuckEnd: () => this.onDuckEnd(),
      isPlaying: () => this.state === "playing",
    });

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
        // En modo sala se juega una sola partida por ronda: sin reintento.
        if (this.room) return;
        if (this.deadFor > 0.5) this.beginCountdown();
        break;
    }
  }

  private onJump(): void {
    if (this.state !== "playing") return;
    if (!this.runner.jump()) return;
    SoundEffects.playJump();
    this.emit("jump");
  }

  private onDuckStart(): void {
    if (this.state !== "playing" || this.runner.dead) return;
    const already = this.runner.ducking;
    this.runner.duckStart();
    if (already) return;
    SoundEffects.playDuck();
    this.emit("duck");
  }

  /** Soltar la agachada tambien se avisa: sin esto el rival te veia agachado
   * hasta el siguiente keepalive (hasta un segundo de mas). El minimo de
   * agachada no se rompe: el receptor corre su propio `duckTimer`. */
  private onDuckEnd(): void {
    if (!this.runner.ducking) {
      this.runner.duckEnd();
      return;
    }
    this.runner.duckEnd();
    if (this.state === "playing") this.emit("stand");
  }

  // -------------------------------------------------------------------- sala

  /** Trae la ronda, deriva la semilla compartida y abre el canal de poses. */
  private async setupRoom(): Promise<void> {
    if (!this.room || !getSupabase()) return;
    const code = this.room.code;
    const state = await fetchRoomState(code);
    const round = state?.room.current_round ?? this.room.round();
    // Misma semilla en todos los clientes: las vigas que ves esquivar a los
    // demas son EXACTAMENTE las mismas que te vienen a vos.
    this.roomSeed = hashStr(`${code}:${round}`) >>> 0;
    this.roomPlayers = state?.players ?? this.room.players();
    this.applyLanes();
    this.channel = new TempleChannel(code, round);
    this.channel.onPose((p) => this.onRemotePose(p));
    this.netTimer = setInterval(() => this.heartbeat(), NET_KEEPALIVE_MS);
  }

  /** Reparte los carriles por orden de asiento: mismo reparto en todas las pantallas. */
  private applyLanes(): void {
    const list = this.roomPlayers.length ? this.roomPlayers : (this.room?.players() ?? []);
    const total = Math.max(1, list.length);
    const mine = list.indexOf(this.me);
    this.runner.y = laneFor(mine >= 0 ? mine : 0, total);
    this.runner.color = this.tunicColor(this.me);
    for (const [name, r] of this.remotes) {
      const i = list.indexOf(name);
      r.runner.y = laneFor(i >= 0 ? i : total - 1, total);
      r.runner.color = this.tunicColor(name);
    }
  }

  private tunicColor(player: string): string {
    const list = this.roomPlayers.length ? this.roomPlayers : (this.room?.players() ?? []);
    const idx = list.indexOf(player);
    if (idx >= 0) return TUNIC_COLORS[idx % TUNIC_COLORS.length];
    return TUNIC_COLORS[hashStr(player) % TUNIC_COLORS.length];
  }

  /**
   * El rival no manda su altura: manda "salte" y aca se corre la MISMA parabola
   * del `Runner`. Por eso el canal necesita dos o tres mensajes por segundo en
   * vez de diez (ver TempleChannel).
   */
  private onRemotePose(p: TemplePayload): void {
    if (!p || p.p === this.me) return;
    let remote = this.remotes.get(p.p);
    if (!remote) {
      const list = this.roomPlayers.length ? this.roomPlayers : (this.room?.players() ?? []);
      const idx = list.indexOf(p.p);
      const runner = new Runner(
        laneFor(idx >= 0 ? idx : list.length, Math.max(1, list.length)),
        this.tunicColor(p.p),
        p.p,
      );
      remote = { runner, score: 0, lastAt: Date.now() };
      this.remotes.set(p.p, remote);
    }
    remote.score = p.s;
    remote.lastAt = Date.now();

    switch (p.e) {
      case "jump":
        remote.runner.jump();
        break;
      case "duck":
        remote.runner.duckStart();
        break;
      case "stand":
        // Nunca corta un salto en curso: la parabola local termina sola.
        remote.runner.duckEnd();
        break;
      case "dead":
        if (!remote.runner.dead) remote.runner.kill();
        break;
    }
  }

  /** Reafirma la pose cada tanto: un mensaje perdido no puede dejar a nadie
   * agachado para siempre en la pantalla del resto. Nunca reenvia "jump", que
   * reiniciaria la parabola del rival. */
  private heartbeat(): void {
    if (this.state === "ready") return;
    this.emit(this.currentPose());
  }

  private currentPose(): PoseEvent {
    if (this.runner.dead) return "dead";
    return this.runner.ducking ? "duck" : "stand";
  }

  private emit(ev: PoseEvent): void {
    this.channel?.send({ p: this.me, e: ev, s: this.score });
  }

  /** Avanza a los rivales con la misma fisica que al propio; purga a los idos. */
  private updateRemotes(dt: number): void {
    const now = Date.now();
    for (const [name, r] of this.remotes) {
      if (now - r.lastAt > REMOTE_STALE_MS) {
        this.remotes.delete(name);
        continue;
      }
      r.runner.update(dt);
    }
  }

  // ------------------------------------------------------------------ partida

  /** Reinicia la sala y corre la cuenta 3-2-1-YA antes de largar. */
  private beginCountdown(): void {
    this.runner.reset();
    this.input.clear();
    if (this.room) this.applyLanes();
    // En sala la semilla es compartida (todos ven las mismas vigas); en solo,
    // cada partida estrena un templo distinto.
    const seed = this.room
      ? this.roomSeed || (hashStr(`${this.room.code}:${this.room.round()}`) >>> 0)
      : (Math.random() * 2 ** 31) >>> 0;
    this.field.reset(seed);
    for (const r of this.remotes.values()) r.runner.reset();
    this.particles.clear();
    this.warnings.length = 0;
    this.score = 0;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.shakeTime = 0;
    this.hud.showScore(false);
    this.hud.hideSpectate();
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
    this.input.showZones(false);
  }

  private start(): void {
    this.state = "playing";
    this.score = 0;
    this.hud.setScore(0);
    this.hud.showScore(true);
    this.hud.hide();
    this.hud.showCountdown(null);
    this.input.showZones(true);
  }

  private die(): void {
    this.state = "dead";
    this.deadFor = 0;
    this.shakeTime = SHAKE_DURATION;
    this.runner.kill();
    this.input.clear();
    this.input.showZones(false);
    this.particles.burst(this.runner.x, this.runner.y, 0.5, "212, 59, 59", 20);
    this.particles.burst(this.runner.x, this.runner.y, 0.35, "168, 128, 79", 14);
    SoundEffects.playHit();
    this.hud.showScore(false);
    this.emit("dead");

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }

    if (this.room) {
      // En sala el caido se queda mirando: el templo sigue corriendo con la
      // misma semilla y `onReportedWaiting` tapa la espera generica.
      this.hud.showSpectate(this.score);
      this.room.reportScore(this.score);
    } else {
      this.hud.showGameOver(this.score, this.best);
      this.hud.showRanking("templo-rodante", this.score);
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
    this.particles.update(dt);
    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      this.warnings[i].life -= dt;
      if (this.warnings[i].life <= 0) this.warnings.splice(i, 1);
    }

    if (this.state === "playing") {
      if (this.runner.update(dt)) {
        this.particles.dust(this.runner.x, this.runner.y);
        SoundEffects.playLand();
      }
      const res = this.field.update(dt, this.runner);
      this.onFieldResult(res.spawned);
      if (!res.died && res.dodged > 0) {
        this.score += res.dodged;
        this.hud.setScore(this.score);
      }
      this.emberSparks(dt);
      this.updateRemotes(dt);
      if (res.died) this.die();
    } else if (this.state === "countdown") {
      this.runner.update(dt);
      this.updateRemotes(dt);
      this.updateCountdown(dt);
    } else if (this.state === "dead") {
      this.deadFor += dt;
      this.runner.update(dt);
      // Espectando en sala: el templo sigue funcionando (mismo mundo sembrado)
      // para ver como esquivan los que quedan vivos.
      if (this.room) {
        this.onFieldResult(this.field.update(dt, null).spawned);
        this.emberSparks(dt);
      }
      this.updateRemotes(dt);
    }
  }

  /** Sonido y flecha de aviso por cada viga que acaba de entrar en la sala. */
  private onFieldResult(spawned: { dir: 1 | -1; kind: "low" | "high" }[]): void {
    if (spawned.length === 0) return;
    SoundEffects.playRumble();
    for (const b of spawned) this.warnings.push({ dir: b.dir, kind: b.kind, life: WARNING_LIFE });
  }

  /** Chispas que la viga rasante arranca de las losas mientras cruza. */
  private emberSparks(dt: number): void {
    this.sparkClock += dt;
    if (this.sparkClock < 0.05) return;
    this.sparkClock = 0;
    for (const b of this.field.beams) {
      if (b.kind !== "low" || b.x < 0 || b.x > FLOOR_W) continue;
      this.particles.sparks(b.x, Math.random() * FLOOR_D, 2);
    }
  }

  /** Avanza la cuenta regresiva y larga la partida al terminar. */
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

    if (this.shakeTime > 0) {
      const amt = SHAKE_MAGNITUDE * (this.shakeTime / SHAKE_DURATION);
      ctx.translate((Math.random() * 2 - 1) * amt, (Math.random() * 2 - 1) * amt);
    }

    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    const views: RunnerView[] = [{ runner: this.runner, self: !!this.room, score: this.score }];
    for (const r of this.remotes.values()) {
      views.push({ runner: r.runner, self: false, score: r.score });
    }
    this.renderer.draw(ctx, this.field, views, this.particles, this.warnings, !!this.room);
    ctx.restore();
  }

  // --- Escalado del canvas: la vista fija entra en la ventana, con bandas. ---
  private scale = 1;
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

    const fit = Math.min(w / VIEW_W, h / VIEW_H);
    this.scale = fit * dpr;
    this.offsetX = (w / fit - VIEW_W) / 2;
    this.offsetY = (h / fit - VIEW_H) / 2;
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
    if (this.netTimer !== null) clearInterval(this.netTimer);
    this.channel?.dispose();
  }
}
