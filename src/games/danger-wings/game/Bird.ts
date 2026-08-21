import * as THREE from "three";
import {
  BIRD_RADIUS,
  BIRD_MODEL_SCALE,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  BOUNCE_VY_ASSIST,
  COLOR_FEATHER,
  COLOR_BEAK,
  COLOR_EYE,
} from "./constants";

/**
 * The crow. Manual vector physics: velocity.x is constant magnitude and flips
 * on every wall bounce; velocity.y is driven by gravity and the flap impulse.
 * Built from primitives as a menacing silhouette with two burning eyes
 * (see DESIGN.md "the crow survives as a silhouette and two burning eyes").
 */
export class Bird {
  readonly object = new THREE.Group();
  readonly velocity = new THREE.Vector3();

  private readonly body = new THREE.Group(); // holds visual mesh, tilts with vy
  private readonly leftWing = new THREE.Group();
  private readonly rightWing = new THREE.Group();
  private readonly box = new THREE.Box3();

  private facing = 1; // +1 facing right, -1 facing left
  private flap = 0; // wing phase
  private flapImpulse = 0; // decays after a flap, drives a fast down-stroke
  private dead = false;

  constructor() {
    this.build();
    this.object.add(this.body);
    this.body.scale.setScalar(BIRD_MODEL_SCALE);
    this.reset();
  }

