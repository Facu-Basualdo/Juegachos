import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { Space } from "./Space";
import { Player } from "./Player";
import { ObstacleSpawner } from "./ObstacleSpawner";
import { EngineTrail } from "./EngineTrail";
import { Explosion } from "./Explosion";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BACKGROUND_COLOR,
  BASE_SPEED,
  BEST_SCORE_KEY,
  CAMERA_Z,
  FOG_FAR,
  FOG_NEAR,
  MAX_SPEED,
  SPEED_RAMP_PER_SEC,
} from "./constants";

type GameState = "ready" | "countdown" | "playing" | "gameover";

/** Countdown before a run starts: one label shown per COUNTDOWN_STEP seconds. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** Crash camera shake. */
const SHAKE_DURATION = 0.5;
const SHAKE_MAGNITUDE = 0.7;

export class Game {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;

  private readonly space: Space;
  private readonly player: Player;
  private readonly spawner: ObstacleSpawner;
  private readonly trail: EngineTrail;
  private readonly explosion: Explosion;
  /** Red flash light spiked on a crash, then decayed. */
  private readonly crashFlash: THREE.PointLight;
  private shakeTime = 0;
  private readonly input: InputController;
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private readonly container: HTMLElement;
  private state: GameState = "ready";
  /**
   * True solo cuando el overlay de inicio / fin esta realmente en pantalla. Al
   * morir, el estado pasa a "gameover" pero el overlay aparece 550ms despues (la
   * explosion se ve primero): sin este guard, reiniciar en esa ventana hacia que
   * el setTimeout del overlay retornara temprano por su propio chequeo de estado
   * y el puntaje de esa corrida nunca se enviara al ranking.
   */
  private menuVisible = true;
  private score = 0;
  private best = 0;
  private elapsed = 0;
  private countdownTime = 0;
  /** Last countdown index that played a tick, so each number sounds once. */
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);
    this.scene.fog = new THREE.Fog(BACKGROUND_COLOR, FOG_NEAR, FOG_FAR);

    // Fixed camera looking straight down the corridor axis.
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
    this.camera.position.set(0, 0, CAMERA_Z);
    this.camera.lookAt(0, 0, -1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,
      0.4,
      0.5,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Scene lighting: shades the ship and the lit obstacle materials (metal
    // gates, asteroids, portal rims) while the starfield/membranes stay unlit.
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(-3, 6, 5);
    const rimLight = new THREE.DirectionalLight(0x66ccff, 1.0);
    rimLight.position.set(4, -2, -4);
    const ambient = new THREE.HemisphereLight(0x8fb4ff, 0x0a0014, 0.75);
    this.scene.add(keyLight, rimLight, ambient);

    this.space = new Space();
    this.player = new Player();
    this.spawner = new ObstacleSpawner(this.scene);
    this.trail = new EngineTrail(this.scene);
    this.explosion = new Explosion(this.scene);

    this.crashFlash = new THREE.PointLight(0xff3020, 0, 40, 2);
    this.scene.add(this.crashFlash);

    this.scene.add(this.space.group, this.player.object);

    this.input = new InputController(this.renderer.domElement);
    this.hud = new Hud(this.container, () => this.handleActivate());

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);
    this.hud.showStart();

    this.room = initRoomMode("vector-rush", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
    (window as any).__vr = this;
  }

  private handleActivate(): void {
    if (this.state === "playing" || this.state === "countdown") return;
    if (!this.menuVisible) return; // no reiniciar durante la explosion previa al overlay
    // En modo sala se juega una sola partida por ronda: sin reintento.
    if (this.room && this.state === "gameover") return;
    this.beginCountdown();
  }

  /** Resets the run and runs the 3-2-1-YA countdown before play begins. */
  private beginCountdown(): void {
    this.menuVisible = false;
    this.player.reset();
    this.player.object.visible = true;
    this.spawner.reset();
    this.trail.reset();
    this.explosion.reset();
    this.crashFlash.intensity = 0;
    this.shakeTime = 0;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startGame(): void {
    this.player.reset();
    this.spawner.reset();
    this.trail.reset();
    this.score = 0;
    this.elapsed = 0;
    this.hud.setScore(0);
    this.hud.hide();
    this.hud.showCountdown(null);
    this.state = "playing";
    this.lastTime = performance.now();
  }

  private endGame(): void {
    this.state = "gameover";
    SoundEffects.playHit();

    // Crash juice: fireball at the ship, red flash light, camera shake, hide ship.
    const px = this.player.x;
    const py = this.player.y;
    this.explosion.burst(px, py, 0.6);
    this.crashFlash.position.set(px, py, 1.5);
    this.crashFlash.intensity = 60;
    this.shakeTime = SHAKE_DURATION;
    this.player.object.visible = false;

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
    }
    this.hud.setBest(this.best);

    // Delay the game-over overlay so the explosion + shake play in the clear first.
    window.setTimeout(() => {
      if (this.state !== "gameover") return; // player may have restarted
      this.menuVisible = true;
      this.hud.showGameOver(this.score, this.best);
      if (this.room) this.room.reportScore(this.score);
      else this.hud.showRanking("vector-rush", this.score);
    }, 550);
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.state === "playing") {
      this.elapsed += dt;
      const speed = Math.min(BASE_SPEED + this.elapsed * SPEED_RAMP_PER_SEC, MAX_SPEED);
      const dz = speed * dt;

      this.player.update(dt, this.input.dirX, this.input.dirY);
      this.space.scroll(dz);
      this.trail.update(dt, this.player.enginePorts(), speed);

      const events = this.spawner.update(dt, dz, this.player.x, this.player.y, this.player.object.position.z, this.score, speed);
      for (const event of events) {
        if (event === "hit") {
          this.endGame();
          break;
        }
        this.score++;
        SoundEffects.playScore();
      }
      this.hud.setScore(this.score);
    } else if (this.state === "countdown") {
      this.space.scroll(dt * 6);
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) this.startGame();
      else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else {
      this.space.scroll(dt * 6);
    }

    // Crash effects run in every state so the fireball/flash play over game-over.
    this.explosion.update(dt);
    if (this.crashFlash.intensity > 0) {
      this.crashFlash.intensity = Math.max(0, this.crashFlash.intensity - dt * 140);
    }
    this.applyShake(dt);

    this.composer.render();
  };

  /** Offsets the fixed axial camera by a decaying random jitter after a crash. */
  private applyShake(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const mag = SHAKE_MAGNITUDE * (this.shakeTime / SHAKE_DURATION);
      this.camera.position.set((Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag, CAMERA_Z);
      this.camera.lookAt(0, 0, -1);
    } else if (this.camera.position.x !== 0 || this.camera.position.y !== 0) {
      this.camera.position.set(0, 0, CAMERA_Z);
      this.camera.lookAt(0, 0, -1);
    }
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
