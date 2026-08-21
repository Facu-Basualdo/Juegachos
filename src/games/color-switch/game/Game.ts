import {
  VIEW_H,
  MAX_DT,
  GRAVITY,
  JUMP_VY,
  BALL_X,
  BALL_R,
  CAM_RATIO,
  RING_INNER,
  RING_OUTER,
  RING_SPACING,
  RING_SPACING_MIN,
  FIRST_RING_Y,
  RING_ROT_MIN,
  RING_ROT_MAX,
  SWITCH_R,
  COLORS,
  SHAPES,
  DIFF_SATURATE,
  SPEED_MUL_MAX,
  type ShapeKind,
  BG,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  BEST_KEY,
} from "./constants";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "dead";

interface Ring {
  y: number;
  kind: ShapeKind;
  n: number; // cantidad de regiones de color
  rot: number;
  rotSpeed: number;
  colors: string[]; // n colores (incluye los 4)
  passed: boolean;
}

interface Switcher {
  y: number;
  used: boolean;
  color: string; // color al que pasa la bola (determinado al generar)
}

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

// Geometria compartida por todas las figuras: la "apotema" (linea central de la
// banda de color) es la misma para circulo y poligono, asi el hueco interior
// usable (RING_INNER) queda igual en todas. El circunradio del poligono se deriva
// de esa apotema segun N.
const POLY_APOTHEM = (RING_INNER + RING_OUTER) / 2;
const POLY_BAND = RING_OUTER - RING_INNER;
function polyR(n: number): number {
  return POLY_APOTHEM / Math.cos(Math.PI / n);
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;

  // Bola
  private ballY = 0;
  private ballVy = 0;
  private ballColor = COLORS[0];
  private camY = 0;

  // Mundo
  private rings: Ring[] = [];
  private switches: Switcher[] = [];
  private spawnY = FIRST_RING_Y;
  /** Color que tendra la bola al llegar a la proxima figura a generar. */
  private nextColor = COLORS[0];

  private lastTime = 0;
  private deadFor = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  /** flash del color equivocado / cambio, 0..1 decayente. */
  private flash = 0;
  private flashColor = "#ffffff";

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.showScore(false);
    this.hud.showStart();

    this.room = initRoomMode("color-switch", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.input = new InputController(container, () => this.onTap());

    this.resetWorld();
    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private onTap(): void {
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;
      case "playing":
        this.ballVy = JUMP_VY;
        SoundEffects.playJump();
        break;
      case "dead":
        if (this.room) return; // en sala, una corrida por ronda
        if (this.deadFor > 0.5) this.beginCountdown();
        break;
    }
  }

  private beginCountdown(): void {
    this.resetWorld();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.showScore(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.score = 0;
    this.ballVy = JUMP_VY; // arranca con un impulso para no caer de una
    this.hud.setScore(0);
    this.hud.showScore(true);
    this.hud.hide();
    this.hud.showCountdown(null);
  }

  private die(): void {
    if (this.state === "dead") return;
    this.state = "dead";
    this.deadFor = 0;
    SoundEffects.playDie();
    this.hud.showScore(false);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("color-switch", this.score);
  }

  private resetWorld(): void {
    this.ballY = 0;
    this.ballVy = 0;
    this.ballColor = COLORS[(Math.random() * COLORS.length) | 0];
    this.nextColor = this.ballColor; // la 1.a figura pide el color inicial de la bola
    this.camY = this.ballY - CAM_RATIO * VIEW_H;
    this.rings = [];
    this.switches = [];
    this.spawnY = FIRST_RING_Y;
    this.flash = 0;
    this.generate();
  }

  /** Crea anillos + cambiadores hacia arriba hasta llenar un buffer. */
  private generate(): void {
    while (this.spawnY > this.camY - VIEW_H) {
      // Figura al azar entre las desbloqueadas por el puntaje (mas score = mas
      // figuras dificiles disponibles).
      const unlocked = SHAPES.filter((s) => s.minScore <= this.score);
      const preset = unlocked[(Math.random() * unlocked.length) | 0];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const mul = speedMul(this.score); // la rotacion se acelera con el score
      // La bola llega a esta figura con `nextColor`: esa figura tiene VARIOS
      // segmentos de ese color (mas ventanas = se cruza rapido, sin esperar).
      const required = this.nextColor;
      this.rings.push({
        y: this.spawnY,
        kind: preset.kind,
        n: preset.n,
        rot: Math.random() * TAU,
        rotSpeed: dir * (RING_ROT_MIN + Math.random() * (RING_ROT_MAX - RING_ROT_MIN)) * mul,
        colors: makeColorsWithMatches(preset.n, required),
        passed: false,
      });
      // El cambiador (mas arriba) fija el color de la PROXIMA figura.
      const target = randOther(required);
      const spacing = spacingFor(this.score); // se achica con el score
      this.switches.push({ y: this.spawnY - spacing / 2, used: false, color: target });
      this.nextColor = target;
      this.spawnY -= spacing;
    }
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt, now);
    this.render(now);
    requestAnimationFrame(this.tick);
  };

  private update(dt: number, now: number): void {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);

    // Los anillos giran siempre (se ven vivos en el menu tambien).
    for (const r of this.rings) r.rot = (r.rot + r.rotSpeed * dt) % TAU;

    if (this.state === "ready" || this.state === "countdown") {
      // Bobeo suave de la bola en el menu / countdown.
      this.ballY = Math.sin(now / 300) * 12;
      this.camY = this.ballY - CAM_RATIO * VIEW_H;
      if (this.state === "countdown") this.updateCountdown(dt);
      return;
    }

    if (this.state === "playing") {
      this.ballVy += GRAVITY * dt;
      this.ballY += this.ballVy * dt;

      // Camara: sigue a la bola hacia arriba (solo baja camY = sube en el mundo).
      this.camY = Math.min(this.camY, this.ballY - CAM_RATIO * VIEW_H);

      this.generate();
      this.recycle();
      this.handleSwitches();
      this.handleRings();

      // Cayo por debajo del borde inferior.
      if (this.ballY - this.camY > VIEW_H + BALL_R) this.die();

      this.hud.setScore(this.score);
    } else if (this.state === "dead") {
      this.deadFor += dt;
      // Deja caer la bola fuera de pantalla para el remate.
      this.ballVy += GRAVITY * dt;
      this.ballY += this.ballVy * dt;
    }
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

  /** Cambiadores de color: al tocarlos, la bola pasa a otro color. */
  private handleSwitches(): void {
    for (const s of this.switches) {
      if (s.used) continue;
      if (Math.abs(this.ballY - s.y) < SWITCH_R + BALL_R) {
        s.used = true;
        this.ballColor = s.color; // color pre-determinado (coincide con la prox. figura)
        this.flash = 1;
        this.flashColor = this.ballColor;
        SoundEffects.playSwitch();
      }
    }
  }

  /** Colision con el color de la figura en el punto de cruce (vertical) + puntaje. */
  private handleRings(): void {
    for (const r of this.rings) {
      const dy = this.ballY - r.y;
      // La bola cruza por el eje vertical del centro: el contacto es abajo
      // (dy>=0) o arriba (dy<0). Se toma el borde de la figura en esa direccion.
      const phi = dy >= 0 ? HALF_PI : -HALF_PI;
      const b = borderAt(r, phi);
      const ad = Math.abs(dy);
      if (ad > b.dist - b.half - BALL_R && ad < b.dist + b.half + BALL_R) {
        if (b.color !== this.ballColor) {
          this.flash = 1;
          this.flashColor = b.color;
          this.die();
          return;
        }
      }
      // Puntaje: cuando la bola queda completamente por encima de la figura.
      if (!r.passed && this.ballY < r.y - outerRadius(r)) {
        r.passed = true;
        this.score++;
        SoundEffects.playPass();
      }
    }
  }

  private recycle(): void {
    const bottom = this.camY + VIEW_H + 120;
    this.rings = this.rings.filter((r) => r.y < bottom);
    this.switches = this.switches.filter((s) => s.y < bottom);
  }

  // ---------- Render ----------

  private render(now: number): void {
    const { ctx } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Fondo full-bleed (llena toda la pantalla, sin barras negras) + resplandor.
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);
    const glow = ctx.createRadialGradient(cw / 2, ch * 0.42, 40 * this.scale, cw / 2, ch * 0.42, Math.max(cw, ch) * 0.72);
    glow.addColorStop(0, "rgba(255,255,255,0.06)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, cw, ch);

    // Mundo: encajado al alto, centrado horizontalmente y trasladado por la camara.
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(cw / 2 / this.scale - BALL_X, -this.camY);
    for (const s of this.switches) if (!s.used) this.drawSwitch(ctx, s, now);
    for (const r of this.rings) this.drawRing(ctx, r);
    this.drawBall(ctx);
    ctx.restore();

    // Flash de pantalla (cambio de color / muerte).
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.28;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }
  }

  private drawRing(ctx: CanvasRenderingContext2D, r: Ring): void {
    const sector = TAU / r.n;
    if (r.kind === "circle") {
      const mid = (RING_INNER + RING_OUTER) / 2;
      ctx.lineWidth = RING_OUTER - RING_INNER;
      ctx.lineCap = "butt";
      for (let i = 0; i < r.n; i++) {
        ctx.beginPath();
        ctx.arc(BALL_X, r.y, mid, r.rot + i * sector, r.rot + (i + 1) * sector);
        ctx.strokeStyle = r.colors[i];
        ctx.shadowColor = r.colors[i];
        ctx.shadowBlur = 14;
        ctx.stroke();
      }
    } else {
      const R = polyR(r.n);
      ctx.lineWidth = POLY_BAND;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < r.n; i++) {
        const a0 = r.rot + i * sector;
        const a1 = r.rot + (i + 1) * sector;
        ctx.beginPath();
        ctx.moveTo(BALL_X + Math.cos(a0) * R, r.y + Math.sin(a0) * R);
        ctx.lineTo(BALL_X + Math.cos(a1) * R, r.y + Math.sin(a1) * R);
        ctx.strokeStyle = r.colors[i];
        ctx.shadowColor = r.colors[i];
        ctx.shadowBlur = 14;
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }

  private drawSwitch(ctx: CanvasRenderingContext2D, s: Switcher, now: number): void {
    const spin = now / 500;
    for (let i = 0; i < 4; i++) {
      const a = spin + i * HALF_PI;
      const x = BALL_X + Math.cos(a) * 7;
      const y = s.y + Math.sin(a) * 7;
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, TAU);
      ctx.fillStyle = COLORS[i];
      ctx.shadowColor = COLORS[i];
      ctx.shadowBlur = 8;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  private drawBall(ctx: CanvasRenderingContext2D): void {
    const x = BALL_X;
    const y = this.ballY;
    // Halo
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, TAU);
    ctx.fillStyle = this.ballColor;
    ctx.shadowColor = this.ballColor;
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Brillo especular (sticker 3D)
    const hi = ctx.createRadialGradient(x - BALL_R * 0.35, y - BALL_R * 0.4, 1, x, y, BALL_R);
    hi.addColorStop(0, "rgba(255,255,255,0.85)");
    hi.addColorStop(0.4, "rgba(255,255,255,0.15)");
    hi.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, TAU);
    ctx.fillStyle = hi;
    ctx.fill();
  }

  // ---------- Escalado del canvas ----------
  private scale = 1;

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // Encaja la caja vertical (VIEW_H) al alto de la ventana. El ancho lo llena el
    // fondo full-bleed y el juego queda centrado (es una columna 1D).
    this.scale = (h / VIEW_H) * dpr;
  };

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
  }
}

