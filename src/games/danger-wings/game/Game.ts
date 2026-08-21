import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Bird } from "./Bird";
import { Room } from "./Room";
import { Environment } from "./Environment";
import { SpikeWalls } from "./SpikeWalls";
import { Candy } from "./Candy";
import { Particles } from "./Particles";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BEST_SCORE_KEY,
  SIDE_X,
  SIDE_SLOTS,
  CEIL_TIP_Y,
  FLOOR_TIP_Y,
  BIRD_RADIUS,
  SPEED_X_BASE,
  SPEED_X_MAX,
  SPEED_X_PER_POINT,
  spikeCountRange,
  CANDY_FIRST_BOUNCE,
  CANDY_BOUNCE_INTERVAL,
  CANDY_COLLECT_DIST,
  CANDY_POINTS,
  CANDY_Y_RANGE,
  CAM_FOV,
  CAM_FIT_MARGIN,
  CEIL_Y,
  WALL_THICKNESS,
  COLOR_RELIC,
  COLOR_FEATHER,
  TINT_CYCLE,
  TINT_PERIOD,
} from "./constants";

type GameState = "ready" | "countdown" | "playing" | "gameover";

const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;
const MAX_DT = 0.05;

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export class Game {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;

  private readonly hemi: THREE.HemisphereLight;
  private birdLight!: THREE.PointLight;
  private readonly room = new Room();
  private readonly environment = new Environment();
  private readonly spikeWalls = new SpikeWalls();
  private readonly bird = new Bird();
  private readonly candy = new Candy();
  private readonly particles = new Particles();
  private readonly hud: Hud;
  private readonly roomMode: RoomMode | null;

  private state: GameState = "ready";
  private score = 0;
  private best = 0;
  private bounces = 0;
  private nextCandyBounce = CANDY_FIRST_BOUNCE;
  private deadFor = 0;
  private elapsed = 0;

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private screenShake = 0;

  private readonly tintCurrent = new THREE.Color(TINT_CYCLE[0]);
  private readonly tintTarget = new THREE.Color(TINT_CYCLE[0]);

  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene / backdrop: solid near-black behind the painted backdrop plane.
    this.scene.background = new THREE.Color(0x07060a);
    this.scene.fog = new THREE.FogExp2(this.tintCurrent.getHex(), 0.02);

    // Camera.
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);

    // Renderer.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    container.appendChild(this.renderer.domElement);

    // Post-processing: a restrained bloom on the few bright sources.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6, // strength
      0.5, // radius
      0.82 // threshold — only genuinely bright pixels bloom
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    // Lights: moonlight over the cell (see DESIGN.md).
    this.hemi = new THREE.HemisphereLight(0x7a7398, 0x161320, 1.35);
    this.scene.add(this.hemi);

    const moon = new THREE.DirectionalLight(0xc9cfdd, 2.5);
    moon.position.set(4, 7, 8);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 30;
    moon.shadow.camera.left = -7;
    moon.shadow.camera.right = 7;
    moon.shadow.camera.top = 8;
    moon.shadow.camera.bottom = -8;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    this.scene.add(moon);

    // Cold fill so backsides aren't pure void.
    const fill = new THREE.DirectionalLight(0x4a5c82, 0.75);
    fill.position.set(-5, -2, 6);
    this.scene.add(fill);

    // A cool light riding just in front of the crow: moonlight catching the bird
    // and lighting the spikes it is about to reach (readability in the dark).
    this.birdLight = new THREE.PointLight(0xbcc4de, 18, 6, 2);
    this.scene.add(this.birdLight);

    // Shadows.
    this.bird.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.room.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    this.spikeWalls.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    this.scene.add(this.environment.object, this.environment.lights);
    this.scene.add(this.room.object, this.spikeWalls.object, this.bird.object, this.candy.object, this.particles.object);
    // Swap in the AI-painted backdrop if the image is present (else procedural).
    this.environment.loadBackdrop(this.renderer.capabilities.getMaxAnisotropy());

    // Listeners keep the controller alive; no field needed.
    new InputController(this.renderer.domElement, () => this.handleAction());
    this.hud = new Hud(this.container, () => this.handleAction());

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);

    this.roomMode = initRoomMode("danger-wings", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.fitCamera();
    window.addEventListener("resize", this.onResize);

    this.enterReady();
    this.renderer.setAnimationLoop(this.tick);
  }

  private enterReady(): void {
    this.state = "ready";
    this.score = 0;
    this.bounces = 0;
    this.nextCandyBounce = CANDY_FIRST_BOUNCE;
    this.bird.reset();
    this.spikeWalls.reset();
    this.candy.reset();
    this.particles.reset();
    // Menu ambiance: a few teeth on the right wall.
    this.spikeWalls.presentWall(1, 3);
    this.hud.setScore(0);
    this.hud.showStart();
  }

  private handleAction(): void {
    if (this.state === "playing") {
      this.bird.jump();
      SoundEffects.playFlap();
      return;
    }
    if (this.state === "countdown") return;
    if (this.state === "gameover" && (this.roomMode || this.deadFor < 0.6)) return;
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.score = 0;
    this.bounces = 0;
    this.nextCandyBounce = CANDY_FIRST_BOUNCE;
    this.bird.reset();
    this.spikeWalls.reset();
    this.candy.reset();
    this.particles.reset();
    this.screenShake = 0;
    this.hud.setScore(0);

    // Present the wall the bird will fly toward first (it starts moving right),
    // keeping the centre lane clear so the opening approach is always fair.
    const [lo, hi] = spikeCountRange(0);
    this.spikeWalls.presentWall(1, randInt(lo, hi), Math.floor(SIDE_SLOTS / 2));

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startGame(): void {
    this.bird.setHorizontalSpeed(SPEED_X_BASE);
    this.hud.showCountdown(null);
    this.state = "playing";
  }

  private die(): void {
    if (this.state !== "playing") return;
    this.state = "gameover";
    this.deadFor = 0;
    this.bird.kill();
    // Give the corpse a little upward toss so it tumbles into view.
    this.bird.velocity.y = 3;
    SoundEffects.playDeath();
    this.hud.flashHit();
    this.screenShake = 0.4;
    this.particles.burst(this.bird.object.position, COLOR_FEATHER, 14, 5);
    this.particles.burst(this.bird.object.position, 0x7a1520, 6, 4);

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.score, this.best);

    if (this.roomMode) this.roomMode.reportScore(this.score);
    else this.hud.showRanking("danger-wings", this.score);
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.elapsed += dt;

    if (this.state === "playing") this.updatePlaying(dt);
    else if (this.state === "countdown") this.updateCountdown(dt);
    else this.updateIdle(dt);

    // Keep the crow's light on the crow, pushed toward the camera so front faces
    // and the nearby wall catch it.
    const bp = this.bird.object.position;
    this.birdLight.position.set(bp.x, bp.y + 0.2, 1.6);

    this.spikeWalls.update(dt);
    this.candy.update(dt);
    this.particles.update(dt);
    this.environment.update(dt, this.elapsed);
    this.updateTint(dt);
    this.updateCamera(dt);

    this.composer.render();
  };

  private updateCountdown(dt: number): void {
    this.bird.idle(dt, this.elapsed);
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) {
      this.startGame();
    } else if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private updateIdle(dt: number): void {
    if (this.state === "gameover") {
      this.bird.update(dt);
      this.deadFor += dt;
    } else {
      this.bird.idle(dt, this.elapsed);
    }
  }

  private updatePlaying(dt: number): void {
    this.bird.update(dt);
    const p = this.bird.object.position;

    // 1. Ceiling / floor fixed spikes — always lethal.
    if (p.y + BIRD_RADIUS >= CEIL_TIP_Y || p.y - BIRD_RADIUS <= FLOOR_TIP_Y) {
      this.die();
      return;
    }

    const dir = Math.sign(this.bird.velocity.x);

    // 2. Side spikes on the wall we're heading toward.
    if (this.spikeWalls.checkHit(p.x, p.y, dir)) {
      this.die();
      return;
    }

    // 3. Wall bounce.
    const bound = SIDE_X - BIRD_RADIUS;
    if (dir > 0 && p.x >= bound) {
      p.x = bound;
      this.onBounce(1);
    } else if (dir < 0 && p.x <= -bound) {
      p.x = -bound;
      this.onBounce(-1);
    }

    // 4. Relic pickup.
    if (this.candy.isActive && p.distanceTo(this.candy.position) < CANDY_COLLECT_DIST) {
      this.collectCandy();
    }
  }

  /** hitSide: which wall was struck (+1 right, -1 left). */
  private onBounce(hitSide: 1 | -1): void {
    this.score += 1;
    this.bounces += 1;
    this.hud.setScore(this.score);
    SoundEffects.playBounce();

    // Invert direction + apply the subtle vertical assist, then reset the speed
    // magnitude with the difficulty ramp folded in.
    this.bird.bounce();
    const speed = Math.min(SPEED_X_MAX, SPEED_X_BASE + this.score * SPEED_X_PER_POINT);
    this.bird.velocity.x = Math.sign(this.bird.velocity.x) * speed;

    // The wall we just left retracts; the wall we now head toward gets fresh
    // teeth chosen by the current difficulty.
    const newSide: 1 | -1 = hitSide > 0 ? -1 : 1;
    this.spikeWalls.retractWall(hitSide);
    const [lo, hi] = spikeCountRange(this.score);
    this.spikeWalls.presentWall(newSide, randInt(lo, hi));

    // Relic schedule.
    if (!this.candy.isActive && this.bounces >= this.nextCandyBounce) {
      const y = (Math.random() * 2 - 1) * CANDY_Y_RANGE;
      this.candy.spawn(y);
    }
  }

  private collectCandy(): void {
    this.particles.burst(this.candy.position, COLOR_RELIC, 16, 4.5);
    this.candy.collect();
    this.score += CANDY_POINTS;
    this.hud.setScore(this.score);
    SoundEffects.playCandy();
    this.nextCandyBounce = this.bounces + CANDY_BOUNCE_INTERVAL;
  }

  private updateTint(dt: number): void {
    const idx = Math.floor(this.score / TINT_PERIOD) % TINT_CYCLE.length;
    this.tintTarget.set(TINT_CYCLE[idx]);
    this.tintCurrent.lerp(this.tintTarget, Math.min(1, dt * 1.2));
    (this.scene.fog as THREE.FogExp2).color.copy(this.tintCurrent);
    this.hemi.groundColor.copy(this.tintCurrent).multiplyScalar(1.4);
  }

  private updateCamera(dt: number): void {
    let x = 0;
    let y = 0;
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt);
      const f = this.screenShake * 0.5;
      x = (Math.random() - 0.5) * f;
      y = (Math.random() - 0.5) * f;
    }
    this.camera.position.x = x;
    this.camera.position.y = y;
    this.camera.lookAt(0, 0, 0);
  }

  private fitCamera(): void {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    const vFov = THREE.MathUtils.degToRad(CAM_FOV);
    const halfH = (CEIL_Y + WALL_THICKNESS) * CAM_FIT_MARGIN;
    const halfW = (SIDE_X + WALL_THICKNESS) * CAM_FIT_MARGIN;
    const distH = halfH / Math.tan(vFov / 2);
    const distW = halfW / (Math.tan(vFov / 2) * aspect);
    this.camera.position.set(0, 0, Math.max(distH, distW));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private readonly onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.fitCamera();
  };
}
