import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Keeper } from "./Keeper";
import { KeeperView } from "./KeeperView";
import { Kicker } from "./Kicker";
import { KickerView } from "./KickerView";
import { ShotField } from "./ShotField";
import { Stadium } from "./Stadium";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BLOOM_RADIUS,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  CAM_FOLLOW_X,
  CAM_FOV,
  CAM_LERP,
  CAM_LOOK_Y,
  CAM_LOOK_Z,
  CAM_POS_Y,
  CAM_POS_Z,
  COLOR_BACKGROUND,
  COLOR_FOG,
  KEEPER_Z,
  MAX_DT,
  MAX_MISSES,
  PIXEL_SIZE,
} from "./constants";

type State = "ready" | "countdown" | "playing" | "dead";

const BEST_KEY = "penalty-keeper:best";
/** Countdown before a run starts: one label shown per COUNTDOWN_STEP seconds. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** Orchestrates scene / camera / composer, the state machine and the loop.
 *  Retro HD-2D: pixel sprites lit by real lights, pixelation + bloom post.
 *  The camera sits inside the goal behind the keeper; balls fly at it. */
export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly pixelPass: RenderPixelatedPass;

  private readonly keeper = new Keeper();
  private readonly keeperView = new KeeperView();
  private readonly kicker = new Kicker();
  private readonly kickerView = new KickerView();
  private readonly shots = new ShotField(this.kicker, () => SoundEffects.playKick());
  private readonly stadium = new Stadium();
  private readonly hud: Hud;
  private readonly input: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  /** Warm light that tracks the incoming ball across the pitch. */
  private readonly ballLight = new THREE.PointLight(0xffe9c4, 0, 7, 1.8);

  private state: State = "ready";
  private score = 0;
  private misses = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;
  /** Seconds of play, drives the difficulty phases. */
  private elapsed = 0;
  private idleTime = 0;
  private deadFor = 0;
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  /** Remaining camera-shake time after a conceded goal, s. */
  private shakeTime = 0;
  private lastTime = performance.now();

  private readonly lookTarget = new THREE.Vector3(0, CAM_LOOK_Y, CAM_LOOK_Z);
  private readonly pointerRay = new THREE.Raycaster();
  private readonly keeperPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), KEEPER_Z);
  private readonly planeHit = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(COLOR_BACKGROUND);
    this.scene.fog = new THREE.Fog(COLOR_FOG, 24, 55);

    this.camera = new THREE.PerspectiveCamera(
      CAM_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      120,
    );
    this.camera.position.set(0, CAM_POS_Y, CAM_POS_Z);
    this.camera.lookAt(this.lookTarget);

    this.renderer = new THREE.WebGLRenderer({ powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "game-canvas";
    container.appendChild(this.renderer.domElement);

    // Retro post chain: pixelate the lit scene, then bloom the highlights.
    this.composer = new EffectComposer(this.renderer);
    this.pixelPass = new RenderPixelatedPass(PIXEL_SIZE, this.scene, this.camera);
    this.pixelPass.normalEdgeStrength = 0.25;
    this.pixelPass.depthEdgeStrength = 0.3;
    this.composer.addPass(this.pixelPass);
    this.composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD,
      ),
    );
    this.composer.addPass(new OutputPass());

    this.scene.add(
      this.stadium.object,
      this.keeperView.object,
      this.kickerView.object,
      this.shots.object,
      this.ballLight,
    );

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.setMisses(0);
    this.hud.showHud(false);
    this.hud.showStart();

    // El target es el container y no el canvas de WebGL: las pantallas de inicio
    // y game over son un overlay que lo tapa, asi que en movil (donde no hay
    // Enter) el toque sobre el cartel no llegaba a arrancar. El panel de ranking
    // corta la propagacion de sus propios pointerdown.
    this.input = new InputController(
      container,
      (clientX) => this.onMove(clientX),
      () => this.onJump(),
      () => this.requestStart(),
    );

    this.room = initRoomMode("penalty-keeper", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
  }

  /** Pointer steering: project the pointer onto the keeper's plane. */
  private onMove(clientX: number): void {
    if (this.state !== "playing") return;
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, 0);
    this.pointerRay.setFromCamera(this.ndc, this.camera);
    if (this.pointerRay.ray.intersectPlane(this.keeperPlane, this.planeHit)) {
      this.keeper.moveTo(this.planeHit.x);
    }
  }

  /** Space / click: jump while playing; anywhere else it starts the run. */
  private onJump(): void {
    if (this.state === "playing") this.keeper.jump();
    else this.requestStart();
  }

  /** Enter or a tap on a start / game-over screen begins the countdown. */
  private requestStart(): void {
    if (this.state === "playing" || this.state === "countdown") return;
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.state === "dead" && (this.room || this.deadFor < 0.6)) return;
    this.beginCountdown();
  }

  /** Resets the field and runs the 3-2-1-YA countdown before play begins. */
  private beginCountdown(): void {
    this.shots.reset();
    this.keeper.reset();
    this.kicker.reset();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.showHud(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
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

  private start(): void {
    this.state = "playing";
    this.score = 0;
    this.misses = 0;
    this.elapsed = 0;
    this.shots.reset();
    this.keeper.reset();
    this.kicker.reset();
    this.hud.setScore(0);
    this.hud.setMisses(0);
    this.hud.showHud(true);
    this.hud.hide();
    this.hud.showCountdown(null);
    SoundEffects.playWhistle();
  }

  private die(): void {
    this.state = "dead";
    this.deadFor = 0;
    this.hud.showHud(false);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);
    SoundEffects.playGameOver();
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("penalty-keeper", this.score);
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    if (this.state === "playing") this.updatePlaying(dt);
    else if (this.state === "countdown") this.updateCountdown(dt);
    else {
      this.idleTime += dt;
      if (this.state === "dead") this.deadFor += dt;
      this.kicker.update(dt);
    }

    this.keeperView.update(dt, this.keeper);
    this.kickerView.update(dt, this.kicker);
    this.stadium.update(dt);
    this.updateLights(dt);
    this.updateCamera(dt);
    this.composer.render();
  };

  private updatePlaying(dt: number): void {
    this.elapsed += dt;

    this.keeper.steer(this.input.getSteerDir(), dt);
    this.keeper.update(dt);
    this.kicker.update(dt);

    const arrived = this.shots.update(dt, this.elapsed);
    for (const shot of arrived) {
      this.shots.arrivalVelocity(shot, shot.exitVelocity);
      if (this.keeper.catches(shot.tx, shot.ty)) {
        shot.resolved = "save";
        // Deflect back out toward the pitch, mirroring the incoming speed.
        shot.exitVelocity.multiplyScalar(-0.35);
        shot.exitVelocity.y = 2.4;
        this.stadium.savePulse.intensity = 26;
        SoundEffects.playSave();
        this.score += 1;
        this.hud.setScore(this.score);
        this.hud.flashFeedback("save");
      } else {
        shot.resolved = "goal";
        // Keeps flying past the keeper and out past the camera; the red
        // pulse + shake make the concession unmistakable.
        shot.exitVelocity.multiplyScalar(1.15);
        this.stadium.goalPulse.intensity = 30;
        SoundEffects.playGoal();
        this.shakeTime = 0.3;
        this.misses += 1;
        this.hud.setMisses(this.misses);
        this.hud.flashFeedback("goal");
        if (this.misses >= MAX_MISSES) {
          this.die();
          return;
        }
      }
    }
  }

  /** Dynamic lighting: the tracking ball light and the feedback pulses. */
  private updateLights(dt: number): void {
    const nearest = this.shots.nearestShot();
    if (nearest) {
      this.ballLight.position.copy(nearest.mesh.position);
      this.ballLight.position.y += 0.4;
      this.ballLight.intensity = 2.5 + nearest.progress * 5;
    } else {
      this.ballLight.intensity = Math.max(0, this.ballLight.intensity - dt * 20);
    }

    this.stadium.savePulse.intensity = Math.max(0, this.stadium.savePulse.intensity - dt * 90);
    this.stadium.goalPulse.intensity = Math.max(0, this.stadium.goalPulse.intensity - dt * 80);
  }

  private updateCamera(dt: number): void {
    const targetX = this.keeper.x * CAM_FOLLOW_X;
    const t = Math.min(1, dt * CAM_LERP);
    this.camera.position.x += (targetX - this.camera.position.x) * t;
    this.camera.position.y = CAM_POS_Y;
    this.camera.position.z = CAM_POS_Z;

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const amp = 0.09 * (this.shakeTime / 0.3);
      this.camera.position.x += (Math.random() * 2 - 1) * amp;
      this.camera.position.y += (Math.random() * 2 - 1) * amp;
    }

    this.lookTarget.set(this.camera.position.x * 0.4, CAM_LOOK_Y, CAM_LOOK_Z);
    this.camera.lookAt(this.lookTarget);
  }

  private readonly onResize = (): void => {
    const { innerWidth, innerHeight } = window;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(null);
    this.input.dispose();
  }
}
