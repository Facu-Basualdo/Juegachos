import * as THREE from "three";
import { WRIST_LEAN } from "./constants";

/**
 * An open hand, palm up, with a katana **balanced standing on the palm**: the
 * pommel rests at the pivot (origin) and the blade rises from it. The hand/arm
 * stay planted; the sword group pivots about the palm-contact point by the
 * balance angle. Authored forms first — a real open hand (palm, splayed fingers,
 * thumb, wrist wraps, forearm) and a tapered brushed-steel blade whose single
 * emissive edge line is the only element the bloom pass is tuned to catch.
 */
export class Sword {
  readonly group = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly blade = new THREE.Group();
  private leanTarget = 0;
  private lean = 0;
  private wobbleTime = 0;
  private currentAngle = 0;

  constructor() {
    this.buildHand();
    this.buildSword();
    this.group.add(this.arm, this.blade);
  }

  private buildHand(): void {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc79a70, roughness: 0.62, metalness: 0.0 });
    const skinDark = new THREE.MeshStandardMaterial({ color: 0xb07f57, roughness: 0.66, metalness: 0.0 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 0.9, metalness: 0.02 });
    const clothBand = new THREE.MeshStandardMaterial({ color: 0x232a38, roughness: 0.85, metalness: 0.03 });

    // First-person open right hand, palm up: fingers reach forward (-Z, away from
    // the viewer) and curl gently up; the wrist and forearm recede toward the
    // camera (+Z, the bottom of the screen). The katana pommel rests at origin.
    const hand = new THREE.Group();
    // Twice as large, with the group lowered so the palm still meets the pommel.
    hand.scale.setScalar(2);
    hand.position.y = -0.09;

    // Palm — a soft cupped pad (scaled sphere) so the top reads concave like a
    // real open palm, not a flat slab.
    const palmPad = new THREE.Mesh(new THREE.SphereGeometry(0.3, 22, 16), skin);
    palmPad.scale.set(0.94, 0.34, 0.9);
    palmPad.position.set(0, -0.07, -0.01);
    palmPad.rotation.x = 0.14;
    palmPad.castShadow = true;
    palmPad.receiveShadow = true;
    hand.add(palmPad);
    // Heel of the palm toward the wrist.
    const heel = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), skin);
    heel.scale.set(0.86, 0.44, 0.72);
    heel.position.set(0, -0.09, 0.17);
    heel.castShadow = true;
    hand.add(heel);
    // Knuckle ridge where the fingers meet the palm.
    [-0.17, -0.058, 0.058, 0.17].forEach((x) => {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), skin);
      k.position.set(x, -0.02, -0.19);
      k.castShadow = true;
      hand.add(k);
    });

    // Four fingers, three phalanges each, splayed and gently curled up.
    const fingers: { x: number; splay: number; lens: [number, number, number]; r: number }[] = [
      { x: -0.17, splay: 0.17, lens: [0.16, 0.12, 0.09], r: 0.05 },
      { x: -0.058, splay: 0.05, lens: [0.18, 0.14, 0.1], r: 0.053 },
      { x: 0.058, splay: -0.05, lens: [0.16, 0.13, 0.095], r: 0.05 },
      { x: 0.17, splay: -0.17, lens: [0.12, 0.1, 0.08], r: 0.043 },
    ];
    for (const f of fingers) {
      const finger = makeFinger(f.lens, f.r, skin, skinDark);
      finger.position.set(f.x, -0.03, -0.19);
      finger.rotation.order = "ZYX";
      finger.rotation.y = f.splay;
      finger.rotation.x = -Math.PI / 2 + 0.3; // forward and slightly up
      hand.add(finger);
    }

    // Thumb: two phalanges from the thenar mound, opposed to the right and up.
    const thumb = makeFinger([0.15, 0.11, 0], 0.058, skin, skinDark);
    thumb.position.set(0.19, -0.05, 0.05);
    thumb.rotation.order = "ZYX";
    thumb.rotation.z = -1.05;
    thumb.rotation.x = -Math.PI / 2 + 0.75;
    hand.add(thumb);

    // Wrist wraps following the receding wrist.
    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.215 - i * 0.006, 0.05, 10, 20), i % 2 ? clothBand : cloth);
      band.rotation.x = Math.PI / 2 - 0.4;
      band.position.set(0, -0.13 - i * 0.09, 0.26 + i * 0.16);
      band.scale.set(1, 0.9, 1);
      band.castShadow = true;
      hand.add(band);
    }

    // Forearm/sleeve receding toward the camera (bottom of the first-person view).
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.33, 2.4, 20), cloth);
    forearm.position.set(0, -0.62, 1.25);
    forearm.rotation.x = Math.PI / 2 - 0.55;
    forearm.castShadow = true;
    hand.add(forearm);

    this.arm.add(hand);
  }

  private buildSword(): void {
    // Pommel cap (kashira) resting on the palm at the pivot.
    const darkIron = new THREE.MeshStandardMaterial({ color: 0x2a2119, roughness: 0.4, metalness: 0.85 });
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.09, 14), darkIron);
    pommel.position.y = 0.045;
    pommel.castShadow = true;

    // Handle (tsuka) — dark cord wrap.
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x1a140f, roughness: 0.6, metalness: 0.15 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.86, 16), handleMat);
    handle.position.y = 0.52;
    handle.castShadow = true;
    const wrapMat = new THREE.MeshStandardMaterial({ color: 0x0d0b09, roughness: 0.75 });
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.077, 0.013, 8, 16), wrapMat);
      w.rotation.x = Math.PI / 2;
      w.position.y = -0.28 + i * 0.18;
      handle.add(w);
    }

    // Guard (tsuba).
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.055, 6), darkIron);
    guard.position.y = 1.0;
    guard.rotation.y = Math.PI / 12;
    guard.castShadow = true;

    // Blade — brushed steel (reads with a light-to-dark gradient, not a mirror).
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x9aa4b2,
      metalness: 0.82,
      roughness: 0.44,
    });
    const bladeLen = 3.0;
    const blade = new THREE.Mesh(makeBladeGeometry(bladeLen, 0.15, 0.032), bladeMat);
    blade.position.y = 1.04;
    blade.castShadow = true;

    // The one authored emissive element the bloom is tuned to: a thin edge glint.
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xbfd4ee,
      emissive: 0x88b6ff,
      emissiveIntensity: 0.42,
      metalness: 0.5,
      roughness: 0.4,
    });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, bladeLen - 0.14, 0.036), edgeMat);
    edge.position.set(0.066, 1.04 + bladeLen / 2, 0);

    this.blade.add(pommel, handle, guard, blade, edge);
  }

  setAngle(rad: number): void {
    this.currentAngle = rad;
    this.blade.rotation.z = rad;
  }

  setLean(lean: number): void {
    this.leanTarget = lean;
  }

  update(dt: number): void {
    this.lean += (this.leanTarget - this.lean) * Math.min(1, dt * 12);

    const failAngleVal = 1.02; // FAIL_ANGLE from constants.ts
    const isFailed = Math.abs(this.currentAngle) >= failAngleVal;

    let targetGroupX = 0;
    let targetGroupY = 0;
    let targetArmY = 0;
    let targetRotZ = this.lean * WRIST_LEAN;

    if (!isFailed) {
      // Calculate dynamic hand wobble (tremor) scaling with tilt angle
      const angleRatio = Math.min(1.0, Math.abs(this.currentAngle) / failAngleVal);
      // Small tremor at 0 tilt (0.004), growing to a heavy wobble (0.08) near failure
      const shakeAmp = 0.004 + Math.pow(angleRatio, 2.5) * 0.076;
      // Shake frequency increases as danger increases (from 12Hz up to 40Hz)
      const shakeFreq = 12 + angleRatio * 28;

      this.wobbleTime += dt * shakeFreq;

      const tremorX = Math.sin(this.wobbleTime) * shakeAmp;
      const tremorY = Math.cos(this.wobbleTime * 1.3) * shakeAmp * 0.6;
      const tremorRotZ = Math.sin(this.wobbleTime * 0.9) * shakeAmp * 0.5;

      // The hand tries to position itself under the sword's tilt to keep it balanced
      const followOffset = this.currentAngle * 0.35;

      targetGroupX = followOffset + tremorX;
      targetGroupY = tremorY;
      targetRotZ = this.lean * WRIST_LEAN + tremorRotZ;
      targetArmY = 0;
    } else {
      // Game over: hand drops in disappointment and centers itself
      targetGroupX = 0;
      targetGroupY = 0;
      targetRotZ = 0;
      targetArmY = -0.18; // hand drops down relative to the pivot
    }

    // Smoothly interpolate group and arm positions
    this.group.position.x += (targetGroupX - this.group.position.x) * Math.min(1, dt * 15);
    this.group.position.y += (targetGroupY - this.group.position.y) * Math.min(1, dt * 15);
    this.arm.position.y += (targetArmY - this.arm.position.y) * Math.min(1, dt * 15);

    this.arm.rotation.z = targetRotZ;
  }

  reset(): void {
    this.blade.rotation.z = 0;
    this.leanTarget = 0;
    this.lean = 0;
    this.arm.rotation.z = 0;

    this.group.position.set(0, 0, 0);
    this.arm.position.set(0, 0, 0);
    this.blade.position.set(0, 0, 0);
    this.wobbleTime = 0;
    this.currentAngle = 0;
  }
}

