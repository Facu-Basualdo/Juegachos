import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { Street } from "./Street";
import { Scooter } from "./Scooter";
import { ObstacleField } from "./ObstacleField";
import { MailboxField } from "./MailboxField";
import { PizzaThrower } from "./Pizza";
import { Particles } from "./Particles";
import { Mailbox } from "./Mailbox";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BASE_SPEED,
  MAX_SPEED,
  SPEED_RAMP_PER_SEC,
  DIFFICULTY_STEP_SECONDS,
  DIFFICULTY_RAMP_SECONDS,
  TUTORIAL_SECONDS,
  MISS_PIZZAS,
  MISS_CUSTOMERS,
  THROW_COOLDOWN,
  DELIVERY_BASE_POINTS,
  COMBO_MAX,
  CAMERA_POS,
  CAMERA_LOOK,
  CAMERA_FOV,
  CAMERA_X_FOLLOW,
  FOG_COLOR,
  FOG_NEAR,
  FOG_FAR,
  BEST_SCORE_KEY,
  COLOR_CHEESE,
  COLOR_DIRT,
  COLOR_TOMATO,
} from "./constants";

type GameState = "ready" | "countdown" | "playing" | "gameover";

const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;
const SHAKE_DURATION = 0.5;
const SHAKE_MAGNITUDE = 0.55;

export class Game {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;

