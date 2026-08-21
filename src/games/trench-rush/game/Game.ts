import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { Trench } from "./Trench";
import { Player } from "./Player";
import { Laser } from "./Laser";
import { Enemy } from "./Enemy";
import { Beam } from "./Beam";
import { LaserWall } from "./LaserWall";
import { Boss } from "./Boss";
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
  PLAYER_FIRE_COOLDOWN,
  SHIELD_MAX,
  ENEMY_SPAWN_INTERVAL_START,
  ENEMY_SPAWN_INTERVAL_MIN,
  DIFFICULTY_RAMP_TIME,
  SPAWN_INTERVAL_DROP,
  PLAYER_RADIUS,
} from "./constants";

type GameState = "ready" | "countdown" | "playing" | "gameover";

const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
const COUNTDOWN_STEP = 0.75;

const SHAKE_DURATION = 0.4;
const SHAKE_MAGNITUDE = 0.6;

// Boss cadence: first boss after this many seconds of play, then one every interval. Regular
// hazards pause while a boss is on screen so the fight stays readable.
const FIRST_BOSS_AT = 28;
const BOSS_INTERVAL = 42;
const BOSS_SCORE = 500;

export class Game {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;

  private readonly trench: Trench;
  private readonly player: Player;
  private readonly explosion: Explosion;
  
  private lasers: Laser[] = [];
  private enemies: Enemy[] = [];
  private beams: Beam[] = [];
  private walls: LaserWall[] = [];
  private boss: Boss | null = null;
  private bossTimer = FIRST_BOSS_AT;
  private powerUps: THREE.Mesh[] = [];

  private readonly crashFlash: THREE.PointLight;
  private shakeTime = 0;
  private readonly input: InputController;
  private readonly hud: Hud;
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
  
  private speed = 0;
  private score = 0;
  private best = 0;
  private elapsed = 0;
  private difficulty = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = performance.now();

