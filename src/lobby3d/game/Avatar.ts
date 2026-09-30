import * as THREE from "three";
import { EMOTE_MS, SPEED } from "./constants";
import { bubbleTexture, labelSprite, nameTexture, setSpriteLabel, shadowTexture } from "./textures";

/** Pieles neutras (DESIGN.md: la remera es la unica marca personal). */
const SKINS = ["#f1c9a5", "#e0ac84", "#c68b62", "#8d5a3b"];
const PANTS = "#3d4f73";

const BODY_Y = 0.78;
const HEAD_Y = 1.5;
const LABEL_Y = 2.35;

let sharedShadow: THREE.CanvasTexture | null = null;

function mat(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/**
 * Muñeco low poly de la Isla: cuerpo de poroto, cabeza grande, manos que flotan
 * sin brazos y dos pies. Todo icosaedros de pocas caras con `flatShading`, asi
 * la luz lo facetea (DESIGN.md, "Facetas al Sol"). El origen del grupo son los
 * pies y mira hacia +Z.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  private readonly rig = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head: THREE.Group;
  private readonly leftHand: THREE.Mesh;
  private readonly rightHand: THREE.Mesh;
  private readonly leftFoot: THREE.Mesh;
  private readonly rightFoot: THREE.Mesh;
  private readonly label: THREE.Sprite | null = null;
  private hat: THREE.Object3D | null = null;
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  private phase = 0;
  private idle = Math.random() * 10;

  constructor(color: string, name: string | null, look: number, skinSeed: number) {
    const skin = SKINS[((skinSeed % SKINS.length) + SKINS.length) % SKINS.length];
    const shirtMat = mat(color);
    const skinMat = mat(skin);
    const pantsMat = mat(PANTS);

    this.root.add(this.rig);

    this.body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), shirtMat);
    this.body.scale.set(1, 1.12, 0.88);
    this.body.position.y = BODY_Y;
    this.rig.add(this.body);

    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y;
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.37, 1), skinMat);
    this.head.add(skull);
    const eyeMat = new THREE.MeshBasicMaterial({ color: "#1d2733" });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.05), eyeMat);
      eye.position.set(side * 0.12, 0.04, 0.33);
      this.head.add(eye);
    }
    this.rig.add(this.head);

    const handGeo = new THREE.IcosahedronGeometry(0.12, 0);
    this.leftHand = new THREE.Mesh(handGeo, skinMat);
    this.rightHand = new THREE.Mesh(handGeo, skinMat);
    this.rig.add(this.leftHand, this.rightHand);

    const footGeo = new THREE.IcosahedronGeometry(0.15, 0);
    this.leftFoot = new THREE.Mesh(footGeo, pantsMat);
    this.rightFoot = new THREE.Mesh(footGeo, pantsMat);
    for (const foot of [this.leftFoot, this.rightFoot]) foot.scale.set(1, 0.6, 1.4);
    this.rig.add(this.leftFoot, this.rightFoot);

    this.setLook(look, color);

    if (name) {
      this.label = labelSprite(nameTexture(name, color), 0.36);
      this.label.position.y = LABEL_Y;
      this.root.add(this.label);
    }

    sharedShadow ??= shadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: sharedShadow, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;

    this.animate(0, 0, true, 0);
  }

  /** Accesorio (ver LOOKS en constants.ts). */
  setLook(look: number, color: string): void {
    if (this.hat) {
      this.head.remove(this.hat);
      this.hat = null;
    }
    const accent = new THREE.Color(color).offsetHSL(0, -0.1, -0.18).getStyle();
    let hat: THREE.Object3D | null = null;
    if (look === 1) {
      // Gorra: copa baja + visera hacia adelante.
      const g = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.36, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(accent));
      crown.position.y = 0.1;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 7, 1, false, -Math.PI / 2, Math.PI), mat(accent));
      brim.position.set(0, 0.12, 0.3);
      g.add(crown, brim);
      hat = g;
    } else if (look === 2) {
      // Gorro de fiesta: cono con pompon.
      const g = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), mat("#ffd43b"));
      cone.position.y = 0.5;
      cone.rotation.z = -0.15;
      const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(accent));
      pom.position.set(0.04, 0.77, 0);
      g.add(cone, pom);
      hat = g;
    } else if (look === 3) {
      // Vincha: aro fino alrededor de la frente.
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 4, 10), mat(accent));
      band.rotation.x = Math.PI / 2 - 0.25;
      band.position.y = 0.12;
      hat = band;
    }
    if (hat) {
      this.hat = hat;
      this.head.add(hat);
    }
  }

  set visible(v: boolean) {
    this.root.visible = v;
    this.shadow.visible = v;
  }

  /** Atenua el nombre del que se desconecto de la sala. */
  setOffline(offline: boolean): void {
    if (this.label) this.label.material.opacity = offline ? 0.35 : 1;
  }

  /** Globo con una reaccion sobre la cabeza. */
  showEmote(text: string): void {
    const label = bubbleTexture(text);
    if (!this.bubble) {
      this.bubble = labelSprite(label, 0.62);
      this.root.add(this.bubble);
    } else {
      setSpriteLabel(this.bubble, label, 0.62);
    }
    this.bubble.visible = true;
    this.bubble.position.y = LABEL_Y + 0.6;
    this.bubbleUntil = performance.now() + EMOTE_MS;
  }

  /**
   * Animacion por procedimiento: caminando, los pies van y vienen, las manos se
   * balancean al reves y el cuerpo rebota; quieto, respira; en el aire, manos
   * arriba.
   */
  animate(dt: number, speed: number, grounded: boolean, vy: number): void {
    const amount = Math.min(1, speed / SPEED);
    this.idle += dt;
    const k = Math.min(1, dt * 12);

    if (grounded) {
      this.phase += dt * (5 + speed * 1.7);
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      const bob = Math.abs(c) * 0.08 * amount + Math.sin(this.idle * 2) * 0.015 * (1 - amount);
      this.rig.position.y = bob;
      this.rig.rotation.x = 0.08 * amount;
      this.leftFoot.position.set(-0.17, 0.09 + Math.max(0, s) * 0.12 * amount, s * 0.24 * amount);
      this.rightFoot.position.set(0.17, 0.09 + Math.max(0, -s) * 0.12 * amount, -s * 0.24 * amount);
      this.setHand(this.leftHand, -0.55, 0.78 + bob, -s * 0.28 * amount, k);
      this.setHand(this.rightHand, 0.55, 0.78 + bob, s * 0.28 * amount, k);
    } else {
      this.rig.position.y += (0 - this.rig.position.y) * k;
      const lean = vy < 0 ? -0.1 : 0.05;
      this.rig.rotation.x += (lean - this.rig.rotation.x) * k;
      this.leftFoot.position.set(-0.17, 0.16, 0.1);
      this.rightFoot.position.set(0.17, 0.12, -0.08);
      this.setHand(this.leftHand, -0.62, 1.45, 0, k);
      this.setHand(this.rightHand, 0.62, 1.45, 0, k);
    }

    if (this.bubble?.visible && performance.now() > this.bubbleUntil) this.bubble.visible = false;
  }

  private setHand(hand: THREE.Mesh, x: number, y: number, z: number, k: number): void {
    hand.position.x += (x - hand.position.x) * k;
    hand.position.y += (y - hand.position.y) * k;
    hand.position.z += (z - hand.position.z) * k;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
      } else if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
