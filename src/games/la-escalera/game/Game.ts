import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Escalator } from "./Escalator";
import { Environment } from "./Environment";
import { PromptRack } from "./PromptRack";
import { Climber } from "./Climber";
import { Particles } from "./Particles";
import { Blood } from "./Blood";
import { InputController } from "./InputController";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { DIRECTIONS, type Direction } from "./directions";
import { rampPoint } from "./ramp";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BEST_SCORE_KEY,
  START_T,
  MAX_HEIGHT,
  CLIMB_GAIN,
  COMBO_BOOST,
  COMBO_STEP,
  SLIP_WRONG,
  SLIP_TIMEOUT,
  STUMBLE_TIME,
  STUMBLE_DRIFT_MULT,
  DRIFT_BASE,
  DRIFT_PER_POINT,
  DRIFT_MAX,
  STEP_SCROLL_BASE,
  STEP_SCROLL_PER_DRIFT,
  BEAT_START,
  BEAT_MIN,
  BEAT_PER_POINT,
  PROMPT_VISIBLE,
  MAX_SAME_DIR,
  CAM_FOV,
  CAM_POS,
  CAM_TARGET,
  CAM_PORTRAIT_PUSH,
  COLOR_VOID,
  COLOR_BONE,
  COLOR_EMBER,
  COLOR_GOLD,
  COLOR_IRON_EDGE,
  TINT_CYCLE,
  TINT_PERIOD,
} from "./constants";

type GameState = "ready" | "countdown" | "playing" | "gameover";

const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;
const MAX_DT = 0.05;
/** Segundos entre la caida y el cartel de game over (ver `die`). */
const GAMEOVER_DELAY = 1.6;

/**
 * La Escalera. Un obrero sube una escalera mecanica que baja: cada flecha que
 * el rack de arriba pide y el jugador acierta lo empuja un escalon hacia
 * arriba, cada error lo hace resbalar, y el arrastre constante de la maquina
 * (que crece con el puntaje) lo lleva siempre hacia el pozo de puas del pie.
 *
 * Toda la posicion del jugador es un escalar `t` en [0, 1] sobre la rampa
 * (ver `ramp.ts`): 1 = la boca de arriba, 0 = las puas.
 */
export class Game {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;

  private readonly hemi: THREE.HemisphereLight;
  private readonly climberLight: THREE.PointLight;
  private readonly escalator = new Escalator();
  private readonly environment = new Environment();
  private readonly rack = new PromptRack();
  private readonly climber = new Climber();
  private readonly particles = new Particles();
  private readonly blood = new Blood();
  private readonly hud: Hud;
  private readonly roomMode: RoomMode | null;

  private state: GameState = "ready";
  private score = 0;
  private best = 0;
  private combo = 0;
  /** Altura en la rampa: 1 arriba, 0 en las puas. */
  private height = START_T;
  private stumbleTimer = 0;
  private deadFor = 0;
  private overlayPending = false;
  private elapsed = 0;

  private queue: Direction[] = [];
  private lastDir: Direction | null = null;
  private sameDirRun = 0;
  private promptTime = 0;
  private beat = BEAT_START;

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private screenShake = 0;
  private camPush = 0;

