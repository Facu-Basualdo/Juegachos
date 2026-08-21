import * as THREE from "three";
import {
  AIR_DRAG,
  BALL_R,
  GRAVITY,
  MAX_BALL_SPEED,
  ROLL_FRICTION,
  SETTLE_FRICTION,
  STOP_SPEED,
} from "./constants";

/**
 * Tiny purpose-built ball physics: one sphere against static/kinematic
 * boxes and vertical cylinders. Deterministic and fully tunable — no
 * engine. Boxes may be oriented (ramps) and may spin (the windmill bar);
 * cylinders (bumpers) can have restitution > 1 to add energy.
 */

export interface ColliderBase {
  restitution: number;
  /** Per-second rolling damp while this collider is the ground
   *  (overrides ROLL_FRICTION; greens are slower than fairway). */
  friction?: number;
  /** Fired when the ball hits this collider with real impact speed. */
  onHit?: (impactSpeed: number) => void;
  /** Marks bumpers for the sound/flash juice. */
  bumper?: boolean;
}

export interface BoxCollider extends ColliderBase {
  kind: "box";
  center: THREE.Vector3;
  half: THREE.Vector3;
  /** Orientation; omitted = axis-aligned. */
  quat?: THREE.Quaternion;
  /** Kinematic spin (rotating bar): world angular velocity around `center`. */
  angularVel?: THREE.Vector3;
}

export interface CylinderCollider extends ColliderBase {
  kind: "cylinder";
  /** Mid-height center. */
  center: THREE.Vector3;
  radius: number;
  halfHeight: number;
}

export type Collider = BoxCollider | CylinderCollider;

export interface Contact {
  collider: Collider;
  normalY: number;
  /** Approach speed along the normal at impact (0 while resting). */
  impact: number;
}

export interface StepResult {
  grounded: boolean;
  groundNormal: THREE.Vector3;
  /** Rolling damp of the current ground collider. */
  groundFriction: number;
  contacts: Contact[];
}

const _local = new THREE.Vector3();
const _clamped = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _pointVel = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _tangent = new THREE.Vector3();

function resolveBox(pos: THREE.Vector3, vel: THREE.Vector3, box: BoxCollider, out: StepResult, record: boolean): void {
  _local.copy(pos).sub(box.center);
  if (box.quat) _local.applyQuaternion(_invQuat.copy(box.quat).invert());

  const h = box.half;
  _clamped.set(
    THREE.MathUtils.clamp(_local.x, -h.x, h.x),
    THREE.MathUtils.clamp(_local.y, -h.y, h.y),
    THREE.MathUtils.clamp(_local.z, -h.z, h.z),
  );
  _delta.copy(_local).sub(_clamped);
  const distSq = _delta.lengthSq();

  let depth: number;
  if (distSq < 1e-12) {
    // Ball center inside the box: push out along the least-penetrated axis.
    const px = h.x - Math.abs(_local.x);
    const py = h.y - Math.abs(_local.y);
    const pz = h.z - Math.abs(_local.z);
    if (px <= py && px <= pz) {
      _normal.set(Math.sign(_local.x) || 1, 0, 0);
      depth = px + BALL_R;
    } else if (py <= pz) {
      _normal.set(0, Math.sign(_local.y) || 1, 0);
      depth = py + BALL_R;
    } else {
      _normal.set(0, 0, Math.sign(_local.z) || 1);
      depth = pz + BALL_R;
    }
  } else {
    if (distSq >= BALL_R * BALL_R) return;
    const dist = Math.sqrt(distSq);
    _normal.copy(_delta).divideScalar(dist);
    depth = BALL_R - dist;
  }

  if (box.quat) _normal.applyQuaternion(box.quat);
  pos.addScaledVector(_normal, depth);

  // Velocity of the collider surface at the contact point (spinning bar).
  _pointVel.set(0, 0, 0);
  if (box.angularVel) {
    _delta.copy(pos).addScaledVector(_normal, -BALL_R).sub(box.center);
    _pointVel.crossVectors(box.angularVel, _delta);
  }
  _relVel.copy(vel).sub(_pointVel);
  const vn = _relVel.dot(_normal);
  let impact = 0;
  if (vn < 0) {
    vel.addScaledVector(_normal, -(1 + box.restitution) * vn);
    impact = -vn;
  }
  if (record) out.contacts.push({ collider: box, normalY: _normal.y, impact });
  if (_normal.y > 0.55) {
    out.grounded = true;
    out.groundNormal.copy(_normal);
    out.groundFriction = box.friction ?? ROLL_FRICTION;
  }
}

function resolveCylinder(pos: THREE.Vector3, vel: THREE.Vector3, cyl: CylinderCollider, out: StepResult, record: boolean): void {
  const dy = pos.y - cyl.center.y;
  if (Math.abs(dy) > cyl.halfHeight + BALL_R) return;
  const dx = pos.x - cyl.center.x;
  const dz = pos.z - cyl.center.z;
  const horiz = Math.hypot(dx, dz);
  if (horiz > cyl.radius + BALL_R) return;

  if (dy > cyl.halfHeight * 0.9 && horiz < cyl.radius) {
    // On top of the bumper: pop straight up.
    _normal.set(0, 1, 0);
    pos.y += cyl.halfHeight + BALL_R - dy;
  } else {
    if (horiz < 1e-6) _normal.set(1, 0, 0);
    else _normal.set(dx / horiz, 0, dz / horiz);
    pos.addScaledVector(_normal, cyl.radius + BALL_R - horiz);
  }

  const vn = vel.dot(_normal);
  let impact = 0;
  if (vn < 0) {
    vel.addScaledVector(_normal, -(1 + cyl.restitution) * vn);
    impact = -vn;
  }
  if (record) out.contacts.push({ collider: cyl, normalY: _normal.y, impact });
  if (_normal.y > 0.55) {
    out.grounded = true;
    out.groundNormal.copy(_normal);
    out.groundFriction = cyl.friction ?? ROLL_FRICTION;
  }
}

/**
 * Advances the ball one substep: integrate gravity, move, resolve every
 * collider (two relaxation passes), then apply rolling friction / air drag.
 */
export function stepBall(pos: THREE.Vector3, vel: THREE.Vector3, colliders: readonly Collider[], dt: number, out: StepResult): StepResult {
  vel.y += GRAVITY * dt;
  if (vel.lengthSq() > MAX_BALL_SPEED * MAX_BALL_SPEED) vel.setLength(MAX_BALL_SPEED);
  pos.addScaledVector(vel, dt);

  out.grounded = false;
  out.groundNormal.set(0, 1, 0);
  out.groundFriction = ROLL_FRICTION;
  out.contacts.length = 0;
  for (let iter = 0; iter < 2; iter++) {
    const record = iter === 0;
    for (const c of colliders) {
      if (c.kind === "box") resolveBox(pos, vel, c, out, record);
      else resolveCylinder(pos, vel, c, out, record);
    }
  }

  if (out.grounded) {
    // Damp only the tangential part so bounces stay lively.
    const n = out.groundNormal;
    const vn = vel.dot(n);
    _tangent.copy(vel).addScaledVector(n, -vn);
    const flat = n.y > 0.98;
    const crawling = flat && _tangent.length() < STOP_SPEED * 2.5;
    const damp = Math.exp(-(crawling ? SETTLE_FRICTION : out.groundFriction) * dt);
    _tangent.multiplyScalar(damp);
    vel.copy(_tangent).addScaledVector(n, vn);
  } else {
    vel.multiplyScalar(Math.exp(-AIR_DRAG * dt));
  }
  return out;
}