  private build(): void {
    const featherMat = new THREE.MeshStandardMaterial({
      color: COLOR_FEATHER,
      roughness: 0.85,
      metalness: 0.1,
    });

    // Torso: a squashed sphere, long along x (flight direction).
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), featherMat);
    torso.scale.set(1.15, 0.9, 0.85);
    this.body.add(torso);

    // Head, set forward and slightly up.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), featherMat);
    head.position.set(0.42, 0.16, 0);
    this.body.add(head);

    // Beak: tarnished gold cone pointing forward (+x).
    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.34, 12),
      new THREE.MeshStandardMaterial({ color: COLOR_BEAK, roughness: 0.4, metalness: 0.6 })
    );
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.74, 0.1, 0);
    this.body.add(beak);

    // Brow tuft — a few swept feathers on the crown.
    for (let i = 0; i < 3; i++) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), featherMat);
      tuft.position.set(0.3 - i * 0.08, 0.42 - i * 0.02, 0);
      tuft.rotation.z = 0.9 + i * 0.12;
      this.body.add(tuft);
    }

    // Eyes: bone-white with a black pupil and angry angled brows. Slight emissive
    // so they read even in the dark (the "two burning eyes").
    const eyeMat = new THREE.MeshStandardMaterial({
      color: COLOR_EYE,
      emissive: new THREE.Color(0xd8cfae),
      emissiveIntensity: 0.9,
      roughness: 0.5,
    });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.4 });
    const browMat = featherMat;
    for (const zside of [0.19, -0.19]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), eyeMat);
      eye.position.set(0.56, 0.22, zside);
      this.body.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), pupilMat);
      pupil.position.set(0.64, 0.2, zside);
      this.body.add(pupil);
      // Angry brow: a thin angled slab over the eye.
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.14), browMat);
      brow.position.set(0.55, 0.33, zside);
      brow.rotation.z = -0.5;
      this.body.add(brow);
    }

    // Tail: a fan of stiff feathers trailing behind (-x).
    for (let i = -1; i <= 1; i++) {
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 6), featherMat);
      tail.rotation.z = Math.PI / 2;
      tail.position.set(-0.62, 0.02 + i * 0.02, i * 0.12);
      tail.rotation.x = i * 0.25;
      this.body.add(tail);
    }

    // Wings: each is a hinged group of layered feather planes, flapping about x.
    this.buildWing(this.leftWing, 1);
    this.buildWing(this.rightWing, -1);
    this.leftWing.position.set(0.05, 0.14, 0.28);
    this.rightWing.position.set(0.05, 0.14, -0.28);
    this.body.add(this.leftWing, this.rightWing);
  }

  private buildWing(group: THREE.Group, zdir: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_FEATHER,
      roughness: 0.9,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    // Three overlapping elongated feathers make a ragged wing.
    const spans = [0.95, 1.15, 0.85];
    const widths = [0.34, 0.4, 0.28];
    for (let i = 0; i < spans.length; i++) {
      const feather = new THREE.Mesh(new THREE.ConeGeometry(widths[i], spans[i], 5), mat);
      // Point the feather outward along ±z, swept slightly back.
      feather.rotation.x = zdir > 0 ? Math.PI / 2 : -Math.PI / 2;
      feather.rotation.z = -0.15 - i * 0.05;
      feather.position.set(-0.05 - i * 0.14, 0, zdir * (0.35 + spans[i] * 0.42));
      feather.scale.set(1, 1, 0.35); // flatten into a blade
      group.add(feather);
    }
  }

  reset(): void {
    this.object.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.facing = 1;
    this.flap = 0;
    this.flapImpulse = 0;
    this.dead = false;
    this.object.visible = true;
    this.body.rotation.z = 0;
    this.updateFacing();
  }

  /** Apply the upward flap impulse. */
  jump(): void {
    if (this.dead) return;
    this.velocity.y = JUMP_VELOCITY;
    this.flapImpulse = 1;
  }

  /** Set the constant horizontal speed and facing (called on start / bounce). */
  setHorizontalSpeed(vx: number): void {
    this.velocity.x = vx;
    this.facing = vx >= 0 ? 1 : -1;
    this.updateFacing();
  }

  /** Bounce off a wall: invert vx and give a subtle vertical assist. */
  bounce(): void {
    this.velocity.x *= -1;
    this.facing = this.velocity.x >= 0 ? 1 : -1;
    // Subtle game feel: soften the current vertical momentum and nudge upward a
    // touch, so the player can recompute their line (see the design brief).
    this.velocity.y = this.velocity.y * 0.55 + BOUNCE_VY_ASSIST;
    this.flapImpulse = Math.max(this.flapImpulse, 0.6);
    this.updateFacing();
  }

  private updateFacing(): void {
    // Turn the whole crow to face its travel direction (rotate, don't mirror —
    // mirroring with a negative scale would flip the lighting normals). The body
    // pitch is applied in this rotated frame, so nose-up stays nose-up both ways.
    this.object.rotation.y = this.facing > 0 ? 0 : Math.PI;
  }

  kill(): void {
    this.dead = true;
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** Idle hover used on menus / countdown: gentle bob, no gravity. */
  idle(dt: number, t: number): void {
    this.object.position.x = 0;
    this.object.position.y = Math.sin(t * 1.6) * 0.35;
    this.flap += dt * 6;
    this.body.rotation.z = Math.sin(t * 1.6) * 0.08;
    this.animateWings(0.5);
  }

  update(dt: number): void {
    if (this.dead) {
      // Tumble and fall on death.
      this.velocity.y += GRAVITY * dt;
      this.object.position.y += this.velocity.y * dt;
      this.object.position.x += this.velocity.x * 0.4 * dt;
      this.body.rotation.z -= dt * 6;
      return;
    }

    // Gravity + flap physics.
    this.velocity.y += GRAVITY * dt;
    if (this.velocity.y < MAX_FALL_SPEED) this.velocity.y = MAX_FALL_SPEED;

    this.object.position.x += this.velocity.x * dt;
    this.object.position.y += this.velocity.y * dt;

    // Tilt the body with vertical velocity: nose up rising, down falling.
    const targetTilt = THREE.MathUtils.clamp(this.velocity.y * 0.06, -0.5, 0.6);
    this.body.rotation.z += (targetTilt - this.body.rotation.z) * Math.min(1, dt * 12);

    // Wings flap faster right after a flap impulse.
    this.flapImpulse = Math.max(0, this.flapImpulse - dt * 4);
    this.flap += dt * (7 + this.flapImpulse * 22);
    this.animateWings(this.flapImpulse);
  }

  private animateWings(impulse: number): void {
    const base = Math.sin(this.flap) * 0.55;
    const beat = base + impulse * 0.5;
    this.leftWing.rotation.x = -beat;
    this.rightWing.rotation.x = beat;
  }

  /** World-space AABB used for all collision tests. */
  getBox(): THREE.Box3 {
    const p = this.object.position;
    this.box.min.set(p.x - BIRD_RADIUS, p.y - BIRD_RADIUS, -BIRD_RADIUS);
    this.box.max.set(p.x + BIRD_RADIUS, p.y + BIRD_RADIUS, BIRD_RADIUS);
    return this.box;
  }
}
