import { initRoomMode } from "../../../shared/room/roomMode";
import {
  BEST_KEY,
  CATCH_DIST,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  DESCENT_TIME,
  LEVEL_POINTS,
  LIGHT_MAX,
  LIGHT_MIN,
  MAX_DT,
  OIL_AMPHORA,
  PAR_PER_CELL,
  SLEEP,
  SLEEP_FIRST,
  TIME_POINTS,
  oilBurnFor,
  sizeFor,
} from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
import { Hud } from "./Hud";
import { Input } from "./Input";
import { Maze, hashSeed, mulberry32 } from "./Maze";
import { Minotaur } from "./Minotaur";
import { Player } from "./Player";
import { Renderer } from "./Renderer";
import { Rivals, parseLive, type MnLive } from "./Rivals";
import { SoundEffects } from "./SoundEffects";

type State = "ready" | "countdown" | "descent" | "play" | "caught" | "over";

/** Cadencia del estado en vivo para la sala (s) y recordatorio si nada cambio. */
const LIVE_SEND = 0.25;
const LIVE_KEEPALIVE = 2;
/** Lo que dura la escena de "te encontro" antes del cartel final (s). */
const CAUGHT_HOLD = 1.7;

/**
 * Minotauro: bajar laberintos a oscuras con una antorcha que se gasta, mientras el
 * Minotauro caza por el ruido. Cada nivel ("descenso") es mas grande, el Minotauro
 * persigue mas rapido y el aceite se quema antes. Encontrar el ovillo de oro baja al
 * siguiente; que te agarre termina la partida.
 *
 * Puntaje (`higher`): por cada descenso `LEVEL_POINTS` + 200 por nivel, mas
 * `TIME_POINTS` por cada segundo por debajo del par del laberinto.
 *
 * En sala, todos bajan los mismos laberintos (semilla = codigo + ronda), cada uno con
 * su Minotauro, y se ven las llamas de los demas cuando comparten nivel.
 */
export class Game {
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly input: Input;
  private readonly room: RoomLink | null;
  private rivals: Rivals | null = null;

  private state: State = "ready";
  private best: number | null = null;
  private seed = 0;
  private level = 1;
  private maze!: Maze;
  private player!: Player;
  private mino!: Minotaur;
  private amphorae: { x: number; y: number }[] = [];
  private oil = 1;
  private levelTime = 0;
  private runTime = 0;
  private score = 0;
  private levelsDone = 0;
  /** Segundos desde que arranco el nivel (el vistazo de la losa). */
  private revealT = 0;
  private revealLen = 3;
  private countdownT = 0;
  private lastCountdownIndex = -1;
  private caughtT = 0;
  private shake = 0;
  private beat = 0;
  private lowOilWarned = false;
  private crackleT = 0;
  private liveT = 0;
  private liveIdle = 0;
  private lastLive = "";
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    const saved = localStorage.getItem(BEST_KEY);
    if (saved) this.best = Number(saved);

    const canvas = document.createElement("canvas");
    canvas.className = "game-canvas";
    container.append(canvas);
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(container);
    this.input = new Input(container);
    this.hud.onRun(
      () => this.input.setRunButton(true),
      () => this.input.setRunButton(false),
    );
    this.hud.setBest(this.best);
    this.hud.showStart(this.best);

    this.room =
      initRoomMode("minotauro", {
        getScore: () => this.score,
        onStart: () => this.beginCountdown(),
      }) ?? devRoom(() => this.beginCountdown());
    this.room?.onLive((player, data) => {
      const m = parseLive(data, this.room?.round() ?? 0);
      if (m && this.rivals) this.rivals.apply(player, m);
    });

