import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { Mailbox } from "./Mailbox";
import {
  PIZZA_ACTIVE_MAX,
  PIZZA_FLIGHT_TIME,
  PIZZA_ARC_HEIGHT,
  COLOR_CHEESE,
  COLOR_CRUST,
  COLOR_PEPPERONI,
} from "./constants";

interface Flight {
  mesh: THREE.Group;
  active: boolean;
  t: number;
  from: THREE.Vector3;
  target: Mailbox | null;
  fallback: THREE.Vector3;
  spin: number;
}

/**
 * Pool of thrown pizzas. Each lobs on a parabolic arc from the scooter toward its
 * assigned pending customer (homing on the moving mailbox); it delivers on
 * arrival via `onDeliver`. A throw with no valid customer just arcs to the side
 * and fizzles.
 */
export class PizzaThrower {
  private readonly scene: THREE.Scene;
  private readonly onDeliver: (m: Mailbox) => void;
  private readonly flights: Flight[] = [];
  private readonly to = new THREE.Vector3();

  constructor(scene: THREE.Scene, onDeliver: (m: Mailbox) => void) {
    this.scene = scene;
    this.onDeliver = onDeliver;
  }

  reset(): void {
    for (const f of this.flights) {
      f.active = false;
      f.mesh.visible = false;
    }
  }

  throw(origin: THREE.Vector3, target: Mailbox | null): void {
    const f = this.flights.find((x) => !x.active) ?? this.create();
    f.active = true;
    f.t = 0;
    f.from.copy(origin);
    f.target = target;
    f.spin = (Math.random() * 2 - 1) * 14 + 20;
    // Fallback landing (wasted throw): a bit forward and to the nearer verge.
    const side = target ? target.side : origin.x >= 0 ? 1 : -1;
    f.fallback.set(side * 4.6, 0.1, origin.z - 6);
    f.mesh.position.copy(origin);
    f.mesh.visible = true;
  }

  update(dt: number): void {
    for (const f of this.flights) {
      if (!f.active) continue;
      f.t += dt / PIZZA_FLIGHT_TIME;
      const homing = f.target && f.target.pending;
      if (homing) this.to.copy(f.target!.target());
      else this.to.copy(f.fallback);

      const t = Math.min(1, f.t);
      f.mesh.position.lerpVectors(f.from, this.to, t);
      f.mesh.position.y += Math.sin(Math.PI * t) * PIZZA_ARC_HEIGHT;
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.rotation.x += f.spin * 0.6 * dt;

      if (f.t >= 1) {
        if (homing) this.onDeliver(f.target!);
        f.active = false;
        f.mesh.visible = false;
      }
    }
  }

  private create(): Flight {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 18), glowMat(COLOR_CHEESE, 1)));
    const crust = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 18), toonMat(COLOR_CRUST, {}));
    crust.rotation.x = Math.PI / 2;
    mesh.add(crust);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), glowMat(COLOR_PEPPERONI, 1));
      p.position.set(Math.cos(a) * 0.13, 0.03, Math.sin(a) * 0.13);
      mesh.add(p);
    }
    mesh.visible = false;
    this.scene.add(mesh);
    const f: Flight = {
      mesh,
      active: false,
      t: 0,
      from: new THREE.Vector3(),
      target: null,
      fallback: new THREE.Vector3(),
      spin: 0,
    };
    this.flights.push(f);
    // Guard the pool size (drop the oldest inactive if we somehow overshoot).
    if (this.flights.length > PIZZA_ACTIVE_MAX + 2) this.flights.shift();
    return f;
  }
}
