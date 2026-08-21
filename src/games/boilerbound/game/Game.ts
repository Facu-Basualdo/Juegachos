import * as THREE from "three";
import { OutlineEffect } from "three/examples/jsm/effects/OutlineEffect.js";

import { Room } from "./Room";
import { Player } from "./Player";
import { VentField } from "./VentField";
import { Particles } from "./Particles";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { loadModels } from "./Models";
import { makeToonGradient } from "./toon";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BACKGROUND_COLOR,
  BEST_SCORE_KEY,
  CAMERA_MARGIN,
  CAMERA_VFOV,
  CEILING_Y,
  FOG_FAR,
  FOG_NEAR,
  LAMP_COLOR,
  ROOM_HALF_WIDTH,
  WALL_X,
  WARNING_COLOR,
} from "./constants";

type GameState = "loading" | "ready" | "countdown" | "playing" | "gameover";

const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;
const SHAKE_DURATION = 0.45;
const SHAKE_MAGNITUDE = 0.5;

// Deliberately dim: a dark boiler room where you can just make out the models,
// and the brightest things are the danger cues (red grilles + steam).
// Cel-shaded look: flatter, a bit more light than the old PBR pass so the toon
// ramp reads, while the painted backdrop carries the mood.
const KEY_INTENSITY = 1.9;
const AMBIENT_INTENSITY = 0.6;
const LAMP_INTENSITY = 0.7;

export class Game {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  /** Draws the scene with automatic inverted-hull ink outlines (the toon look). */
  private readonly outline: OutlineEffect;
  private readonly gradientMap: THREE.Texture;

  private readonly keyLight: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly lampLights: THREE.PointLight[] = [];
  private readonly emergencyLight: THREE.PointLight;

  private room!: Room;
  private player!: Player;
  private field!: VentField;
  private particles!: Particles;
  private readonly input: InputController;
  private readonly hud: Hud;
  private roomMode: RoomMode | null = null;

  private readonly container: HTMLElement;
  private readonly camCenterY = CEILING_Y / 2;
  private camDistance = 20;
  private shakeTime = 0;

