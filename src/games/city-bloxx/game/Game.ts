import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { Tower, type PlaceResult } from "./Tower";
import { Crane } from "./Crane";
import { Environment } from "./Environment";
import { Particles } from "./Particles";
import { buildFloor, buildFoundation, buildingColor } from "./Blocks";
import { Hud } from "./Hud";
import { InputController } from "./InputController";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  BASE_POP,
  BUILDING_CAP_BASE,
  BUILDING_CAP_GROWTH,
  BUILDING_CAP_MAX,
  CAM_FOCUS_UP,
  CAM_FOV,
  CAM_LERP,
  CAM_X,
  CAM_Y_OFF,
  CAM_Z,
  COMBO_MULT,
  COMBO_SPEEDUP,
  COMBO_THRESHOLD,
  BUILDING_BONUS_PER_FLOOR,
  CRUMBLE_HOP,
  CRUMBLE_KICK,
  DROP_GRAVITY,
  DROP_INHERIT,
  MAX_DT,
  MISS_HOP,
  MISS_KICK,
  PERFECT_BONUS,
  SWAY_INSTABILITY_MAX,
  SWAY_RAMP_PER_FLOOR,
} from "./constants";

type State = "ready" | "countdown" | "playing" | "dead";

const BEST_KEY = "city-bloxx:best";

/** Countdown before a run starts: one label shown per COUNTDOWN_STEP seconds. */
const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

/** The block currently on the hook or falling. */
interface Block {
  mesh: THREE.Object3D;
}

/** A missed block plummeting into the void (cosmetic). */
interface Debris {
  mesh: THREE.Object3D;
  vx: number;
  vy: number;
  spin: number;
}

/**
 * Orchestrates the Three.js scene, the state machine and the game loop for the
 * City Bloxx rework. Owns the four systems: the swinging Crane (module 1), the
 * balance/collision Tower (module 2), the dynamic camera + Environment
 * (module 3), and the combo / population / lives economy (module 4).
 */
