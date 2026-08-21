import * as THREE from "three";
import type { ModelSet } from "./Models";
import { toonify, type EmissiveMaterial } from "./toon";
import {
  CEILING_Y,
  COYOTE_TIME,
  DASH_COOLDOWN,
  DASH_IFRAME_TIME,
  DASH_SPEED,
  DASH_TIME,
  FALL_GRAVITY_MULT,
  FLOOR_Y,
  GRAVITY,
  HURTBOX_HALF_WIDTH,
  JUMP_BUFFER_TIME,
  JUMP_CUT,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  PLAYER_ACCEL,
  PLAYER_AIR_ACCEL,
  PLAYER_FRICTION,
  PLAYER_GRILLE_LIFT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_SPEED,
  WALL_X,
} from "./constants";

export interface PlayerInput {
  moveDir: number; // -1 / 0 / 1
  jumpPressed: boolean; // edge
  jumpHeld: boolean;
  dashPressed: boolean; // edge
}

export interface PlayerEvents {
  jumped: boolean;
  dashed: boolean;
}

/**
 * The dodger: simple 2D platformer physics (gravity + friction) in the XY plane
 * with the two moves the boss fight needs — a variable-height jump (with coyote
 * time + jump buffer) to reposition, and a short i-frame dash to slip through a
 * last-moment jet. Modelled from primitives as a brass boiler-suit diver. `x` is
 * the horizontal centre, `y` is the feet (bottom); the mesh group sits at the feet.
 */
export class Player {
  readonly object = new THREE.Group();
  x = 0;
  y = FLOOR_Y;
  private vx = 0;
  private vy = 0;
  private facing = 1;
  private grounded = true;
  private dashTime = 0;
  private dashDir = 1;
  private invuln = 0;
  private dashCooldown = 0;
  private canCut = false;
  private coyote = 0; // grace to still jump just after leaving the ground
  private jumpBuffer = 0; // grace to jump if pressed just before landing

  /** Emissive materials pulsed brighter during the dash i-frames (the porthole). */
  private readonly glowMats: { mat: EmissiveMaterial; base: number }[] = [];

