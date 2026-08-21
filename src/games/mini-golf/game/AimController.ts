import * as THREE from "three";
import {
  AIM_PICK_PX,
  CAM_DEFAULT_DIST,
  CAM_DEFAULT_PITCH,
  CAM_FOLLOW_LERP,
  CAM_MAX_DIST,
  CAM_MAX_PITCH,
  CAM_MIN_DIST,
  CAM_MIN_PITCH,
  MAX_PULL,
  MAX_SHOT_SPEED,
  MIN_SHOT_POWER,
} from "./constants";

export interface AimHooks {
  /** True when the ball is stopped and a shot may be aimed. */
  canAim(): boolean;
  ballPos(): THREE.Vector3;
  /** Fired on release with the shot velocity (horizontal). */
  onShoot(velocity: THREE.Vector3): void;
}

const _ndc = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _pull = new THREE.Vector3();
const _shot = new THREE.Vector3();
const _target = new THREE.Vector3();

/**
 * One pointer gesture does everything (Golf It style): a drag that starts
 * on the ball aims the shot (pull back = direction + power, with an arrow
 * preview); a drag anywhere else orbits the camera; wheel / pinch zooms.
 * Also owns the smooth follow camera.
 */
export class AimController {
  yaw = Math.PI;
  pitch = CAM_DEFAULT_PITCH;
  dist = CAM_DEFAULT_DIST;

  private mode: "none" | "aim" | "orbit" = "none";
  private power = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private readonly followPos = new THREE.Vector3();

  private readonly arrow: THREE.Group;
  private readonly shaft: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly arrowMat: THREE.MeshBasicMaterial;
  private readonly colorFrom = new THREE.Color(0xffd23c);
  private readonly colorTo = new THREE.Color(0xe8442a);

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly hooks: AimHooks;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, hooks: AimHooks) {
    this.camera = camera;
    this.dom = dom;
    this.hooks = hooks;
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.92 });
    this.arrowMat.userData.outlineParameters = { visible: false };
    this.shaft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 1), this.arrowMat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 12), this.arrowMat);
    this.head.rotation.x = Math.PI / 2;
    this.arrow = new THREE.Group();
    this.arrow.add(this.shaft, this.head);
    this.arrow.visible = false;

    dom.style.touchAction = "none";
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointercancel", this.onUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
  }

  get object(): THREE.Object3D {
    return this.arrow;
  }

  get aiming(): boolean {
    return this.mode === "aim";
  }

  /** Snap the orbit to a hole's starting framing. */
  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = CAM_DEFAULT_PITCH;
    this.dist = CAM_DEFAULT_DIST;
    this.followPos.copy(this.hooks.ballPos());
    this.cancel();
  }

  cancel(): void {
    this.mode = "none";
    this.power = 0;
    this.arrow.visible = false;
    this.pointers.clear();
  }

  /** Smooth-follow the ball and place the orbit camera. */
  updateCamera(dt: number): void {
    const ball = this.hooks.ballPos();
    const k = 1 - Math.exp(-CAM_FOLLOW_LERP * dt);
    this.followPos.lerp(ball, k);
    _target.copy(this.followPos);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      _target.x + Math.sin(this.yaw) * cp * this.dist,
      _target.y + Math.sin(this.pitch) * this.dist,
      _target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(_target.x, _target.y + 0.3, _target.z);
  }

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointercancel", this.onUp);
    this.dom.removeEventListener("wheel", this.onWheel);
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // Second finger: switch to pinch zoom, drop any aim/orbit in progress.
      this.mode = "none";
      this.arrow.visible = false;
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (this.hooks.canAim() && this.isOnBall(e.clientX, e.clientY)) {
      this.mode = "aim";
      this.power = 0;
    } else {
      this.mode = "orbit";
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) {
        this.dist = THREE.MathUtils.clamp((this.dist * this.pinchDist) / Math.max(d, 1), CAM_MIN_DIST, CAM_MAX_DIST);
      }
      this.pinchDist = d;
      return;
    }

    if (this.mode === "orbit") {
      this.yaw -= dx * 0.0055;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, CAM_MIN_PITCH, CAM_MAX_PITCH);
    } else if (this.mode === "aim") {
      this.updateAim(e.clientX, e.clientY);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.mode === "aim" && this.pointers.size === 0) {
      this.arrow.visible = false;
      if (this.power >= MIN_SHOT_POWER && this.hooks.canAim()) {
        this.hooks.onShoot(_shot.clone());
      }
      this.mode = "none";
      this.power = 0;
    } else if (this.pointers.size === 0) {
      this.mode = "none";
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    this.dist = THREE.MathUtils.clamp(this.dist * f, CAM_MIN_DIST, CAM_MAX_DIST);
  };

  /** Screen-space proximity check: generous so touch can grab the ball. */
  private isOnBall(px: number, py: number): boolean {
    const rect = this.dom.getBoundingClientRect();
    _ndc.copy(this.hooks.ballPos()).project(this.camera);
    const sx = rect.left + ((_ndc.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - _ndc.y) / 2) * rect.height;
    return Math.hypot(px - sx, py - sy) <= AIM_PICK_PX;
  }

  /** Intersects the pointer ray with the horizontal plane at ball height. */
  private updateAim(px: number, py: number): void {
    const ball = this.hooks.ballPos();
    const rect = this.dom.getBoundingClientRect();
    _ndc.set(((px - rect.left) / rect.width) * 2 - 1, -(((py - rect.top) / rect.height) * 2 - 1), 0.5);
    _ray.copy(_ndc).unproject(this.camera).sub(this.camera.position).normalize();
    if (Math.abs(_ray.y) < 1e-4) return;
    const t = (ball.y - this.camera.position.y) / _ray.y;
    if (t <= 0) return;
    _hit.copy(this.camera.position).addScaledVector(_ray, t);

    _pull.set(ball.x - _hit.x, 0, ball.z - _hit.z);
    const len = Math.min(_pull.length(), MAX_PULL);
    this.power = len / MAX_PULL;
    if (this.power < 1e-3) {
      this.arrow.visible = false;
      _shot.set(0, 0, 0);
      return;
    }
    _pull.normalize();
    _shot.copy(_pull).multiplyScalar(this.power * MAX_SHOT_SPEED);

    // Arrow preview: anchored at the ball, pointing along the shot.
    const arrowLen = 0.6 + this.power * 2.2;
    this.arrow.position.copy(ball);
    this.arrow.visible = true;
    this.arrow.rotation.y = Math.atan2(_pull.x, _pull.z);
    this.shaft.scale.z = arrowLen;
    this.shaft.position.z = arrowLen / 2;
    this.head.position.z = arrowLen + 0.15;
    this.arrowMat.color.lerpColors(this.colorFrom, this.colorTo, this.power);
  }
}
