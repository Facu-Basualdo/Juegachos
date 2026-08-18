import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  INITIAL_LIVES,
  CIVILIAN_PENALTY,
  MISS_PENALTY,
  MAX_DT,
  ROOM_ROUND_SEC,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./constants";
import { Background } from "./Background";
import { Crosshair } from "./Crosshair";
import { Hud } from "./Hud";
import { Spawner } from "./Spawner";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "gameover";

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly background = new Background();
  private readonly spawner = new Spawner();
  private crosshair!: Crosshair;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lives = INITIAL_LIVES;

  private countdownTime = 0;
  private lastTime = 0;

  // ── Modo sala (multijugador): activo solo con ?room= en la URL ────
  private readonly room: RoomMode | null;
  /** Cuenta atras de la ronda a tiempo en modo sala (segundos). */
  private roomTimer = 0;

  // ── Screen-shake on hit taken ─────────────────────────────────────
  private shakeTimer = 0;
  private shakeIntensity = 0;

  // ── Damage vignette flash ─────────────────────────────────────────
  private damageFlash = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.crosshair = new Crosshair(this.canvas);

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
    this.hud.setLives(INITIAL_LIVES);
    this.hud.showStart();
    this.hud.mountPopupCanvas(this.canvas);

    this.room = initRoomMode("western-shoot", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.canvas.addEventListener("pointerdown", this.handlePointer);
    window.addEventListener("keydown", this.handleKeyDown);

    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ── Sizing ────────────────────────────────────────────────────────

  private resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const scale = Math.min(parent.clientWidth / VIEW_WIDTH, parent.clientHeight / VIEW_HEIGHT, 1);
    this.canvas.style.width = `${VIEW_WIDTH * scale}px`;
    this.canvas.style.height = `${VIEW_HEIGHT * scale}px`;
    this.hud.syncPopupSize(this.canvas);
  };

  // ── Input ─────────────────────────────────────────────────────────

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.onPrimary();
    }
  };

  private handlePointer = (e: PointerEvent): void => {
    e.preventDefault();
    // Update crosshair position from the click itself
    const rect = this.canvas.getBoundingClientRect();
    this.crosshair.x = (e.clientX - rect.left) * (VIEW_WIDTH / rect.width);
    this.crosshair.y = (e.clientY - rect.top) * (VIEW_HEIGHT / rect.height);

    if (this.state === "playing") {
      this.shoot();
    } else {
      this.onPrimary();
    }
  };

  private onPrimary(): void {
    // En modo sala el inicio lo dispara RoomMode (onStart) y no hay reintento:
    // una sola partida por ronda.
    if (this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    }
  }

  // ── Game flow ─────────────────────────────────────────────────────

  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.spawner.reset();
    this.shakeTimer = 0;
    this.damageFlash = 0;

    this.hud.setScore(0);
    this.hud.setLevel(0);
    this.hud.hide();

    if (this.room) {
      // Ronda a tiempo: sin vidas, gana quien mas puntos hace en 1 minuto.
      this.roomTimer = ROOM_ROUND_SEC;
      this.hud.setLives(-1);
      this.hud.setTimer(ROOM_ROUND_SEC);
    } else {
      this.hud.setLives(INITIAL_LIVES);
      this.hud.setTimer(null);
    }

    this.countdownTime = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
  }

  private startGameplay(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
  }

  private shoot(): void {
    const mx = this.crosshair.x;
    const my = this.crosshair.y;

    this.crosshair.shoot();
    SoundEffects.playShoot();

    // Priority: enemies > civilians > targets (check front-to-back)
    // Check enemies first (most urgent)
    for (const enemy of this.spawner.enemies) {
      if (enemy.hitTest(mx, my)) {
        enemy.onDowned();
        SoundEffects.playEnemyDown();
        this.hud.addPopup("DERRIBADO", mx, my - 10, "#f39c12");
        return;
      }
    }

    // Check civilians
    for (const civ of this.spawner.civilians) {
      if (civ.hitTest(mx, my)) {
        civ.onHit();
        this.score = Math.max(0, this.score - CIVILIAN_PENALTY);
        this.hud.setScore(this.score);
        SoundEffects.playCivilianHit();
        this.hud.addPopup(`-${CIVILIAN_PENALTY}`, mx, my - 10, "#e74c3c");
        return;
      }
    }

    // Check targets (smallest first for fair play — they're harder to hit)
    const sortedTargets = [...this.spawner.targets]
      .filter(t => !t.destroying)
      .sort((a, b) => a.radius - b.radius);

    for (const target of sortedTargets) {
      if (target.hitTest(mx, my)) {
        target.destroy();
        this.score += target.points;
        this.hud.setScore(this.score);
        SoundEffects.playTargetHit();
        this.hud.addPopup(`+${target.points}`, mx, my - 10, "#2ecc71");
        return;
      }
    }

    // Miss — wasted bullet, subtract points (can go negative)
    this.score -= MISS_PENALTY;
    this.hud.setScore(this.score);
    SoundEffects.playMiss();
    this.hud.addPopup(`-${MISS_PENALTY}`, mx, my - 10, "#e74c3c");
  }

  private takeDamage(): void {
    this.shakeTimer = 0.3;
    this.shakeIntensity = 8;
    this.damageFlash = 0.4;
    SoundEffects.playEnemyShoot();

    // En salas la ronda es a tiempo: el disparo enemigo sacude la pantalla pero
    // no quita vidas ni termina la partida (dura 1 minuto fijo).
    if (this.room) return;

    this.lives--;
    this.hud.setLives(this.lives);

    if (this.lives <= 0) {
      this.gameOver();
    }
  }

  private gameOver(): void {
    this.state = "gameover";
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    SoundEffects.playGameOver();
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("western-shoot", this.score);
  }

  // ── Game loop ─────────────────────────────────────────────────────

  private tick = (now: number): void => {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    this.crosshair.update(dt);
    this.hud.updatePopups(dt);

    // Shake decay
    if (this.shakeTimer > 0) this.shakeTimer -= dt;
    if (this.damageFlash > 0) this.damageFlash -= dt;

    if (this.state === "countdown") {
      this.countdownTime -= dt;
      if (this.countdownTime <= 0) {
        this.startGameplay();
      } else {
        const total = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
        const idx = Math.floor((total - this.countdownTime) / COUNTDOWN_STEP);
        this.hud.showCountdown(COUNTDOWN_LABELS[Math.max(0, Math.min(COUNTDOWN_LABELS.length - 1, idx))]);
      }
      return;
    }

    if (this.state === "playing") {
      // Ronda a tiempo en modo sala: al agotarse el minuto termina la partida.
      if (this.room) {
        this.roomTimer -= dt;
        this.hud.setTimer(Math.max(0, this.roomTimer));
        if (this.roomTimer <= 0) {
          this.gameOver();
          return;
        }
      }

      const prevLevel = this.spawner.level;
      this.spawner.update(dt);

      if (this.spawner.level > prevLevel) {
        this.hud.setLevel(this.spawner.level);
      }

      // Check if any enemy has fired (hasFired is true for one frame)
      for (const enemy of this.spawner.enemies) {
        if (enemy.hasFired && enemy.alive) {
          this.takeDamage();
        }
      }
    }
  }

  private draw(): void {
    const ctx = this.ctx;

    ctx.save();

    // ── Screen shake ────────────────────────────────────────────────
    if (this.shakeTimer > 0) {
      const ox = (Math.random() - 0.5) * this.shakeIntensity * 2;
      const oy = (Math.random() - 0.5) * this.shakeIntensity * 2;
      ctx.translate(ox, oy);
    }

    // ── Background ──────────────────────────────────────────────────
    this.background.draw(ctx);

    if (this.state === "playing" || this.state === "gameover") {
      // ── Draw targets ──────────────────────────────────────────────
      for (const t of this.spawner.targets) t.draw(ctx);

      // ── Draw civilians ────────────────────────────────────────────
      for (const c of this.spawner.civilians) c.draw(ctx);

      // ── Draw enemies ──────────────────────────────────────────────
      for (const e of this.spawner.enemies) e.draw(ctx);
    }

    // ── Damage vignette ─────────────────────────────────────────────
    if (this.damageFlash > 0) {
      const alpha = this.damageFlash * 0.6;
      const vignette = ctx.createRadialGradient(
        VIEW_WIDTH / 2, VIEW_HEIGHT / 2, VIEW_WIDTH * 0.2,
        VIEW_WIDTH / 2, VIEW_HEIGHT / 2, VIEW_WIDTH * 0.7,
      );
      vignette.addColorStop(0, "rgba(200,0,0,0)");
      vignette.addColorStop(1, `rgba(200,0,0,${alpha})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    }

    // ── Crosshair (always on top) ───────────────────────────────────
    if (this.state === "playing") {
      this.crosshair.draw(ctx);
    }

    ctx.restore();

    // ── Floating popups (drawn on separate canvas) ──────────────────
    this.hud.drawPopups();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.resize);
    this.crosshair.destroy();
    this.canvas.remove();
  }
}