    // La losa del primer nivel queda de fondo detras de la tabla de inicio.
    this.renderer.setMargins(this.hud.margins());
    this.seed = (Math.random() * 2 ** 31) >>> 0;
    this.buildLevel(1);

    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown);
    // Sobre el container, no sobre el canvas: la tabla de inicio lo tapa.
    container.addEventListener("pointerdown", this.onPointerDown);
    requestAnimationFrame(this.tick);
  }

  // ---------- Input de menu ----------

  private onResize = (): void => {
    this.renderer.setMargins(this.hud.margins());
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    SoundEffects.unlock();
    if (e.key === "Enter" && (this.state === "ready" || this.state === "over")) this.onStartInput();
  };

  private onPointerDown = (e: PointerEvent): void => {
    SoundEffects.unlock();
    const el = e.target as HTMLElement | null;
    if (el?.closest("button, .mg-lb, input")) return;
    if (this.state === "ready" || this.state === "over") this.onStartInput();
  };

  private onStartInput(): void {
    // En sala se juega una sola partida por ronda.
    if (this.state === "over" && this.room) return;
    this.beginCountdown();
  }

  // ---------- Flujo ----------

  private beginCountdown(): void {
    if (this.state !== "ready" && this.state !== "over") return;
    this.state = "countdown";
    this.countdownT = 0;
    this.lastCountdownIndex = -1;
    this.score = 0;
    this.levelsDone = 0;
    this.runTime = 0;
    this.oil = 1;
    this.lowOilWarned = false;
    this.seed = this.room ? hashSeed(`${this.room.code}:${this.room.round()}`) : (Math.random() * 2 ** 31) >>> 0;
    if (this.room && !this.rivals) this.rivals = new Rivals(this.room.players().filter((p) => p !== this.room?.me));
    this.buildLevel(1);
    this.revealLen = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
    this.hud.hideOverlay();
    this.hud.setPlaying(true);
    SoundEffects.startAmbience();
    this.sendLive(true);
  }

  private buildLevel(level: number): void {
    this.level = level;
    const amph = 1 + Math.floor(level / 2);
    this.maze = new Maze(sizeFor(level), (this.seed + level * 7919) >>> 0, amph);
    this.player = new Player(this.maze);
    this.mino = new Minotaur(this.maze, this.maze.lair, level, level === 1 ? SLEEP_FIRST : SLEEP, mulberry32((this.seed ^ (level * 2654435761)) >>> 0));
    this.amphorae = this.maze.amphorae.map((a) => ({ ...a }));
    this.levelTime = 0;
    this.revealT = 0;
    this.renderer.setMaze(this.maze);
    this.hud.setLevel(level);
  }

  private nextLevel(): void {
    const par = this.maze.w * this.maze.h * PAR_PER_CELL;
    const gained = LEVEL_POINTS + 200 * (this.level - 1) + Math.max(0, Math.round((par - this.levelTime) * TIME_POINTS));
    this.score += gained;
    this.levelsDone = this.level;
    this.renderer.burst("gold", this.player.fx, this.player.fy, 40, 2.4);
    SoundEffects.spool();
    window.setTimeout(() => SoundEffects.descend(), 380);
    this.hud.toast(`+${gained.toLocaleString("es-AR")}`, "gold");
    this.state = "descent";
    this.buildLevel(this.level + 1);
    this.revealLen = DESCENT_TIME;
    this.hud.descent(this.level, this.level === 2 ? "El laberinto se hunde" : "Más hondo");
    this.sendLive(true);
  }

  private caught(): void {
    this.state = "caught";
    this.caughtT = 0;
    this.shake = 14;
    SoundEffects.caught();
    SoundEffects.stopAmbience();
    this.renderer.burst("smoke", this.player.fx, this.player.fy, 26, 1.4);
    this.hud.setPlaying(false);
    this.hud.toast("Te encontró", "danger");
    this.sendLive(true);
  }

  private finish(): void {
    this.state = "over";
    const isBest = this.score > 0 && (this.best === null || this.score > this.best);
    if (isBest) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.score));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver({
      title: "Te encontró",
      levels: this.levelsDone,
      score: this.score,
      time: this.runTime,
      best: this.best,
      isBest,
      room: this.room !== null,
    });
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking(this.score);
  }

  // ---------- Bucle ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt, now / 1000);
    requestAnimationFrame(this.tick);
  };

  private update(dt: number, time: number): void {
    const s = this.state;
    if (s === "countdown") {
      this.countdownT += dt;
      this.revealT += dt;
      const index = Math.floor(this.countdownT / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.hud.descent(null);
        this.state = "play";
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (s === "descent") {
      this.revealT += dt;
      if (this.revealT >= this.revealLen) {
        this.hud.descent(null);
        this.state = "play";
      }
    } else if (s === "play") {
      this.updatePlay(dt);
    } else if (s === "caught") {
      this.caughtT += dt;
      if (this.caughtT >= CAUGHT_HOLD) this.finish();
    }

    this.shake = Math.max(0, this.shake - dt * 30);
    this.rivals?.update(dt);
    this.updateLive(dt);
    this.updateHud();
    this.draw(dt, time);
  }

  private updatePlay(dt: number): void {
    this.levelTime += dt;
    this.runTime += dt;
    this.revealT += dt;
    const p = this.player;
    const pe = p.update(dt, this.input.dirs, this.input.running);
    if (pe.arrived) SoundEffects.footstep(p.running);
    if (pe.bumped) {
      SoundEffects.bump();
      this.shake = Math.max(this.shake, 3);
    }

    const noises = pe.noise > 0 ? [{ x: p.cx, y: p.cy, r: pe.noise }] : [];
    const wasState = this.mino.state;
    const me = this.mino.update(dt, { px: p.cx, py: p.cy, noises });
    const dx = this.mino.fx - p.fx;
    const dy = this.mino.fy - p.fy;
    const d = Math.hypot(dx, dy);
    const near = Math.max(0, Math.min(1, 1 - d / 9));
    const pan = Math.max(-1, Math.min(1, dx / 6));
    if (me.step) {
      SoundEffects.hoof(near, pan);
      if (d < 6) this.renderer.dust(this.mino.x, this.mino.y);
    }
    if (me.snort) SoundEffects.snort(near, pan);
    if (me.roar) {
      SoundEffects.roar(near, pan);
      this.shake = Math.max(this.shake, 8);
      this.hud.toast("Te vio", "danger");
    }
    if (me.woke && wasState === "sleep") this.hud.toast("Se despertó", "danger");
    if (this.mino.awake) SoundEffects.heartbeat(Math.max(0, Math.min(1, 1 - d / 6)));
    if (d < CATCH_DIST) {
      this.caught();
      return;
    }

    // Aceite.
    this.oil = Math.max(0, this.oil - oilBurnFor(this.level) * dt);
    if (this.oil < 0.18 && !this.lowOilWarned) {
      this.lowOilWarned = true;
      SoundEffects.gutter();
      this.hud.toast("La antorcha se apaga", "info");
    }
    if (pe.arrived) {
      const i = this.amphorae.findIndex((a) => a.x === p.x && a.y === p.y);
      if (i >= 0) {
        this.amphorae.splice(i, 1);
        this.oil = Math.min(1, this.oil + OIL_AMPHORA);
        if (this.oil >= 0.18) this.lowOilWarned = false;
        this.renderer.burst("gold", p.fx, p.fy, 18, 1.6);
        SoundEffects.amphora();
        this.hud.toast("Aceite", "gold");
      }
      if (p.x === this.maze.exit.x && p.y === this.maze.exit.y) this.nextLevel();
    }

    this.crackleT -= dt;
    if (this.crackleT <= 0) {
      this.crackleT = 0.2 + Math.random() * 0.6;
      SoundEffects.crackle();
    }
  }

  private lightRadius(time: number): number {
    const base = LIGHT_MIN + (LIGHT_MAX - LIGHT_MIN) * this.oil;
    let flicker = 1 + 0.035 * Math.sin(time * 13.1) + 0.025 * Math.sin(time * 7.3 + 1.7);
    if (this.oil < 0.2) flicker *= 0.86 + 0.14 * Math.abs(Math.sin(time * 23.7) * Math.sin(time * 5.1));
    return base * flicker;
  }

  private draw(dt: number, time: number): void {
    const d = Math.hypot(this.mino.fx - this.player.fx, this.mino.fy - this.player.fy);
    const dread = this.state === "play" && this.mino.awake ? Math.max(0, Math.min(1, 1 - d / 6)) : this.state === "caught" ? 1 : 0;
    // El pulso rojo late con el corazon: mas rapido cuanto mas cerca.
    this.beat = (this.beat + dt / (1.1 - dread * 0.62)) % 1;
    const reveal = this.state === "ready" ? 0 : Math.min(1, this.revealT / this.revealLen);
    const rivals =
      this.rivals?.list
        .filter((r) => r.level === this.level && this.rivals!.fresh(r))
        .map((r) => ({ x: r.sx, y: r.sy, name: r.name, alive: r.alive })) ?? [];
    this.renderer.draw(
      {
        maze: this.maze,
        player: this.player,
        mino: this.mino,
        light: this.state === "caught" ? 0.6 : this.lightRadius(time),
        amphorae: this.amphorae,
        reveal,
        dread,
        beat: this.beat,
        shake: this.shake,
        rivals,
        showPlayer: this.state !== "caught" && this.state !== "over",
        time,
      },
      dt,
    );
  }

  private updateHud(): void {
    this.hud.setTime(this.runTime);
    this.hud.setScore(this.score);
    this.hud.setOil(this.oil);
    this.hud.setState(this.mino.state);
    this.hud.setStick(this.state === "play" ? this.input.stick : null);
    if (this.rivals) {
      this.hud.setRivals(
        this.rivals.list.filter((r) => this.rivals!.fresh(r)).map((r) => ({ name: r.name, level: r.level, alive: r.alive })),
      );
    }
  }

  // ---------- Sala en vivo ----------

  private updateLive(dt: number): void {
    if (!this.room || this.state === "ready") return;
    this.liveT -= dt;
    this.liveIdle += dt;
    if (this.liveT <= 0) {
      this.liveT = LIVE_SEND;
      this.sendLive(false);
    }
  }

  private sendLive(force: boolean): void {
    if (!this.room) return;
    const msg: MnLive = {
      g: "mn",
      r: this.room.round(),
      lv: this.level,
      x: Math.round(this.player.fx * 100) / 100,
      y: Math.round(this.player.fy * 100) / 100,
      a: this.state === "caught" || this.state === "over" ? 0 : 1,
      s: this.score,
    };
    const sig = JSON.stringify(msg);
    if (!force && sig === this.lastLive && this.liveIdle < LIVE_KEEPALIVE) return;
    this.lastLive = sig;
    this.liveIdle = 0;
    this.room.broadcastLive(msg);
  }
}
