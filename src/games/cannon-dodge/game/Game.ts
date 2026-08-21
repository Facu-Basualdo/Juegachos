import {
  BANDANA_COLORS,
  hashStr,
  MAX_DT,
  MUZZLE_OFFSET,
  NET_IDLE_MS,
  NET_SEND_MS,
  REMOTE_STALE_MS,
  VIEW_SIZE,
} from "./constants";
import { Player } from "./Player";
import { CannonField } from "./CannonField";
import { Renderer, type RemotePirate } from "./Renderer";
import { Particles } from "./Particles";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { DodgeChannel, type DodgePayload } from "./DodgeChannel";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { getSupabase } from "../../../shared/supabase";
import { fetchRoomState } from "../../../shared/room/api";

/** A remote pirate with interpolation targets (room mode). */
interface Remote {
  x: number;
  y: number;
  facing: number;
  tx: number;
  ty: number;
  tfacing: number;
  color: string;
  name: string;
  alive: boolean;
  lastAt: number;
}

type State = "ready" | "countdown" | "playing" | "dead";

const BEST_KEY = "cannon-dodge:best";

/** Countdown before a run starts: one label shown per COUNTDOWN_STEP seconds. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** Death screen-shake. */
const SHAKE_DURATION = 0.45;
const SHAKE_MAGNITUDE = 18;

