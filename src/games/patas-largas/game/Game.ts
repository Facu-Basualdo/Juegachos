import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { RAPIER as R } from "./physics";
import { Creature, type LegSide } from "./Creature";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { Particles } from "./Particles";
import { Renderer } from "./Renderer";
import { StepController } from "./StepController";
import { Terrain } from "./Terrain";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BEST_SCORE_KEY,
  DUST_COLOR,
  GRAVITY_Y,
  PHYS_MAX_SUBSTEPS,
  PHYS_SOLVER_ITERATIONS,
  PHYS_STEP,
  RAGDOLL_TIME,
  RECORD_COLOR,
  START_X,
  TORSO_FLOOR_Y,
} from "./constants";

const GAME_ID = "patas-largas";
type GameState = "ready" | "countdown" | "playing" | "falling" | "gameover";

const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;
const MAX_DT = 0.1;
/** Cuanto hay que esperar tras la caida para poder reintentar sin querer. */
const RESTART_LOCK = 0.45;

const DUST_TINT = new THREE.Color(DUST_COLOR).convertSRGBToLinear();
const FALL_TINT = new THREE.Color(0xc9b199).convertSRGBToLinear();
const RECORD_TINT = new THREE.Color(RECORD_COLOR).convertSRGBToLinear();

export class Game {
  private readonly view: Renderer;
  private readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  private readonly terrain: Terrain;
  private readonly creature: Creature;
  private readonly particles = new Particles();
  private readonly steps = new StepController();
  private readonly hud: Hud;
  private readonly input: InputController;
  private readonly room: RoomMode | null;

  private state: GameState = "ready";
  private best = 0;
  private maxX = START_X;
  private deadFor = 0;
  private accumulator = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  private readonly tmp = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.view = new Renderer(container);

    this.world = new R.World({ x: 0, y: GRAVITY_Y, z: 0 });
    this.world.timestep = PHYS_STEP;
    this.world.numSolverIterations = PHYS_SOLVER_ITERATIONS;
    this.events = new R.EventQueue(true);

    this.terrain = new Terrain(this.world);
    this.creature = new Creature(this.world);
    this.view.scene.add(this.terrain.group, this.creature.group, this.particles.points);

