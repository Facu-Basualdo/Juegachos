import {
  BEST_KEY,
  BONUS_DIVISOR,
  BONUS_SPEED,
  CAMERA_EASE,
  CAMERA_MIN_AHEAD,
  CAMERA_PIG_VIEW_X,
  CAMERA_PIG_VIEW_X_MIN,
  CAMERA_TOP_MARGIN,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  FIRST_ANCHOR_X,
  MAX_DPR,
  MAX_DT,
  MIN_VIEW_WIDTH,
  PHYSICS_STEP,
  PIG_RADIUS,
  PX_PER_POINT,
  START_VX,
  START_X,
  START_Y,
  STREET_Y,
  WORLD_HEIGHT,
} from "./constants";
import { attach, nextAnchor, pickAnchor, stepPig, type Anchor, type Pig } from "./Swing";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameover";

interface FloatingText {
  x: number;
  y: number;
  text: string;
  life: number; // seconds remaining
}

const FLOAT_LIFE = 1.1;
const TRAIL_MAX = 14; // flight trail samples kept
const FIRST_ANCHOR_Y = 140; // the opening anchor is fixed so every run starts the same swing

/** Deterministic pseudo-random in [0, 1) so the skyline renders without stored state. */
function hash(i: number): number {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export class Game {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private bonus = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;

  // Viewport: the canvas fills the container; the visible world adapts to it.
  private dpr = 1;
  private scale = 1; // CSS px per world px
  private viewW = MIN_VIEW_WIDTH;
  private viewH = WORLD_HEIGHT;

  // World state (x grows to the right forever; y grows downward).
  // Starts at the run's opening spot so the start screen frames the city like the run will.
  private readonly pig: Pig = { x: START_X, y: START_Y, vx: 0, vy: 0, attached: null, rope: 0, ropeTarget: 0 };
  private webHeld = false; // input held: auto-attach as soon as an anchor is in range
  private target: Anchor | null = null; // what a press would grab right now
  private farthestX = 0; // drives the distance score (swinging backward never subtracts)
  private cameraX = 0;
  private cameraY = 0;
  private anchors: Anchor[] = [];
  private trail: { x: number; y: number }[] = [];
  private floaters: FloatingText[] = [];

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = 0;
  private clock = 0; // seconds since load, drives the target pulse

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container, () => this.onPrimary());
    this.hud.setBest(this.best);
    this.hud.showStart();

    this.room = initRoomMode("puerco-arana", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    // The press goes on the container, not the canvas: the start / game-over
    // overlay covers the canvas, and on a phone the letterbox around it must
    // also count. The overlay button has its own click handler.
    container.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    // A lost keyup / pointerup (tab switch, alt-tab) must not leave the web stuck on.
    window.addEventListener("blur", this.handlePointerUp);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private resize = (): void => {
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    if (cw === 0 || ch === 0) return;
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.scale = Math.min(ch / WORLD_HEIGHT, cw / MIN_VIEW_WIDTH);
    this.viewW = cw / this.scale;
    this.viewH = ch / this.scale;
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.snapCamera();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.onPrimary();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (e.repeat) return;
      if (this.state === "playing" || this.state === "countdown") this.pressWeb();
      else this.onPrimary();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.key === " ") this.releaseWeb();
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (this.state === "playing" || this.state === "countdown") {
      e.preventDefault();
      this.pressWeb();
    } else {
      this.onPrimary();
    }
  };

  private handlePointerUp = (): void => {
    this.releaseWeb();
  };

  /** Enter / tap / overlay button: start from the start and game-over screens. */
  private onPrimary(): void {
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "gameover" && this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    }
  }

  /** Input pressed: grab the targeted anchor now, or keep trying while held. */
  private pressWeb(): void {
    this.webHeld = true;
    this.tryAttach();
  }

  private releaseWeb(): void {
    this.webHeld = false;
    // During the countdown the pig hangs from the opening anchor: letting go of
    // a key held through "3 2 1" must not drop it before the run even starts.
    if (this.state !== "playing") return;
    const from = this.pig.attached;
    if (!from) return;
    this.pig.attached = null;
    SoundEffects.playRelease();

    const speed = Math.hypot(this.pig.vx, this.pig.vy);
    if (this.pig.vx > 0 && speed >= BONUS_SPEED && !from.paid) {
      // One bonus per anchor: tapping on the same web cannot farm points.
      from.paid = true;
      const points = Math.floor(speed / BONUS_DIVISOR);
      this.bonus += points;
      SoundEffects.playBonus(points);
      this.floaters.push({
        x: this.pig.x,
        y: this.pig.y - 44,
        text: `¡LANZADO! +${points}`,
        life: FLOAT_LIFE,
      });
    }
  }

  private tryAttach(): void {
    if (this.pig.attached || this.state !== "playing") return;
    const anchor = pickAnchor(this.pig, this.anchors);
    if (!anchor) return;
    attach(this.pig, anchor);
    SoundEffects.playAttach();
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.bonus = 0;
    this.floaters = [];
    this.trail = [];
    this.target = null;

    // Start already hanging from a fixed opening anchor so the countdown flows
    // into a swing and not into a fall.
    const first: Anchor = { x: FIRST_ANCHOR_X, y: FIRST_ANCHOR_Y, paid: false };
    this.anchors = [first];
    this.pig.x = START_X;
    this.pig.y = START_Y;
    this.pig.vx = START_VX;
    this.pig.vy = 0;
    attach(this.pig, first);
    this.farthestX = this.pig.x;

    // Camera first, then the anchors ahead of it (spawning against the previous
    // run's camera used to generate thousands of anchors on every retry).
    this.snapCamera();
    this.spawnAnchorsAhead();

    this.hud.setScore(0);
    this.hud.hide();

    this.lastCountdownIndex = -1;
    this.countdownTime = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
  }

  private startGameplay(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
  }

  private spawnAnchorsAhead(): void {
    let last = this.anchors[this.anchors.length - 1];
    let index = this.anchors.length;
    const limit = this.cameraX + this.viewW + 600;
    while (last.x < limit) {
      last = nextAnchor(last.x, index++, Math.random);
      this.anchors.push(last);
    }
  }

  private cameraTargetX(): number {
    const fraction = Math.max(CAMERA_PIG_VIEW_X_MIN, Math.min(CAMERA_PIG_VIEW_X, 1 - CAMERA_MIN_AHEAD / this.viewW));
    return this.pig.x - this.viewW * fraction;
  }

  /** The street stays at the bottom edge; the view rises only to keep the pig on screen. */
  private cameraTargetY(): number {
    return Math.min(WORLD_HEIGHT - this.viewH, this.pig.y - CAMERA_TOP_MARGIN);
  }

  private snapCamera(): void {
    this.cameraX = this.cameraTargetX();
    this.cameraY = this.cameraTargetY();
  }

  private tick = (now: number): void => {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    this.clock += dt;
    for (const f of this.floaters) f.life -= dt;
    this.floaters = this.floaters.filter((f) => f.life > 0);

    if (this.state === "countdown") {
      this.countdownTime -= dt;
      if (this.countdownTime <= 0) {
        this.startGameplay();
      } else {
        const total = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
        const idx = Math.max(0, Math.min(COUNTDOWN_LABELS.length - 1, Math.floor((total - this.countdownTime) / COUNTDOWN_STEP)));
        if (idx !== this.lastCountdownIndex) {
          this.lastCountdownIndex = idx;
          SoundEffects.playCountdownTick();
        }
        this.hud.showCountdown(COUNTDOWN_LABELS[idx]);
      }
      return;
    }

    if (this.state !== "playing" && this.state !== "gameover") return;

    const ease = Math.min(1, dt * CAMERA_EASE);
    this.cameraX += (this.cameraTargetX() - this.cameraX) * ease;
    this.cameraY += (this.cameraTargetY() - this.cameraY) * ease;

    if (this.state !== "playing") return;

    this.trail.push({ x: this.pig.x, y: this.pig.y });
    if (this.trail.length > TRAIL_MAX) this.trail.shift();

    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(PHYSICS_STEP, remaining);
      remaining -= step;
      if (stepPig(this.pig, step)) {
        this.pig.y = STREET_Y - PIG_RADIUS;
        this.gameOver();
        return;
      }
    }

    if (this.webHeld && !this.pig.attached) this.tryAttach();
    this.target = this.pig.attached ? null : pickAnchor(this.pig, this.anchors);

    this.spawnAnchorsAhead();
    this.anchors = this.anchors.filter((a) => a === this.pig.attached || a.x > this.cameraX - 400);

    this.farthestX = Math.max(this.farthestX, this.pig.x);
    const total = Math.floor((this.farthestX - START_X) / PX_PER_POINT) + this.bonus;
    if (total !== this.score) {
      this.score = total;
      this.hud.setScore(total);
    }
  }

  private gameOver(): void {
    this.state = "gameover";
    this.pig.attached = null;
    this.target = null;
    this.webHeld = false;
    SoundEffects.playSplat();
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("puerco-arana", this.score);
  }

  private draw(): void {
    const ctx = this.ctx;
    const k = this.dpr * this.scale;
    ctx.setTransform(k, 0, 0, k, 0, 0);

    // Dusk sky (screen space).
    const bg = ctx.createLinearGradient(0, 0, 0, this.viewH);
    bg.addColorStop(0, "#141028");
    bg.addColorStop(0.65, "#33204a");
    bg.addColorStop(1, "#5b2a44");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Everything below lives in world y (the skyline sinks when the view rises).
    ctx.save();
    ctx.translate(0, -this.cameraY);
    this.drawSkyline(ctx, 0.25, 150, 160, "#221a3c", 190);
    this.drawSkyline(ctx, 0.55, 110, 240, "#2c2148", 240);

    if (this.state !== "ready") {
      ctx.translate(-this.cameraX, 0);
      this.drawAnchorTowers(ctx);
      this.drawStreet(ctx);
      this.drawTarget(ctx);
      this.drawTrail(ctx);
      this.drawWeb(ctx);
      this.drawPig(ctx);
      this.drawFloaters(ctx);
    } else {
      this.drawStreet(ctx, 0);
    }
    ctx.restore();
  }

  /** Parallax skyline layer rendered from the deterministic hash (no stored state). */
  private drawSkyline(
    ctx: CanvasRenderingContext2D,
    parallax: number,
    slotW: number,
    maxH: number,
    color: string,
    minTopFromBottom: number,
  ): void {
    const offset = this.cameraX * parallax;
    const first = Math.floor(offset / slotW) - 1;
    const count = Math.ceil(this.viewW / slotW) + 3;
    for (let i = first; i < first + count; i++) {
      const h = minTopFromBottom + hash(i) * maxH;
      const w = slotW * (0.6 + hash(i * 3 + 1) * 0.35);
      const x = i * slotW - offset;
      const top = WORLD_HEIGHT - h;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, w, h);

      // Lit windows.
      ctx.fillStyle = "rgba(255, 214, 140, 0.35)";
      const cols = Math.max(2, Math.floor(w / 22));
      const rows = Math.max(3, Math.floor(h / 34));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (hash(i * 91 + c * 13 + r * 7) > 0.72) {
            ctx.fillRect(x + 6 + c * (w - 12) / cols, top + 10 + r * (h - 20) / rows, 6, 8);
          }
        }
      }
    }
  }

  /** Foreground towers holding the web anchors, antenna up to the glowing node. */
  private drawAnchorTowers(ctx: CanvasRenderingContext2D): void {
    const left = this.cameraX - 60;
    const right = this.cameraX + this.viewW + 60;
    for (const a of this.anchors) {
      if (a.x < left || a.x > right) continue;
      const roofY = a.y + 60;
      const w = 84;
      ctx.fillStyle = "#3a2a55";
      ctx.fillRect(a.x - w / 2, roofY, w, STREET_Y - roofY);
      ctx.fillStyle = "rgba(255, 214, 140, 0.28)";
      for (let r = 0; r < Math.floor((STREET_Y - roofY) / 30); r++) {
        for (let c = 0; c < 3; c++) {
          if (hash(Math.round(a.x) * 3 + r * 17 + c * 5) > 0.6) {
            ctx.fillRect(a.x - w / 2 + 12 + c * 24, roofY + 10 + r * 30, 8, 10);
          }
        }
      }

      // Antenna and anchor node.
      ctx.strokeStyle = "#6a5a8c";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, roofY);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();

      const lit = a === this.pig.attached || a === this.target;
      ctx.save();
      ctx.globalAlpha = lit ? 1 : 0.6;
      ctx.fillStyle = "#ff5d8f";
      ctx.shadowColor = "#ff5d8f";
      ctx.shadowBlur = lit ? 18 : 10;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawStreet(ctx: CanvasRenderingContext2D, x0 = this.cameraX): void {
    ctx.fillStyle = "#181022";
    ctx.fillRect(x0 - 50, STREET_Y, this.viewW + 100, WORLD_HEIGHT - STREET_Y + 400);
    ctx.strokeStyle = "rgba(255, 214, 140, 0.4)";
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 22]);
    ctx.lineDashOffset = x0 % 48;
    ctx.beginPath();
    ctx.moveTo(x0 - 50, STREET_Y + 26);
    ctx.lineTo(x0 + this.viewW + 50, STREET_Y + 26);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  /**
   * What a press would grab right now: a pulsing ring on the anchor and a faint
   * dotted line to it. No ring means nothing is in reach, so letting go is a gamble.
   */
  private drawTarget(ctx: CanvasRenderingContext2D): void {
    const t = this.target;
    if (!t || this.state !== "playing") return;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 10);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 210, 227, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(this.pig.x, this.pig.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffd2e3";
    ctx.globalAlpha = 0.55 + pulse * 0.45;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 15 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Fading ghost circles along the recent path, drawn under the pig. */
  private drawTrail(ctx: CanvasRenderingContext2D): void {
    if (this.trail.length === 0) return;
    ctx.save();
    for (let i = 0; i < this.trail.length; i++) {
      const t = (i + 1) / this.trail.length;
      ctx.globalAlpha = t * 0.18;
      ctx.fillStyle = "#ff9ec4";
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, PIG_RADIUS * (0.35 + t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWeb(ctx: CanvasRenderingContext2D): void {
    const a = this.pig.attached;
    if (!a) return;
    ctx.save();
    ctx.strokeStyle = "rgba(240, 240, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(this.pig.x, this.pig.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawFloaters(ctx: CanvasRenderingContext2D): void {
    for (const f of this.floaters) {
      const alpha = Math.min(1, f.life / FLOAT_LIFE + 0.2);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ffd27f";
      ctx.font = "bold 22px 'Courier New', Courier, monospace";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - (FLOAT_LIFE - f.life) * 40);
      ctx.restore();
    }
  }

  private drawPig(ctx: CanvasRenderingContext2D): void {
    const pig = this.pig;
    ctx.save();
    ctx.translate(pig.x, pig.y);

    // Lean into the swing / flight direction.
    const tilt = pig.attached
      ? Math.atan2(pig.y - pig.attached.y, pig.x - pig.attached.x) - Math.PI / 2
      : Math.max(-0.5, Math.min(0.5, pig.vy / 1400));
    ctx.rotate(tilt * 0.5);

    // Body.
    const grad = ctx.createRadialGradient(-5, -6, 4, 0, 0, PIG_RADIUS + 2);
    grad.addColorStop(0, "#ffb9d2");
    grad.addColorStop(1, "#f2789f");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, PIG_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Ears.
    ctx.fillStyle = "#f2789f";
    ctx.beginPath();
    ctx.moveTo(-12, -12);
    ctx.lineTo(-16, -24);
    ctx.lineTo(-4, -16);
    ctx.closePath();
    ctx.moveTo(12, -12);
    ctx.lineTo(16, -24);
    ctx.lineTo(4, -16);
    ctx.closePath();
    ctx.fill();

    // Spider mask band with web lines across the eyes.
    ctx.fillStyle = "#d8324a";
    ctx.fillRect(-PIG_RADIUS, -9, PIG_RADIUS * 2, 9);
    ctx.strokeStyle = "rgba(20, 8, 12, 0.5)";
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 7, -9);
      ctx.lineTo(i * 7, 0);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-PIG_RADIUS, -4.5);
    ctx.lineTo(PIG_RADIUS, -4.5);
    ctx.stroke();

    // Mask eyes.
    ctx.fillStyle = "#f4f7ff";
    ctx.beginPath();
    ctx.ellipse(-7, -4.5, 4.5, 3.2, -0.2, 0, Math.PI * 2);
    ctx.ellipse(7, -4.5, 4.5, 3.2, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Snout.
    ctx.fillStyle = "#ffa1bf";
    ctx.beginPath();
    ctx.ellipse(0, 6, 8.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c2476b";
    ctx.beginPath();
    ctx.arc(-3, 6, 1.6, 0, Math.PI * 2);
    ctx.arc(3, 6, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Little legs.
    ctx.strokeStyle = "#f2789f";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-8, PIG_RADIUS - 3);
    ctx.lineTo(-10, PIG_RADIUS + 7);
    ctx.moveTo(8, PIG_RADIUS - 3);
    ctx.lineTo(10, PIG_RADIUS + 7);
    ctx.stroke();

    ctx.restore();
  }

  destroy(): void {
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("blur", this.handlePointerUp);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
