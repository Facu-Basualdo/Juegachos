import * as THREE from "three";
import { BALL_R } from "./constants";
import { toonify } from "./toon";

const _axis = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * The golf ball: physics state (position/velocity, integrated by
 * `Physics.stepBall` from Game) plus the visual mesh — the Blender GLB
 * when available (cel-shaded via `toonify`), a plain sphere otherwise.
 * The mesh rolls to match the travelled distance.
 */
export class Ball {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();

  private readonly spinner: THREE.Object3D;

  constructor(grad: THREE.Texture, model?: THREE.Object3D) {
    if (model) {
      this.spinner = model.clone(true);
      this.spinner.scale.setScalar(BALL_R); // GLB is a unit-radius sphere
      toonify(this.spinner, grad);
    } else {
      const mat = new THREE.MeshToonMaterial({ color: 0xf4f2ec, gradientMap: grad });
      this.spinner = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 18), mat);
    }
    this.group.add(this.spinner);
  }

  place(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.sync(0);
  }

  /** Copies physics state to the mesh and rolls it by the distance moved. */
  sync(dt: number): void {
    this.group.position.copy(this.pos);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.01 && dt > 0) {
      _dir.set(this.vel.x, 0, this.vel.z).normalize();
      _axis.crossVectors(_up, _dir);
      // Roll angle = arc length / radius.
      this.spinner.rotateOnWorldAxis(_axis, (speed * dt) / BALL_R);
    }
  }
}
