import {
  GRID_SIZE,
  VIEW_WIDTH,
  VIEW_HEIGHT,
  MAX_DT,
  LIVES_START,
  FROG_HITBOX_HALF,
  FROG_SUPPORT_HALF,
  MIN_SUPPORT_OVERLAP,
  type LaneData,
} from "./constants";
import { Frog } from "./Frog";
import { Obstacle } from "./Obstacle";
import { Renderer } from "./Renderer";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "dead" | "gameover";

const BEST_KEY = "mini-frogger:best";

/** Countdown 3 / 2 / 1 / YA compartido por todo el repo (ver CLAUDE.md raiz). */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.6;

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frog: Frog;
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private score = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  private lives = LIVES_START;

  // Infinite map lanes
  private readonly lanes = new Map<number, LaneData>();
  private cameraY = 0;
  private targetCameraY = 0;

  // Procedural generator state
  private nextGeneratedRow = -1;
  private currentBlockType: "grass" | "road" | "river" = "grass";
  private blockLengthRemaining = 4;
  private lastDir = 1;

  private maxRowReached = 0;
  private lastTime = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    // Create canvas
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    this.canvas.width = VIEW_WIDTH;
    this.canvas.height = VIEW_HEIGHT;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    // Create models & systems
    this.frog = new Frog();
    this.renderer = new Renderer();

    // Create HUD
    this.hud = new Hud(
      container,
      () => this.onAction(),
      (dx, dy) => this.onMove(dx, dy)
    );
    this.hud.setBest(this.best);
    this.hud.showStartScreen(this.best);

    this.room = initRoomMode("mini-frogger", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    // Setup input listeners
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));
    // En movil no hay Enter, y el boton JUGAR del overlay no alcanza: el toque
    // tiene que arrancar desde cualquier parte de la pantalla. Va sobre el
    // container (el overlay lo tapa) y se ignoran los <button>, que ya tienen
    // su propio handler, para no disparar dos veces el arranque. Los controles
    // virtuales (.mobile-btn) ya frenan la propagacion de los suyos.
    container.addEventListener("pointerdown", this.handlePointerDown);

    // Handle resizing
    this.resize();
    window.addEventListener("resize", () => this.resize());

    // Start game loop
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;

    const scale = Math.min(w / VIEW_WIDTH, h / VIEW_HEIGHT, 1.2);
    
    this.canvas.style.width = `${VIEW_WIDTH * scale}px`;
    this.canvas.style.height = `${VIEW_HEIGHT * scale}px`;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest("button")) return;
    this.onAction();
  };

  private onAction(): void {
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "gameover" && this.room) return;
    if (this.state === "ready" || this.state === "gameover") {
      this.beginCountdown();
    }
  }

  private onMove(dx: number, dy: number): void {
    if (this.state !== "playing" || this.frog.isDead) return;

    // Snap to grid before moving in case we are drifting on a log
    this.frog.snapToGrid();

    this.frog.move(dx, dy);
    SoundEffects.playHop();

    // Award points based on the maximum distance (highest row reached)
    const currentDistance = -this.frog.gridY;
    if (currentDistance > this.maxRowReached) {
      this.score = currentDistance * 10;
      this.maxRowReached = currentDistance;
      this.hud.setScore(this.score);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      this.onAction();
      return;
    }

    if (this.state !== "playing") return;

    let dx = 0;
    let dy = 0;

    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        dy = -1;
        break;
      case "ArrowDown":
      case "s":
      case "S":
        dy = 1;
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        dx = -1;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        dx = 1;
        break;
      default:
        return; // ignore other keys
    }

    e.preventDefault();
    this.onMove(dx, dy);
  }

  /** Prepara el mundo (mapa, rana, marcadores) sin largar la partida. */
  private resetWorld(): void {
    this.score = 0;
    this.lives = LIVES_START;
    this.maxRowReached = 0;
    
    // Clear and reset lanes map
    this.lanes.clear();
    
    // Set up camera starting position
    // Starting line is Y = 0 (row 0), frog drawn at Y = 400 (bottom area)
    this.cameraY = -400;
    this.targetCameraY = -400;

    // Seeding base safe lanes (from row 3 down to row 0)
    for (let r = 3; r >= 0; r--) {
      this.lanes.set(r, {
        row: r,
        type: "grass",
        speed: 0,
        dir: 1,
        obstacleType: "car",
        color: "#ffffff",
        width: 0,
        spacing: 0,
        obstacles: [],
      });
    }

    // Reset procedural generator
    this.nextGeneratedRow = -1;
    this.currentBlockType = "grass";
    this.blockLengthRemaining = 4;
    this.lastDir = 1;

    // Pre-generate 30 rows ahead
    this.generateLanesUpTo(-30);

    // Reset frog position
    this.frog.reset();

    this.hud.setScore(0);
    this.hud.setLives(this.lives);
    this.hud.hideOverlay();
  }

  /** Resetea el mundo y corre el countdown 3 / 2 / 1 / YA antes de jugar. */
  private beginCountdown(): void {
    this.resetWorld();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.hud.showCountdown(null);
  }

  /** Avanza el countdown y larga la partida al terminar. */
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

  private generateLanesUpTo(targetRow: number): void {
    while (this.nextGeneratedRow >= targetRow) {
      const row = this.nextGeneratedRow;
      this.blockLengthRemaining--;

      if (this.blockLengthRemaining <= 0) {
        // Toggle block types
        if (this.currentBlockType === "grass") {
          this.currentBlockType = Math.random() < 0.5 ? "road" : "river";
          this.blockLengthRemaining = Math.floor(Math.random() * 3) + 2; // 2 to 4 lanes
        } else {
          this.currentBlockType = "grass";
          this.blockLengthRemaining = Math.floor(Math.random() * 2) + 1; // 1 to 2 lanes
        }
      }

      // Alternate obstacle direction
      this.lastDir = -this.lastDir;
      this.createLane(row, this.currentBlockType, this.lastDir);
      this.nextGeneratedRow--;
    }
  }

  private createLane(row: number, type: "grass" | "road" | "river", dir: number): void {
    const laneData: LaneData = {
      row,
      type,
      speed: 0,
      dir,
      obstacleType: "car",
      color: "#ffffff",
      width: 60,
      spacing: 200,
      obstacles: [],
    };

    if (type === "road") {
      // Speed scales slowly with distance
      const diffMultiplier = 1.0 + Math.min(1.5, -row / 250);
      laneData.speed = (50 + Math.random() * 60) * diffMultiplier;
      laneData.obstacleType = "car";
      laneData.width = Math.random() < 0.25 ? 85 : (Math.random() < 0.4 ? 50 : 60);
      laneData.color = ["#ff2a5f", "#00f0ff", "#ffd700", "#ff8c00", "#a020f0", "#ff00ff"][
        Math.floor(Math.random() * 6)
      ];
      // spacing = ancho + hueco libre, para que nunca se solapen y quede sitio
      // seguro entre autos.
      laneData.spacing = laneData.width + 110 + Math.random() * 90;
      this.populateLane(laneData, dir);
    } else if (type === "river") {
      const diffMultiplier = 1.0 + Math.min(1.5, -row / 300);
      laneData.speed = (40 + Math.random() * 45) * diffMultiplier;
      laneData.obstacleType = Math.random() < 0.5 ? "log" : "turtle";

      if (laneData.obstacleType === "log") {
        laneData.width = Math.random() < 0.33 ? 140 : (Math.random() < 0.5 ? 100 : 80);
        laneData.color = "#8b5a2b";
      } else {
        laneData.width = Math.random() < 0.5 ? 90 : 60;
        laneData.color = "#32cd32";
      }
      // Plataformas parejas: spacing = ancho + hueco de agua (~1 celda). Sin
      // solapamientos, los huecos son visibles y consistentes.
      laneData.spacing = laneData.width + 40 + Math.random() * 30;
      this.populateLane(laneData, dir);
    }

    this.lanes.set(row, laneData);
  }

  /**
   * Fills a lane with evenly spaced, non-overlapping obstacles laid out on a
   * ring of length `count * spacing`. Every obstacle shares that `wrapWidth`, so
   * they keep their spacing forever (no clustering, no obstacles on top of each
   * other) and both wrap boundaries stay off-screen (no pop-in).
   */
  private populateLane(lane: LaneData, dir: number): void {
    const count = Math.ceil((VIEW_WIDTH + lane.width) / lane.spacing) + 1;
    const wrapWidth = count * lane.spacing;
    const phase = Math.random() * lane.spacing; // desfase aleatorio del patron
    for (let i = 0; i < count; i++) {
      const x = -lane.width + i * lane.spacing + phase;
      lane.obstacles.push(
        new Obstacle(x, lane.row, lane.width, lane.speed, dir, lane.obstacleType, lane.color, wrapWidth)
      );
    }
  }

  private update(dt: number): void {
    if (this.state === "countdown") this.updateCountdown(dt);
    // Determine visible row range to update obstacles
    const visibleTopRow = Math.floor((this.cameraY - 2 * GRID_SIZE) / GRID_SIZE);
    const visibleBottomRow = Math.ceil((this.cameraY + VIEW_HEIGHT + 2 * GRID_SIZE) / GRID_SIZE);

    for (let r = visibleTopRow; r <= visibleBottomRow; r++) {
      const lane = this.lanes.get(r);
      if (lane) {
        lane.obstacles.forEach((obs) => obs.update(dt));
      }
    }

    // Generate more lanes procedurally as the frog moves forward
    if (this.state === "playing") {
      this.generateLanesUpTo(this.frog.gridY - 20);
    }

    // Collision detection
    let currentLogSpeed = 0;

    if (this.state === "playing" && !this.frog.isDead) {
      const row = this.frog.gridY;
      const currentLane = this.lanes.get(row);

      if (currentLane) {
        // The frog is, by definition, within this lane's row, so collisions are
        // a pure horizontal test against each obstacle's visible body. Using the
        // interpolated (rendered) x keeps deaths in sync with what's on screen.
        const frogCenterX = this.frog.x + GRID_SIZE / 2;

        if (currentLane.type === "road") {
          // Die only on a real overlap with a car's visible body.
          const hit = currentLane.obstacles.some((obs) =>
            obs.overlapsX(frogCenterX, FROG_HITBOX_HALF)
          );
          if (hit) {
            this.killFrog("crash");
          }
        } else if (currentLane.type === "river") {
          // Ride a log/turtle when a real chunk of the frog's body overlaps it
          // (not just the exact centre): landing on the edge/side still counts,
          // so it no longer feels like a coin flip. Platforms don't overlap and
          // are wider than the frog, so at most one can support it.
          const supportObs = currentLane.obstacles.find(
            (obs) => obs.overlapX(frogCenterX, FROG_SUPPORT_HALF) >= MIN_SUPPORT_OVERLAP
          );
          if (supportObs) {
            currentLogSpeed = supportObs.speed * supportObs.dir;
          } else {
            // Water death
            this.killFrog("water");
          }
        }
      }

      // Check if camera scrolled past the frog (fell off screen)
      if (this.frog.y > this.cameraY + VIEW_HEIGHT + 10) {
        this.killFrog("crash");
      }
    }

    // Update frog kinematics
    this.frog.update(dt, currentLogSpeed);

    // Camera smoothing & scrolling tracking
    if (this.state === "playing" && !this.frog.isDead) {
      // Keep frog centered at about 72% down the screen
      this.targetCameraY = this.frog.y - VIEW_HEIGHT * 0.72;
      
      // Camera only moves up (negative scroll direction)
      if (this.targetCameraY < this.cameraY) {
        this.cameraY += (this.targetCameraY - this.cameraY) * 5.0 * dt;
      }
    }

    // Death transition handling
    if (this.state === "dead" && this.frog.isDead) {
      if (this.frog.deathTime >= this.frog.maxDeathTime) {
        this.lives--;
        this.hud.setLives(this.lives);

        if (this.lives > 0) {
          // (Not used in 1-life mode, but kept for logic safety)
          this.state = "playing";
          this.frog.reset();
        } else {
          this.gameOver();
        }
      }
    }
  }

  private killFrog(cause: "water" | "crash"): void {
    if (cause === "water") SoundEffects.playSplash();
    else SoundEffects.playSquash();
    this.frog.die();
    this.state = "dead";
  }

  private gameOver(): void {
    this.state = "gameover";

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }

    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("mini-frogger", this.score);
  }

  private tick(timestamp: number): void {
    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > MAX_DT) dt = MAX_DT;
    this.lastTime = timestamp;

    this.update(dt);

    this.renderer.draw(
      this.ctx,
      this.frog,
      this.lanes,
      this.cameraY,
      dt
    );

    requestAnimationFrame((t) => this.tick(t));
  }
}