/** Radio maximo de la figura (para saber cuando la bola quedo por encima). */
function outerRadius(r: Ring): number {
  return r.kind === "circle" ? RING_OUTER : polyR(r.n) + POLY_BAND / 2;
}

/**
 * Borde de la figura en la direccion `phi` (solo se usa arriba/abajo del centro):
 * distancia al borde, medio-grosor de la banda y color de esa region. Unifica
 * circulo (radio constante) y poligono (radio = apotema / cos del angulo al lado),
 * para cualquier N.
 */
function borderAt(r: Ring, phi: number): { dist: number; half: number; color: string } {
  const sector = TAU / r.n;
  let local = (phi - r.rot) % TAU;
  if (local < 0) local += TAU;
  const idx = Math.floor(local / sector) % r.n;
  const color = r.colors[idx];
  if (r.kind === "circle") {
    return { dist: (RING_INNER + RING_OUTER) / 2, half: (RING_OUTER - RING_INNER) / 2, color };
  }
  const normal = r.rot + (idx + 0.5) * sector;
  let da = (phi - normal) % TAU;
  if (da > Math.PI) da -= TAU;
  if (da < -Math.PI) da += TAU;
  return { dist: POLY_APOTHEM / Math.max(0.35, Math.cos(da)), half: POLY_BAND / 2, color };
}

