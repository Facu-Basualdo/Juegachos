import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import {
  MAILBOX_X,
  COLOR_TOMATO,
  COLOR_CHEESE,
  COLOR_MOLTEN,
  COLOR_CREAM,
  COLOR_CRUST,
} from "./constants";

/**
 * A roadside mailbox — a delivery customer. While `pending` it floats a glowing
 * pizza order marker; a thrown pizza that reaches it delivers (flag flips up,
 * marker pops). If it passes the scooter undelivered it is `missed` (breaks the
 * combo). Built from primitives, cel-shaded.
 */
export class Mailbox {
  readonly group = new THREE.Group();
  readonly side: -1 | 1;
  pending = true;
  missed = false;
  /** A pizza is in flight toward this box, so it must not be marked missed. */
  reserved = false;

  private readonly marker: THREE.Group;
  private readonly flag: THREE.Mesh;
  private bob = 0;
  private flagAngle = -1.2; // down while pending, flips up on delivery
  private readonly targetScratch = new THREE.Vector3();

  constructor(side: -1 | 1, z: number) {
    this.side = side;
    this.group.position.set(side * MAILBOX_X, 0, z);
    // The box opening faces the road, so it visually "catches" the pizza.
    this.group.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;

    // Post.
    this.group.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 8), toonMat(COLOR_CRUST, {}), 0, 0.5, 0));
    // Box body (rounded top via a half-cylinder).
    this.group.add(mesh(new THREE.BoxGeometry(0.34, 0.34, 0.6), toonMat(COLOR_CREAM, {}), 0, 1.05, 0));
    const dome = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.6, 12, 1, false, 0, Math.PI), toonMat(COLOR_CREAM, {}), 0, 1.22, 0);
    dome.rotation.z = Math.PI / 2;
    this.group.add(dome);
    // Front number plate.
    this.group.add(mesh(new THREE.PlaneGeometry(0.24, 0.18), glowMat(COLOR_TOMATO, 1), 0, 1.05, 0.31));

    // Signal flag (red), starts down.
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18), toonMat(COLOR_TOMATO, { side: THREE.DoubleSide }));
    this.flag.position.set(0.19, 1.1, 0);
    this.flag.geometry.translate(0.12, 0, 0); // pivot at the post edge
    this.group.add(this.flag);

    this.marker = this.buildMarker();
    this.marker.position.set(0, 2.0, 0);
    this.group.add(this.marker);
    this.applyFlag();
  }

  get z(): number {
    return this.group.position.z;
  }

  /** World-space point a pizza should land on (the box), for homing + delivery. */
  target(): THREE.Vector3 {
    this.group.updateMatrixWorld();
    this.targetScratch.set(0, 1.05, 0);
    this.group.localToWorld(this.targetScratch);
    return this.targetScratch;
  }

  update(dz: number, dt: number): void {
    this.group.position.z += dz;
    if (this.pending) {
      // The arrow bounces down toward the box so it clearly points at it.
      this.bob += dt * 5;
      this.marker.position.y = 2.1 + Math.abs(Math.sin(this.bob)) * 0.28;
    } else if (this.flagAngle < 0.55) {
      // Snap the flag up on delivery.
      this.flagAngle = Math.min(0.55, this.flagAngle + dt * 6);
      this.applyFlag();
    }
  }

  deliver(): void {
    this.pending = false;
    this.marker.visible = false;
  }

  markMissed(): void {
    this.pending = false;
    this.missed = true;
    this.marker.visible = false;
  }

  private applyFlag(): void {
    this.flag.rotation.z = this.flagAngle;
  }

  private buildMarker(): THREE.Group {
    const g = new THREE.Group();
    // A bright downward arrow that points right at the mailbox — reads clearly
    // from far as "deliver here" (much clearer than the old pizza icon).
    const headMat = glowMat(COLOR_TOMATO, 1);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.44, 4), headMat);
    head.rotation.x = Math.PI; // tip points down
    head.rotation.y = Math.PI / 4; // square arrowhead facing the road
    head.position.y = -0.05;
    g.add(head);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.16), glowMat(COLOR_CHEESE, 1));
    shaft.position.y = 0.34;
    g.add(shaft);
    // Faint additive glow halo so it pops against the town.
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), glowMat(COLOR_MOLTEN, 0.4, true));
    halo.position.y = 0.05;
    g.add(halo);
    return g;
  }
}

function mesh(geom: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(x, y, z);
  return m;
}
