import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { RAPIER as R } from "./physics";
import {
  GROUND_COLOR,
  GROUND_COLOR_ALT,
  GROUND_FRICTION,
  GROUND_HALF_X,
  GROUND_HALF_Y,
  GROUND_HALF_Z,
  GROUP_GROUND,
  MILESTONE_AHEAD,
  MILESTONE_BEHIND,
  MILESTONE_COLOR,
  MILESTONE_EVERY,
  MILESTONE_POOL,
  RECORD_COLOR,
  SEGMENT_COUNT,
  SEGMENT_LENGTH,
  SKY_TOP,
} from "./constants";

interface Milestone {
  readonly group: THREE.Group;
  readonly post: THREE.Mesh;
  readonly plate: THREE.Mesh;
  readonly label: THREE.Sprite;
  index: number;
}

const DUNE_COUNT = 7;
const DUNE_SPACING = 46;

/** Textura de arena: mota fina para que el suelo mate no quede plano. */
function sandTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 226 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(SEGMENT_LENGTH / 2, 24);
  tex.anisotropy = 4;
  return tex;
}

/** Cartelito de metros: canvas -> sprite, cacheado por numero. */
const labelCache = new Map<number, THREE.SpriteMaterial>();
function labelMaterial(meters: number): THREE.SpriteMaterial {
  const cached = labelCache.get(meters);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f6efe3";
  ctx.strokeStyle = "#8a5a44";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(6, 22, 244, 84, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#8a5a44";
  ctx.font = "bold 58px Verdana, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${meters} m`, 128, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  if (labelCache.size > 60) labelCache.clear();
  labelCache.set(meters, mat);
  return mat;
}

/**
 * Escenario infinito.
 *
 * El COLLIDER del suelo es uno solo y enorme: el piso es plano y horizontal,
 * asi que reciclarlo solo agregaria teleports de geometria debajo de los pies.
 * Lo que se recicla es lo visual — losas, dunas de fondo y postes de hito — a
 * medida que el bicho avanza en +X.
 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly groundCollider: RAPIER.Collider;

  private readonly segments: THREE.Mesh[] = [];
  private readonly dunes: THREE.Mesh[] = [];
  private readonly milestones: Milestone[] = [];

  private readonly recordGroup = new THREE.Group();
  private readonly recordBanner: THREE.Mesh;
  private recordDistance = 0;
  private recordBeaten = false;

  constructor(world: RAPIER.World) {
    // ------------------------------------------------------------- fisica
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -GROUND_HALF_Y, 0));
    this.groundCollider = world.createCollider(
      R.ColliderDesc.cuboid(GROUND_HALF_X, GROUND_HALF_Y, GROUND_HALF_Z)
        .setFriction(GROUND_FRICTION)
        .setFrictionCombineRule(R.CoefficientCombineRule.Max)
        .setCollisionGroups(GROUP_GROUND)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );

    // ------------------------------------------------------------- losas
    const sand = sandTexture();
    // Plano en vez de caja: la arena solo se ve desde arriba, y en GPU floja
    // seis caras por losa son relleno pagado de gusto.
    const geo = new THREE.PlaneGeometry(SEGMENT_LENGTH, GROUND_HALF_Z * 1.6);
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? GROUND_COLOR : GROUND_COLOR_ALT,
        roughness: 1,
        metalness: 0,
        map: sand,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(i * SEGMENT_LENGTH, 0, 0);
      mesh.receiveShadow = true;
      this.segments.push(mesh);
      this.group.add(mesh);
    }

    // -------------------------------------------------------------- dunas
    const duneGeo = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const duneMat = new THREE.MeshStandardMaterial({
      color: SKY_TOP,
      roughness: 1,
      metalness: 0,
    });
    for (let i = 0; i < DUNE_COUNT; i++) {
      const dune = new THREE.Mesh(duneGeo, duneMat);
      dune.scale.set(26 + (i % 3) * 8, 6 + (i % 4) * 2.2, 14);
      dune.position.set(i * DUNE_SPACING, -1.2, -34 - (i % 2) * 9);
      this.dunes.push(dune);
      this.group.add(dune);
    }

    // ------------------------------------------------------------- hitos
    const postGeo = new THREE.CylinderGeometry(0.055, 0.07, 1, 8);
    const postMat = new THREE.MeshStandardMaterial({
      color: MILESTONE_COLOR,
      roughness: 0.75,
      metalness: 0,
    });
    const plateGeo = new THREE.BoxGeometry(0.05, 0.34, 0.62);
    for (let i = 0; i < MILESTONE_POOL; i++) {
      const group = new THREE.Group();
      const post = new THREE.Mesh(postGeo, postMat);
      post.castShadow = true;
      const plate = new THREE.Mesh(plateGeo, postMat);
      plate.castShadow = true;
      const label = new THREE.Sprite(labelMaterial(100));
      label.scale.set(1.5, 0.75, 1);
      group.add(post, plate, label);
      group.visible = false;
      this.group.add(group);
      this.milestones.push({ group, post, plate, label, index: -1 });
    }

    // -------------------------------------------------------- bandera record
    const flagPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x6f5a4a, roughness: 0.8 }),
    );
    flagPost.position.y = 1.7;
    flagPost.castShadow = true;
    this.recordBanner = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.55, 1.05),
      new THREE.MeshStandardMaterial({ color: RECORD_COLOR, roughness: 0.6 }),
    );
    this.recordBanner.position.set(0, 3.05, 0.55);
    this.recordBanner.castShadow = true;
    this.recordGroup.add(flagPost, this.recordBanner);
    this.recordGroup.visible = false;
    this.group.add(this.recordGroup);
  }

  /** Planta la bandera del record anterior. `distance <= 0` la esconde. */
  setRecord(distance: number): void {
    this.recordDistance = distance;
    this.recordBeaten = false;
    this.recordGroup.visible = distance > 0;
    this.recordGroup.position.set(distance, 0, 1.4);
    (this.recordBanner.material as THREE.MeshStandardMaterial).color.setHex(RECORD_COLOR);
    this.recordBanner.scale.setScalar(1);
  }

  /** True (una sola vez) el cuadro en que el bicho pasa la bandera. */
  checkRecord(x: number): boolean {
    if (this.recordBeaten || this.recordDistance <= 0 || x < this.recordDistance) return false;
    this.recordBeaten = true;
    (this.recordBanner.material as THREE.MeshStandardMaterial).color.setHex(0xffffff);
    this.recordBanner.scale.set(1, 1.35, 1.35);
    return true;
  }

  recordPosition(): number {
    return this.recordDistance;
  }

  /** Recicla todo lo visual alrededor de `x`. */
  update(x: number): void {
    // Losas: cada una salta SEGMENT_COUNT lugares adelante cuando queda atras.
    const span = SEGMENT_LENGTH * SEGMENT_COUNT;
    for (const seg of this.segments) {
      while (seg.position.x < x - SEGMENT_LENGTH * 2) seg.position.x += span;
      while (seg.position.x > x + span - SEGMENT_LENGTH * 2) seg.position.x -= span;
    }

    const duneSpan = DUNE_SPACING * DUNE_COUNT;
    for (const dune of this.dunes) {
      while (dune.position.x < x - DUNE_SPACING) dune.position.x += duneSpan;
      while (dune.position.x > x + duneSpan - DUNE_SPACING) dune.position.x -= duneSpan;
    }

    // Hitos: se asignan por indice modulo el pool, asi que ninguno parpadea
    // mientras la ventana visible sea mas corta que el pool.
    const first = Math.max(1, Math.ceil((x - MILESTONE_BEHIND) / MILESTONE_EVERY));
    const last = Math.floor((x + MILESTONE_AHEAD) / MILESTONE_EVERY);
    const live = new Set<number>();
    for (let i = first; i <= last; i++) {
      live.add(i % MILESTONE_POOL);
      const slot = this.milestones[i % MILESTONE_POOL];
      if (slot.index !== i) this.buildMilestone(slot, i);
      slot.group.visible = true;
    }
    for (let s = 0; s < this.milestones.length; s++) {
      if (!live.has(s)) this.milestones[s].group.visible = false;
    }
  }

  private buildMilestone(slot: Milestone, index: number): void {
    const meters = index * MILESTONE_EVERY;
    slot.index = index;
    slot.group.position.set(meters, 0, 1.05);

    const major = meters % 100 === 0;
    const medium = !major && meters % 50 === 0;
    const height = major ? 2.6 : medium ? 1.5 : 0.62;

    slot.post.scale.set(1, height, 1);
    slot.post.position.y = height / 2;

    slot.plate.visible = major || medium;
    slot.plate.position.y = height - 0.24;
    slot.plate.scale.set(1, major ? 1 : 0.7, major ? 1 : 0.7);

    slot.label.visible = major;
    if (major) {
      slot.label.material = labelMaterial(meters);
      slot.label.position.set(0, height + 0.5, 0);
    }
  }
}
