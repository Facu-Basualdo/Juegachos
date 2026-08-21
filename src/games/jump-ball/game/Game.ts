import * as THREE from "three";
import { Ball } from "./Ball";
import { Track } from "./Track";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BACKGROUND_COLOR,
  BASE_SPEED,
  BEST_SCORE_KEY,
  CAM_BACK,
  CAM_FOLLOW_X,
  CAM_FOV,
  CAM_HEIGHT,
  CAM_LERP,
  CAM_LOOK_AHEAD,
  CAM_LOOK_Y,
  FOG_FAR,
  FOG_NEAR,
  IDLE_SPEED,
  MAX_DT,
  MAX_SPEED,
  ROW_DEPTH,
  SPEED_RAMP_PER_SEC,
} from "./constants";

type GameState = "ready" | "countdown" | "playing" | "gameover";

/** Countdown before a run starts: one label shown per COUNTDOWN_STEP seconds. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** Orchestrates scene / camera / renderer, the chase camera and the game loop. */
export class Game {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;

  private readonly track = new Track();
  private readonly ball = new Ball();
  private readonly input: InputController;
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private readonly lookTarget = new THREE.Vector3();

  private state: GameState = "ready";
  private worldScroll = 0;
  private speed = BASE_SPEED;
  private elapsed = 0;
  private idleTime = 0;
  private score = 0;
  private best = 0;
  private lastLandedRow = 0;
  private deadFor = 0;
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene.background = new THREE.Color(BACKGROUND_COLOR);
    this.scene.fog = new THREE.Fog(BACKGROUND_COLOR, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(
      CAM_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.camera.position.set(0, CAM_HEIGHT, CAM_BACK);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    // Lighting: soft sky/ground fill plus a shadow-casting sun so the ball's
    // drop shadow reads as a landing cue on the platforms.
    this.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x24314d, 1.05));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(5, 16, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 45;
    this.sun.shadow.camera.left = -10;
    this.sun.shadow.camera.right = 10;
    this.sun.shadow.camera.top = 12;
    this.sun.shadow.camera.bottom = -14;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.target.position.set(0, 0, -3);
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.track.object, this.ball.object);

    this.input = new InputController(this.renderer.domElement, () => this.handleActivate());
    this.hud = new Hud(this.container, () => this.handleActivate());

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);
    this.hud.showStart();

    this.room = initRoomMode("jump-ball", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.updateCamera(1);
    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
  }

  private handleActivate(): void {
    if (this.state === "playing" || this.state === "countdown") return;
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "gameover" && (this.room || this.deadFor < 0.6)) return;
    this.beginCountdown();
  }

  /** Resets the world and runs the 3-2-1-YA countdown before play begins. */
  private beginCountdown(): void {
    this.ball.reset();
    this.track.reset();
    this.input.reset();
    this.worldScroll = 0;
    this.idleTime = 0;
    this.track.update(0);
    this.track.landOn(0, 1);
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private updateCountdown(dt: number): void {
    this.idleTime += dt;
    this.ball.idle(this.idleTime);
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) this.startGame();
    else if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private startGame(): void {
    this.ball.reset();
    this.input.reset();
    this.worldScroll = 0;
    this.speed = BASE_SPEED;
    this.elapsed = 0;
    this.score = 0;
    this.lastLandedRow = 0;
    this.deadFor = 0;
    this.input.consumeSteer();
    this.hud.setScore(0);
    this.hud.hide();
    this.hud.showCountdown(null);
    this.state = "playing";
  }

  private die(): void {
    this.state = "gameover";
    this.deadFor = 0;
    SoundEffects.playFall();
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("jump-ball", this.score);
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    if (this.state === "playing") this.updatePlaying(dt);
    else if (this.state === "countdown") this.updateCountdown(dt);
    else this.updateIdle(dt);

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private updatePlaying(dt: number): void {
    this.elapsed += dt;
    this.speed = Math.min(BASE_SPEED + this.elapsed * SPEED_RAMP_PER_SEC, MAX_SPEED);

    const steerDir = this.input.getSteerDir();
    if (steerDir !== 0) {
      this.ball.steerContinuous(steerDir, dt);
    } else {
      const pointerTargetX = this.input.getPointerTargetX();
      if (pointerTargetX !== null) this.ball.steerToward(pointerTargetX, dt);
    }

    this.worldScroll += this.speed * dt;
    const hopPhase = this.worldScroll / ROW_DEPTH - Math.floor(this.worldScroll / ROW_DEPTH);
    this.ball.update(dt, hopPhase);
    this.track.update(this.worldScroll);

    // Each time a new row passes under the ball, that's a landing: score it and
    // check the ball is standing on a real platform.
    const currentRow = Math.floor(this.worldScroll / ROW_DEPTH + 1e-4);
    if (currentRow > this.lastLandedRow) {
      this.lastLandedRow = currentRow;
      const lane = this.track.landedLane(currentRow, this.ball.object.position.x);
      if (lane === null) {
        this.die();
        return;
      }
      if (lane !== undefined) this.track.landOn(currentRow, lane);
      SoundEffects.playHop();
      this.score = currentRow;
      this.hud.setScore(this.score);
    }
  }

  private updateIdle(dt: number): void {
    this.idleTime += dt;
    this.worldScroll += IDLE_SPEED * dt;
    this.track.update(this.worldScroll);

    if (this.state === "gameover") {
      this.deadFor += dt;
      // Let the ball drop through the gap it missed.
      if (this.ball.object.position.y > -6) this.ball.fall(dt);
    } else {
      this.ball.idle(this.idleTime);
    }
  }

  private updateCamera(dt: number): void {
    const targetX = this.ball.object.position.x * CAM_FOLLOW_X;
    const t = Math.min(1, dt * CAM_LERP);
    this.camera.position.x += (targetX - this.camera.position.x) * t;
    this.camera.position.y = CAM_HEIGHT;
    this.camera.position.z = CAM_BACK;

    this.lookTarget.set(this.ball.object.position.x * 0.3, CAM_LOOK_Y, -CAM_LOOK_AHEAD);
    this.camera.lookAt(this.lookTarget);
  }

  private readonly onResize = (): void => {
    const { innerWidth, innerHeight } = window;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(null);
    this.input.dispose();
  }
}