  constructor(models?: ModelSet, gradientMap?: THREE.Texture) {
    if (models?.diver) this.buildDiver(models.diver);
    else this.buildPrimitive();
    // A soft cyan lantern so the diver is always findable in the dark (and casts
    // a little glow on the floor around it). Follows the player as a child.
    const locator = new THREE.PointLight(0x5cd0ff, 1.8, 4, 2);
    locator.position.set(0, 0.85, 0.4);
    this.object.add(locator);
    // Cel-shade the diver, then grab the emissive materials (the porthole) for
    // the i-frame flash — collected after toonify so the refs point at the toon
    // materials actually on screen.
    if (gradientMap) toonify(this.object, gradientMap);
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as EmissiveMaterial | undefined;
      if (mesh.isMesh && mat && mat.emissive && mat.emissiveIntensity > 0.01) {
        this.glowMats.push({ mat, base: mat.emissiveIntensity });
      }
    });
    this.object.position.set(this.x, this.y, 0);
  }

  /** Uses the Blender diver: scaled to PLAYER_HEIGHT with its feet at the origin. */
  private buildDiver(source: THREE.Group): void {
    const diver = source.clone(true);
    const box = new THREE.Box3().setFromObject(diver);
    const h = box.max.y - box.min.y || 1;
    const s = (PLAYER_HEIGHT * 1.06) / h;
    diver.scale.setScalar(s);
    diver.position.y = -box.min.y * s; // drop feet to y=0
    this.object.add(diver);
  }

  /** Fallback if diver.glb is missing: a blocky diver from primitives. */
  private buildPrimitive(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.9, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3b2c22, metalness: 0.8, roughness: 0.5 });
    const goggleMat = new THREE.MeshStandardMaterial({
      color: 0x2ad6ff,
      emissive: 0x2ad6ff,
      emissiveIntensity: 1.4,
      metalness: 0.3,
      roughness: 0.3,
    });

    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.3), dark);
    legL.position.set(-0.16, 0.21, 0);
    const legR = legL.clone();
    legR.position.x = 0.16;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.42), metal);
    torso.position.set(0, 0.72, 0);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), dark);
    tank.position.set(0, 0.72, -0.28);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.4), metal);
    head.position.set(0, 1.14, 0);
    const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), goggleMat);
    goggle.position.set(0, 1.16, 0.21);
    this.object.add(legL, legR, torso, tank, head, goggle);
  }

  get halfWidth(): number {
    return PLAYER_HALF_WIDTH;
  }

  /** Narrow hurtbox for steam collision (forgiving; see HURTBOX_HALF_WIDTH). */
  get hurtHalfWidth(): number {
    return HURTBOX_HALF_WIDTH;
  }

  /** Visual foot height (logical `y` + the grille-standing lift). Use this, not
   *  `y`, when positioning cosmetic effects (sparks, bursts) at the character's
   *  feet — `y` itself stays the physics/collision value. */
  get visualY(): number {
    return this.y + PLAYER_GRILLE_LIFT;
  }

  get invulnerable(): boolean {
    return this.invuln > 0;
  }

  reset(): void {
    this.x = 0;
    this.y = FLOOR_Y;
    this.vx = this.vy = 0;
    this.facing = 1;
    this.grounded = true;
    this.dashTime = this.invuln = this.dashCooldown = 0;
    this.canCut = false;
    this.coyote = this.jumpBuffer = 0;
    this.object.position.set(0, FLOOR_Y + PLAYER_GRILLE_LIFT, 0);
    this.object.rotation.z = 0;
  }

  update(dt: number, input: PlayerInput): PlayerEvents {
    const ev: PlayerEvents = { jumped: false, dashed: false };

    // --- Timers. ---
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    // Coyote (still jumpable just after a ledge) and jump buffer (press remembered
    // just before landing) — the two forgiveness windows that make the jump feel
    // responsive instead of a commitment you regret.
    this.coyote = this.grounded ? COYOTE_TIME : this.coyote - dt;
    this.jumpBuffer = input.jumpPressed ? JUMP_BUFFER_TIME : this.jumpBuffer - dt;

    // --- Dash start. ---
    if (input.dashPressed && this.dashCooldown <= 0 && this.dashTime <= 0) {
      this.dashDir = input.moveDir !== 0 ? input.moveDir : this.facing;
      this.facing = this.dashDir;
      this.dashTime = DASH_TIME;
      this.invuln = DASH_IFRAME_TIME;
      this.dashCooldown = DASH_COOLDOWN;
      ev.dashed = true;
    }

    // --- Horizontal motion. ---
    if (this.dashTime > 0) {
      this.vx = this.dashDir * DASH_SPEED;
      this.dashTime -= dt;
      // The instant the dash ends, cut the carried speed to a walk (or a stop) so
      // the dash lands at a *predictable* spot instead of sliding on at 22 u/s.
      if (this.dashTime <= 0) {
        this.vx = input.moveDir === this.dashDir ? this.dashDir * PLAYER_SPEED : 0;
      }
    } else {
      const target = input.moveDir * PLAYER_SPEED;
      if (input.moveDir !== 0) {
        const accel = (this.grounded ? PLAYER_ACCEL : PLAYER_AIR_ACCEL) * dt;
        this.vx += Math.sign(target - this.vx) * Math.min(accel, Math.abs(target - this.vx));
        this.facing = input.moveDir;
      } else if (this.grounded) {
        const drop = PLAYER_FRICTION * dt;
        this.vx -= Math.sign(this.vx) * Math.min(drop, Math.abs(this.vx));
      }
    }

    // --- Jump (buffered press, honoured within the coyote window). ---
    if (this.jumpBuffer > 0 && this.dashTime <= 0 && this.coyote > 0) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.canCut = true;
      ev.jumped = true;
    }
    // Variable height: releasing while still rising cuts the ascent.
    if (this.canCut && !input.jumpHeld && this.vy > 0) {
      this.vy *= JUMP_CUT;
      this.canCut = false;
    }

    // --- Gravity (heavier on the way down for a snappy, low-commitment arc). ---
    if (this.dashTime > 0) {
      this.vy = 0; // dash floats horizontally
    } else {
      const g = this.vy > 0 ? GRAVITY : GRAVITY * FALL_GRAVITY_MULT;
      this.vy -= g * dt;
      if (this.vy < -MAX_FALL_SPEED) this.vy = -MAX_FALL_SPEED;
    }

    // --- Integrate + collide with the room box. ---
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const minX = -WALL_X + PLAYER_HALF_WIDTH;
    const maxX = WALL_X - PLAYER_HALF_WIDTH;
    if (this.x < minX) {
      this.x = minX;
      if (this.vx < 0) this.vx = 0;
    } else if (this.x > maxX) {
      this.x = maxX;
      if (this.vx > 0) this.vx = 0;
    }

    if (this.y <= FLOOR_Y) {
      this.y = FLOOR_Y;
      this.vy = 0;
      this.grounded = true;
      this.canCut = false;
    } else {
      this.grounded = false;
    }
    const maxY = CEILING_Y - PLAYER_HEIGHT;
    if (this.y > maxY) {
      this.y = maxY;
      if (this.vy > 0) this.vy = 0;
    }

    // --- Visuals. ---
    this.object.position.set(this.x, this.visualY, 0);
    // Lean into a dash, flash the goggle during i-frames.
    const lean = this.dashTime > 0 ? 0.5 * this.dashDir : 0;
    this.object.rotation.z = -lean;
    const flash = this.invulnerable ? 1.9 : 1;
    for (const g of this.glowMats) g.mat.emissiveIntensity = g.base * flash;

    return ev;
  }
}
