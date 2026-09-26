import { initRoomMode } from "../../../shared/room/roomMode";
import { Candy } from "./Candy";
import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  MIN_TOL_PX,
  POINTS_PER_SECOND,
  REVEAL_TIME,
  TIME_LIMIT,
  TOL_CARVE,
  TOUCH_OFFSET_PX,
} from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
import { Hud } from "./Hud";
import { Renderer, type RenderPhase } from "./Renderer";
import { Rivals, parseLive, type DgLive, type RivalStatus } from "./Rivals";
import { SHAPE_ORDER, SHAPES, type ShapeDef } from "./shapes";
import { SoundEffects } from "./SoundEffects";

type State = "ready" | "countdown" | "reveal" | "playing" | "broken" | "done" | "over";

/** Umbrales de tension que disparan un crujido al cruzarlos subiendo. */
const CREAKS = [0.5, 0.7, 0.85];
/** Tiempo que se mira la galleta rota / la figura afuera antes del cartel final, en s. */
const END_HOLD = 1.5;
/**
 * Cadencia del estado en vivo para los rivales (s) y el recordatorio si nada cambio.
 * 4 por segundo por jugador: con 8 en la sala son 32 mensajes/s, lejos del tope de
 * ~100 del canal de la sala (ver "Canales efimeros" en el CLAUDE.md raiz).
 */
const LIVE_SEND = 0.25;
const LIVE_KEEPALIVE = 2;

/**
 * Dalgona: la prueba de la galleta de azucar. Se elige una de cuatro latas a ciegas
 * DURANTE el 3/2/1 (si no se elige, toca una al azar), la tapa sale y hay
 * `TIME_LIMIT` segundos para sacar la figura con la aguja sin que se parta. La
 * simulacion del caramelo vive en `Candy.ts`.
 *
 * Puntaje (`higher`): los puntos de la figura (el paraguas vale mas) mas
 * `POINTS_PER_SECOND` por cada segundo que sobro. Si se rompe o se acaba el tiempo, 0.
 */
export class Game {
  private readonly hud: Hud;
  private readonly renderer: Renderer;
  private readonly room: RoomLink | null;
  /** Los demas jugadores de la sala (null fuera de sala). */
  private rivals: Rivals | null = null;
  private liveTimer = 0;
  private liveIdle = 0;
  private lastLive = "";

  private state: State = "ready";
  private best: number | null = null;

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  /** Que figura hay en cada lata (se baraja en cada partida). */
  private tins: ShapeDef[] = SHAPE_ORDER.map((id) => SHAPES[id]);
  private chosen = -1;
  private hover = -1;
  private revealT = 0;
  private candy: Candy | null = null;
  private timeLeft = TIME_LIMIT;
  private endT = 0;
  private score = 0;
  private lastTick = -1;

  // Aguja
  private pointerId: number | null = null;
  private pressed = false;
  private touch = false;
  private tipX = 0;
  private tipY = 0;
  private fingerX = 0;
  private fingerY = 0;
  private hoverVisible = false;
  private keyLick = false;
  private buttonLick = false;

  private scratchAcc = 0;
  private scratchTimer = 0;
  private lickSoundTimer = 0;
  private prevStress = 0;

  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    const saved = localStorage.getItem(BEST_KEY);
    if (saved) this.best = parseFloat(saved);

    const canvas = document.createElement("canvas");
    canvas.className = "game-canvas";
    container.append(canvas);
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(container);
    this.hud.showStart(this.best);
    this.hud.onLick(
      () => (this.buttonLick = true),
      () => (this.buttonLick = false),
    );