    this.hud = new Hud(container);
    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);
    this.hud.setLegsVisible(false);
    this.hud.showStart();
    this.terrain.setRecord(this.best);
    this.terrain.update(START_X);

    this.input = new InputController(container, () => this.handleTap());

    this.room = initRoomMode(GAME_ID, {
      getScore: () => this.score(),
      onStart: () => this.beginCountdown(),
    });

    this.view.follow(START_X, this.creature.torsoY(), 0, true);
    this.view.renderer.setAnimationLoop(this.tick);
  }

  // ------------------------------------------------------------------ estado

  private score(): number {
    return Math.max(0, Math.floor(this.maxX - START_X));
  }

  private handleTap(): void {
    switch (this.state) {
      case "playing":
        this.doStep();
        return;
      case "ready":
        this.beginCountdown();
        return;
      case "gameover":
        // En sala se juega una sola corrida por ronda.
        if (this.room || this.deadFor < RESTART_LOCK) return;
        this.beginCountdown();
        return;
      default:
        // countdown / falling: el toque no hace nada.
        return;
    }
  }

  private beginCountdown(): void {
    this.creature.reset();
    this.steps.reset();
    this.input.reset();
    this.particles.clear();
    this.maxX = START_X;
    this.accumulator = 0;
    this.deadFor = 0;

    this.terrain.setRecord(this.best);
    this.terrain.update(START_X);

    this.hud.hide();
    this.hud.setDistance(0);
    this.hud.setLegsVisible(true);
    this.hud.setNextLeg(this.steps.pendingSide());
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);

    this.view.follow(START_X, this.creature.torsoY(), 0, true);

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
  }

  private startRun(): void {
    this.hud.showCountdown(null);
    this.state = "playing";
    // Sale ya caminando: ver Creature.launch().
    this.creature.launch();
  }

  private doStep(): void {
    const result = this.steps.tap(this.creature, performance.now());
    if (!result) return;
    this.hud.setNextLeg(this.steps.pendingSide());
    this.hud.flashGrade(result.grade, this.steps.streak());
    this.hud.setTiming(0);
    SoundEffects.playToeOff();

    // Polvillo del pie que despega.
    this.creature.footPosition(result.side, this.tmp);
    this.particles.burst(this.tmp, {
      count: 5,
      color: DUST_TINT,
      speed: 1.1,
      spread: 1.5,
      size: 0.06,
      life: 0.45,
      drift: -0.5,
    });
  }

  private die(): void {
    if (this.state !== "playing") return;
    this.state = "falling";
    this.deadFor = 0;
    this.creature.collapse();
    this.view.kick(1);
    SoundEffects.playFall();

    this.tmp.set(this.creature.torsoX(), Math.max(0.2, this.creature.torsoY() * 0.4), 0);
    this.particles.burst(this.tmp, {
      count: 34,
      color: FALL_TINT,
      speed: 3.4,
      spread: 2.6,
      size: 0.1,
      life: 0.95,
      drift: 0.6,
    });
  }

  private finish(): void {
    this.state = "gameover";
    const meters = this.score();

    if (meters > this.best) {
      this.best = meters;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
      this.hud.setBest(this.best);
    }

    this.hud.setLegsVisible(false);
    this.hud.showGameOver(meters, this.best, this.steps.stepCount());

    if (this.room) this.room.reportScore(meters);
    else this.hud.showRanking(GAME_ID, meters);
  }

  // ------------------------------------------------------------------- bucle

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    switch (this.state) {
      case "countdown":
        this.updateCountdown(dt);
        break;
      case "playing":
      case "falling":
        this.simulate(dt);
        break;
      default:
        break;
    }

    if (this.state === "falling") {
      this.deadFor += dt;
      if (this.deadFor >= RAGDOLL_TIME) this.finish();
    } else if (this.state === "gameover") {
      this.deadFor += dt;
      this.simulate(dt); // El ragdoll sigue asentandose bajo el cartel.
    }

    this.particles.update(dt);
    this.creature.sync();
    this.terrain.update(this.creature.torsoX());
    this.view.follow(this.creature.torsoX(), this.creature.torsoY(), dt, false);
    this.view.render();
  };

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) {
      this.startRun();
    } else if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  /** Fisica a paso fijo: las patas son finas y largas, dt variable las dobla. */
  private simulate(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, PHYS_STEP * PHYS_MAX_SUBSTEPS);
    let steps = 0;
    while (this.accumulator >= PHYS_STEP && steps < PHYS_MAX_SUBSTEPS) {
      this.creature.applyMotors(PHYS_STEP);
      this.world.step(this.events);
      this.creature.constrainToRail();
      this.creature.clampVelocities();
      this.drainEvents();
      this.accumulator -= PHYS_STEP;
      steps++;
    }

    if (this.state !== "playing") return;

    const x = this.creature.torsoX();
    if (x > this.maxX) this.maxX = x;
    this.hud.setDistance(this.score());
    this.hud.setTiming(this.creature.stanceTrailRatio());

    if (this.terrain.checkRecord(x)) {
      SoundEffects.playRecord();
      this.view.kick(0.5);
      this.hud.toast("RECORD SUPERADO");
      this.tmp.set(this.terrain.recordPosition(), 3.2, 1.4);
      this.particles.burst(this.tmp, {
        count: 26,
        color: RECORD_TINT,
        speed: 2.6,
        spread: 2.8,
        size: 0.09,
        life: 1.1,
      });
    }

    // Red de seguridad: si el evento de colision se escapa, la altura no miente.
    if (this.creature.torsoY() < TORSO_FLOOR_Y) this.die();
  }

  private drainEvents(): void {
    const ground = this.terrain.groundCollider.handle;
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const other = h1 === ground ? h2 : h2 === ground ? h1 : -1;
      if (other < 0) return;

      // Regla del original: si toca el suelo algo que no sea un zapato, se acabo.
      if (this.creature.lethalColliders.has(other)) {
        this.die();
        return;
      }

      const side = this.creature.footColliders.get(other);
      if (side !== undefined && this.state === "playing") this.landFoot(side);
    });
  }

  /** Baja el juego: usado si alguna vez se monta y desmonta en la misma pagina. */
  dispose(): void {
    this.view.renderer.setAnimationLoop(null);
    this.input.dispose();
    this.view.dispose();
  }

  private landFoot(side: LegSide): void {
    // El paso termina por contacto, no por reloj (ver Creature.footLanded).
    const wasSwinging = this.creature.legRole(side) === "swing";
    this.creature.footLanded(side);
    const solid = !wasSwinging || this.creature.legRole(side) !== "swing";
    SoundEffects.playStep(solid);
    this.creature.footPosition(side, this.tmp);
    this.particles.burst(this.tmp, {
      count: 9,
      color: DUST_TINT,
      speed: 1.5,
      spread: 2.2,
      size: 0.075,
      life: 0.6,
      drift: -0.9,
    });
  }
}
