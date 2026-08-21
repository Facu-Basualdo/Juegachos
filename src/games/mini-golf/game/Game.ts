import * as THREE from "three";
import { OutlineEffect } from "three/examples/jsm/effects/OutlineEffect.js";

import { AimController } from "./AimController";
import { Ball } from "./Ball";
import { Course } from "./Course";
import { Hud, type HoleResult } from "./Hud";
import { loadModels, type ModelSet } from "./Models";
import { stepBall, type StepResult } from "./Physics";
import { SoundEffects } from "./SoundEffects";
import { makeToonGradient, toonify } from "./toon";
import { HOLE_DEFS } from "./holes";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { clearRoomRun, loadRoomRun, saveRoomRun } from "../../../shared/room/roomRun";
import {
  BALL_R,
  BEST_SCORE_KEY,
  CLOUD_COLOR,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  FALL_Y,
  FOG_COLOR,
  FOLIAGE_DARK_COLOR,
  FOLIAGE_MID_COLOR,
  HOLES_PER_ROUND,
  HOLE_CAPTURE_SPEED,
  HOLE_PULL,
  HOLE_R,
  MAX_SHOT_SPEED,
  MAX_STROKES,
  OUTLINE_COLOR,
  PHYS_STEP,
  SINK_TIME,
  SKY_HORIZON_COLOR,
  SKY_TOP_COLOR,
  STOP_DELAY,
  STOP_SPEED,
  SUN_GLOW_COLOR,
  TRUNK_COLOR,
} from "./constants";

type GameState = "loading" | "ready" | "countdown" | "playing" | "sinking" | "transition" | "gameover";

/**
 * Vuelta en curso persistida en sala, para sobrevivir un F5 (ver roomRun.ts).
 * No se guarda la posicion de la pelota: al retomar se la pone en el tee del hoyo
 * en curso, pero **conservando los golpes ya dados en ese hoyo** — si no,
 * recargar seria un mulligan gratis, y el ranking es `direction: "lower"`.
 * `holeIndex` y `totalStrokes` no se guardan: se derivan de `completed`.
 */
interface SavedRun {
  completed: HoleResult[];
  strokes: number;
}

const TRANSITION_TIME = 1.6;
const BOUNCE_SOUND_MIN = 1.1;

export class Game {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  /** Draws the scene with inverted-hull ink outlines (the cartoon look). */
  private readonly outline: OutlineEffect;
  private readonly gradientMap: THREE.Texture;

  private readonly hud: Hud;
  private readonly sounds = new SoundEffects();
  private readonly aim: AimController;
  private readonly room: RoomMode | null;

  private models: ModelSet = {};
  private course!: Course;
  private ball!: Ball;
  private readonly blob: THREE.Mesh;
  private readonly clouds: { mesh: THREE.Group; angle: number; radius: number; y: number; speed: number }[] = [];
  private readonly raycaster = new THREE.Raycaster();

  private state: GameState = "loading";
  private pendingStart = false;
  /** Dev map editor (?edit=N): overrides the hole def and gates aiming/capture. */
  private defOverride: import("./holes").HoleDef | null = null;
  private editMode = false;
  private holeIndex = 0;
  private strokes = 0;
  private completed: HoleResult[] = [];
  private totalStrokes = 0;
  private best = 0;