/** Orchestrates the canvas, the state machine and the fixed-view game loop. */
export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly player = new Player();
  private readonly field = new CannonField();
  private readonly renderer = new Renderer();
  private readonly particles = new Particles();
  private readonly hud: Hud;
  private readonly input: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;
  private readonly me: string;

  // --- Room live-view (Neon Drift model): see the other players ---
  /** Ephemeral position broadcast channel (null in solo). */
  private channel: DodgeChannel | null = null;
  /** Other players' pirates, keyed by nickname. */
  private readonly remotes = new Map<string, Remote>();
  /** Shared seed for this room+round, so every client fires the same cannons. */
  private roomSeed = 0;
  /** Player list captured at boot, for stable per-seat bandana colours. */
  private roomPlayers: string[] = [];
  /** Own bandana colour. */
  private myColor = BANDANA_COLORS[0];
  /** Position heartbeat timer. Driven off setInterval (not the animation frame)
   * so a still or unfocused player keeps broadcasting — rAF throttles/pauses in
   * background tabs, which made idle pirates vanish for everyone else. */
  private netTimer: ReturnType<typeof setInterval> | null = null;
  /** Last snapshot actually broadcast, to skip re-sending an unchanged one. */
  private lastSent: DodgePayload | null = null;
  private lastSentAt = 0;

  private state: State = "ready";
  /** Survival time in seconds — this is the score. */
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lastTime = 0;
  private deadFor = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private shakeTime = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.showTime(false);
    this.hud.showStart();

    this.room = initRoomMode("cannon-dodge", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
      onReportedWaiting: () => this.state === "dead",
    });
    this.me = this.room?.me ?? "";
    if (this.room) void this.setupRoom();

    this.input = new InputController(container, {
      onAction: () => this.onAction(),
    });

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

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

  // ---------- Room live-view (see the other players) ----------

  /** Fetches the round, derives the shared seed and opens the position channel. */
  private async setupRoom(): Promise<void> {
    if (!this.room || !getSupabase()) return;
    const code = this.room.code;
    const state = await fetchRoomState(code);
    const round = state?.room.current_round ?? this.room.round();
    // Same seed on every client -> everyone simulates the same cannons/balls,
    // so the pirates you see are dodging the exact same shots you are.
    this.roomSeed = hashStr(`${code}:${round}`) >>> 0;
    this.roomPlayers = state?.players ?? this.room.players();
    this.myColor = this.bandanaColor(this.me);
    this.channel = new DodgeChannel(code, round);
    this.channel.onPos((p) => this.onRemotePos(p));
    // Heartbeat off a timer, not rAF, so background/idle tabs keep emitting.
    this.netTimer = setInterval(() => this.heartbeat(), NET_SEND_MS);
  }

  /** Stable per-player bandana colour by seat order (falls back to a hash). */
  private bandanaColor(player: string): string {
    const list = this.roomPlayers.length ? this.roomPlayers : (this.room?.players() ?? []);
    const idx = list.indexOf(player);
    if (idx >= 0) return BANDANA_COLORS[idx % BANDANA_COLORS.length];
    return BANDANA_COLORS[hashStr(player) % BANDANA_COLORS.length];
  }

  private onRemotePos(p: DodgePayload): void {
    if (p.p === this.me) return;
    const r = this.remotes.get(p.p);
    if (!r) {
      this.remotes.set(p.p, {
        x: p.x, y: p.y, facing: p.a,
        tx: p.x, ty: p.y, tfacing: p.a,
        color: this.bandanaColor(p.p), name: p.p, alive: p.alive,
        lastAt: Date.now(),
      });
      return;
    }
    r.tx = p.x;
    r.ty = p.y;
    r.tfacing = p.a;
    r.alive = p.alive;
    r.lastAt = Date.now();
  }

  /** Timer-driven heartbeat: broadcasts our position from the countdown on (so
   * everyone is on screen before the first shot), and keeps emitting the wreck
   * while dead so others still see where we went down. */
  private heartbeat(): void {
    if (this.state === "countdown" || this.state === "playing") this.emitPos(true);
    else if (this.state === "dead") this.emitPos(false);
  }

  private emitPos(alive: boolean): void {
    if (!this.channel) return;
    const payload: DodgePayload = {
      p: this.me,
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      a: Number(this.player.facing.toFixed(3)),
      alive,
    };

    // Un pirata quieto (o hundido) no necesita repetir el mismo snapshot 10
    // veces por segundo: baja a un keepalive. Con la sala llena esto es la
    // diferencia entre rozar el tope de mensajes/s del canal y no rozarlo.
    const now = Date.now();
    const last = this.lastSent;
    const same =
      last !== null &&
      last.x === payload.x &&
      last.y === payload.y &&
      last.a === payload.a &&
      last.alive === payload.alive;
    if (same && now - this.lastSentAt < NET_IDLE_MS) return;

    this.lastSent = payload;
    this.lastSentAt = now;
    this.channel.send(payload);
  }

  /** Eases the remote pirates toward their latest snapshot; purges stale ones. */
  private updateRemotes(dt: number): void {
    const now = Date.now();
    const k = 1 - Math.exp(-dt * 12);
    for (const [name, r] of this.remotes) {
      if (now - r.lastAt > REMOTE_STALE_MS) {
        this.remotes.delete(name);
        continue;
      }
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      let da = r.tfacing - r.facing;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      r.facing += da * k;
    }
  }

  /** Resets the world and runs the 3-2-1-YA countdown before play begins. */
  private beginCountdown(): void {
    this.player.reset();
    // Room mode shares the seed so every client fires identical cannons; solo
    // gets a fresh random world each run.
    const seed = this.room ? (this.roomSeed || (hashStr(`${this.room.code}:${this.room.round()}`) >>> 0)) : (Math.random() * 2 ** 31) >>> 0;
    this.field.reset(seed);
    this.remotes.clear();
    this.lastSent = null;
    this.particles.clear();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.shakeTime = 0;
    this.hud.showTime(false);
    this.hud.hideSpectate();
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.score = 0;
    this.hud.setTime(0);
    this.hud.showTime(true);
    this.hud.hide();
    this.hud.showCountdown(null);
  }

  private die(): void {
    this.state = "dead";
    this.deadFor = 0;
    this.shakeTime = SHAKE_DURATION;
    this.particles.burst(this.player.x, this.player.y, "212, 59, 59", 22);
    this.particles.burst(this.player.x, this.player.y, "255, 255, 255", 14);
    SoundEffects.playHit();
    this.hud.showTime(false);

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }

    // Tell the others we've been sunk so our pirate lingers as a wreck (the
    // heartbeat keeps re-sending this while we're dead).
    this.emitPos(false);

    if (this.room) {
      // En sala el naufrago se queda mirando: la isla sigue simulandose (misma
      // semilla que los demas) y `onReportedWaiting` tapa la pantalla generica
      // de espera, asi que solo mostramos una banda con el puntaje.
      this.hud.showSpectate(this.score);
      this.room.reportScore(this.score);
    } else {
      this.hud.showGameOver(this.score, this.best);
      this.hud.showRanking("cannon-dodge", this.score);
    }
  }

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

    if (this.state === "playing") {
      this.player.update(dt, this.input.vecX, this.input.vecY);
      const res = this.stepField(dt);

      this.score += dt;
      this.hud.setTime(this.score);

      // Our position goes out on the setInterval heartbeat; here we just ease
      // the other players toward their latest snapshots.
      this.updateRemotes(dt);

      if (res.died) this.die();
    } else if (this.state === "countdown") {
      this.updateCountdown(dt);
    } else if (this.state === "dead") {
      this.deadFor += dt;
      // Espectando en sala: los cañones siguen disparando (mismo mundo sembrado
      // que el de los vivos) para ver como esquivan. El choque contra nuestro
      // naufrago se ignora, ya estamos muertos.
      if (this.room) this.stepField(dt);
      this.updateRemotes(dt);
    }
  }

  /** Avanza cañones y balas, con el sonido y el humo de cada disparo. */
  private stepField(dt: number) {
    const res = this.field.update(dt, this.player);
    if (res.spawned > 0) SoundEffects.playAppear();
    for (const f of res.fired) {
      SoundEffects.playBoom();
      this.particles.smoke(f.x + f.dx * MUZZLE_OFFSET, f.y + f.dy * MUZZLE_OFFSET, f.dx, f.dy);
    }
    return res;
  }

  /** Advances the countdown, updating the label and starting play when done. */
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
    ctx.rect(0, 0, VIEW_SIZE, VIEW_SIZE);
    ctx.clip();

    const remotes: RemotePirate[] = [];
    for (const r of this.remotes.values()) {
      remotes.push({ x: r.x, y: r.y, facing: r.facing, color: r.color, name: r.name, alive: r.alive });
    }
    this.renderer.draw(
      ctx,
      this.field,
      { player: this.player, color: this.myColor, alive: this.state !== "dead", self: !!this.room },
      remotes,
      this.particles,
    );
    ctx.restore();
  }

  // --- Canvas scaling: fit the fixed square into the window, letterboxed. ---
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

    const fit = Math.min(w / VIEW_SIZE, h / VIEW_SIZE);
    this.scale = fit * dpr;
    this.offsetX = (w / fit - VIEW_SIZE) / 2;
    this.offsetY = (h / fit - VIEW_SIZE) / 2;
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
    if (this.netTimer !== null) clearInterval(this.netTimer);
    this.channel?.dispose();
  }
}
