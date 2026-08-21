import * as THREE from "three";
import type { Collider, BoxCollider } from "./Physics";
import type { HoleDef, RampDef } from "./holes";
import type { ModelSet } from "./Models";
import {
  DIRT_COLOR,
  FOLIAGE_MID_COLOR,
  GRASS_COLOR,
  GREEN_FRICTION,
  GREEN_REST,
  GREEN_COLOR,
  HOLE_DARK_COLOR,
  HOLE_R,
  LANTERN_GLOW_COLOR,
  MOSS_COLOR,
  RAMP_BLUE_COLOR,
  RED_COLOR,
  TRIM_COLOR,
  WOOD_COLOR,
} from "./constants";

const FLOOR_THICK = 0.7;
const RAMP_THICK = 0.34;
const WALL_REST = 0.55;
const FLOOR_REST = 0.35;
const RAMP_REST = 0.15;
const BUMPER_REST = 1.5;
const BAR_REST = 0.7;
const BUMPER_R = 0.34;
const BUMPER_H = 0.5;

interface Rotor {
  group: THREE.Group;
  collider: BoxCollider;
  speed: number;
  angle: number;
}

interface MillRotor {
  obj: THREE.Object3D;
  speed: number;
}

interface BumperFlash {
  mat: THREE.MeshToonMaterial;
  t: number;
}

/**
 * Builds one hole from its `HoleDef`: cel-shaded meshes + the matching
 * physics colliders. Owns the moving parts (rotating bars, bumper flashes)
 * via `update(dt)`.
 */
export class Course {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  /** Meshes the ball's blob shadow raycasts against. */
  readonly floorMeshes: THREE.Mesh[] = [];
  readonly holeCenter: THREE.Vector3;
  readonly teePos: THREE.Vector3;

