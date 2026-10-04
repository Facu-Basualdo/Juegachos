import * as THREE from "three";
import type { DollLook } from "./Doll";

/**
 * Teseo en 3D: el muñeco de bloques de Marea de Lava (mismas medidas, mismas texturas
 * pixeladas de 8x8), con la antorcha en la mano. El laberinto sigue siendo canvas 2D;
 * cada muñeco se renderiza con Three.js en un canvas WebGL chico fuera de pantalla y
 * se estampa sobre el tablero con `drawImage`, despues de la oscuridad. Asi el juego no
 * cambia de motor y el muñeco tiene volumen, gira de verdad y lo alumbra su antorcha.
 *
 * Copiado (no importado) de Marea de Lava por la regla de desacople del repo.
 */

const LEG_H = 0.72;
const BODY_H = 0.72;
const HEAD = 0.46;
const PANTS = "#4a5a92";

/**
 * Unidades de mundo por celda. Con la camara inclinada el alto se ve multiplicado por
 * cos(ELEVATION): el muñeco (1.9 de alto) queda en ~3/4 de celda en pantalla.
 */
const WORLD_PER_CELL = 1.95;
/** Caja del sprite en celdas (la antorcha levantada asoma por arriba de la cabeza). */
const SPRITE_W = 1.5;
const SPRITE_H = 1.9;
/** Elevacion de la camara: tres cuartos desde arriba, como se ve el laberinto. */
const ELEVATION = (60 * Math.PI) / 180;
/** Punto al que mira la camara (altura del pecho), que queda en el centro del sprite. */
const AIM_Y = 1.05;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return [canvas, canvas.getContext("2d")!];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Textura lisa de un color con un grano minimo (torso, brazos, piernas). */
function clothTexture(base: string, seed: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(8);
  const r = rng(seed);
  const color = new THREE.Color(base);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = `#${color.clone().multiplyScalar(0.9 + r() * 0.14).getHexString()}`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas);
}

/** Cara del muñeco (8x8): piel, pelo arriba, ojos y boca. */
function faceTexture(skin: string, hair: string): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(8);
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = hair;
  ctx.fillRect(0, 0, 8, 2);
  ctx.fillRect(0, 2, 1, 1);
  ctx.fillRect(7, 2, 1, 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(1, 4, 2, 1);
  ctx.fillRect(5, 4, 2, 1);
  ctx.fillStyle = "#2a2a4a";
  ctx.fillRect(2, 4, 1, 1);
  ctx.fillRect(5, 4, 1, 1);
  ctx.fillStyle = "rgba(90,40,30,0.75)";
  ctx.fillRect(3, 6, 2, 1);
  return toTexture(canvas);
}

/** Un muñeco armado: brazos y piernas cuelgan de pivotes para balancearse. */
class Puppet {
  readonly root = new THREE.Group();
  readonly freeArm = new THREE.Group();
  readonly torchArm = new THREE.Group();
  readonly leftLeg = new THREE.Group();
  readonly rightLeg = new THREE.Group();
  /** Punta de la antorcha (de ahi salen la llama 2D y la luz). */
  readonly tip = new THREE.Object3D();
  private readonly torch = new THREE.Group();

  constructor(look: DollLook, seed: number) {
    const shirtMat = new THREE.MeshLambertMaterial({ map: clothTexture(look.shirt, 11 + seed) });
    const skinMat = new THREE.MeshLambertMaterial({ map: clothTexture(look.skin, 31 + seed) });
    const pantsMat = new THREE.MeshLambertMaterial({ map: clothTexture(PANTS, 51 + seed) });
    const hairMat = new THREE.MeshLambertMaterial({ map: clothTexture(look.hair, 71 + seed) });
    const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(look.skin, look.hair) });

    for (const [leg, side] of [
      [this.leftLeg, -1],
      [this.rightLeg, 1],
    ] as const) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.23, LEG_H, 0.24), pantsMat);
      mesh.position.y = -LEG_H / 2;
      leg.add(mesh);
      leg.position.set(side * 0.12, LEG_H, 0);
      this.root.add(leg);
    }

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, BODY_H, 0.26), shirtMat);
    body.position.y = LEG_H + BODY_H / 2;
    this.root.add(body);

    // Brazos: la antorcha va en el de -x (la mano derecha, mirando a +z).
    for (const [arm, side] of [
      [this.torchArm, -1],
      [this.freeArm, 1],
    ] as const) {
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.22), shirtMat);
      sleeve.position.y = -0.21;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.28, 0.21), skinMat);
      hand.position.y = -0.56;
      arm.add(sleeve, hand);
      arm.position.set(side * 0.35, LEG_H + BODY_H - 0.04, 0);
      this.root.add(arm);
    }

    // Antorcha: palo de madera con la cabeza de tela engrasada, parada en la mano.
    const stick = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.78, 0.08),
      new THREE.MeshLambertMaterial({ color: "#6b3f1f" }),
    );
    stick.position.y = 0.22;
    const wrap = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.18, 0.14),
      new THREE.MeshLambertMaterial({ color: "#3a2414", emissive: "#7a2a08", emissiveIntensity: 0.6 }),
    );
    wrap.position.y = 0.58;
    this.tip.position.y = 0.72;
    this.torch.add(stick, wrap, this.tip);
    this.torch.position.y = -0.6;
    this.torchArm.add(this.torch);

    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD, HEAD, HEAD), [
      skinMat,
      skinMat,
      hairMat,
      skinMat,
      faceMat,
      hairMat,
    ]);
    head.position.y = LEG_H + BODY_H + HEAD / 2 + 0.01;
    this.root.add(head);
  }

  /** Pose del cuadro: el brazo de la antorcha va levantado adelante y la antorcha, parada. */
  pose(yaw: number, phase: number, stride: number, time: number): void {
    this.root.rotation.y = yaw;
    const swing = Math.sin(phase) * 0.28 * stride;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.freeArm.rotation.x = -swing;
    this.freeArm.rotation.z = 0.08;
    const raise = -2.6 + Math.sin(phase * 2) * 0.06 * stride + Math.sin(time * 2.1) * 0.03;
    this.torchArm.rotation.x = raise;
    this.torchArm.rotation.z = -0.12;
    this.torch.rotation.x = -raise;
    this.torch.rotation.z = 0.12;
    // Rebote del paso y respiracion quieto.
    this.root.position.y = Math.abs(Math.sin(phase)) * 0.06 * stride + Math.sin(time * 2.2) * 0.008 * (1 - stride);
  }
}