export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly sun: THREE.DirectionalLight;

  private readonly tower = new Tower();
  private readonly crane = new Crane();
  private readonly environment: Environment;
  private readonly particles = new Particles();
  private readonly hud: Hud;
  private readonly input: InputController;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";

  private population = 0;
  private best = Number(localStorage.getItem(BEST_KEY)) || 0;

  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private deadFor = 0;

  /** Consecutive perfect placements; drives the combo state. */
  private perfectCombo = 0;
  /** Building / roof bookkeeping (absolute rule 2). */
  private buildingIndex = 0;
  private floorInBuilding = 0;
  private buildingCap = BUILDING_CAP_BASE;
  private seed = 0;

  private block: Block | null = null;
  private blockFalling = false;
  private blockVy = 0;
  /** Horizontal velocity the block inherited from the swing at release. */
  private blockVx = 0;

  private readonly debris: Debris[] = [];

  /** Vertical camera focus (world Y), lerped toward the tower top. */
  private camY = 0;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      CAM_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      400,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4,
      0.6,
      0.82,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Lights: warm key sun + cool sky fill (see DESIGN.md).
    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4a3b2a, 1.05));
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 40;
    const s = 7;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const fill = new THREE.DirectionalLight(0x9ec9ff, 0.4);
    fill.position.set(-6, 6, -4);
    this.scene.add(fill);

    this.environment = new Environment(this.scene);
    this.scene.add(this.environment.group);
    this.scene.add(buildFoundation());
    this.scene.add(this.tower.group);
    this.scene.add(this.crane.group);
    this.scene.add(this.particles.points);

    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.showScore(false);
    this.hud.showStart();

    this.room = initRoomMode("city-bloxx", {
      getScore: () => this.population,
      onStart: () => this.beginCountdown(),
    });

    this.input = new InputController(this.renderer.domElement, () => this.onDrop());

    this.resetWorld();
    window.addEventListener("resize", this.onResize);
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.tick);
  }

  private onDrop(): void {
    switch (this.state) {
      case "ready":
        this.beginCountdown();
        break;
      case "playing":
        if (this.block && !this.blockFalling) {
          this.blockFalling = true;
          this.blockVy = 0;
          // Inherit the swing's horizontal velocity so the block flies along its
          // arc instead of dropping straight down (real pendulum inertia).
          this.blockVx = this.crane.blockVx * DROP_INHERIT;
          this.crane.setHolding(false);
          SoundEffects.playDrop();
        }
        break;
      case "dead":
        // En modo sala se juega una sola partida por ronda: sin reintento.
        if (this.room) return;
        if (this.deadFor > 0.6) this.beginCountdown();
        break;
    }
  }

  private computeCap(): number {
    return Math.min(BUILDING_CAP_MAX, BUILDING_CAP_BASE + this.buildingIndex * BUILDING_CAP_GROWTH);
  }

  /** Clears the tower/crane/debris to a fresh, empty construction site. */
  private resetWorld(): void {
    // Drop any block still on the hook (e.g. the one spawned for the ready
    // screen) so restarting doesn't orphan its mesh in the scene.
    if (this.block) {
      this.scene.remove(this.block.mesh);
      this.block = null;
    }
    this.blockFalling = false;
    this.tower.reset();
    this.crane.reset();
    this.clearDebris();
    this.particles.clear();
    this.population = 0;
    this.perfectCombo = 0;
    this.buildingIndex = 0;
    this.floorInBuilding = 0;
    this.buildingCap = this.computeCap();
    this.seed = 0;
    this.camY = this.tower.landingTopY() + CAM_FOCUS_UP;
    this.hud.setScore(0);
    this.hud.setBalance(0);
    this.hud.setCombo(false);
    this.hud.setBuilding(this.buildingIndex + 1, this.floorInBuilding, this.buildingCap);
    this.spawnBlock();
    this.updateCamera(1);
  }

  /** Puts a fresh floor of the current building's color on the hook. */
  private spawnBlock(): void {
    const mesh = buildFloor(buildingColor(this.buildingIndex), ++this.seed);
    mesh.position.set(this.crane.blockX, this.crane.blockY, 0);
    this.scene.add(mesh);
    this.block = { mesh };
    this.blockFalling = false;
    this.blockVy = 0;
    this.crane.setHolding(true);
  }

  private beginCountdown(): void {
    this.resetWorld();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.showScore(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private start(): void {
    this.state = "playing";
    this.hud.showScore(true);
    this.hud.hide();
    this.hud.showCountdown(null);
  }

  private die(topple: boolean): void {
    this.state = "dead";
    this.deadFor = 0;
    if (topple) SoundEffects.playCollapse();
    this.hud.showScore(false);
    if (this.population > this.best) {
      this.best = this.population;
      localStorage.setItem(BEST_KEY, String(this.best));
      this.hud.setBest(this.best);
    }
    this.hud.showGameOver(this.population, this.best);
    if (this.room) this.room.reportScore(this.population);
    else this.hud.showRanking("city-bloxx", this.population);
  }

  /** Population awarded for placing one floor (module 4). */
  private populationFor(res: PlaceResult, comboActive: boolean): number {
    let pop: number;
    if (res.perfect) {
      pop = BASE_POP + PERFECT_BONUS;
    } else {
      // A crooked floor is unstable, so fewer habitants move in.
      pop = Math.round(BASE_POP * (0.35 + 0.65 * res.quality));
    }
    return comboActive ? pop * COMBO_MULT : pop;
  }

  /** Resolves a dropped floor: a miss ends the run, a hit stacks and rebalances. */
  private resolveDrop(): void {
    // Use the block's live X (it drifted sideways with its inherited velocity).
    const dropX = this.block!.mesh.position.x;
    const res = this.tower.place(dropX, this.block!.mesh);
    if (!res.ok) {
      this.onMiss();
      return;
    }

    // The mesh now belongs to the tower.
    this.block = null;
    this.blockFalling = false;

    if (res.perfect) this.perfectCombo++;
    else this.perfectCombo = 0;
    const comboActive = this.perfectCombo >= COMBO_THRESHOLD;

    let pop = this.populationFor(res, comboActive);
    this.floorInBuilding++;

    // A building completes when it reaches its cap: pay a population bonus and
    // the next floor begins the next building (new color) — no roof piece.
    const completed = this.floorInBuilding >= this.buildingCap;
    const seam = this.tower.topSeam();
    if (completed) {
      pop += BUILDING_BONUS_PER_FLOOR * this.buildingCap;
      SoundEffects.playRoof();
      this.particles.burst(seam.x, seam.y, 4);
      this.hud.flash(`EDIFICIO ${this.buildingIndex + 1} LISTO  +${pop}`, "cyan");
      this.buildingIndex++;
      this.floorInBuilding = 0;
      this.buildingCap = this.computeCap();
    } else if (res.perfect) {
      SoundEffects.playPerfect(this.perfectCombo);
      this.particles.burst(seam.x, seam.y, comboActive ? this.perfectCombo : 1);
      this.hud.flash(comboActive ? `PERFECTO x${this.perfectCombo}` : "PERFECTO", "gold");
    } else {
      SoundEffects.playLand(this.tower.count);
    }

    this.population += pop;
    this.hud.setScore(this.population);
    this.hud.setBalance(this.tower.balanceRatio());
    this.hud.setCombo(comboActive);
    this.hud.setBuilding(this.buildingIndex + 1, this.floorInBuilding, this.buildingCap);

    if (this.tower.isToppled()) {
      this.crumble();
      this.die(true);
      return;
    }
    this.spawnBlock();
  }

  /**
   * Topple: instead of rigidly rotating the tower around the base (which swept
   * the floors through the gray base slab), detach every floor and let it fall
   * as independent debris flung toward the topple side — the building crumbles
   * off to the side. Higher floors fly further and pop up more (whip), and the
   * upward pop keeps even the bottom floor clear of the base slab.
   */
  private crumble(): void {
    const dir = Math.sign(this.tower.comOffset()) || 1;
    for (const f of this.tower.detachFloors()) {
      this.scene.add(f.mesh);
      f.mesh.position.set(f.x, f.y, 0);
      this.debris.push({
        mesh: f.mesh,
        vx: dir * (CRUMBLE_KICK + f.y * 0.5) + (Math.random() - 0.5) * 0.6,
        vy: -(CRUMBLE_HOP + f.y * 0.25),
        spin: -dir * (2 + Math.random() * 3),
      });
    }
  }

  /** A dropped block missed its support entirely: the run ends. */
  private onMiss(): void {
    this.perfectCombo = 0;
    this.hud.setCombo(false);
    SoundEffects.playLifeLost();
    this.hud.flash("¡FALLASTE!", "red");

    // Bounce the missed block off the edge instead of letting it sink straight
    // through the wide base slab: pop it UP and fling it outward (toward the side
    // it missed on) so it rises clear of the slab top and arcs down beside it.
    if (this.block) {
      const dir = Math.sign(this.block.mesh.position.x - this.tower.topWorldX()) || 1;
      const vx = dir * Math.max(MISS_KICK, Math.abs(this.blockVx));
      this.debris.push({
        mesh: this.block.mesh,
        vx,
        vy: -MISS_HOP, // negative vy = upward (debris integrates position.y -= vy*dt)
        spin: -dir * (4 + Math.random() * 3),
      });
      this.block = null;
    }
    this.blockFalling = false;
    this.die(false);
  }

  private clearDebris(): void {
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris.length = 0;
  }

  private updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.vy += DROP_GRAVITY * dt;
      d.mesh.position.y -= d.vy * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.rotation.z += d.spin * dt;
      if (d.mesh.position.y < this.camY - 24) {
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt);
    this.composer.render();
  };

  private update(dt: number): void {
    // Instability ramp: 0 through the base building, growing per floor after it,
    // so from the 2nd building on a badly-built tower sways more and more.
    const instability = Math.min(
      SWAY_INSTABILITY_MAX,
      Math.max(0, this.tower.count - BUILDING_CAP_BASE) * SWAY_RAMP_PER_FLOOR,
    );
    this.tower.update(dt, instability);
    this.particles.update(dt);
    this.updateDebris(dt);
    this.environment.update(dt, this.tower.landingTopY());

    const comboSpeedup = this.perfectCombo >= COMBO_THRESHOLD ? COMBO_SPEEDUP : 0;

    if (this.state === "playing") {
      this.crane.update(dt, this.tower.count, this.tower.landingCenterY(), comboSpeedup);
      if (this.block && this.blockFalling) {
        this.blockVy += DROP_GRAVITY * dt;
        this.block.mesh.position.y -= this.blockVy * dt;
        this.block.mesh.position.x += this.blockVx * dt;
        if (this.block.mesh.position.y <= this.tower.landingCenterY()) {
          this.block.mesh.position.y = this.tower.landingCenterY();
          this.resolveDrop();
        }
      } else if (this.block) {
        this.block.mesh.position.set(this.crane.blockX, this.crane.blockY, 0);
      }
      this.updateCamera(dt);
    } else if (this.state === "ready" || this.state === "countdown") {
      // Idle: keep the hook sweeping so the scene reads as alive.
      this.crane.update(dt, 0, this.tower.landingCenterY());
      if (this.block) this.block.mesh.position.set(this.crane.blockX, this.crane.blockY, 0);
      if (this.state === "countdown") this.updateCountdown(dt);
      this.updateCamera(dt);
    } else if (this.state === "dead") {
      this.deadFor += dt;
      this.crane.update(dt, this.tower.count, this.tower.landingCenterY());
    }
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

  /** Lerps the camera to frame the current tower top + crane (module 3). */
  private updateCamera(dt: number): void {
    const target = this.tower.landingTopY() + CAM_FOCUS_UP;
    this.camY += (target - this.camY) * Math.min(1, CAM_LERP * dt);
    this.camera.position.set(CAM_X, this.camY + CAM_Y_OFF, CAM_Z);
    this.camera.lookAt(0, this.camY, 0);
    // Keep the sun (and its shadow frustum) over the build area.
    this.sun.position.set(6, this.camY + 12, 7);
    this.sun.target.position.set(0, this.camY, 0);
  }

  private readonly onResize = (): void => {
    const { innerWidth, innerHeight } = window;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloomPass.setSize(innerWidth, innerHeight);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(null);
    this.input.dispose();
  }
}