/**
 * A finger built along local +Y from up to three tapering phalanges, each joint
 * curling forward a little so the finger reads relaxed and cupped. The caller
 * rotates the returned group to point it forward and splay it.
 */
function makeFinger(
  lens: number[],
  r0: number,
  mat: THREE.Material,
  tipMat: THREE.Material,
): THREE.Group {
  const root = new THREE.Group();
  const curls = [0.05, 0.24, 0.3];
  const taper = [1, 0.9, 0.8];
  let parent = root;
  let last: { next: THREE.Group; r: number } | null = null;
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i];
    if (len <= 0) break;
    const joint = new THREE.Group();
    joint.rotation.x = curls[i] ?? 0.28;
    parent.add(joint);
    const r = r0 * (taper[i] ?? 0.75);
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 10), mat);
    seg.position.y = len / 2;
    seg.castShadow = true;
    joint.add(seg);
    const next = new THREE.Group();
    next.position.y = len;
    joint.add(next);
    parent = next;
    last = { next, r };
  }
  if (last) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(last.r * 0.94, 12, 10), tipMat);
    last.next.add(tip);
  }
  return root;
}

/** A long tapered blade: wide near the guard, narrowing to a point. */
function makeBladeGeometry(length: number, width: number, thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const w = width / 2;
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w * 0.82, length * 0.86);
  shape.lineTo(0, length); // point
  shape.lineTo(-w * 0.9, length * 0.86);
  shape.lineTo(-w, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: thick * 0.5,
    bevelSize: thick * 0.6,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -thick / 2);
  geo.computeVertexNormals();
  return geo;
}