  private readonly rotors: Rotor[] = [];
  private readonly millRotors: MillRotor[] = [];
  private readonly flashes: BumperFlash[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private readonly grass: THREE.MeshToonMaterial;
  private readonly green: THREE.MeshToonMaterial;
  private readonly dirt: THREE.MeshToonMaterial;
  private readonly wood: THREE.MeshToonMaterial;
  private readonly moss: THREE.MeshToonMaterial;
  private readonly red: THREE.MeshToonMaterial;
  private readonly trim: THREE.MeshToonMaterial;
  private readonly blue: THREE.MeshToonMaterial;
  private readonly foliage: THREE.MeshToonMaterial;

  readonly def: HoleDef;

  constructor(def: HoleDef, grad: THREE.Texture, models: ModelSet) {
    this.def = def;
    const toon = (color: number) => {
      const m = new THREE.MeshToonMaterial({ color, gradientMap: grad });
      this.materials.push(m);
      return m;
    };
    this.grass = toon(GRASS_COLOR);
    this.green = toon(GREEN_COLOR);
    this.dirt = toon(DIRT_COLOR);
    this.wood = toon(WOOD_COLOR);
    this.moss = toon(MOSS_COLOR);
    this.red = toon(RED_COLOR);
    this.trim = toon(TRIM_COLOR);
    this.blue = toon(RAMP_BLUE_COLOR);
    this.foliage = toon(FOLIAGE_MID_COLOR);
    // Pillow mounds are soft atmosphere, not machined props: no ink outline.
    this.foliage.userData.outlineParameters = { visible: false };

    const holeY = def.hole.y ?? 0;
    this.holeCenter = new THREE.Vector3(def.hole.x, holeY, def.hole.z);
    this.teePos = new THREE.Vector3(def.tee.x, 0, def.tee.z);

    this.buildFloors();
    this.buildWalls();
    this.buildRamps();
    this.buildBars();
    this.buildBumpers();
    this.buildHole(models.flag);
    this.buildTee();
    this.buildDecor(models);
  }

  private box(geo: THREE.BoxGeometry, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
    this.geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    return mesh;
  }

  private buildFloors(): void {
    for (const f of this.def.floors) {
      const top = f.y ?? 0;
      const topMat = f.kind === "green" ? this.green : this.grass;
      // Face order +x,-x,+y,-y,+z,-z: grass on top, dirt on the sides.
      const mesh = this.box(new THREE.BoxGeometry(f.w, FLOOR_THICK, f.d), [
        this.dirt,
        this.dirt,
        topMat,
        this.dirt,
        this.dirt,
        this.dirt,
      ]);
      mesh.position.set(f.x, top - FLOOR_THICK / 2, f.z);
      this.floorMeshes.push(mesh);
      this.colliders.push({
        kind: "box",
        center: mesh.position.clone(),
        half: new THREE.Vector3(f.w / 2, FLOOR_THICK / 2, f.d / 2),
        restitution: f.kind === "green" ? GREEN_REST : FLOOR_REST,
        friction: f.kind === "green" ? GREEN_FRICTION : undefined,
      });
    }
  }

  private buildWalls(): void {
    for (const w of this.def.walls) {
      const h = w.h ?? 0.4;
      const side = w.color === "red" ? this.red : this.wood;
      // Mossy cap on every wall (the overgrown-garden read, see DESIGN.md).
      const mat = [side, side, this.moss, side, side, side];
      const mesh = this.box(new THREE.BoxGeometry(w.w, h, w.d), mat);
      mesh.position.set(w.x, h / 2, w.z);
      if (w.yaw) mesh.rotation.y = w.yaw;
      this.colliders.push({
        kind: "box",
        center: mesh.position.clone(),
        half: new THREE.Vector3(w.w / 2, h / 2, w.d / 2),
        quat: w.yaw ? new THREE.Quaternion().setFromAxisAngle(UP, w.yaw) : undefined,
        restitution: WALL_REST,
      });
    }
  }

  private rampTransform(r: RampDef): { quat: THREE.Quaternion; center: THREE.Vector3; hyp: number } {
    const theta = Math.atan2(r.rise, r.len);
    const hyp = Math.hypot(r.len, r.rise);
    const quat = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, r.yaw, 0))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-theta, 0, 0)));
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    // Box top surface = the inclined plane from y=0 (downhill edge) to y=rise.
    const center = new THREE.Vector3(r.x, r.rise / 2, r.z).addScaledVector(normal, -RAMP_THICK / 2);
    return { quat, center, hyp };
  }

  private buildRamps(): void {
    for (const r of this.def.ramps ?? []) {
      const { quat, center, hyp } = this.rampTransform(r);
      const topMat = r.kind === "shortcut" ? this.blue : this.grass;
      const mesh = this.box(new THREE.BoxGeometry(r.w, RAMP_THICK, hyp), [
        this.dirt,
        this.dirt,
        topMat,
        this.dirt,
        this.dirt,
        this.dirt,
      ]);
      mesh.position.copy(center);
      mesh.quaternion.copy(quat);
      this.floorMeshes.push(mesh);
      this.colliders.push({
        kind: "box",
        center: center.clone(),
        half: new THREE.Vector3(r.w / 2, RAMP_THICK / 2, hyp / 2),
        quat: quat.clone(),
        restitution: RAMP_REST,
      });
    }
  }

  private buildBars(): void {
    for (const b of this.def.bars ?? []) {
      const post = this.box(new THREE.BoxGeometry(0.22, 1.0, 0.22), this.wood);
      post.position.set(b.x, 0.5, b.z);

      const rotor = new THREE.Group();
      rotor.position.set(b.x, 0.27, b.z);
      const mid = new THREE.Mesh(new THREE.BoxGeometry(b.len * 0.5, 0.3, 0.22), this.red);
      const tipL = new THREE.Mesh(new THREE.BoxGeometry(b.len * 0.25, 0.3, 0.22), this.trim);
      tipL.position.x = -b.len * 0.375;
      const tipR = tipL.clone();
      tipR.position.x = b.len * 0.375;
      this.geometries.push(mid.geometry, tipL.geometry);
      rotor.add(mid, tipL, tipR);
      this.group.add(rotor);

      const collider: BoxCollider = {
        kind: "box",
        center: new THREE.Vector3(b.x, 0.27, b.z),
        half: new THREE.Vector3(b.len / 2, 0.2, 0.11),
        quat: new THREE.Quaternion(),
        angularVel: new THREE.Vector3(0, b.speed, 0),
        restitution: BAR_REST,
      };
      this.colliders.push(collider);
      this.rotors.push({ group: rotor, collider, speed: b.speed, angle: 0 });
    }
  }

  private buildBumpers(): void {
    for (const b of this.def.bumpers ?? []) {
      const r = b.r ?? BUMPER_R;
      const body = new THREE.MeshToonMaterial({ color: RED_COLOR, gradientMap: this.red.gradientMap });
      this.materials.push(body);
      const geo = new THREE.CylinderGeometry(r, r * 1.12, BUMPER_H, 20);
      this.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, body);
      mesh.position.set(b.x, BUMPER_H / 2, b.z);
      this.group.add(mesh);

      const capGeo = new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.07, 20);
      this.geometries.push(capGeo);
      const cap = new THREE.Mesh(capGeo, this.trim);
      cap.position.set(b.x, BUMPER_H + 0.02, b.z);
      this.group.add(cap);

      const flash: BumperFlash = { mat: body, t: 0 };
      this.flashes.push(flash);
      this.colliders.push({
        kind: "cylinder",
        center: new THREE.Vector3(b.x, BUMPER_H / 2, b.z),
        radius: r,
        halfHeight: BUMPER_H / 2,
        restitution: BUMPER_REST,
        bumper: true,
        onHit: () => {
          flash.t = 1;
        },
      });
    }
  }

  private buildHole(flagTemplate?: THREE.Object3D): void {
    const y = this.holeCenter.y;
    const cupGeo = new THREE.CircleGeometry(HOLE_R, 32);
    this.geometries.push(cupGeo);
    const cupMat = new THREE.MeshBasicMaterial({ color: HOLE_DARK_COLOR });
    cupMat.userData.outlineParameters = { visible: false };
    this.materials.push(cupMat);
    const cup = new THREE.Mesh(cupGeo, cupMat);
    cup.rotation.x = -Math.PI / 2;
    cup.position.set(this.holeCenter.x, y + 0.006, this.holeCenter.z);
    this.group.add(cup);

    if (flagTemplate) {
      const flag = flagTemplate.clone(true);
      flag.position.set(this.holeCenter.x, y, this.holeCenter.z);
      // The pennant is a flat triangle: face it broadside toward the tee so
      // it never reads edge-on from the hole's starting camera.
      flag.rotation.y = Math.atan2(this.teePos.x - this.holeCenter.x, this.teePos.z - this.holeCenter.z);
      this.group.add(flag);
    } else {
      // Primitive fallback: pole + pennant.
      const poleGeo = new THREE.CylinderGeometry(0.024, 0.024, 1.42, 10);
      this.geometries.push(poleGeo);
      const pole = new THREE.Mesh(poleGeo, this.trim);
      pole.position.set(this.holeCenter.x, y + 0.71, this.holeCenter.z);
      const flagGeo = new THREE.ConeGeometry(0.16, 0.5, 4);
      this.geometries.push(flagGeo);
      const pennant = new THREE.Mesh(flagGeo, this.red);
      pennant.rotation.z = -Math.PI / 2;
      pennant.position.set(this.holeCenter.x + 0.26, y + 1.2, this.holeCenter.z);
      this.group.add(pole, pennant);
    }
  }

  private buildTee(): void {
    const geo = new THREE.CircleGeometry(0.3, 24);
    this.geometries.push(geo);
    const mat = new THREE.MeshBasicMaterial({ color: TRIM_COLOR, transparent: true, opacity: 0.55 });
    mat.userData.outlineParameters = { visible: false };
    this.materials.push(mat);
    const decal = new THREE.Mesh(geo, mat);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(this.teePos.x, 0.005, this.teePos.z);
    this.group.add(decal);
  }

  private buildDecor(models: ModelSet): void {
    for (const d of this.def.decor ?? []) {
      const yaw = d.yaw ?? 0;
      if (d.kind === "lantern" && models.lantern) {
        const lantern = models.lantern.clone(true);
        lantern.position.set(d.x, 0, d.z);
        lantern.rotation.y = yaw;
        this.group.add(lantern);
        // Warm pool of light under the hanging glass (arm extends +Z at yaw 0).
        const light = new THREE.PointLight(LANTERN_GLOW_COLOR, 1.1, 4.5, 2);
        light.position.set(d.x + Math.sin(yaw) * 0.36, 1.15, d.z + Math.cos(yaw) * 0.36);
        this.group.add(light);
        this.colliders.push({
          kind: "cylinder",
          center: new THREE.Vector3(d.x, 0.78, d.z),
          radius: 0.1,
          halfHeight: 0.78,
          restitution: 0.5,
        });
      } else if (d.kind === "barrel" && models.barrel) {
        const barrel = models.barrel.clone(true);
        barrel.position.set(d.x, 0, d.z);
        barrel.rotation.y = yaw;
        this.group.add(barrel);
        this.colliders.push({
          kind: "cylinder",
          center: new THREE.Vector3(d.x, 0.39, d.z),
          radius: 0.34,
          halfHeight: 0.39,
          restitution: 0.6,
        });
      } else if (d.kind === "windmill" && models.windmill) {
        // The mill floats on a green pillow (same read as the garden mounds).
        const scale = d.scale ?? 1;
        const moundGeo = new THREE.SphereGeometry(1, 12, 9);
        this.geometries.push(moundGeo);
        const mound = new THREE.Mesh(moundGeo, this.foliage);
        mound.position.set(d.x, 0.1 - 1.05 * scale, d.z);
        mound.scale.set(2.1 * scale, 1.05 * scale, 2.1 * scale);
        this.group.add(mound);
        const mill = models.windmill.clone(true);
        mill.position.set(d.x, 0, d.z);
        mill.rotation.y = yaw;
        mill.scale.setScalar(scale);
        this.group.add(mill);
        this.colliders.push({
          kind: "cylinder",
          center: new THREE.Vector3(d.x, 1.25 * scale, d.z),
          radius: 0.85 * scale,
          halfHeight: 1.25 * scale,
          restitution: 0.5,
        });
        const rotor = mill.getObjectByName("rotor");
        if (rotor) this.millRotors.push({ obj: rotor, speed: 0.5 });
      }
    }
  }

  update(dt: number): void {
    for (const r of this.rotors) {
      r.angle += r.speed * dt;
      r.group.rotation.y = r.angle;
      r.collider.quat!.setFromAxisAngle(UP, r.angle);
    }
    for (const m of this.millRotors) {
      m.obj.rotation.z += m.speed * dt;
    }
    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t = Math.max(0, f.t - dt * 3.5);
      f.mat.emissive.setScalar(f.t * 0.55);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