  private readonly shotOrigin = new THREE.Vector3();
  private stopTimer = 0;
  private sinkTime = 0;
  private readonly sinkFrom = new THREE.Vector3();
  private transitionTimer = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private soundCooldown = 0;
  private physAcc = 0;
  private readonly stepResult: StepResult = {
    grounded: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    groundFriction: 0,
    contacts: [],
  };
  private lastTime = performance.now();

  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_HORIZON_COLOR);
    // Warm golden haze: melts the distant foliage into light (see DESIGN.md).
    this.scene.fog = new THREE.Fog(FOG_COLOR, 22, 52);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping; // flat, vivid cartoon colours
    this.container.appendChild(this.renderer.domElement);

    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.0035,
      defaultColor: OUTLINE_COLOR,
    });
    this.gradientMap = makeToonGradient(3);

    // Golden hour: one low amber sun + a honeyed hemisphere.
    const key = new THREE.DirectionalLight(0xffd9a0, 2.1);
    key.position.set(9, 7, 5);
    const ambient = new THREE.HemisphereLight(0xffe7b8, 0x2e5222, 0.9);
    this.scene.add(key, ambient);
    this.buildSky(key.position);
    this.buildFoliage();
    this.buildClouds();

    // Cartoon blob shadow under the ball (reads flight height better than real shadows).
    const blobMat = new THREE.MeshBasicMaterial({
      color: 0x123312,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    blobMat.userData.outlineParameters = { visible: false };
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.scene.add(this.blob);

    this.hud = new Hud(this.container, () => this.handleActivate());
    this.hud.showLoading();
    this.best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
    this.hud.setBest(this.best);

    this.aim = new AimController(this.camera, this.renderer.domElement, {
      canAim: () => this.canAim(),
      ballPos: () => this.ball?.pos ?? ZERO,
      onShoot: (v) => this.shoot(v),
    });
    this.scene.add(this.aim.object);

    this.room = initRoomMode("mini-golf", {
      getScore: () => this.liveScore(),
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
    (window as any).__mg = this;
    void this.init();
  }

  private async init(): Promise<void> {
    this.models = await loadModels();
    for (const template of [this.models.flag, this.models.lantern, this.models.barrel, this.models.windmill]) {
      if (template) toonify(template, this.gradientMap);
    }
    this.ball = new Ball(this.gradientMap, this.models.ball);
    this.scene.add(this.ball.group);
    this.loadHole(0);
    this.state = "ready";
    this.hud.showStart();
    if (this.pendingStart) {
      this.pendingStart = false;
      this.beginCountdown();
    }
    // Dev-only map editor: /games/mini-golf/?edit=1 (2, 3) in `npm run dev`.
    if (import.meta.env.DEV) {
      const editParam = new URL(location.href).searchParams.get("edit");
      if (editParam) {
        const idx = Math.min(Math.max(parseInt(editParam) || 1, 1), HOLES_PER_ROUND) - 1;
        this.loadHole(idx);
        this.state = "playing";
        this.hud.hide();
        void import("./editor").then(({ initEditor }) => initEditor(this.buildEditorApi()));
      }
    }
  }

  private buildEditorApi(): import("./editor").EditorApi {
    return {
      scene: this.scene,
      camera: this.camera,
      dom: this.renderer.domElement,
      container: this.container,
      currentDef: () => this.defOverride ?? HOLE_DEFS[this.holeIndex],
      holeIndex: () => this.holeIndex,
      applyDef: (def) => {
        this.defOverride = def;
        this.rebuildCourse();
      },
      setEditMode: (on) => {
        this.editMode = on;
        if (on) this.aim.cancel();
      },
      resetBall: () => {
        const def = this.defOverride ?? HOLE_DEFS[this.holeIndex];
        this.ball.place(def.tee.x, BALL_R, def.tee.z);
        this.ball.group.visible = true;
        this.ball.group.scale.setScalar(1);
        this.shotOrigin.copy(this.ball.pos);
        this.stopTimer = STOP_DELAY;
        this.state = "playing";
        this.hud.hide();
      },
    };
  }

  /** Rebuilds the course from the (possibly overridden) def without touching
   *  ball or camera — the editor calls this on every change. */
  private rebuildCourse(): void {
    const def = this.defOverride ?? HOLE_DEFS[this.holeIndex];
    this.course?.dispose();
    this.course = new Course(def, this.gradientMap, this.models);
    this.scene.add(this.course.group);
    this.hud.setHole(this.holeIndex, def.name, def.par);
  }

  /** Painted sky dome: cream-gold horizon into deep dusk blue, plus a sun glow. */
  private buildSky(sunPos: THREE.Vector3): void {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP_COLOR) },
        horizon: { value: new THREE.Color(SKY_HORIZON_COLOR) },
        sunGlow: { value: new THREE.Color(SUN_GLOW_COLOR) },
        sunDir: { value: sunPos.clone().normalize() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 sunGlow;
        uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          // Below the horizon the haze holds until the canopy disc edge
          // (~d.y -0.3), then the world falls into garden shade.
          vec3 deep = vec3(0.16, 0.2, 0.09);
          vec3 c = mix(deep, horizon, smoothstep(-0.75, -0.28, d.y));
          c = mix(c, top, smoothstep(0.03, 0.55, d.y));
          float sun = pow(max(dot(d, sunDir), 0.0), 5.0);
          gl_FragColor = vec4(c + sunGlow * sun * 0.4, 1.0);
        }
      `,
    });
    mat.userData.outlineParameters = { visible: false };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(56, 24, 16), mat);
    this.scene.add(dome);
  }

  /** Ring of toon foliage around the dioramas so the orbit camera never
   *  lands on empty sky — the garden the key art sits in. */
  private buildFoliage(): void {
    // Distant vegetation gets no ink outline: it is fogged atmosphere, and
    // OutlineEffect would double its (large) fill cost for nothing.
    const noOutline = <T extends THREE.Material>(m: T): T => {
      m.userData.outlineParameters = { visible: false };
      return m;
    };
    const dark = noOutline(new THREE.MeshToonMaterial({ color: FOLIAGE_DARK_COLOR, gradientMap: this.gradientMap }));
    const mid = noOutline(new THREE.MeshToonMaterial({ color: FOLIAGE_MID_COLOR, gradientMap: this.gradientMap }));
    const trunk = noOutline(new THREE.MeshToonMaterial({ color: TRUNK_COLOR, gradientMap: this.gradientMap }));
    const puffGeo = new THREE.SphereGeometry(1, 10, 7);
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.45, 4, 7);
    // Forest canopy far below the floating islands, so falling reads as
    // dropping into the garden: one flat disc + a few silhouette mounds
    // (kept cheap — this covers a lot of screen).
    const canopyFloor = new THREE.Mesh(
      new THREE.CircleGeometry(42, 28),
      noOutline(new THREE.MeshBasicMaterial({ color: 0x24421c })),
    );
    canopyFloor.rotation.x = -Math.PI / 2;
    canopyFloor.position.y = -10.5;
    this.scene.add(canopyFloor);
    const canopy: [number, number, number, number][] = [
      [5, -10, 7, 6],
      [-9, -10.5, 13, 7],
      [11, -10.5, 18, 8],
      [-4, -10, -3, 6],
      [-13, -10.5, 2, 7],
      [3, -11, 22, 8],
    ];
    for (const [x, y, z, s] of canopy) {
      const puff = new THREE.Mesh(puffGeo, (x + z) % 2 === 0 ? dark : mid);
      puff.position.set(x, y, z);
      puff.scale.set(s, s * 0.5, s);
      this.scene.add(puff);
    }
    // angle (rad), radius, base y, scale, tree?
    const spots: [number, number, number, number, boolean][] = [
      [0.15, 27, -2.5, 3.2, true],
      [0.75, 31, -3, 4.1, false],
      [1.3, 25, -2, 2.6, true],
      [1.9, 29, -3.5, 4.6, false],
      [2.5, 26, -2.2, 3.0, true],
      [3.05, 32, -3, 4.4, false],
      [3.6, 27, -2.4, 3.4, true],
      [4.2, 30, -3.2, 4.0, false],
      [4.75, 25, -2, 2.8, true],
      [5.3, 31, -3, 4.5, false],
      [5.9, 28, -2.6, 3.6, true],
      [0.45, 36, -4, 5.5, false],
      [2.2, 37, -4, 5.8, false],
      [4.0, 36, -4, 5.2, false],
      [5.6, 37, -4, 5.6, false],
    ];
    for (const [angle, radius, baseY, scale, isTree] of spots) {
      const clump = new THREE.Group();
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (isTree) {
        // Green pillow under the trunk so the tree stands on something
        // instead of floating in the air.
        const mound = new THREE.Mesh(puffGeo, dark);
        mound.position.y = -0.7;
        mound.scale.set(2.4, 1.1, 2.4);
        clump.add(mound);
        const t = new THREE.Mesh(trunkGeo, trunk);
        t.position.y = 1.2;
        clump.add(t);
        const canopy = new THREE.Mesh(puffGeo, mid);
        canopy.position.y = 3.6;
        canopy.scale.set(2.1, 1.6, 2.1);
        clump.add(canopy);
      } else {
        for (const [ox, oy, s, m] of [
          [0, 0.4, 1.25, dark],
          [-1.1, 0, 1.0, mid],
          [1.05, -0.1, 0.9, dark],
        ] as [number, number, number, THREE.Material][]) {
          const puff = new THREE.Mesh(puffGeo, m);
          puff.position.set(ox, oy, 0);
          puff.scale.setScalar(s);
          puff.scale.y *= 0.78;
          clump.add(puff);
        }
      }
      clump.position.set(x, baseY, z);
      clump.scale.setScalar(scale * 0.55);
      clump.rotation.y = angle * 2.3;
      this.scene.add(clump);
    }
  }

  private buildClouds(): void {
    // Unlit and unfogged: paper clouds stay luminous cream at the horizon.
    // They live far out (radius > every course + camera extent) and orbit
    // slowly, so they give ambience without ever crossing the player's view.
    const mat = new THREE.MeshBasicMaterial({ color: CLOUD_COLOR, fog: false });
    mat.userData.outlineParameters = { color: [0.72, 0.62, 0.42] };
    // angle (rad), radius, y, scale, orbit speed (rad/s)
    const spots: [number, number, number, number, number][] = [
      [0.4, 40, 9, 3.2, 0.01],
      [1.3, 44, 12, 3.8, -0.008],
      [2.2, 38, 8, 2.8, 0.012],
      [3.1, 46, 13, 4.2, 0.007],
      [4.0, 40, 10, 3.0, -0.01],
      [4.9, 44, 9, 3.4, 0.009],
      [5.7, 38, 12, 2.6, 0.011],
    ];
    for (const [angle, radius, y, scale, speed] of spots) {
      const cloud = new THREE.Group();
      const sizes: [number, number, number][] = [
        [0, 0, 1.4],
        [-1.3, -0.25, 1.0],
        [1.25, -0.2, 0.9],
      ];
      for (const [ox, oy, s] of sizes) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), mat);
        puff.position.set(ox, oy, 0);
        puff.scale.y = 0.62;
        cloud.add(puff);
      }
      cloud.scale.setScalar(scale);
      cloud.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      this.scene.add(cloud);
      this.clouds.push({ mesh: cloud, angle, radius, y, speed });
    }
  }

  private loadHole(index: number): void {
    this.course?.dispose();
    this.holeIndex = index;
    const def = this.defOverride ?? HOLE_DEFS[index];
    this.course = new Course(def, this.gradientMap, this.models);
    this.scene.add(this.course.group);

    this.ball.group.visible = true;
    this.ball.group.scale.setScalar(1);
    this.ball.place(def.tee.x, BALL_R, def.tee.z);
    this.shotOrigin.copy(this.ball.pos);
    this.strokes = 0;
    this.stopTimer = STOP_DELAY;
    this.aim.reset(def.camYaw);
    this.hud.setHole(index, def.name, def.par);
    this.hud.setStrokes(0, this.totalStrokes);
  }

  private handleActivate(): void {
    if (this.state === "ready") {
      this.beginCountdown();
    } else if (this.state === "gameover") {
      if (this.room) return; // one round per room match
      this.resetRound();
      this.beginCountdown();
    }
  }

  private resetRound(): void {
    this.completed = [];
    this.totalStrokes = 0;
    this.loadHole(0);
  }

  private beginCountdown(): void {
    if (this.state === "loading") {
      this.pendingStart = true;
      return;
    }
    // En sala, un F5 vuelve a pasar por aca (la ronda sigue en "playing" y
    // RoomMode redispara onStart): si hay vuelta guardada se retoma.
    if (this.room && this.resumeSavedRun()) return;

    if (this.state !== "ready" && this.state !== "gameover") return;
    if (this.state === "gameover") this.resetRound();
    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.hud.hide();
  }

  /**
   * Retoma la vuelta guardada tras un reload, sin countdown: los hoyos ya cerrados
   * no se rejuegan y los golpes del hoyo en curso se mantienen (la pelota vuelve
   * al tee, como tras una caida al vacio, pero el golpe ya esta cobrado).
   */
  private resumeSavedRun(): boolean {
    const s = loadRoomRun<SavedRun>(this.room!, "mini-golf");
    if (!s || !Array.isArray(s.completed) || !Number.isFinite(s.strokes)) return false;
    if (s.completed.length > HOLES_PER_ROUND || s.strokes < 0) return false;
    if (s.completed.some((r) => !r || !Number.isFinite(r.strokes))) return false;
    // Nada que retomar: que arranque normal, con countdown.
    if (s.completed.length === 0 && s.strokes === 0) return false;

    this.completed = s.completed.map((r) => ({ ...r }));
    this.totalStrokes = this.completed.reduce((acc, r) => acc + r.strokes, 0);

    // Los 3 hoyos ya estaban: la vuelta termino durante el reload.
    if (this.completed.length >= HOLES_PER_ROUND) {
      this.finishRound();
      return true;
    }

    this.loadHole(this.completed.length); // pone strokes en 0: se pisa abajo
    this.strokes = s.strokes;
    this.hud.setStrokes(this.strokes, this.totalStrokes);
    this.hud.hide();
    this.state = "playing";
    return true;
  }

  /**
   * Snapshot de la vuelta. No hace nada fuera de sala. `strokes` se pasa explicito
   * al cerrar un hoyo (0: los golpes ya viajaron dentro de `completed`), sin tocar
   * el campo, que todavia se compara contra MAX_STROKES en el mismo frame.
   */
  private saveRun(strokes = this.strokes): void {
    if (!this.room) return;
    const data: SavedRun = { completed: this.completed, strokes };
    saveRoomRun(this.room, "mini-golf", data);
  }

  private canAim(): boolean {
    return this.state === "playing" && !this.editMode && this.stopTimer >= STOP_DELAY && this.strokes < MAX_STROKES;
  }

  private shoot(velocity: THREE.Vector3): void {
    this.strokes++;
    this.shotOrigin.copy(this.ball.pos);
    this.ball.vel.copy(velocity);
    this.stopTimer = 0;
    this.hud.setStrokes(this.strokes, this.totalStrokes);
    this.sounds.playHit(velocity.length() / MAX_SHOT_SPEED);
    this.saveRun();
  }

  /** Live score for the room-mode timeout partial: unfinished holes count as the cap. */
  private liveScore(): number {
    const done = this.completed.reduce((acc, r) => acc + r.strokes, 0);
    return done + (HOLES_PER_ROUND - this.completed.length) * MAX_STROKES;
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.soundCooldown = Math.max(0, this.soundCooldown - dt);
    for (const c of this.clouds) {
      c.angle += c.speed * dt;
      c.mesh.position.set(Math.cos(c.angle) * c.radius, c.y, Math.sin(c.angle) * c.radius);
    }

    switch (this.state) {
      case "countdown":
        this.updateCountdown(dt);
        break;
      case "playing":
        this.updatePlaying(dt);
        break;
      case "sinking":
        this.updateSinking(dt);
        break;
      case "transition":
        this.transitionTimer += dt;
        if (this.transitionTimer >= TRANSITION_TIME) this.advanceHole();
        break;
      default:
        break;
    }

    if (this.ball) {
      this.updateBlobShadow();
      this.aim.updateCamera(dt);
    }
    this.outline.render(this.scene, this.camera);
  };

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const idx = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (idx !== this.lastCountdownIndex && idx < COUNTDOWN_LABELS.length) {
      this.hud.showCountdown(COUNTDOWN_LABELS[idx]);
      this.sounds.playCountdownTick();
      this.lastCountdownIndex = idx;
    }
    if (this.countdownTime >= COUNTDOWN_STEP * COUNTDOWN_LABELS.length) {
      this.hud.showCountdown(null);
      this.state = "playing";
    }
  }

  private updatePlaying(dt: number): void {
    this.course.update(dt);

    this.physAcc = Math.min(this.physAcc + dt, PHYS_STEP * 16);
    let bounce = 0;
    let bumper = false;
    while (this.physAcc >= PHYS_STEP) {
      this.physAcc -= PHYS_STEP;
      stepBall(this.ball.pos, this.ball.vel, this.course.colliders, PHYS_STEP, this.stepResult);
      for (const c of this.stepResult.contacts) {
        if (c.impact < BOUNCE_SOUND_MIN || c.normalY > 0.55) continue;
        c.collider.onHit?.(c.impact);
        if (c.collider.bumper) bumper = true;
        else bounce = Math.max(bounce, c.impact);
      }
    }
    this.ball.sync(dt);

    if (this.soundCooldown <= 0 && (bumper || bounce > 0)) {
      if (bumper) this.sounds.playBumper();
      else this.sounds.playBounce(bounce / 8);
      this.soundCooldown = 0.07;
    }

    const speed = this.ball.vel.length();
    const grounded = this.stepResult.grounded;

    // Rim assist + capture.
    const hole = this.course.holeCenter;
    const dx = this.ball.pos.x - hole.x;
    const dz = this.ball.pos.z - hole.z;
    const dist = Math.hypot(dx, dz);
    const onCupPlane = this.ball.pos.y - hole.y < BALL_R + 0.08;
    if (grounded && onCupPlane && dist < HOLE_R * 1.4 && speed < 3.5 && dist > 1e-4) {
      this.ball.vel.x -= (dx / dist) * HOLE_PULL * dt;
      this.ball.vel.z -= (dz / dist) * HOLE_PULL * dt;
    }
    if (!this.editMode && onCupPlane && dist < HOLE_R * 0.8 && speed < HOLE_CAPTURE_SPEED) {
      this.startSinking();
      return;
    }

    // Fell off the course: +1 stroke, back to the shot origin.
    if (this.editMode && this.ball.pos.y < FALL_Y) {
      const def = this.defOverride ?? HOLE_DEFS[this.holeIndex];
      this.ball.place(def.tee.x, BALL_R, def.tee.z);
      return;
    }
    if (this.ball.pos.y < FALL_Y) {
      this.sounds.playFall();
      this.strokes++;
      this.hud.setStrokes(this.strokes, this.totalStrokes);
      this.hud.flashBanner("AL VACIO · +1 GOLPE");
      this.ball.place(this.shotOrigin.x, this.shotOrigin.y, this.shotOrigin.z);
      this.stopTimer = 0;
      this.saveRun(); // el golpe de penalizacion tambien tiene que sobrevivir un F5
      if (this.strokes >= MAX_STROKES) {
        this.holeComplete(false);
        return;
      }
    }

    // Stopped-ball bookkeeping (gates the next shot).
    if (grounded && speed < STOP_SPEED) {
      this.stopTimer += dt;
      if (this.stopTimer >= STOP_DELAY && this.strokes >= MAX_STROKES) this.holeComplete(false);
    } else {
      this.stopTimer = 0;
    }
  }

  private startSinking(): void {
    this.state = "sinking";
    this.sinkTime = 0;
    this.sinkFrom.copy(this.ball.pos);
    this.aim.cancel();
    this.sounds.playHole();
  }

  private updateSinking(dt: number): void {
    this.sinkTime += dt;
    const t = Math.min(this.sinkTime / SINK_TIME, 1);
    const hole = this.course.holeCenter;
    this.ball.pos.set(
      THREE.MathUtils.lerp(this.sinkFrom.x, hole.x, t),
      THREE.MathUtils.lerp(this.sinkFrom.y, hole.y - 0.3, t * t),
      THREE.MathUtils.lerp(this.sinkFrom.z, hole.z, t),
    );
    this.ball.vel.set(0, 0, 0);
    this.ball.group.position.copy(this.ball.pos);
    this.ball.group.scale.setScalar(1 - t * 0.6);
    if (t >= 1) {
      this.ball.group.visible = false;
      this.holeComplete(true);
    }
  }

  private holeComplete(holed: boolean): void {
    const def = HOLE_DEFS[this.holeIndex];
    this.completed.push({ name: def.name, par: def.par, strokes: this.strokes });
    this.totalStrokes += this.strokes;
    this.hud.setStrokes(this.strokes, this.totalStrokes);
    this.hud.flashBanner(holed ? holeBanner(this.strokes, def.par) : "LIMITE DE GOLPES");
    this.state = "transition";
    this.transitionTimer = 0;
    // El hoyo quedo cerrado y `completed` crecio: el snapshot ya apunta al hoyo
    // siguiente, con 0 golpes. Un reload durante el cartel no lo rejuega.
    this.saveRun(0);
  }

  private advanceHole(): void {
    if (this.holeIndex + 1 < HOLES_PER_ROUND) {
      this.loadHole(this.holeIndex + 1);
      this.state = "playing";
    } else {
      this.finishRound();
    }
  }

  private finishRound(): void {
    this.state = "gameover";
    const total = this.totalStrokes;
    const isRecord = this.best === 0 || total < this.best;
    if (isRecord) {
      this.best = total;
      localStorage.setItem(BEST_SCORE_KEY, String(total));
      this.hud.setBest(total);
    }
    this.sounds.playFinish();
    this.hud.showGameOver(this.completed, total, this.best, isRecord);
    if (this.room) {
      // La vuelta de la ronda termino: un reload ya no debe retomarla.
      clearRoomRun(this.room, "mini-golf");
      this.room.reportScore(total);
    } else {
      this.hud.showRanking("mini-golf", total);
    }
  }

  private updateBlobShadow(): void {
    if (!this.ball.group.visible) {
      this.blob.visible = false;
      return;
    }
    _down.set(this.ball.pos.x, this.ball.pos.y + 0.05, this.ball.pos.z);
    this.raycaster.set(_down, DOWN);
    this.raycaster.far = 30;
    const hits = this.raycaster.intersectObjects(this.course.floorMeshes, false);
    if (hits.length === 0) {
      this.blob.visible = false;
      return;
    }
    const hit = hits[0];
    const height = Math.max(this.ball.pos.y - hit.point.y, 0);
    this.blob.visible = true;
    this.blob.position.set(this.ball.pos.x, hit.point.y + 0.008, this.ball.pos.z);
    const s = THREE.MathUtils.clamp(1.15 - height * 0.1, 0.45, 1.15);
    this.blob.scale.setScalar(s);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.24 * THREE.MathUtils.clamp(1 - height * 0.09, 0.3, 1);
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };
}

function holeBanner(strokes: number, par: number): string {
  if (strokes === 1) return "HOYO EN UNO";
  const diff = strokes - par;
  if (diff <= -2) return "EAGLE";
  if (diff === -1) return "BIRDIE";
  if (diff === 0) return "PAR";
  if (diff === 1) return "BOGEY";
  return `+${diff}`;
}

const ZERO = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const _down = new THREE.Vector3();