  // Firing and spawning timers
  private fireCooldown = 0;
  private spawnTimer = 0;
  private currentSpawnInterval = ENEMY_SPAWN_INTERVAL_START;
  private powerUpSpawnTimer = 8;
  private distanceTimer = 0;
  private shield = SHIELD_MAX;
  private invulnTimer = 0; // brief invulnerability window after hit

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);
    this.scene.fog = new THREE.Fog(BACKGROUND_COLOR, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
    this.camera.position.set(0, 0.6, CAMERA_Z);
    this.camera.lookAt(0, 0, -5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    
    // Add glowing bloom pass for Sci-Fi lasers and lights
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.8, // bloom strength
      0.4,
      0.45,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Lights
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(-5, 12, 10);
    const fillLight = new THREE.DirectionalLight(0xaad5ff, 0.85);
    fillLight.position.set(5, 5, -8);
    const ambient = new THREE.AmbientLight(0x0f1422, 1.2);
    this.scene.add(keyLight, fillLight, ambient);

    this.trench = new Trench();
    this.player = new Player();
    this.explosion = new Explosion(this.scene);

    this.crashFlash = new THREE.PointLight(0xff2211, 0, 50, 2);
    this.crashFlash.position.set(0, 1, CAMERA_Z - 2);
    this.scene.add(this.crashFlash);

    this.scene.add(this.trench.group, this.player.object);

    this.input = new InputController(this.renderer.domElement);
    this.hud = new Hud(this.container, () => this.handleActivate());

    this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0);
    this.hud.setBest(this.best);
    this.hud.showStart();

    // Register room mode for leaderboard updates
    this.room = initRoomMode("trench-rush", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.tick);
  }

  private handleActivate(): void {
    if (this.state === "playing" || this.state === "countdown") return;
    if (!this.menuVisible) return; // no reiniciar durante la explosion previa al overlay
    if (this.room && this.state === "gameover") return;
    this.beginCountdown();
  }

  private beginCountdown(): void {
    this.menuVisible = false;
    this.player.reset();
    this.player.object.visible = true;
    this.trench.reset();
    this.explosion.reset();
    
    // Clear lasers
    for (const l of this.lasers) l.destroy(this.scene);
    this.lasers = [];

    // Clear enemies
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];

    // Clear beams
    for (const b of this.beams) b.dispose(this.scene);
    this.beams = [];

    // Clear laser walls
    for (const w of this.walls) w.dispose(this.scene);
    this.walls = [];

    // Clear boss
    if (this.boss) {
      this.boss.dispose(this.scene);
      this.boss = null;
    }
    this.bossTimer = FIRST_BOSS_AT;
    this.hud.hideBoss();

    // Clear powerups
    for (const p of this.powerUps) {
      this.scene.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.powerUps = [];

    this.crashFlash.intensity = 0;
    this.shakeTime = 0;
    this.score = 0;
    this.shield = SHIELD_MAX;
    this.invulnTimer = 0;
    this.fireCooldown = 0;
    this.spawnTimer = 0.5; // spawn shortly after start
    this.currentSpawnInterval = ENEMY_SPAWN_INTERVAL_START;
    this.powerUpSpawnTimer = 6;
    this.speed = BASE_SPEED;
    this.elapsed = 0;
    this.difficulty = 0;

    this.hud.setScore(0);
    this.hud.setShield(SHIELD_MAX);
    this.hud.hide();

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
  }

  private triggerGameOver(): void {
    this.state = "gameover";
    this.player.object.visible = false;
    
    // Massive fireball burst
    this.explosion.burst(this.player.x, this.player.y, this.player.z);
    SoundEffects.playHit();
    SoundEffects.playExplosion();

    this.shakeTime = SHAKE_DURATION * 2;
    this.crashFlash.intensity = 25;

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, String(this.best));
    }
    this.hud.setBest(this.best);

    window.setTimeout(() => {
      if (this.state !== "gameover") return;
      this.menuVisible = true;
      this.hud.showGameOver(this.score, this.best);
      if (this.room) this.room.reportScore(this.score);
      else this.hud.showRanking("trench-rush", this.score);
    }, 550);
  }

  private takeDamage(amount: number): void {
    if (this.state !== "playing" || this.invulnTimer > 0) return;

    this.shield = Math.max(0, this.shield - amount);
    this.hud.setShield(this.shield);
    this.shakeTime = SHAKE_DURATION;
    this.crashFlash.intensity = 18;
    this.invulnTimer = 1.0; // 1 second of invulnerability

    SoundEffects.playHit();

    if (this.shield <= 0) {
      this.triggerGameOver();
    }
  }

  private spawnPowerUp(): void {
    const geom = new THREE.IcosahedronGeometry(0.35, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x39ff7a }); // bright green glow

    const mesh = new THREE.Mesh(geom, mat);
    const px = (Math.random() * 2 - 1) * 6;
    const py = -4.5 + Math.random() * 9.5;
    mesh.position.set(px, py, -160);
    
    // Add green glow light
    const light = new THREE.PointLight(0x39ff7a, 1.5, 6, 2);
    mesh.add(light);

    this.scene.add(mesh);
    this.powerUps.push(mesh);
  }

  private spawnHazard(): void {
    // Weighted pick: drone (shoot) / static beam / moving beam / laser wall (all dodged).
    const r = Math.random();
    if (r < 0.5) this.spawnDrone();
    else if (r < 0.68) this.spawnBeam();
    else if (r < 0.84) this.spawnMovingBeam();
    else this.spawnWall();
  }

  private spawnDrone(): void {
    const px = (Math.random() * 2 - 1) * 5; // offset from center
    const py = -4.0 + Math.random() * 9.0;
    const enemy = new Enemy(px, py, -165, this.difficulty);
    this.scene.add(enemy.object);
    this.enemies.push(enemy);
  }

  private spawnBeam(): void {
    // Vertical beam sits on an X line (dodge left/right); horizontal on a Y line (dodge up/down),
    // both placed within reach so the ship can always steer clear.
    const orientation = Math.random() < 0.5 ? "vertical" : "horizontal";
    const axisPos =
      orientation === "vertical"
        ? (Math.random() * 2 - 1) * 6 // x in [-6, 6]
        : -3 + Math.random() * 9; // y in [-3, 6]
    const beam = new Beam(orientation, axisPos, -165);
    this.scene.add(beam.object);
    this.beams.push(beam);
  }

  private spawnMovingBeam(): void {
    // Horizontal beam that sweeps up and down around a center Y — must be timed/dodged.
    const beam = new Beam("horizontal", 1.5, -165, 4.0);
    this.scene.add(beam.object);
    this.beams.push(beam);
  }

  private spawnWall(): void {
    // Wall of lasers with a gap the ship flies through, placed within reach.
    const gapX = (Math.random() * 2 - 1) * 4.5; // x in [-4.5, 4.5]
    const gapY = -2 + Math.random() * 7; // y in [-2, 5]
    const wall = new LaserWall(gapX, gapY, -170);
    this.scene.add(wall.object);
    this.walls.push(wall);
  }

  private spawnBoss(): void {
    this.boss = new Boss(-165, this.difficulty);
    this.scene.add(this.boss.object);
    this.hud.showBoss();
  }

  private tick = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000); // clamp dt to avoid giant frame jumps
    this.lastTime = now;

    // Decay impact flash
    if (this.crashFlash.intensity > 0) {
      this.crashFlash.intensity = Math.max(0, this.crashFlash.intensity - dt * 25);
    }

    // Camera shake calculation
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const decay = this.shakeTime / SHAKE_DURATION;
      shakeX = (Math.random() * 2 - 1) * SHAKE_MAGNITUDE * decay;
      shakeY = (Math.random() * 2 - 1) * SHAKE_MAGNITUDE * decay;
    }

    // Rigid third-person mount: the camera is welded to the ship. It translates 1:1 with the
    // ship (no smoothing/lag, so it never "chases" behind) and keeps a constant orientation —
    // the look target is a fixed offset from the camera itself, so the viewing angle never
    // changes and the ship stays locked in the same spot with the same perspective.
    const camPosX = this.player.x + shakeX;
    const camPosY = this.player.y + 0.8 + shakeY;
    this.camera.position.set(camPosX, camPosY, CAMERA_Z);
    this.camera.lookAt(camPosX, camPosY - 0.6, CAMERA_Z - 20);

    switch (this.state) {
      case "ready":
        // Idle ambient scrolling
        this.trench.scroll(BASE_SPEED * 0.15 * dt);
        break;

      case "countdown":
        this.trench.scroll(BASE_SPEED * 0.4 * dt);
        this.countdownTime += dt;
        
        const idx = Math.floor(this.countdownTime / COUNTDOWN_STEP);
        if (idx < COUNTDOWN_LABELS.length) {
          this.hud.showCountdown(COUNTDOWN_LABELS[idx]);
          if (idx !== this.lastCountdownIndex) {
            SoundEffects.playCountdownTick();
            this.lastCountdownIndex = idx;
          }
        } else {
          this.hud.showCountdown(null);
          this.state = "playing";
        }
        break;

      case "playing":
        this.elapsed += dt;
        this.invulnTimer = Math.max(0, this.invulnTimer - dt);

        // Difficulty grows with time (unbounded) and drives spawn density, extra drones,
        // drone aggression and boss stats. Speed and spawn interval ramp off it.
        this.difficulty = this.elapsed / DIFFICULTY_RAMP_TIME;
        this.speed = Math.min(MAX_SPEED, this.speed + SPEED_RAMP_PER_SEC * dt);
        this.currentSpawnInterval = Math.max(
          ENEMY_SPAWN_INTERVAL_MIN,
          ENEMY_SPAWN_INTERVAL_START - this.difficulty * SPAWN_INTERVAL_DROP
        );

        // Move the world
        this.trench.scroll(this.speed * dt);

        // Update player
        this.player.update(dt, this.input.dirX, this.input.dirY);

        // Flash ship visibility slightly when invulnerable
        if (this.invulnTimer > 0) {
          this.player.object.visible = Math.floor(this.elapsed * 18) % 2 === 0;
        } else {
          this.player.object.visible = true;
        }

        // Firing logic
        this.fireCooldown -= dt;
        if (this.input.isFiring && this.fireCooldown <= 0) {
          this.fireCooldown = PLAYER_FIRE_COOLDOWN;
          SoundEffects.playLaser();

          // Spawn lasers from both wing cannons
          const ports = this.player.getWeaponPorts();
          for (const port of ports) {
            const laser = new Laser(this.scene, port.x, port.y, port.z, false);
            this.lasers.push(laser);
          }
        }

        // Boss cadence (regular hazards pause while a boss is active).
        if (!this.boss) {
          this.bossTimer -= dt;
          if (this.bossTimer <= 0) {
            this.spawnBoss();
          }
        }

        // Spawn hazards (drones, beams, laser walls) — not while a boss is on screen.
        if (!this.boss) {
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0) {
            this.spawnTimer = this.currentSpawnInterval * (0.85 + Math.random() * 0.3);
            this.spawnHazard();
            // Pile on extra drones as difficulty climbs (capped so it stays fair).
            const extraDrones = Math.min(2, Math.floor(this.difficulty * 0.8));
            for (let i = 0; i < extraDrones; i++) this.spawnDrone();
          }
        }

        // Spawn powerups
        this.powerUpSpawnTimer -= dt;
        if (this.powerUpSpawnTimer <= 0) {
          this.powerUpSpawnTimer = 11 + Math.random() * 7;
          this.spawnPowerUp();
        }

        // Update lasers
        for (let i = this.lasers.length - 1; i >= 0; i--) {
          const l = this.lasers[i];
          l.update(dt);

          // Cull out of bounds lasers
          if (l.z < -280 || l.z > CAMERA_Z + 10) {
            l.destroy(this.scene);
            this.lasers.splice(i, 1);
          }
        }

        // Update enemies
        const playerPos = this.player.object.position;
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          const enemy = this.enemies[i];
          const newLaser = enemy.update(dt, this.speed, playerPos);
          if (newLaser) {
            this.lasers.push(newLaser);
          }

          // Cull passed enemies
          if (enemy.object.position.z > CAMERA_Z + 10) {
            enemy.dispose(this.scene);
            this.enemies.splice(i, 1);
          }
        }

        // Update beams (scroll toward the ship, cull once past the camera)
        for (let i = this.beams.length - 1; i >= 0; i--) {
          const beam = this.beams[i];
          beam.update(dt, this.speed);
          if (beam.z > CAMERA_Z + 10) {
            beam.dispose(this.scene);
            this.beams.splice(i, 1);
          }
        }

        // Update laser walls (scroll toward the ship, cull once past the camera)
        for (let i = this.walls.length - 1; i >= 0; i--) {
          const wall = this.walls[i];
          wall.update(dt, this.speed);
          if (wall.z > CAMERA_Z + 10) {
            wall.dispose(this.scene);
            this.walls.splice(i, 1);
          }
        }

        // Update boss (flies in, strafes, fires aimed volleys into the laser pool)
        if (this.boss) {
          const volley = this.boss.update(dt, this.player.object.position);
          for (const l of volley) this.lasers.push(l);
          this.hud.setBossHealth(this.boss.healthFrac);
        }

        // Update powerups
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
          const p = this.powerUps[i];
          p.rotation.y += 2 * dt;
          p.rotation.x += dt;
          p.position.z += this.speed * dt;

          // Cull passed powerups
          if (p.position.z > CAMERA_Z + 10) {
            this.scene.remove(p);
            p.geometry.dispose();
            (p.material as THREE.Material).dispose();
            this.powerUps.splice(i, 1);
          }
        }

        // --- Collision Checks ---

        // 1. Player lasers vs Enemies
        for (const l of this.lasers) {
          if (l.isEnemy) continue; // skip enemy lasers

          for (const enemy of this.enemies) {
            if (!enemy.alive) continue;

            if (l.collidesWith(enemy.object.position.x, enemy.object.position.y, enemy.object.position.z, enemy.radius)) {
              // Deal damage
              enemy.takeDamage(1);
              this.explosion.burst(l.x, l.y, l.z);
              
              // Destroy laser
              l.object.position.z = -999; // trigger cull next loop
              
              if (!enemy.alive) {
                this.explosion.burst(enemy.object.position.x, enemy.object.position.y, enemy.object.position.z);
                SoundEffects.playExplosion();
                this.score += 10;
                this.hud.setScore(this.score);
              } else {
                SoundEffects.playScore(); // small confirmation beep
              }
            }
          }
        }

        // 2. Enemy lasers vs Player
        for (const l of this.lasers) {
          if (!l.isEnemy) continue;

          if (l.collidesWith(this.player.x, this.player.y, this.player.z, PLAYER_RADIUS)) {
            l.object.position.z = 999; // trigger cull
            this.takeDamage(1);
          }
        }

        // 3. Player vs Enemies directly
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;

          // Simple spherical distance collision
          const dx = this.player.x - enemy.object.position.x;
          const dy = this.player.y - enemy.object.position.y;
          const dz = this.player.z - enemy.object.position.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          const minDist = PLAYER_RADIUS + enemy.radius;

          if (distSq < minDist * minDist) {
            enemy.takeDamage(99); // instakill enemy
            this.explosion.burst(enemy.object.position.x, enemy.object.position.y, enemy.object.position.z);
            SoundEffects.playExplosion();

            this.takeDamage(1);
          }
        }

        // Remove destroyed enemies now (they explode on death; otherwise they'd keep
        // scrolling visibly until they passed the camera).
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          if (!this.enemies[i].alive) {
            this.enemies[i].dispose(this.scene);
            this.enemies.splice(i, 1);
          }
        }

        // 3b. Beams vs Player (dodge hazard; not destroyable, invuln window prevents re-hits)
        for (const beam of this.beams) {
          if (beam.hits(this.player.x, this.player.y, this.player.z)) {
            this.takeDamage(1);
          }
        }

        // 3c. Laser walls vs Player (must fly through the gap)
        for (const wall of this.walls) {
          if (wall.hits(this.player.x, this.player.y, this.player.z)) {
            this.takeDamage(1);
          }
        }

        // 3d. Player lasers vs Boss (many hits to kill)
        if (this.boss) {
          const bx = this.boss.object.position.x;
          const by = this.boss.object.position.y;
          const bz = this.boss.object.position.z;
          for (const l of this.lasers) {
            if (l.isEnemy) continue;
            if (l.collidesWith(bx, by, bz, this.boss.radius)) {
              this.boss.takeDamage(1);
              this.explosion.burst(l.x, l.y, l.z);
              l.object.position.z = -999; // cull next loop
              if (!this.boss.alive) break;
              SoundEffects.playScore();
            }
          }

          if (this.boss && !this.boss.alive) {
            // Boss defeated: big fireball, score, and reset the boss timer.
            for (let k = 0; k < 6; k++) {
              this.explosion.burst(
                bx + (Math.random() - 0.5) * 4.5,
                by + (Math.random() - 0.5) * 3.0,
                bz + (Math.random() - 0.5) * 3.0,
              );
            }
            SoundEffects.playExplosion();
            this.shakeTime = SHAKE_DURATION * 1.5;
            this.crashFlash.intensity = 22;
            this.score += BOSS_SCORE;
            this.hud.setScore(this.score);
            this.boss.dispose(this.scene);
            this.boss = null;
            this.hud.hideBoss();
            // Next boss comes sooner as difficulty climbs (floored so it never spams).
            this.bossTimer = Math.max(22, BOSS_INTERVAL - this.difficulty * 7);
          }
        }

        // 4. Player vs Powerups (Shield Battery)
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
          const p = this.powerUps[i];
          const dx = this.player.x - p.position.x;
          const dy = this.player.y - p.position.y;
          const dz = this.player.z - p.position.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          const minDist = PLAYER_RADIUS + 0.45;

          if (distSq < minDist * minDist) {
            // Collect!
            SoundEffects.playPowerUp();
            this.scene.remove(p);
            p.geometry.dispose();
            (p.material as THREE.Material).dispose();
            this.powerUps.splice(i, 1);

            if (this.shield < SHIELD_MAX) {
              this.shield = Math.min(SHIELD_MAX, this.shield + 1);
              this.hud.setShield(this.shield);
            } else {
              // Score bonus for max shield
              this.score += 50;
              this.hud.setScore(this.score);
            }
          }
        }

        // Distance traveled increases score
        this.distanceTimer += dt;
        if (this.distanceTimer >= 0.16) {
          this.distanceTimer = 0;
          this.score += 1;
          this.hud.setScore(this.score);
        }
        break;

      case "gameover":
        // Idle slower scroll
        this.trench.scroll(BASE_SPEED * 0.1 * dt);
        break;
    }

    // Update explosions
    this.explosion.update(dt);

    // Render pass
    this.composer.render();
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(null);
    this.input.dispose();
    this.trench.dispose();
    this.player.dispose();
    this.explosion.dispose();

    for (const l of this.lasers) l.destroy(this.scene);
    for (const e of this.enemies) e.dispose(this.scene);
    for (const b of this.beams) b.dispose(this.scene);
    for (const w of this.walls) w.dispose(this.scene);
    if (this.boss) this.boss.dispose(this.scene);
    for (const p of this.powerUps) {
      this.scene.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }

    this.renderer.dispose();
    this.composer.dispose();
  }
}
