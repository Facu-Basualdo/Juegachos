import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { Sword } from "./Sword";
import { Dojo } from "./Dojo";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  MAX_DT,
  FAIL_ANGLE,
  GRAVITY,
  CONTROL_TORQUE,
  DAMPING,
  GUST_MIN_INTERVAL,
  GUST_MAX_INTERVAL,
  GUST_BASE,
  GUST_RAMP,
  GUST_MAX,
  JITTER,
  START_KICK,
  FALL_DURATION,
} from "./constants";

type GameState = "ready" | "countdown" | "playing" | "gameover";

const WOBBLE_EDGE = 0.72; // fraction of FAIL_ANGLE where the wobble tick fires

export class Game {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;

  private readonly sword: Sword;
  private readonly dojo: Dojo;
  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private readonly container: HTMLElement;
  private state: GameState = "ready";

  // Physics
  private angle = 0;
  private angleVel = 0;
  private elapsed = 0;
  private score = 0;
  private best = 0;
  private gustTimer = 0;
  private wasNearEdge = false;
  private landed = false;
  private fallFrom = 0;
  private fallDir = 1;
  private fallT = 0;

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private shake = 0;
  private readonly cameraBase = new THREE.Vector3(0, 1.95, 4.7);
  private idleTime = 0;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.Fog(0x05060a, 9, 22);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(0, 1.82, -0.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.container.appendChild(this.renderer.domElement);

    // Subtle reflections on the steel without shipping an HDR asset — kept low so
    // the blade reads as brushed metal, not a blown-out mirror.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom tuned to catch only the authored emissive edge glint, not the blade.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.22, // strength
      0.5, // radius
      0.92, // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.setupLights();

    this.dojo = new Dojo();
    this.sword = new Sword();
    this.scene.add(this.dojo.group, this.sword.group);

    this.input = new InputController(this.renderer.domElement);
    this.hud = new Hud(this.container, () => this.handleActivate());

    this.best = Number(localStorage.getItem(BEST_KEY) ?? 0);
    this.hud.setBest(this.best);
    this.hud.showStart(this.best);

    this.room = initRoomMode("sword-balance", {
      getScore: () => (this.state === "playing" ? this.elapsed : this.score),
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
  }

  private setupLights(): void {
    this.scene.add(new THREE.AmbientLight(0x2a3550, 0.35));

    // Key: a dramatic warm spotlight from the upper left, raking across the blade
    // and hand so they read with form (a light-to-dark gradient), not a wash.
    const key = new THREE.SpotLight(0xffe9c8, 20, 40, Math.PI / 6.5, 0.5, 1.4);
    key.position.set(-4.5, 8.5, 5.5);
    key.target.position.set(0, 1.7, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 5;
    key.shadow.bias = -0.0004;
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 26;
    this.scene.add(key, key.target);

    // Cool rim from behind-right to separate the blade edge from the dark.
    const rim = new THREE.DirectionalLight(0x7fb0ff, 0.9);
    rim.position.set(5, 5, -5);
    this.scene.add(rim);

    // A warm frontal fill so the hand reads as a hand, not a silhouette hole.
    const fill = new THREE.DirectionalLight(0xd8c3a4, 0.5);
    fill.position.set(1.5, 1.5, 8);
    this.scene.add(fill);
  }

  private handleActivate(): void {
    if (this.state === "playing" || this.state === "countdown") return;
    if (this.room && this.state === "gameover") return; // one run per room round
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.sword.reset();
    this.input.clear();
    this.angle = 0;
    this.angleVel = 0;
    this.elapsed = 0;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.showMeter(true);
    this.hud.setTime(0);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startGame(): void {
    this.state = "playing";
    this.elapsed = 0;
    this.angle = 0;
    this.angleVel = (Math.random() < 0.5 ? -1 : 1) * START_KICK;
    this.gustTimer = GUST_MIN_INTERVAL + Math.random() * (GUST_MAX_INTERVAL - GUST_MIN_INTERVAL);
    this.wasNearEdge = false;
    this.landed = false;
    this.hud.showCountdown(null);
    this.hud.setTime(0);
    SoundEffects.playUnsheathe();
  }

  private stepPhysics(dt: number): void {
    const lean = this.input.lean();
    this.sword.setLean(lean);

    // Gusts ramp up the longer you survive.
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      const mag = Math.min(GUST_MAX, GUST_BASE + this.elapsed * GUST_RAMP);
      this.angleVel += (Math.random() < 0.5 ? -1 : 1) * mag;
      this.gustTimer = GUST_MIN_INTERVAL + Math.random() * (GUST_MAX_INTERVAL - GUST_MIN_INTERVAL);
    }

    const jitter = (Math.random() * 2 - 1) * JITTER;
    const accel =
      GRAVITY * Math.sin(this.angle) + lean * CONTROL_TORQUE - DAMPING * this.angleVel + jitter;
    this.angleVel += accel * dt;
    this.angle += this.angleVel * dt;

    this.elapsed += dt;
    this.hud.setTime(this.elapsed);
    this.hud.setTilt(this.angle / FAIL_ANGLE);

    // Metallic wobble tick when entering the danger zone.
    const nearEdge = Math.abs(this.angle) > WOBBLE_EDGE * FAIL_ANGLE;
    if (nearEdge && !this.wasNearEdge) SoundEffects.playWobble();
    this.wasNearEdge = nearEdge;

    if (Math.abs(this.angle) >= FAIL_ANGLE) this.fail();
  }

  private fail(): void {
    this.state = "gameover";
    this.score = this.elapsed;
    this.landed = false;
    this.fallFrom = this.angle;
    this.fallDir = this.angle >= 0 ? 1 : -1;
    this.fallT = 0;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
  }

  /** After failing, tween the blade flat (~0.4 s), then clang + show results. */
  private stepFall(dt: number): void {
    this.fallT += dt;
    const k = Math.min(1, this.fallT / FALL_DURATION);
    const target = this.fallDir * (Math.PI / 2 + 0.05);
    const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
    this.angle = this.fallFrom + (target - this.fallFrom) * eased;
    this.hud.setTilt(this.fallDir);
    if (k >= 1) {
      this.landed = true;
      this.shake = 0.32;
      SoundEffects.playClang();
      this.hud.setBest(this.best);
      this.hud.showGameOver(this.score, this.best);
      if (this.room) this.room.reportScore(this.score);
      else this.hud.showRanking("sword-balance", this.score);
    }
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.idleTime += dt;

    if (this.state === "playing") {
      this.stepPhysics(dt);
    } else if (this.state === "gameover" && !this.landed) {
      this.stepFall(dt);
    } else if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) {
        this.startGame();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "ready") {
      // Gentle idle breathing before a run.
      this.angle = Math.sin(this.idleTime * 1.4) * 0.018;
    }

    this.sword.setAngle(this.angle);
    this.sword.update(dt);
    this.dojo.update(dt);
    this.applyCameraShake(dt);

    this.composer.render();
  };

  private applyCameraShake(dt: number): void {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.4);
    this.camera.position.set(
      this.cameraBase.x + (Math.random() - 0.5) * this.shake,
      this.cameraBase.y + (Math.random() - 0.5) * this.shake,
      this.cameraBase.z,
    );
  }

  private readonly onResize = (): void => {
    const { innerWidth, innerHeight } = window;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloomPass.setSize(innerWidth, innerHeight);
  };
}
