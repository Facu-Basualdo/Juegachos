import {
  AIR_DRAG,
  ANCHOR_GAP_MAX,
  ANCHOR_GAP_MIN,
  ANCHOR_Y_MAX,
  ANCHOR_Y_MIN,
  BEST_KEY,
  BONUS_DIVISOR,
  BONUS_SPEED,
  CAMERA_EASE,
  CAMERA_PIG_VIEW_X,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  GRAVITY,
  MAX_DT,
  MAX_SPEED,
  PIG_RADIUS,
  PX_PER_POINT,
  ROPE_MIN,
  STREET_Y,
  SWING_PUMP,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WEB_AHEAD_MIN,
  WEB_RANGE,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameover";

interface Anchor {
  x: number;
  y: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  life: number; // seconds remaining
}

const FLOAT_LIFE = 1.1;
const PHYSICS_STEP = 1 / 120; // substep keeps the rope constraint stable at high speed
const TRAIL_MAX = 14; // flight trail samples kept

/** Deterministic pseudo-random in [0, 1) so the skyline renders without stored state. */
function hash(i: number): number {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private bonus = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;

  // World state (x grows to the right forever; y grows downward).
  private pigX = 0;
  private pigY = 0;
  private velX = 0;
  private velY = 0;
  private attached: Anchor | null = null;
  private ropeLen = 0;
  private webHeld = false; // input held: auto-attach as soon as an anchor is in range
  private farthestX = 0; // drives the distance score (swinging backward never subtracts)
  private cameraX = 0;
  private anchors: Anchor[] = [];
  private nextAnchorX = 0;
  private trail: { x: number; y: number }[] = [];
  private floaters: FloatingText[] = [];

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container, () => this.onPrimary());


    // En movil no hay Enter: el toque tiene que poder arrancar desde cualquier

    // parte de la pantalla, no solo desde el boton del cartel. Va sobre el

    // container (el overlay de inicio tapa al canvas) y se ignoran los <button>,

    // que ya tienen su propio handler, para no arrancar dos veces.

    container.addEventListener("pointerdown", (e) => {

      if ((e.target as HTMLElement).closest("button")) return;

      this.onPrimary();

    });
    this.hud.setBest(this.best);
    this.hud.showStart();

    this.room = initRoomMode("puerco-arana", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const scale = Math.min(parent.clientWidth / VIEW_WIDTH, parent.clientHeight / VIEW_HEIGHT, 1);
    this.canvas.style.width = `${VIEW_WIDTH * scale}px`;
    this.canvas.style.height = `${VIEW_HEIGHT * scale}px`;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.onPrimary();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (this.state === "playing") {
        if (!e.repeat) this.pressWeb();
      } else {
        this.onPrimary();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.key === " ") this.releaseWeb();
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.state !== "playing") return;
    e.preventDefault();
    this.pressWeb();
  };

  private handlePointerUp = (): void => {
    this.releaseWeb();
  };

  /** Enter / overlay button: start from the start and game-over screens. */
  private onPrimary(): void {
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "gameover" && this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    }
  }

  /** Input pressed: grab the best anchor now, or keep trying while held. */
  private pressWeb(): void {
    this.webHeld = true;
    this.tryAttach();
  }

  private releaseWeb(): void {
    this.webHeld = false;
    if (!this.attached) return;
    this.attached = null;
    SoundEffects.playRelease();

    const speed = Math.hypot(this.velX, this.velY);
    if (this.velX > 0 && speed >= BONUS_SPEED) {
      const points = Math.floor(speed / BONUS_DIVISOR);
      this.bonus += points;
      SoundEffects.playBonus(points);
      this.floaters.push({
        x: this.pigX,
        y: this.pigY - 44,
        text: `¡LANZADO! +${points}`,
        life: FLOAT_LIFE,
      });
    }
  }

  /**
   * First grabbable anchor: above the pig, at most WEB_RANGE away and not too
   * far behind; selects the first matching one found.
   */
  private tryAttach(): void {
    if (this.attached || this.state !== "playing") return;
    let bestAnchor: Anchor | null = null;
    for (const a of this.anchors) {
      const dx = a.x - this.pigX;
      if (dx < WEB_AHEAD_MIN) continue;
      if (a.y >= this.pigY - 10) continue;
      if (Math.hypot(dx, a.y - this.pigY) > WEB_RANGE) continue;
      bestAnchor = a;
      break;
    }
    if (!bestAnchor) return;

    this.attached = bestAnchor;
    this.ropeLen = Math.max(ROPE_MIN, Math.hypot(bestAnchor.x - this.pigX, bestAnchor.y - this.pigY));
    SoundEffects.playAttach();
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.bonus = 0;
    this.floaters = [];
    this.trail = [];
    this.webHeld = false;

    this.anchors = [];
    this.nextAnchorX = 250;
    this.spawnAnchorsAhead(VIEW_WIDTH * 2);

    // Start already hanging from the first anchor so the run opens mid-swing.
    this.pigX = 90;
    this.pigY = 300;
    this.velX = 260;
    this.velY = 0;
    this.farthestX = this.pigX;
    const first = this.anchors[0];
    this.attached = first;
    this.ropeLen = Math.hypot(first.x - this.pigX, first.y - this.pigY);
    this.cameraX = this.pigX - VIEW_WIDTH * CAMERA_PIG_VIEW_X;

    this.hud.setScore(0);
    this.hud.hide();

    this.lastCountdownIndex = -1;
    this.countdownTime = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
  }

  private startGameplay(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
  }

  private spawnAnchorsAhead(untilX: number): void {
    while (this.nextAnchorX < this.cameraX + untilX) {
      this.anchors.push({
        x: this.nextAnchorX,
        y: ANCHOR_Y_MIN + Math.random() * (ANCHOR_Y_MAX - ANCHOR_Y_MIN),
      });
      this.nextAnchorX += ANCHOR_GAP_MIN + Math.random() * (ANCHOR_GAP_MAX - ANCHOR_GAP_MIN);
    }
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

    // Camera eases so the pig sits at a fixed fraction of the view.
    const camTarget = this.pigX - VIEW_WIDTH * CAMERA_PIG_VIEW_X;
    this.cameraX += (camTarget - this.cameraX) * Math.min(1, dt * CAMERA_EASE);

    if (this.state !== "playing") return;

    this.trail.push({ x: this.pigX, y: this.pigY });
    if (this.trail.length > TRAIL_MAX) this.trail.shift();

    let remaining = dt;
    while (remaining > 0 && this.state === "playing") {
      const step = Math.min(PHYSICS_STEP, remaining);
      remaining -= step;
      this.stepPhysics(step);
    }

    if (this.webHeld && !this.attached) this.tryAttach();

    this.spawnAnchorsAhead(VIEW_WIDTH * 2);
    this.anchors = this.anchors.filter((a) => a === this.attached || a.x > this.cameraX - 300);

    this.farthestX = Math.max(this.farthestX, this.pigX);
    const total = Math.max(0, Math.floor(this.farthestX / PX_PER_POINT)) + this.bonus;
    if (total !== this.score) {
      this.score = total;
      this.hud.setScore(total);
    }
  }

  private stepPhysics(dt: number): void {
    this.velY += GRAVITY * dt;

    if (this.attached) {
      // Small tangential pump in the direction of motion keeps the swing alive.
      const nx = (this.pigX - this.attached.x) / this.ropeLen;
      const ny = (this.pigY - this.attached.y) / this.ropeLen;
      const tx = -ny;
      const ty = nx;
      const tangential = this.velX * tx + this.velY * ty;
      const dir = Math.sign(tangential) || 1;
      this.velX += tx * SWING_PUMP * dir * dt;
      this.velY += ty * SWING_PUMP * dir * dt;
    } else {
      this.velX -= this.velX * AIR_DRAG * dt;
    }

    const speed = Math.hypot(this.velX, this.velY);
    if (speed > MAX_SPEED) {
      this.velX = (this.velX / speed) * MAX_SPEED;
      this.velY = (this.velY / speed) * MAX_SPEED;
    }

    this.pigX += this.velX * dt;
    this.pigY += this.velY * dt;

    if (this.attached) {
      // Rope constraint: project back onto the circle and kill outward velocity.
      const dx = this.pigX - this.attached.x;
      const dy = this.pigY - this.attached.y;
      const dist = Math.hypot(dx, dy);
      if (dist > this.ropeLen && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        this.pigX = this.attached.x + nx * this.ropeLen;
        this.pigY = this.attached.y + ny * this.ropeLen;
        const radial = this.velX * nx + this.velY * ny;
        if (radial > 0) {
          this.velX -= radial * nx;
          this.velY -= radial * ny;
        }
      }
    }

    if (this.pigY + PIG_RADIUS >= STREET_Y) {
      this.pigY = STREET_Y - PIG_RADIUS;
      this.gameOver();
    }
  }

  private gameOver(): void {
    this.state = "gameover";
    this.attached = null;
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

    // Dusk sky.
    const bg = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
    bg.addColorStop(0, "#141028");
    bg.addColorStop(0.65, "#33204a");
    bg.addColorStop(1, "#5b2a44");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    this.drawSkyline(ctx, 0.25, 150, 160, "#221a3c", 190);
    this.drawSkyline(ctx, 0.55, 110, 240, "#2c2148", 240);

    if (this.state === "ready") return;

    ctx.save();
    ctx.translate(-this.cameraX, 0);

    this.drawAnchorTowers(ctx);
    this.drawStreet(ctx);
    this.drawTrail(ctx);
    this.drawWeb(ctx);
    this.drawPig(ctx);

    // Floating score texts.
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
    const count = Math.ceil(VIEW_WIDTH / slotW) + 3;
    ctx.save();
    for (let i = first; i < first + count; i++) {
      const h = minTopFromBottom + hash(i) * maxH;
      const w = slotW * (0.6 + hash(i * 3 + 1) * 0.35);
      const x = i * slotW - offset;
      const top = VIEW_HEIGHT - h;
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
    ctx.restore();
  }

  /** Foreground towers holding the web anchors, antenna up to the glowing node. */
  private drawAnchorTowers(ctx: CanvasRenderingContext2D): void {
    for (const a of this.anchors) {
      const roofY = a.y + 60;
      const w = 84;
      ctx.fillStyle = "#3a2a55";
      ctx.fillRect(a.x - w / 2, roofY, w, STREET_Y - roofY);
      ctx.fillStyle = "rgba(255, 214, 140, 0.28)";
      for (let r = 0; r < Math.floor((STREET_Y - roofY) / 30); r++) {
        for (let c = 0; c < 3; c++) {
          if (hash(a.x * 3 + r * 17 + c * 5) > 0.6) {
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

      const glow = a === this.attached ? 1 : 0.55;
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.fillStyle = "#ff5d8f";
      ctx.shadowColor = "#ff5d8f";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawStreet(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#181022";
    ctx.fillRect(this.cameraX - 50, STREET_Y, VIEW_WIDTH + 100, VIEW_HEIGHT - STREET_Y);
    ctx.strokeStyle = "rgba(255, 214, 140, 0.4)";
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 22]);
    ctx.beginPath();
    ctx.moveTo(this.cameraX - 50, STREET_Y + 26);
    ctx.lineTo(this.cameraX + VIEW_WIDTH + 50, STREET_Y + 26);
    ctx.stroke();
    ctx.setLineDash([]);
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
    if (!this.attached) return;
    ctx.save();
    ctx.strokeStyle = "rgba(240, 240, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.attached.x, this.attached.y);
    ctx.lineTo(this.pigX, this.pigY);
    ctx.stroke();
    ctx.restore();
  }

  private drawPig(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pigX, this.pigY);

    // Lean into the swing / flight direction.
    const tilt = this.attached
      ? Math.atan2(this.pigY - this.attached.y, this.pigX - this.attached.x) - Math.PI / 2
      : Math.max(-0.5, Math.min(0.5, this.velY / 1400));
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
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