  private readonly street: Street;
  private readonly scooter: Scooter;
  private readonly obstacles: ObstacleField;
  private readonly mailboxes: MailboxField;
  private readonly thrower: PizzaThrower;
  private readonly particles: Particles;
  private readonly crashFlash: THREE.PointLight;
  private shakeTime = 0;

  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private readonly container: HTMLElement;
  private state: GameState = "ready";
  /**
   * True solo cuando el overlay de inicio / fin esta realmente en pantalla. Al
   * morir, el estado pasa a "gameover" pero el overlay aparece 600ms despues (el
   * choque se ve primero): sin este guard, reiniciar en esa ventana hacia que el
   * setTimeout del overlay retornara temprano por su propio chequeo de estado y
   * el puntaje de esa corrida nunca se enviara al ranking.
   */
  private menuVisible = true;
  private score = 0;
  private best = 0;
  private combo = 0;
  private elapsed = 0;
  private throwCooldown = 0;
  private shieldActive = true;
  private pizzasLeft = MISS_PIZZAS;
  private customersLeft = MISS_CUSTOMERS;
  private crashed = false;
  private bubbleText: string | null = null;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 700);
    this.camera.position.set(CAMERA_POS.x, CAMERA_POS.y, CAMERA_POS.z);
    this.camera.lookAt(CAMERA_LOOK.x, CAMERA_LOOK.y, CAMERA_LOOK.z);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Gentle bloom, high threshold — only the sun, order markers and pizzas glow.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.6, 0.82);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Warm golden-hour lighting (see DESIGN.md).
    const key = new THREE.DirectionalLight(0xffd9a0, 2.1);
    key.position.set(-34, 16, -60); // from the low sun
    const rim = new THREE.DirectionalLight(0xffe9c8, 0.5);
    rim.position.set(6, 8, 20); // soft fill from behind the camera
    const hemi = new THREE.HemisphereLight(0xffe0b0, 0x5a3a22, 0.95);
    this.scene.add(key, rim, hemi);

    this.street = new Street();
    this.scooter = new Scooter();
    this.obstacles = new ObstacleField(this.scene);
    this.mailboxes = new MailboxField(this.scene);
    this.particles = new Particles();
    this.thrower = new PizzaThrower(this.scene, (m) => this.deliver(m));

    this.crashFlash = new THREE.PointLight(0xff6a2a, 0, 30, 2);
    this.scene.add(this.crashFlash);
    this.scene.add(this.street.group, this.scooter.object, this.particles.points);

    this.input = new InputController(this.renderer.domElement, () => this.handleThrow());
    this.hud = new Hud(this.container, () => this.handleActivate());

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);
    this.hud.showStart();

    this.room = initRoomMode("pizza-express", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
    (window as any).__pe = this;
  }

  private handleActivate(): void {
    if (this.state === "playing" || this.state === "countdown") return;
    if (!this.menuVisible) return; // no reiniciar durante el choque previo al overlay
    // Room mode: one run per round, no retry.
    if (this.room && this.state === "gameover") return;
    this.beginCountdown();
  }

  private handleThrow(): void {
    if (this.state !== "playing" || this.throwCooldown > 0) return;
    this.throwCooldown = THROW_COOLDOWN;
    // Deliver to the customer on the side of the street the scooter is on. If
    // there is none in range, the throw is wasted (an "errant" pizza).
    const side: -1 | 1 = this.scooter.x >= 0 ? 1 : -1;
    const target = this.mailboxes.nearestPendingTarget(side);
    if (target) target.reserved = true;
    this.thrower.throw(this.scooter.throwOrigin(), target);
    SoundEffects.playThrow();
    if (!target) {
      // A late attempt burns that customer now (errant pizza cost only) so its
      // passing doesn't also charge a skipped-mailbox token.
      this.mailboxes.dismissLateTarget(side);
      this.onErrantPizza();
    }
  }

  private deliver(mailbox: Mailbox): void {
    mailbox.deliver();
    this.combo = Math.min(this.combo + 1, COMBO_MAX);
    this.score += DELIVERY_BASE_POINTS * this.combo;
    this.hud.setScore(this.score);
    this.hud.setCombo(this.combo);
    SoundEffects.playDeliver(this.combo);
    const p = mailbox.target();
    this.particles.burst(p.x, p.y + 0.2, p.z, COLOR_CHEESE, 22, 3.2, 3.4);
  }

  /** A customer passed by unserved: break the combo and (after the tutorial)
   *  spend one of the MISS_CUSTOMERS mailbox tokens — skipping customers ends
   *  the run once the pool is gone, same as wasting pizzas does. */
  private onCustomerMissed(count: number): void {
    this.combo = 0;
    this.hud.setCombo(0);
    if (this.elapsed < TUTORIAL_SECONDS) return; // learning window: skips are free
    SoundEffects.playMiss();
    this.customersLeft = Math.max(0, this.customersLeft - count);
    this.hud.setTokens(this.shieldActive, this.pizzasLeft, this.customersLeft);
    if (this.customersLeft <= 0) this.endGame(false);
  }

  /** A thrown pizza that didn't land on a customer (wrong side / no customer in
   *  range): break the combo and spend a token. The shield absorbs it first (and
   *  it's free during the tutorial); running out of pizzas after the tutorial ends
   *  the run. */
  private onErrantPizza(): void {
    this.combo = 0;
    this.hud.setCombo(0);
    SoundEffects.playMiss();
    if (this.shieldActive) {
      this.shieldActive = false;
    } else if (this.elapsed >= TUTORIAL_SECONDS) {
      this.pizzasLeft = Math.max(0, this.pizzasLeft - 1);
      if (this.pizzasLeft <= 0) {
        this.hud.setTokens(this.shieldActive, this.pizzasLeft, this.customersLeft);
        this.endGame(false);
        return;
      }
    }
    this.hud.setTokens(this.shieldActive, this.pizzasLeft, this.customersLeft);
  }

  private beginCountdown(): void {
    this.menuVisible = false;
    this.scooter.reset();
    this.scooter.object.visible = true;
    this.obstacles.reset();
    this.mailboxes.reset();
    this.thrower.reset();
    this.particles.reset();
    this.crashFlash.intensity = 0;
    this.shakeTime = 0;
    this.combo = 0;
    this.shieldActive = true;
    this.pizzasLeft = MISS_PIZZAS;
    this.customersLeft = MISS_CUSTOMERS;
    this.crashed = false;
    SoundEffects.stopEngine(); // safety: room-mode rounds can restart mid-run
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.showTokens(false);
    this.hud.showBubble(null);
    this.hud.setCombo(0);
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startGame(): void {
    this.score = 0;
    this.elapsed = 0;
    this.combo = 0;
    this.throwCooldown = 0;
    this.shieldActive = true;
    this.pizzasLeft = MISS_PIZZAS;
    this.customersLeft = MISS_CUSTOMERS;
    this.bubbleText = null;
    this.obstacles.reset(); // clean road for the tutorial window
    this.hud.setScore(0);
    this.hud.setCombo(0);
    this.hud.setTokens(true, MISS_PIZZAS, MISS_CUSTOMERS);
    this.hud.showTokens(true);
    this.hud.hide();
    this.hud.showCountdown(null);
    SoundEffects.startEngine();
    this.state = "playing";
    this.lastTime = performance.now();
  }

  private endGame(crashed: boolean): void {
    this.state = "gameover";
    this.crashed = crashed;
    SoundEffects.stopEngine();
    this.hud.showTokens(false);
    this.hud.showBubble(null);

    const px = this.scooter.x;
    if (crashed) {
      SoundEffects.playCrash();
      this.particles.burst(px, 0.6, 0.2, COLOR_DIRT, 30, 4.5, 4.2);
      this.particles.burst(px, 0.6, 0.2, COLOR_TOMATO, 16, 3.5, 5.0);
      this.crashFlash.position.set(px, 1.2, 0.5);
      this.crashFlash.intensity = 40;
      this.shakeTime = SHAKE_DURATION;
      this.scooter.object.visible = false;
    }

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
    }
    this.hud.setBest(this.best);

    // Let the crash play in the clear before the overlay covers it.
    window.setTimeout(() => {
      if (this.state !== "gameover") return;
      this.menuVisible = true;
      this.hud.showGameOver(this.score, this.best, this.crashed);
      if (this.room) this.room.reportScore(this.score);
      else this.hud.showRanking("pizza-express", this.score);
    }, crashed ? 600 : 250);
  }

  /** Normalized difficulty 0..1, quantized into steps so it visibly ramps up.
   *  `t` is play time (elapsed minus the tutorial), so the ramp starts fresh. */
  private difficulty(t: number): number {
    const level = Math.floor(t / DIFFICULTY_STEP_SECONDS);
    const d = (level * DIFFICULTY_STEP_SECONDS) / DIFFICULTY_RAMP_SECONDS;
    return d < 0 ? 0 : d > 1 ? 1 : d;
  }

  /** Drives the two tutorial thought bubbles over the first `TUTORIAL_SECONDS`. */
  private updateTutorial(): void {
    // The shield is only the tutorial cushion — it vanishes when the tutorial
    // ends, so the real game runs on the 3 pizza tokens alone.
    if (this.elapsed >= TUTORIAL_SECONDS && this.shieldActive) {
      this.shieldActive = false;
      this.hud.setTokens(false, this.pizzasLeft, this.customersLeft);
    }
    let text: string | null = null;
    if (this.elapsed < 5) text = "W / ↑ / Espacio para lanzar la pizza";
    else if (this.elapsed < TUTORIAL_SECONDS) text = "Ponete del lado de la calle al que querés tirar";
    if (text !== this.bubbleText) {
      this.bubbleText = text;
      this.hud.showBubble(text);
    }
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.state === "playing") {
      this.elapsed += dt;
      this.throwCooldown = Math.max(0, this.throwCooldown - dt);
      const inTutorial = this.elapsed < TUTORIAL_SECONDS;
      // Play time only counts after the tutorial, so the ramp starts then.
      const playT = Math.max(0, this.elapsed - TUTORIAL_SECONDS);
      const d = this.difficulty(playT);
      const speed = inTutorial ? BASE_SPEED : Math.min(BASE_SPEED + playT * SPEED_RAMP_PER_SEC, MAX_SPEED);
      const dz = speed * dt;
      SoundEffects.setEngineSpeed((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED));

      this.scooter.update(dt, this.input.dirX, dz);
      this.street.scroll(dz, dt);

      const missed = this.mailboxes.update(dt, dz, d);
      if (missed > 0) this.onCustomerMissed(missed);
      this.thrower.update(dt);

      // No lethal obstacles during the tutorial (safe learning window).
      if (!inTutorial) {
        const hit = this.obstacles.update(dt, dz, this.scooter.x, speed, d);
        if (hit) this.endGame(true);
      }

      this.updateTutorial();
    } else {
      // Idle drift so the town keeps moving on the menus (not the countdown,
      // which needs a clean road for the tutorial start).
      const dz = (this.state === "countdown" ? 10 : 5) * dt;
      this.street.scroll(dz, dt);
      this.scooter.update(dt, 0, dz);
      this.mailboxes.update(dt, dz, 0);
      if (this.state !== "countdown") {
        this.obstacles.update(dt, dz, 999, BASE_SPEED, 0); // 999 = never collide off-road
      }
      this.thrower.update(dt);

      if (this.state === "countdown") {
        this.countdownTime += dt;
        const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
        if (index >= COUNTDOWN_LABELS.length) this.startGame();
        else if (index !== this.lastCountdownIndex) {
          this.lastCountdownIndex = index;
          SoundEffects.playCountdownTick();
          this.hud.showCountdown(COUNTDOWN_LABELS[index]);
        }
      }
    }

    this.particles.update(dt);
    if (this.crashFlash.intensity > 0) {
      this.crashFlash.intensity = Math.max(0, this.crashFlash.intensity - dt * 90);
    }
    this.applyCamera(dt);
    this.composer.render();
  };

  /** Chase camera: eases its X toward the scooter and applies the crash shake. */
  private applyCamera(dt: number): void {
    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const mag = SHAKE_MAGNITUDE * (this.shakeTime / SHAKE_DURATION);
      sx = (Math.random() * 2 - 1) * mag;
      sy = (Math.random() * 2 - 1) * mag;
    }
    const followX = this.scooter.x * CAMERA_X_FOLLOW;
    this.camera.position.set(CAMERA_POS.x + followX + sx, CAMERA_POS.y + sy, CAMERA_POS.z);
    this.camera.lookAt(CAMERA_LOOK.x + this.scooter.x * CAMERA_X_FOLLOW * 1.6, CAMERA_LOOK.y, CAMERA_LOOK.z);
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
