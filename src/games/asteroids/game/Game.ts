import { Ship } from "./Ship";
import { Asteroid } from "./Asteroid";
import { Laser } from "./Laser";
import { Particle } from "./Particle";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  STAR_COUNT,
  LASER_COOLDOWN,
  MAX_LASERS,
  ASTEROID_SPAWN_INTERVAL,
  SHIP_ROTATION_SPEED,
} from "./constants";

type State = "ready" | "countdown" | "playing" | "gameover";

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  twinkleSpeed: number;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  alpha: number;
  color: string;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private input!: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private bestScore = 0;
  private level = 1;

  private ship!: Ship;
  private asteroids: Asteroid[] = [];
  private lasers: Laser[] = [];
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private scorePopups: ScorePopup[] = [];

  // Frame management
  private lastTime = 0;
  private laserCooldownRemaining = 0;
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private asteroidSpawnTimer = 0;

  // Screen shake
  private shakeTime = 0;
  private shakeAmount = 0;

  // Mouse control (desktop only; gated on pointerType === "mouse" so touch keeps
  // using the on-screen buttons). Aim: the ship turns toward the cursor at its
  // normal rotation speed. Left click shoots; right click (held) thrusts.
  private mouseX = 0;
  private mouseY = 0;
  private mouseAimActive = false;
  private mouseThrust = false;

  constructor(container: HTMLElement) {
    // Create canvas
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    // Initialize HUD
    this.hud = new Hud(container, () => this.handleStartAction());

    // En movil no hay Enter: el toque tiene que poder arrancar desde cualquier
    // parte de la pantalla, no solo desde el boton del cartel. Va sobre el
    // container (el overlay de inicio tapa al canvas) y se ignoran los <button>,
    // que ya tienen su propio handler, para no arrancar dos veces.
    container.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.handleStartAction();
    });
    this.bestScore = Number(localStorage.getItem(BEST_KEY) || 0);
    this.hud.setBest(this.bestScore);
    this.hud.showStart();

    this.room = initRoomMode("asteroids", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    // Initialize entities
    this.initGameObjects();

    // Input Controller
    this.input = new InputController(
      container,
      () => this.fireLaser(),
      () => this.handleStartAction()
    );

    // Mouse control (desktop): aim toward cursor, left click fires, right click
    // holds thrust. Touch is untouched (handled by the on-screen buttons).
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);

    // Resize canvas to fill window
    this.resize();
    window.addEventListener("resize", this.resize);

    // Initialise background stars
    this.generateStarfield();

    // Start game loop
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private initGameObjects(): void {
    const midX = window.innerWidth / 2;
    const midY = window.innerHeight / 2;
    this.ship = new Ship(midX, midY);
    this.asteroids = [];
    this.lasers = [];
    this.particles = [];
    this.scorePopups = [];
  }

  private generateStarfield(): void {
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.8 + 0.2,
        twinkleSpeed: Math.random() * 2 + 1,
      });
    }
  }

  private handleStartAction(): void {
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "gameover" && this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    }
  }

  private beginCountdown(): void {
    this.state = "countdown";
    this.score = 0;
    this.level = 1;
    this.hud.setScore(0);
    this.hud.hide();

    // Re-initialize objects
    this.initGameObjects();
    this.ship.lives = 1;
    this.hud.setLives(1);

    // Spawn initial wave (more asteroids for higher base difficulty)
    this.spawnAsteroidsWave(6);

    this.countdownTime = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
    this.lastCountdownIndex = -1;
  }

  private startGameplay(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
    this.hud.hide();
    this.asteroidSpawnTimer = ASTEROID_SPAWN_INTERVAL;
  }

  private spawnAsteroidsWave(count: number): void {
    const minSafeDist = 220; // Ensure asteroids spawn away from the ship
    const sx = this.ship ? this.ship.x : window.innerWidth / 2;
    const sy = this.ship ? this.ship.y : window.innerHeight / 2;

    for (let i = 0; i < count; i++) {
      let x = 0;
      let y = 0;
      let dist = 0;
      let attempts = 0;

      // Keep picking random coordinates until they are far enough from the ship
      do {
        x = Math.random() * window.innerWidth;
        y = Math.random() * window.innerHeight;
        dist = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy));
        attempts++;
      } while (dist < minSafeDist && attempts < 100);

      this.asteroids.push(new Asteroid(x, y, 3)); // 3 = Large
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse") return;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseAimActive = true;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse") return;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseAimActive = true;
    if (e.button === 2) {
      this.mouseThrust = true;
    } else if (e.button === 0) {
      this.fireLaser();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse") return;
    if (e.button === 2) this.mouseThrust = false;
  };

  private onContextMenu = (e: Event): void => {
    // Right click is "thrust" during play; suppress the browser menu.
    e.preventDefault();
  };

  /** Rotates the ship toward an absolute angle, capped at its turn rate so mouse
   *  aim keeps the same maneuverability limit as the keyboard. */
  private aimToward(targetAngle: number, dt: number): void {
    let diff = targetAngle - this.ship.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest signed delta
    const maxStep = SHIP_ROTATION_SPEED * dt;
    if (Math.abs(diff) <= maxStep) this.ship.angle = targetAngle;
    else this.ship.angle += Math.sign(diff) * maxStep;
  }

  private fireLaser(): void {
    if (this.state !== "playing") return;
    if (this.lasers.length >= MAX_LASERS) return;
    if (this.laserCooldownRemaining > 0) return;

    // Laser position starts at ship nose
    const noseLength = this.ship.radius * 1.2;
    const lx = this.ship.x + Math.cos(this.ship.angle) * noseLength;
    const ly = this.ship.y + Math.sin(this.ship.angle) * noseLength;

    this.lasers.push(new Laser(lx, ly, this.ship.angle, this.ship.vx, this.ship.vy));
    this.laserCooldownRemaining = LASER_COOLDOWN;

    SoundEffects.playLaser();
  }

  private triggerScreenShake(amount: number, duration: number): void {
    this.shakeAmount = amount;
    this.shakeTime = duration;
  }

  private handlePlayerDeath(): void {
    this.ship.lives--;
    this.hud.setLives(this.ship.lives);

    // Create a spectacular explosion of cian ship fragments
    for (let i = 0; i < 40; i++) {
      this.particles.push(new Particle(this.ship.x, this.ship.y, "#00f3ff"));
    }

    this.triggerScreenShake(20, 0.6);
    SoundEffects.playLoseLife();

    if (this.ship.lives <= 0) {
      this.state = "gameover";
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        localStorage.setItem(BEST_KEY, String(this.bestScore));
        this.hud.setBest(this.bestScore);
      }
      this.hud.showGameOver(this.score, this.bestScore);
      if (this.room) this.room.reportScore(this.score);
      else this.hud.showRanking("asteroids", this.score);
    } else {
      // Clean up nearby asteroids so user doesn't die immediately on respawn
      const safeRadius = 150;
      const midX = window.innerWidth / 2;
      const midY = window.innerHeight / 2;

      this.asteroids = this.asteroids.filter((ast) => {
        const d = Math.sqrt((ast.x - midX) * (ast.x - midX) + (ast.y - midY) * (ast.y - midY));
        if (d < safeRadius) {
          // Relocate the asteroid rather than deleting it
          let newX = 0;
          let newY = 0;
          let newD = 0;
          let attempts = 0;
          do {
            newX = Math.random() * window.innerWidth;
            newY = Math.random() * window.innerHeight;
            newD = Math.sqrt((newX - midX) * (newX - midX) + (newY - midY) * (newY - midY));
            attempts++;
          } while (newD < safeRadius + 50 && attempts < 100);

          ast.x = newX;
          ast.y = newY;
        }
        return true;
      });

      this.ship.reset(midX, midY);
    }
  }

  private spawnScorePopup(x: number, y: number, points: number, color: string): void {
    this.scorePopups.push({
      x,
      y,
      text: `+${points}`,
      alpha: 1.0,
      color,
    });
  }

  private resize = (): void => {
    // Correct canvas layout for high density displays
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
    this.generateStarfield();
  };

  private tick = (now: number): void => {
    // Calculate delta time in seconds, clamp to prevent large jumps
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // 1. Update Screenshake
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      if (this.shakeTime < 0) this.shakeTime = 0;
    }

    // 2. Update Twinkling Background Stars
    this.stars.forEach((star) => {
      // Twinkle effect (sine wave alpha variation)
      star.alpha += Math.sin(performance.now() / 200 * star.twinkleSpeed) * 0.01;
      star.alpha = Math.max(0.1, Math.min(1.0, star.alpha));

      // Drift stars opposite to ship velocity to create 3D parallax scrolling
      star.x -= this.ship.vx * dt * 0.07;
      star.y -= this.ship.vy * dt * 0.07;

      // Wrap stars
      if (star.x < 0) star.x += width;
      if (star.x > width) star.x -= width;
      if (star.y < 0) star.y += height;
      if (star.y > height) star.y -= height;
    });

    // 3. Handle Countdown State
    if (this.state === "countdown") {
      this.countdownTime -= dt;
      if (this.countdownTime <= 0) {
        this.startGameplay();
      } else {
        const totalDuration = COUNTDOWN_LABELS.length * COUNTDOWN_STEP;
        const elapsedTime = totalDuration - this.countdownTime;
        const stepIdx = Math.floor(elapsedTime / COUNTDOWN_STEP);
        const index = Math.max(0, Math.min(COUNTDOWN_LABELS.length - 1, stepIdx));
        if (index !== this.lastCountdownIndex) {
          this.lastCountdownIndex = index;
          SoundEffects.playCountdownTick();
        }
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
      return;
    }

    // 4. Update Ship Controls & Physics
    if (this.state === "playing") {
      this.ship.isThrusting = false;

      const rotatingByKey = this.input.rotateLeft || this.input.rotateRight;
      if (this.input.rotateLeft) {
        this.ship.rotate(-1, dt);
      }
      if (this.input.rotateRight) {
        this.ship.rotate(1, dt);
      }
      // Mouse aim takes over only when no rotation key is held.
      if (!rotatingByKey && this.mouseAimActive) {
        const targetAngle = Math.atan2(this.mouseY - this.ship.y, this.mouseX - this.ship.x);
        this.aimToward(targetAngle, dt);
      }
      if (this.input.thrust || this.mouseThrust) {
        this.ship.applyThrust(dt);

        // Sound effect (brief periodic rumbles)
        if (Math.random() < 0.25) {
          SoundEffects.playThrust();
        }

        // Spawn flickering exhaust particles
        const angleBehind = this.ship.angle + Math.PI;
        const rearDist = this.ship.radius * 0.6;
        const rx = this.ship.x + Math.cos(angleBehind) * rearDist;
        const ry = this.ship.y + Math.sin(angleBehind) * rearDist;

        // Spread directions
        const p = new Particle(rx, ry, "#ff8a3d", true);
        const spreadAngle = angleBehind + (Math.random() * 0.5 - 0.25);
        const speed = Math.random() * 150 + 100;
        p.setVelocity(
          Math.cos(spreadAngle) * speed + this.ship.vx * 0.5,
          Math.sin(spreadAngle) * speed + this.ship.vy * 0.5
        );
        this.particles.push(p);
      }

      this.ship.update(dt, width, height);

      // Decrement laser cooldown
      if (this.laserCooldownRemaining > 0) {
        this.laserCooldownRemaining -= dt;
      }

      // Periodically spawn new asteroids
      this.asteroidSpawnTimer -= dt;
      if (this.asteroidSpawnTimer <= 0) {
        this.spawnAsteroidsWave(1);
        this.asteroidSpawnTimer = ASTEROID_SPAWN_INTERVAL;
      }
    }

    // 5. Update Lasers
    this.lasers.forEach((laser) => laser.update(dt, width, height));
    this.lasers = this.lasers.filter((laser) => !laser.isExpired());

    // 6. Update Asteroids
    this.asteroids.forEach((ast) => ast.update(dt, width, height));

    // 7. Update Particles
    this.particles.forEach((part) => part.update(dt, width, height));
    this.particles = this.particles.filter((part) => !part.isDead());

    // 8. Update Score Popups
    this.scorePopups.forEach((popup) => {
      popup.y -= 40 * dt; // float up
      popup.alpha -= 1.0 * dt; // fade out in 1s
    });
    this.scorePopups = this.scorePopups.filter((p) => p.alpha > 0);

    // 9. Handle Collisions
    if (this.state === "playing") {
      this.checkCollisions();
    }
  }

  private checkCollisions(): void {
    // Collision checking: Lasers vs Asteroids
    for (let lIdx = this.lasers.length - 1; lIdx >= 0; lIdx--) {
      const laser = this.lasers[lIdx];
      let laserRemoved = false;

      for (let aIdx = this.asteroids.length - 1; aIdx >= 0; aIdx--) {
        const asteroid = this.asteroids[aIdx];

        if (asteroid.collidesWithCircle(laser.x, laser.y, laser.radius)) {
          // Hit! Remove laser & asteroid
          this.lasers.splice(lIdx, 1);
          laserRemoved = true;

          // Split asteroid
          const debris = asteroid.split();
          this.asteroids.splice(aIdx, 1);
          this.asteroids.push(...debris);

          // Add score
          this.score += asteroid.scoreValue;
          this.hud.setScore(this.score);

          // Trigger sound and visual explosion
          SoundEffects.playExplosion(asteroid.size);
          this.triggerScreenShake(asteroid.size * 3.5, 0.25);
          this.spawnScorePopup(asteroid.x, asteroid.y, asteroid.scoreValue, asteroid.color);

          // Spawn explosion debris particles
          const particleCount = asteroid.size === 3 ? 20 : asteroid.size === 2 ? 14 : 8;
          for (let p = 0; p < particleCount; p++) {
            this.particles.push(new Particle(asteroid.x, asteroid.y, asteroid.color));
          }

          break; // break inner loop since laser hit something and is removed
        }
      }
      if (laserRemoved) continue;
    }

    // Collision checking: Ship vs Asteroids
    if (!this.ship.isInvulnerable() && this.ship.lives > 0) {
      for (let aIdx = 0; aIdx < this.asteroids.length; aIdx++) {
        const asteroid = this.asteroids[aIdx];
        if (asteroid.collidesWithCircle(this.ship.x, this.ship.y, this.ship.radius)) {
          // Crash!
          this.handlePlayerDeath();
          break; // only die once per tick
        }
      }
    }

    // 10. Check if level is cleared (no asteroids remaining)
    if (this.asteroids.length === 0) {
      this.level++;
      SoundEffects.playLevelUp();
      // Spawn a wave with more asteroids (steeper progression curve)
      this.spawnAsteroidsWave(4 + this.level * 2);
      // Give ship brief invulnerability boost
      this.ship.invulnerableTime = 2.0;
    }
  }

  private draw(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.ctx.save();

    // Apply Screen Shake
    if (this.shakeTime > 0) {
      const currentShake = (this.shakeTime / 0.6) * this.shakeAmount; // fade shake out
      const dx = (Math.random() * 2 - 1) * currentShake;
      const dy = (Math.random() * 2 - 1) * currentShake;
      this.ctx.translate(dx, dy);
    }

    // Clear Screen
    this.ctx.fillStyle = "#020205";
    this.ctx.fillRect(0, 0, width, height);

    // Draw grid lines for premium cyber aesthetic
    this.drawSpaceGrid();

    // 1. Draw Starfield
    this.stars.forEach((star) => {
      this.ctx.save();
      this.ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
      this.ctx.beginPath();
      this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });

    // 2. Draw Particles
    this.particles.forEach((part) => part.draw(this.ctx));

    // 3. Draw Lasers
    this.lasers.forEach((laser) => laser.draw(this.ctx));

    // 4. Draw Asteroids
    this.asteroids.forEach((asteroid) => asteroid.draw(this.ctx));

    // 5. Draw Ship
    if (this.state === "playing" || this.state === "countdown") {
      this.ship.draw(this.ctx);
    }

    // 6. Draw Score Popups
    this.scorePopups.forEach((popup) => {
      this.ctx.save();
      this.ctx.globalAlpha = popup.alpha;
      this.ctx.fillStyle = popup.color;
      this.ctx.font = "bold 15px 'Courier New', Courier, monospace";
      this.ctx.shadowBlur = 6;
      this.ctx.shadowColor = popup.color;
      this.ctx.fillText(popup.text, popup.x, popup.y);
      this.ctx.restore();
    });

    this.ctx.restore();
  }

  private drawSpaceGrid(): void {
    const spacing = 100;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(0, 243, 255, 0.02)"; // very subtle neon cyan grid
    this.ctx.lineWidth = 1;

    // Draw vertical lines
    for (let x = 0; x < window.innerWidth; x += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, window.innerHeight);
      this.ctx.stroke();
    }

    // Draw horizontal lines
    for (let y = 0; y < window.innerHeight; y += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(window.innerWidth, y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  public destroy(): void {
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.input.destroy();
    this.canvas.remove();
  }
}