  private state: GameState = "loading";
  /**
   * True solo cuando el overlay de inicio / fin esta realmente en pantalla. Al
   * morir, el estado pasa a "gameover" pero el overlay aparece 550ms despues (la
   * muerte se ve primero): sin este guard, reiniciar en esa ventana hacia que el
   * setTimeout del overlay retornara temprano por su propio chequeo de estado y
   * el puntaje de esa corrida nunca se enviara al ranking.
   */
  private menuVisible = true;
  private elapsed = 0;
  private score = 0; // centiseconds survived (for the leaderboard / room mode)
  private best = 0; // centiseconds
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);
    this.scene.fog = new THREE.Fog(BACKGROUND_COLOR, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(CAMERA_VFOV, window.innerWidth / window.innerHeight, 0.1, 200);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping; // flat, vivid cartoon colours
    this.container.appendChild(this.renderer.domElement);

    // Ink outlines around every mesh -> the cel-shaded cartoon read.
    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.004,
      defaultColor: [0.05, 0.04, 0.04],
    });
    this.gradientMap = makeToonGradient(4);

    this.keyLight = new THREE.DirectionalLight(0xffcf8a, KEY_INTENSITY);
    this.keyLight.position.set(-4, 9, 6);
    this.ambient = new THREE.HemisphereLight(0xffb066, 0x140a06, AMBIENT_INTENSITY);
    this.scene.add(this.keyLight, this.ambient);
    for (const side of [-1, 1]) {
      const lamp = new THREE.PointLight(LAMP_COLOR, LAMP_INTENSITY, 22, 2);
      lamp.position.set(side * (ROOM_HALF_WIDTH - 0.6), CEILING_Y - 1.4, 1.2);
      this.lampLights.push(lamp);
      this.scene.add(lamp);
    }
    this.emergencyLight = new THREE.PointLight(WARNING_COLOR, 0, 40, 2);
    this.emergencyLight.position.set(0, this.camCenterY, 4);
    this.scene.add(this.emergencyLight);

    this.input = new InputController(this.container);
    this.hud = new Hud(this.container, () => this.handleActivate());
    this.hud.showLoading();

    this.frameCamera();
    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
    (window as any).__bb = this;

    void this.init();
  }

  /** Preloads the Blender models, then builds the world and opens the start screen. */
  private async init(): Promise<void> {
    const models = await loadModels();
    this.room = new Room(models, this.gradientMap);
    this.particles = new Particles(500);
    this.player = new Player(models, this.gradientMap);
    this.field = new VentField(this.scene, this.particles, models, this.gradientMap, () => SoundEffects.playSteam());
    this.scene.add(this.room.group, this.player.object, this.particles.points);
    this.player.object.visible = false;

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);
    this.state = "ready";
    this.hud.showStart();

    this.roomMode = initRoomMode("boilerbound", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });
  }

  private handleActivate(): void {
    if (this.state === "loading" || this.state === "playing" || this.state === "countdown") return;
    if (!this.menuVisible) return; // no reiniciar durante la muerte previa al overlay
    if (this.roomMode && this.state === "gameover") return; // one run per round in salas
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.menuVisible = false;
    this.player.reset();
    this.player.object.visible = true;
    this.field.reset();
    this.particles.reset();
    this.shakeTime = 0;
    this.emergencyLight.intensity = 0;
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startGame(): void {
    this.player.reset();
    this.field.reset();
    this.particles.reset();
    this.elapsed = 0;
    this.score = 0;
    this.hud.setTime(0);
    this.hud.hide();
    this.hud.showCountdown(null);
    this.state = "playing";
    this.lastTime = performance.now();
  }

  private endGame(): void {
    this.state = "gameover";
    SoundEffects.playDeath();

    const px = this.player.x;
    const py = this.player.visualY + 0.7;
    this.particles.burst(px, py, 24, { speed: 8, up: 3, gravity: 20, color: new THREE.Color(0xffffff) });
    this.particles.burst(px, py, 16, { speed: 6, up: 2, gravity: 22, color: new THREE.Color(WARNING_COLOR) });
    this.emergencyLight.position.set(px, py, 3);
    this.emergencyLight.intensity = 22;
    this.shakeTime = SHAKE_DURATION;
    this.player.object.visible = false;

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
    }
    this.hud.setBest(this.best);

    window.setTimeout(() => {
      if (this.state !== "gameover") return; // player may have restarted
      this.menuVisible = true;
      this.hud.showGameOver(this.score, this.best);
      if (this.roomMode) this.roomMode.reportScore(this.score);
      else this.hud.showRanking("boilerbound", this.score);
    }, 550);
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.state === "loading") {
      this.outline.render(this.scene, this.camera);
      return;
    }

    this.room.update(dt);

    if (this.state === "playing") {
      this.elapsed += dt;
      this.score = Math.round(this.elapsed * 100);

      const events = this.player.update(dt, {
        moveDir: this.input.moveDir,
        jumpPressed: this.input.consumeJumpPressed(),
        jumpHeld: this.input.jumpHeld,
        dashPressed: this.input.consumeDashPressed(),
      });
      if (events.jumped) SoundEffects.playJump();
      if (events.dashed) {
        SoundEffects.playDash();
        this.particles.burst(this.player.x, this.player.visualY + 0.5, 8, {
          speed: 4,
          gravity: 8,
          color: new THREE.Color(0x2ad6ff),
        });
      }

      const fieldTick = this.field.update(dt, this.elapsed, this.player.x);
      if (fieldTick.overloadStarted) {
        SoundEffects.playAlarm();
        this.hud.flashBanner("¡SOBRECARGA!");
      }

      if (!this.player.invulnerable && this.field.isPlayerHit(this.player.x, this.player.hurtHalfWidth, this.player.y)) {
        this.endGame();
      }

      this.hud.setTime(this.elapsed);
    } else if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) this.startGame();
      else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    }

    this.particles.update(dt);
    this.updateLighting(dt);
    this.applyShake(dt);
    this.outline.render(this.scene, this.camera);
  };

  /** Cross-fades warm lamps and the red emergency light for the overload phase. */
  private updateLighting(dt: number): void {
    const overloaded = this.state === "playing" && this.field.overloadActive;
    const targetKey = overloaded ? KEY_INTENSITY * 0.35 : KEY_INTENSITY;
    const targetAmbient = overloaded ? AMBIENT_INTENSITY * 0.5 : AMBIENT_INTENSITY;
    const targetLamp = overloaded ? LAMP_INTENSITY * 0.3 : LAMP_INTENSITY;
    const k = Math.min(1, dt * 8);
    this.keyLight.intensity += (targetKey - this.keyLight.intensity) * k;
    this.ambient.intensity += (targetAmbient - this.ambient.intensity) * k;
    for (const l of this.lampLights) l.intensity += (targetLamp - l.intensity) * k;

    if (overloaded) {
      this.emergencyLight.position.set(0, this.camCenterY, 4);
      this.emergencyLight.intensity = 3 + this.field.emergencyFlicker * 6;
    } else if (this.state !== "gameover") {
      this.emergencyLight.intensity += (0 - this.emergencyLight.intensity) * k;
    } else if (this.emergencyLight.intensity > 0) {
      this.emergencyLight.intensity = Math.max(0, this.emergencyLight.intensity - dt * 90);
    }
  }

  private applyShake(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const mag = SHAKE_MAGNITUDE * (this.shakeTime / SHAKE_DURATION);
      this.camera.position.set(
        (Math.random() * 2 - 1) * mag,
        this.camCenterY + (Math.random() * 2 - 1) * mag,
        this.camDistance,
      );
      this.camera.lookAt(0, this.camCenterY, 0);
    } else {
      this.camera.position.set(0, this.camCenterY, this.camDistance);
      this.camera.lookAt(0, this.camCenterY, 0);
    }
  }

  /** Positions the fixed camera so the whole room box fits the viewport. */
  private frameCamera(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const vHalf = Math.tan((CAMERA_VFOV * Math.PI) / 180 / 2);
    const distForHeight = (this.camCenterY * CAMERA_MARGIN) / vHalf;
    const distForWidth = (WALL_X * CAMERA_MARGIN) / (aspect * vHalf);
    this.camDistance = Math.max(distForHeight, distForWidth);
    this.camera.position.set(0, this.camCenterY, this.camDistance);
    this.camera.lookAt(0, this.camCenterY, 0);
  }

  private readonly onResize = (): void => {
    const { innerWidth, innerHeight } = window;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.frameCamera();
    this.renderer.setSize(innerWidth, innerHeight);
  };
}