/** Multiplicador de rotacion segun el puntaje (dificultad progresiva). */
function speedMul(score: number): number {
  const t = Math.min(score, DIFF_SATURATE) / DIFF_SATURATE;
  return 1 + t * (SPEED_MUL_MAX - 1);
}

/** Separacion entre figuras segun el puntaje (se achica = mas rapido). */
function spacingFor(score: number): number {
  const t = Math.min(score, DIFF_SATURATE) / DIFF_SATURATE;
  return RING_SPACING - t * (RING_SPACING - RING_SPACING_MIN);
}

/**
 * n colores para una figura cuyo color a cruzar es `required`: se colocan VARIOS
 * segmentos de `required` (cantidad aleatoria >= 2, dejando al menos uno de otro
 * color) para que haya muchas ventanas por vuelta; el resto, colores distintos
 * (peligro). Posiciones al azar.
 */
function makeColorsWithMatches(n: number, required: string): string[] {
  const maxMatch = Math.max(2, n - 1);
  const matchCount = Math.min(maxMatch, 2 + ((Math.random() * Math.max(1, Math.floor(n / 2))) | 0));
  const others = COLORS.filter((c) => c !== required);
  const arr: string[] = [];
  for (let i = 0; i < matchCount; i++) arr.push(required);
  for (let i = matchCount; i < n; i++) arr.push(others[(Math.random() * others.length) | 0]);
  return shuffle(arr);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randOther(current: string): string {
  let c = current;
  while (c === current) c = COLORS[(Math.random() * COLORS.length) | 0];
  return c;
}