export interface Doll3DPose {
  yaw: number;
  phase: number;
  stride: number;
  time: number;
}

/**
 * El escenario de los muñecos: un solo `WebGLRenderer` chico, una camara ortografica
 * fija en tres cuartos y un muñeco por jugador. `draw` renderiza uno, lo estampa en el
 * canvas del juego y devuelve la punta de la antorcha en px.
 *
 * Tira si el navegador no tiene WebGL: el `Renderer` cae al muñeco 2D (`Doll.ts`).
 */
export class DollStage {
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly torchLight = new THREE.PointLight("#ffb062", 5, 7, 1.2);
  private readonly puppets = new Map<string, Puppet>();
  private readonly v = new THREE.Vector3();
  private cssW = 0;
  private cssH = 0;
  private cell = 0;
  private dpr = 0;
  /** Donde caen los pies dentro del sprite (px CSS). */
  private foot = { x: 0, y: 0 };

  constructor() {
    this.gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.gl.setClearColor(0x000000, 0);
    const w = (SPRITE_W * WORLD_PER_CELL) / 2;
    const h = (SPRITE_H * WORLD_PER_CELL) / 2;
    this.camera = new THREE.OrthographicCamera(-w, w, h, -h, 0.1, 40);
    this.camera.position.set(0, AIM_Y + Math.sin(ELEVATION) * 12, Math.cos(ELEVATION) * 12);
    this.camera.lookAt(0, AIM_Y, 0);
    this.camera.updateMatrixWorld();
    // La piedra devuelve algo de la luz calida; desde abajo, casi nada.
    this.scene.add(new THREE.HemisphereLight("#ffd6a8", "#7a5232", 1.35));
    this.scene.add(this.torchLight);
  }

  private resize(cell: number, dpr: number): void {
    if (cell === this.cell && dpr === this.dpr) return;
    this.cell = cell;
    this.dpr = dpr;
    this.cssW = Math.max(8, Math.round(cell * SPRITE_W));
    this.cssH = Math.max(8, Math.round(cell * SPRITE_H));
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(this.cssW, this.cssH, false);
    this.foot = this.toSprite(this.v.set(0, 0, 0));
  }

  private toSprite(p: THREE.Vector3): { x: number; y: number } {
    p.project(this.camera);
    return { x: ((p.x + 1) / 2) * this.cssW, y: ((1 - p.y) / 2) * this.cssH };
  }

  private puppet(key: string, look: DollLook): Puppet {
    const id = `${key}|${look.shirt}`;
    let p = this.puppets.get(id);
    if (!p) {
      p = new Puppet(look, this.puppets.size * 7);
      this.puppets.set(id, p);
      this.scene.add(p.root);
    }
    return p;
  }

  /**
   * Dibuja el muñeco `key` con los pies en (x, y) px del canvas del juego. `cell` es el
   * tamano de celda en px CSS. Devuelve la punta de la antorcha en px.
   */
  draw(ctx: CanvasRenderingContext2D, key: string, look: DollLook, x: number, y: number, cell: number, dpr: number, pose: Doll3DPose): { x: number; y: number } {
    this.resize(cell, dpr);
    const active = this.puppet(key, look);
    for (const p of this.puppets.values()) p.root.visible = p === active;
    active.pose(pose.yaw, pose.phase, pose.stride, pose.time);
    active.root.updateMatrixWorld(true);
    active.tip.getWorldPosition(this.v);
    this.torchLight.position.copy(this.v);
    this.torchLight.intensity = 4.6 + Math.sin(pose.time * 13.1) * 0.35 + Math.sin(pose.time * 7.3) * 0.25;
    this.gl.render(this.scene, this.camera);
    const ox = x - this.foot.x;
    const oy = y - this.foot.y;
    ctx.drawImage(this.gl.domElement, ox, oy, this.cssW, this.cssH);
    const tip = this.toSprite(this.v);
    return { x: ox + tip.x, y: oy + tip.y };
  }
}