    this.room =
      initRoomMode("dalgona", {
        getScore: () => this.score,
        onStart: () => this.beginCountdown(),
        // Terminado, se siguen mirando las galletas de los demas en vez de la espera generica.
        onReportedWaiting: () => this.rivals?.anyPlaying() ?? false,
      }) ?? devRoom(() => this.beginCountdown());
    this.room?.onLive((player, data) => {
      const m = parseLive(data, this.room?.round() ?? 0);
      if (m && this.rivals) this.rivals.apply(player, m);
    });

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize);
    // Sobre el container y no sobre el canvas: la pantalla de inicio es un overlay
    // que lo tapa (el bug documentado en el CLAUDE.md raiz).
    container.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    container.addEventListener("pointerleave", () => (this.hoverVisible = false));

    requestAnimationFrame(this.tick);
  }

  // ---------- Input ----------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      if (this.state === "ready" || this.state === "over") this.onStartInput();
      return;
    }
    if (e.code === "KeyL") {
      this.keyLick = true;
      return;
    }
    if (this.state === "countdown" && /^[1-4]$/.test(e.key)) this.choose(Number(e.key) - 1);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "KeyL") this.keyLick = false;
  };

  /** Al perder el foco no llegan los keyup ni los pointerup. */
  private onBlur = (): void => {
    this.keyLick = false;
    this.buttonLick = false;
    this.pressed = false;
    this.pointerId = null;
  };

  private onResize = (): void => {
    this.renderer.resize();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.state === "ready" || this.state === "over") {
      this.onStartInput();
      return;
    }
    if (this.state === "countdown") {
      const i = this.renderer.tinAt(e.clientX, e.clientY);
      if (i >= 0) this.choose(i);
      return;
    }
    if (this.state !== "playing" || this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.pressed = true;
    this.touch = e.pointerType !== "mouse";
    this.moveNeedle(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.state === "countdown" && e.pointerType === "mouse") {
      this.hover = this.renderer.tinAt(e.clientX, e.clientY);
    }
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    if (this.pointerId === null && e.pointerType !== "mouse") return;
    if (this.pointerId === null) this.touch = false;
    this.moveNeedle(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.pressed = false;
    if (this.touch) this.hoverVisible = false;
  };

  private moveNeedle(e: PointerEvent): void {
    this.fingerX = e.clientX;
    this.fingerY = e.clientY;
    this.tipX = e.clientX;
    this.tipY = e.clientY - (this.touch ? TOUCH_OFFSET_PX : 0);
    this.hoverVisible = true;
  }

  private get licking(): boolean {
    return this.keyLick || this.buttonLick;
  }

  // ---------- Flujo ----------

  private onStartInput(): void {
    // En sala se juega una sola partida por ronda.
    if (this.state === "over" && this.room) return;
    this.beginCountdown();
  }

  private beginCountdown(): void {
    if (this.state !== "ready" && this.state !== "over") return;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.chosen = -1;
    this.hover = -1;
    this.candy = null;
    this.score = 0;
    this.timeLeft = TIME_LIMIT;
    this.lastTick = -1;
    this.prevStress = 0;
    this.pressed = false;
    this.pointerId = null;
    // A ciegas: en cada partida las figuras cambian de lata.
    this.tins = shuffle(SHAPE_ORDER.map((id) => SHAPES[id]));
    // La lista de la sala recien esta completa cuando arranca la ronda (onStart).
    if (this.room && !this.rivals) this.rivals = new Rivals(this.room.players().filter((p) => p !== this.room?.me));
    this.sendLive(true);
    this.hud.hideOverlay();
    this.hud.showPlaying(false);
    this.hud.showTop(false);
    this.hud.banner("ELEGÍ UNA LATA", "info");
  }

  private choose(i: number): void {
    if (this.state !== "countdown" || i === this.chosen) return;
    this.chosen = i;
    SoundEffects.playPick();
    this.sendLive(true);
  }

  private startReveal(): void {
    if (this.chosen < 0) this.chosen = Math.floor(Math.random() * 4);
    const shape = this.tins[this.chosen];
    this.candy = new Candy(shape, (Date.now() & 0xffff) + this.chosen);
    this.state = "reveal";
    this.revealT = 0;
    this.hud.banner(null);
    this.hud.setShape(shape.name);
    this.hud.setClock(TIME_LIMIT);
    this.hud.setProgress(0);
    this.hud.setStress(0);
    this.hud.showTop(true);
    SoundEffects.playLid();
    this.sendLive(true);
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.showPlaying(true);
    this.hud.banner(null);
  }

  private endRun(kind: "broken" | "done" | "time"): void {
    const candy = this.candy;
    this.pressed = false;
    this.pointerId = null;
    this.endT = 0;
    if (kind === "done" && candy) {
      this.score = candy.shape.points + Math.ceil(this.timeLeft) * POINTS_PER_SECOND;
      this.state = "done";
      SoundEffects.playSuccess();
      this.hud.banner(`¡SALIÓ EL ${candy.shape.name}!`, "good");
    } else {
      this.score = 0;
      this.state = "broken";
      if (kind === "broken") {
        SoundEffects.playBreak();
        this.hud.banner("SE ROMPIÓ", "bad");
      } else {
        SoundEffects.playTimeUp();
        this.hud.banner("SE ACABÓ EL TIEMPO", "bad");
        // Sin grieta: la galleta queda entera pero afuera de tiempo.
      }
    }
    this.hud.showPlaying(false);
    this.sendLive(true);
  }

  private finish(): void {
    this.state = "over";
    this.hud.banner(null);
    this.hud.showTop(false);
    const candy = this.candy;
    const won = this.score > 0;
    let isNewBest = false;
    if (won && (this.best === null || this.score > this.best)) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.score));
      isNewBest = true;
    }
    const name = candy?.shape.name.toLowerCase() ?? "";
    const title = won ? (isNewBest ? "¡NUEVO RÉCORD!" : "¡LA SACASTE!") : candy && candy.broken >= 0 ? "ELIMINADO" : "SIN TIEMPO";
    const detail = won
      ? `Te tocó el ${name} y lo sacaste entero con ${Math.ceil(this.timeLeft)} s de sobra.`
      : candy && candy.broken >= 0
        ? `Te tocó el ${name} y se partió al ${Math.round(candy.progress * 100)}%.`
        : `Te tocó el ${name} y llegaste al ${Math.round((candy?.progress ?? 0) * 100)}%.`;
    if (this.room) {
      // En sala no hay cartel propio: la pantalla pasa a mirar a los demas (o a la
      // espera de la sala) y el resultado lo muestra el RoomOverlay.
      this.room.reportScore(this.score);
      this.sendLive(true);
      return;
    }
    this.hud.showGameOver(title, detail, this.score, this.best, false);
    this.hud.showRanking("dalgona", this.score);
  }

  /** Lo que ven los demas de esta partida. */
  private liveStatus(): RivalStatus {
    switch (this.state) {
      case "countdown":
        return "choose";
      case "reveal":
      case "playing":
        return "play";
      case "done":
        return "done";
      case "broken":
      case "over":
        return this.candy?.done ? "done" : this.candy && this.candy.broken >= 0 ? "broken" : this.candy ? "time" : "wait";
      default:
        return "wait";
    }
  }

  /**
   * Manda el estado propio a la sala. `force` al cambiar de paso (elegir lata, abrirla,
   * romperse); si no, cada `LIVE_SEND` solo si algo cambio, y un recordatorio cada
   * `LIVE_KEEPALIVE` para el que entro tarde o perdio un mensaje.
   */
  private sendLive(force: boolean): void {
    if (!this.room) return;
    const candy = this.candy;
    const p = this.renderer.toCandy(this.tipX, this.tipY);
    const msg: DgLive = {
      g: "dg",
      r: this.room.round(),
      st: this.liveStatus(),
      t: this.chosen,
      sh: this.state === "countdown" ? "" : (candy?.shape.id ?? ""),
      c: candy && this.state !== "countdown" ? candy.carveLevels() : "",
      x: Math.round(p.x * 1000) / 1000,
      y: Math.round(p.y * 1000) / 1000,
      p: this.pressed && !this.licking ? 1 : 0,
      v: this.hoverVisible && !this.licking && this.state === "playing" ? 1 : 0,
      s: Math.round((candy?.maxStress ?? 0) * 100) / 100,
      w: Math.round((candy?.wet ?? 0) * 10) / 10,
      b: candy?.broken ?? -1,
      pts: this.score,
    };
    const sig = JSON.stringify(msg);
    if (!force && sig === this.lastLive && this.liveIdle < LIVE_KEEPALIVE) return;
    this.lastLive = sig;
    this.liveIdle = 0;
    this.room.broadcastLive(msg);
  }

  /** Terminada la partida propia, si alguien sigue se miran sus galletas en grande. */
  private get watching(): boolean {
    return this.room !== null && this.state === "over" && (this.rivals?.anyPlaying() ?? false);
  }

  // ---------- Bucle ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt);
    this.draw(now / 1000);
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    switch (this.state) {
      case "countdown": {
        this.countdownTime += dt;
        const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
        if (index >= COUNTDOWN_LABELS.length) {
          this.hud.showCountdown(null);
          this.startReveal();
        } else if (index !== this.lastCountdownIndex) {
          this.lastCountdownIndex = index;
          SoundEffects.playCountdownTick();
          this.hud.showCountdown(COUNTDOWN_LABELS[index]);
        }
        break;
      }
      case "reveal":
        this.revealT += dt / REVEAL_TIME;
        if (this.revealT >= 0.5 && this.candy) this.hud.banner(this.candy.shape.name, "info");
        if (this.revealT >= 1) this.startPlaying();
        break;
      case "playing":
        this.updatePlaying(dt);
        break;
      case "broken":
      case "done":
        this.endT += dt;
        if (this.endT >= END_HOLD) this.finish();
        break;
    }
    this.hud.setLicking(this.state === "playing" && this.licking);

    if (this.rivals) {
      this.rivals.update(dt);
      this.renderer.setRivals(this.rivals.list.length, this.watching);
      if (this.room && this.state === "over") {
        this.hud.banner(
          this.watching ? `${this.score > 0 ? `${this.score} pts` : "ELIMINADO"} · MIRANDO A LOS DEMÁS` : "ESPERANDO EL RESULTADO",
          this.score > 0 ? "good" : "bad",
        );
      }
    }
    if (this.room && this.state !== "ready") {
      this.liveTimer -= dt;
      this.liveIdle += dt;
      if (this.liveTimer <= 0) {
        this.liveTimer = LIVE_SEND;
        this.sendLive(false);
      }
    }
  }

  private updatePlaying(dt: number): void {
    const candy = this.candy;
    if (!candy) return;
    this.timeLeft -= dt;
    const whole = Math.ceil(this.timeLeft);
    if (whole <= 10 && whole !== this.lastTick && whole > 0) {
      this.lastTick = whole;
      SoundEffects.playClockTick();
    }
    const p = this.renderer.toCandy(this.tipX, this.tipY);
    const tol = Math.max(TOL_CARVE, MIN_TOL_PX / this.renderer.r);
    const ev = candy.update(dt, { pressed: this.pressed, x: p.x, y: p.y, licking: this.licking, tol });

    this.scratchAcc += ev.carved;
    this.scratchTimer -= dt;
    if (this.scratchTimer <= 0) {
      this.scratchTimer = 0.07;
      if (this.scratchAcc > 0.004) SoundEffects.playScratch(this.scratchAcc);
      this.scratchAcc = 0;
    }
    if (this.licking) {
      this.lickSoundTimer -= dt;
      if (this.lickSoundTimer <= 0) {
        this.lickSoundTimer = 0.32;
        SoundEffects.playLick();
      }
    } else {
      this.lickSoundTimer = 0;
    }
    const stress = candy.maxStress;
    for (const c of CREAKS) if (this.prevStress < c && stress >= c) SoundEffects.playCreak(c);
    this.prevStress = stress;

    this.hud.setClock(this.timeLeft);
    this.hud.setProgress(candy.progress);
    this.hud.setStress(stress);

    if (ev.broke >= 0) this.endRun("broken");
    else if (ev.done) this.endRun("done");
    else if (this.timeLeft <= 0) this.endRun("time");
  }

  private draw(time: number): void {
    const phase: RenderPhase =
      this.state === "ready" || this.state === "over"
        ? this.candy && this.state === "over"
          ? this.candy.done
            ? "done"
            : "broken"
          : "menu"
        : this.state === "countdown"
          ? "choose"
          : this.state === "reveal"
            ? "reveal"
            : this.state === "playing"
              ? "play"
              : this.state;
    this.renderer.draw({
      phase,
      candy: this.candy,
      chosen: this.chosen,
      hover: this.hover,
      revealT: Math.min(1, this.revealT),
      endT: this.state === "over" ? 10 : this.endT,
      needle: {
        visible: this.hoverVisible && !this.licking,
        x: this.tipX,
        y: this.tipY,
        pressed: this.pressed,
        finger: this.touch && this.pressed ? { x: this.fingerX, y: this.fingerY } : null,
      },
      time,
      rivals: this.rivals?.list ?? [],
      pickers: this.rivals?.pickers() ?? [[], [], [], []],
      isStale: (r) => this.rivals?.stale(r) ?? false,
    });
  }
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
