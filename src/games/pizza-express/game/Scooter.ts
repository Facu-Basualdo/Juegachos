import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import {
  SCOOTER_MOVE_SPEED,
  SCOOTER_SMOOTHING,
  SCOOTER_Z,
  STEER_LIMIT,
  COLOR_TOMATO,
  COLOR_PEPPERONI,
  COLOR_CARDBOARD,
  COLOR_CREAM,
  COLOR_CRUST,
  COLOR_MOLTEN,
  COLOR_CHEESE,
} from "./constants";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The player's red delivery scooter + rider, built from primitives and cel-shaded
 * (see DESIGN.md). It faces -Z (into the screen); the chase camera sees it from
 * behind, so the delivery box on the rack reads clearly. Steers only in X.
 */
export class Scooter {
  readonly object = new THREE.Group();

  private velX = 0;
  private bob = 0;
  private readonly wheels: THREE.Mesh[] = [];
  private readonly handSpawn = new THREE.Vector3(0.34, 1.02, 0.1); // right hand, local
  private readonly handScratch = new THREE.Vector3();

  constructor() {
    this.build();
    this.object.position.set(0, 0, SCOOTER_Z);
  }

  get x(): number {
    return this.object.position.x;
  }

  reset(): void {
    this.velX = 0;
    this.bob = 0;
    this.object.position.set(0, 0, SCOOTER_Z);
    this.object.rotation.set(0, 0, 0);
  }

  /** World-space point a thrown pizza launches from (the rider's throwing hand). */
  throwOrigin(): THREE.Vector3 {
    this.object.updateMatrixWorld();
    this.handScratch.copy(this.handSpawn);
    this.object.localToWorld(this.handScratch);
    return this.handScratch;
  }

  update(dt: number, dirX: number, dz: number): void {
    const targetVX = dirX * SCOOTER_MOVE_SPEED;
    const k = Math.min(1, SCOOTER_SMOOTHING * dt);
    this.velX += (targetVX - this.velX) * k;
    this.object.position.x = clamp(this.object.position.x + this.velX * dt, -STEER_LIMIT, STEER_LIMIT);

    // Lean + yaw into the turn for a lively arcade feel.
    const t = clamp(this.velX / SCOOTER_MOVE_SPEED, -1, 1);
    this.object.rotation.z = -t * 0.42;
    this.object.rotation.y = -t * 0.22;

    // Engine idle vibration.
    this.bob += dt * 34;
    this.object.position.y = Math.sin(this.bob) * 0.015;

    // Spin the wheels with travel.
    const spin = dz * 1.4;
    for (const wheel of this.wheels) wheel.rotation.x -= spin;
  }

  private build(): void {
    const bodyMat = toonMat(COLOR_TOMATO, {});
    const deepMat = toonMat(COLOR_PEPPERONI, {});

    // --- Main body / floorboard ---
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 1.5), bodyMat);
    chassis.position.set(0, 0.5, 0.05);
    this.object.add(chassis);

    // Rounded front leg-shield.
    const shield = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.4, 6, 12), bodyMat);
    shield.rotation.x = Math.PI / 2;
    shield.position.set(0, 0.62, -0.72);
    shield.scale.set(1, 0.8, 1);
    this.object.add(shield);

    // Seat.
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.7), toonMat(COLOR_CRUST, {}));
    seat.position.set(0, 0.74, 0.28);
    this.object.add(seat);

    // Front fork + headlight.
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), toonMat(0x2a2320, {}));
    fork.position.set(0, 0.55, -0.95);
    fork.rotation.x = 0.18;
    this.object.add(fork);
    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.62, 6), toonMat(0x2a2320, {}));
    handlebar.rotation.z = Math.PI / 2;
    handlebar.position.set(0, 0.98, -1.02);
    this.object.add(handlebar);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glowMat(COLOR_MOLTEN, 1));
    lamp.position.set(0, 0.74, -1.16);
    this.object.add(lamp);
    const headlight = new THREE.PointLight(0xffe6b0, 14, 12, 2);
    headlight.position.set(0, 0.8, -1.4);
    this.object.add(headlight);

    // --- Wheels ---
    for (const wz of [-0.85, 0.72]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 16), toonMat(0x1c1712, {}));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, 0.34, wz);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 10), toonMat(COLOR_CREAM, {}));
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      this.object.add(wheel);
      this.wheels.push(wheel);
    }

    // --- Delivery box on the rear rack (cardboard with a red lid) ---
    const rack = new THREE.Group();
    rack.position.set(0, 1.02, 0.75);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), toonMat(COLOR_CARDBOARD, {}));
    rack.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.64), deepMat);
    lid.position.y = 0.28;
    rack.add(lid);
    // A little glowing pizza slice icon on the box front.
    const icon = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), glowMat(COLOR_CHEESE, 1));
    icon.position.set(0, 0.02, 0.31);
    rack.add(icon);
    this.object.add(rack);

    // --- Rider ---
    const rider = new THREE.Group();
    rider.position.set(0, 0.86, 0.18);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 6, 10), toonMat(COLOR_TOMATO, {}));
    torso.position.y = 0.34;
    torso.rotation.x = -0.28; // leaning forward over the bars
    rider.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), toonMat(0xe0a878, {}));
    head.position.set(0, 0.7, -0.06);
    rider.add(head);
    // Red delivery cap.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), deepMat);
    cap.position.set(0, 0.74, -0.06);
    rider.add(cap);
    const brim = new THREE.Mesh(new THREE.CircleGeometry(0.19, 16), deepMat);
    brim.rotation.x = -Math.PI / 2 + 0.2;
    brim.position.set(0, 0.72, -0.22);
    rider.add(brim);
    // Legs.
    for (const lx of [-0.14, 0.14]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 4, 8), toonMat(0x37506b, {}));
      leg.position.set(lx, 0.02, -0.16);
      leg.rotation.x = 0.9;
      rider.add(leg);
    }
    // Arms reaching to the handlebar.
    for (const ax of [-0.2, 0.2]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.34, 4, 8), toonMat(COLOR_TOMATO, {}));
      arm.position.set(ax, 0.4, -0.5);
      arm.rotation.x = 1.15;
      rider.add(arm);
    }
    this.object.add(rider);
  }
}