  private readonly tintCurrent = new THREE.Color(TINT_CYCLE[0]);
  private readonly tintTarget = new THREE.Color(TINT_CYCLE[0]);
  private readonly camTarget = new THREE.Vector3(...CAM_TARGET);
  private readonly tmp = new THREE.Vector3();

  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene.background = new THREE.Color(COLOR_VOID);
    this.scene.fog = new THREE.FogExp2(this.tintCurrent.getHex(), 0.026);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);

    // Bloom racionado: solo las pantallas, las lamparas y el pozo pasan el umbral.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 0.8),
    );
    this.composer.addPass(new OutputPass());

    // Luz: una de servicio fria desde arriba y nada mas gratis (ver DESIGN.md).
    this.hemi = new THREE.HemisphereLight(0x5c6478, 0x0a0b12, 0.85);
    this.scene.add(this.hemi);

    const key = new THREE.DirectionalLight(COLOR_BONE, 1.5);
    key.position.set(3.5, 14, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 46;
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x3d4a6b, 0.55);
    fill.position.set(-6, 3, -8);
    this.scene.add(fill);

    // Farol que acompaña al muñeco: sin esto la silueta se pierde en el hierro.
    this.climberLight = new THREE.PointLight(0xcfd6e6, 7.5, 6.5, 2);
    this.scene.add(this.climberLight);

    this.scene.add(this.environment.object, this.environment.lights);
    this.scene.add(
      this.escalator.object,
      this.rack.object,
      this.climber.object,
      this.particles.object,
      this.blood.object,
    );

    this.hud = new Hud(this.container, () => this.handleAction());
    // Los listeners mantienen vivo el controlador; no hace falta guardarlo.
    new InputController(this.container, {
      onDirection: (dir) => this.handleDirection(dir),
      onAction: () => this.handleAction(),
    });

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);

    this.roomMode = initRoomMode("la-escalera", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.fitCamera();
    window.addEventListener("resize", this.onResize);

    this.enterReady();
    this.renderer.setAnimationLoop(this.tick);
  }

  // --- ciclo de vida --------------------------------------------------------

  private enterReady(): void {
    this.state = "ready";
    this.resetRun();
    this.hud.setScore(0);
    this.hud.showStart();
  }

  private resetRun(): void {
    this.score = 0;
    this.combo = 0;
    this.height = START_T;
    this.stumbleTimer = 0;
    this.promptTime = 0;
    this.beat = BEAT_START;
    this.screenShake = 0;
    this.lastDir = null;
    this.sameDirRun = 0;
    this.queue = [];
    for (let i = 0; i < PROMPT_VISIBLE; i++) this.queue.push(this.rollDirection());
    this.rack.setQueue(this.queue);
    this.rack.reset();
    this.climber.reset();
    this.particles.reset();
    this.blood.reset();
    this.hud.clearBlood();
    this.hud.setCombo(0);
    this.hud.setDanger(this.height / MAX_HEIGHT);
  }

  private handleAction(): void {
    if (this.state === "playing" || this.state === "countdown") return;
    if (this.state === "gameover" && (this.roomMode || this.overlayPending)) return;
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.resetRun();
    this.hud.setScore(0);
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startGame(): void {
    this.hud.showCountdown(null);
    this.promptTime = 0;
    this.state = "playing";
  }

  private die(): void {
    if (this.state !== "playing") return;
    this.state = "gameover";
    this.deadFor = 0;
    this.overlayPending = false;
    this.height = 0;
    this.hud.setDanger(0);
    this.climber.kill();
    SoundEffects.playDeath();
    this.hud.flashHit();
    this.screenShake = 0.45;
    rampPoint(0.02, this.tmp, 0.4);
    this.particles.burst(this.tmp, COLOR_IRON_EDGE, 10, 4);

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    // El cartel de game over NO sale todavia: taparia justo el empalamiento y
    // el charco, que es la mitad del premio de perder. Sale en `finishDeath`.
    this.overlayPending = true;
  }

  /** Cierra la muerte: cartel, ranking y reporte a la sala. */
  private finishDeath(): void {
    this.overlayPending = false;
    this.hud.showGameOver(this.score, this.best);
    if (this.roomMode) this.roomMode.reportScore(this.score);
    else this.hud.showRanking("la-escalera", this.score);
  }

  // --- flechas --------------------------------------------------------------

  /** Elige una flecha nueva evitando mas de `MAX_SAME_DIR` repeticiones. */
  private rollDirection(): Direction {
    let dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    if (dir === this.lastDir && this.sameDirRun >= MAX_SAME_DIR) {
      const others = DIRECTIONS.filter((d) => d !== dir);
      dir = others[Math.floor(Math.random() * others.length)];
    }
    this.sameDirRun = dir === this.lastDir ? this.sameDirRun + 1 : 1;
    this.lastDir = dir;
    return dir;
  }

  private nextPrompt(): void {
    this.queue.shift();
    this.queue.push(this.rollDirection());
    this.rack.setQueue(this.queue);
    this.promptTime = 0;
    this.rack.setProgress(1);
  }

  private handleDirection(dir: Direction): void {
    if (this.state !== "playing") return;
    if (dir === this.queue[0]) this.onHit();
    else this.onWrong();
  }

  private onHit(): void {
    this.score += 1;
    this.combo += 1;
    this.height = Math.min(MAX_HEIGHT, this.height + CLIMB_GAIN);
    this.stumbleTimer = 0;

    this.hud.setScore(this.score);
    this.hud.setCombo(this.combo);
    this.climber.hop();
    this.rack.flashHit();
    SoundEffects.playStep(this.combo);
    rampPoint(this.height, this.tmp, 0.1);
    this.particles.burst(this.tmp, COLOR_IRON_EDGE, 4, 2.4);

    if (this.combo % COMBO_STEP === 0) {
      this.height = Math.min(MAX_HEIGHT, this.height + COMBO_BOOST);
      SoundEffects.playCombo();
      this.particles.burst(this.tmp, COLOR_GOLD, 10, 3.4);
    }

    this.nextPrompt();
  }

  private onWrong(): void {
    this.slip(SLIP_WRONG);
    SoundEffects.playSlip();
    this.hud.flashHit();
    this.screenShake = 0.16;
    this.nextPrompt();
  }

  private onTimeout(): void {
    this.slip(SLIP_TIMEOUT);
    SoundEffects.playTimeout();
    this.nextPrompt();
  }

  private slip(amount: number): void {
    this.combo = 0;
    this.hud.setCombo(0);
    this.height -= amount;
    this.stumbleTimer = STUMBLE_TIME;
    this.climber.stumble();
    this.rack.flashMiss();
    rampPoint(Math.max(this.height, 0), this.tmp, 0.1);
    this.particles.burst(this.tmp, COLOR_EMBER, 6, 2.8);
  }

  // --- loop -----------------------------------------------------------------

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.elapsed += dt;

    if (this.state === "playing") this.updatePlaying(dt);
    else if (this.state === "countdown") this.updateCountdown(dt);
    else this.updateIdle(dt);

    this.particles.update(dt);
    this.blood.update(dt);
    this.environment.update(dt, this.elapsed);
    this.rack.update(dt, this.elapsed);
    this.escalator.pulsePit(this.elapsed, 1 - Math.min(1, this.height / 0.45));
    this.updateTint(dt);
    this.updateCamera(dt);

    this.composer.render();
  };

  private updateCountdown(dt: number): void {
    this.climber.idle(this.height, this.elapsed);
    this.escalator.update(dt, STEP_SCROLL_BASE);
    this.followClimber();

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
    // La maquina nunca se detiene, ni en el menu ni sobre el cadaver.
    this.escalator.update(dt, STEP_SCROLL_BASE);
    if (this.state === "gameover") {
      this.deadFor += dt;
      this.climber.update(dt, this.height, 1);
      if (this.climber.consumeImpale()) this.onImpale();
      if (this.overlayPending && this.deadFor >= GAMEOVER_DELAY) this.finishDeath();
    } else {
      this.climber.idle(this.height, this.elapsed);
    }
    this.followClimber();
  }

  private updatePlaying(dt: number): void {
    this.beat = Math.max(BEAT_MIN, BEAT_START - this.score * BEAT_PER_POINT);

    // 1. Reloj de la flecha actual.
    this.promptTime += dt;
    this.rack.setProgress(1 - this.promptTime / this.beat);
    if (this.promptTime >= this.beat) this.onTimeout();

    // 2. Arrastre de la escalera (x2 mientras dura el tropiezo).
    this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);
    const drift = Math.min(DRIFT_MAX, DRIFT_BASE + this.score * DRIFT_PER_POINT);
    const applied = drift * (this.stumbleTimer > 0 ? STUMBLE_DRIFT_MULT : 1);
    this.height -= applied * dt;

    this.escalator.update(dt, STEP_SCROLL_BASE + drift * STEP_SCROLL_PER_DRIFT);
    this.hud.setDanger(this.height / MAX_HEIGHT);

    if (this.height <= 0) {
      this.die();
      return;
    }

    this.climber.update(dt, this.height, Math.min(1, drift / DRIFT_MAX));
    this.followClimber();
  }

  /** El cuerpo llego a las puas: sangre, sacudon y golpe humedo. */
  private onImpale(): void {
    this.blood.burst(this.climber.object.position);
    this.screenShake = 0.5;
    SoundEffects.playImpale();
    this.hud.showBlood();
  }

  /** El farol del muñeco lo sigue, empujado hacia la camara. */
  private followClimber(): void {
    const p = this.climber.object.position;
    this.climberLight.position.set(p.x, p.y + 1.9, p.z + 1.6);
  }

  private updateTint(dt: number): void {
    const idx = Math.floor(this.score / TINT_PERIOD) % TINT_CYCLE.length;
    this.tintTarget.set(TINT_CYCLE[idx]);
    this.tintCurrent.lerp(this.tintTarget, Math.min(1, dt * 1.2));
    (this.scene.fog as THREE.FogExp2).color.copy(this.tintCurrent);
    this.hemi.groundColor.copy(this.tintCurrent).multiplyScalar(1.5);
  }

  private updateCamera(dt: number): void {
    // Sigue apenas la altura del muñeco: encuadre estable, pero vivo. El
    // seguimiento va acotado porque el rack de pantallas vive pegado al borde
    // superior: con mas recorrido, la fila de flechas que vienen se sale del
    // cuadro justo cuando el jugador esta hundido y mas la necesita.
    const focus = this.climber.object.position.y;
    const offset =
      this.state === "gameover"
        ? -1.3 // encuadre de muerte: se abre para que entre el pozo entero
        : THREE.MathUtils.clamp((focus - 4.6) * 0.14, -0.55, 0.55);
    this.camTarget.y += (CAM_TARGET[1] + offset - this.camTarget.y) * Math.min(1, dt * 2.4);

    let shakeX = 0;
    let shakeY = 0;
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt);
      const f = this.screenShake * 0.55;
      shakeX = (Math.random() - 0.5) * f;
      shakeY = (Math.random() - 0.5) * f;
    }

    this.camera.position.set(
      CAM_POS[0] + shakeX,
      CAM_POS[1] + (this.camTarget.y - CAM_TARGET[1]) * 0.5 + shakeY,
      CAM_POS[2] + this.camPush,
    );
    this.camera.lookAt(CAM_TARGET[0], this.camTarget.y, CAM_TARGET[2]);
  }

  /** En vertical la camara se aleja para que el rack y el pozo entren juntos. */
  private fitCamera(): void {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    this.camPush = aspect < 1 ? CAM_PORTRAIT_PUSH * Math.min(1, 1 - aspect + 0.35) : 0;
    this.camera.updateProjectionMatrix();
  }

  private readonly onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.fitCamera();
  };
}
