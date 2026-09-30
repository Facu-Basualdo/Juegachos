import * as THREE from "three";
import { EMOTE_MS, SPEED, type EmoteId } from "./constants";
import { LABEL_LAYER, psxBasic, psxLambert } from "./retro";
import { clothTexture, emoteFaceTexture, labelSprite, nameTexture, shadowTexture } from "./textures";
import { makeCrown } from "./Tower";

const BURLAP = "#8a7a5e";
const PANTS = "#2e2a26";

const BODY_Y = 0.78;
const HEAD_Y = 1.5;
const LABEL_Y = 2.3;

/**
 * Medidas de la cabeza (un icosaedro de radio HEAD_R estirado HEAD_SY en alto). Los
 * accesorios se calculan contra esto: la primera version los ponia mas chicos o mas
 * abajo que la cabeza y la atravesaban.
 */
const HEAD_R = 0.34;
const HEAD_SY = 1.08;
const HEAD_TOP = HEAD_R * HEAD_SY;
/** Altura de los ojos de boton (sobre el centro de la cabeza). */
const EYE_Y = 0.05;

/** Radio de la cabeza a la altura `y` (sobre su centro), con un margen para las facetas. */
function headRadiusAt(y: number): number {
  const k = y / HEAD_SY;
  return Math.sqrt(Math.max(0, HEAD_R * HEAD_R - k * k)) + 0.015;
}

let sharedShadow: THREE.CanvasTexture | null = null;

/**
 * Muñeco de trapo de La Feria (DESIGN.md): cuerpo de bolsa cosida con la remera del
 * color del asiento, cabeza de arpillera con dos ojos de boton y la boca cosida, manos
 * que flotan y dos pies. (Tuvo una mascara palida; el programador la saco.) El que tiene el record de la torre lleva la
 * corona, lo unico que brilla limpio. El origen del grupo son los pies y mira a +Z.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  private readonly rig = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly leftHand: THREE.Mesh;
  private readonly rightHand: THREE.Mesh;
  private readonly leftFoot: THREE.Mesh;
  private readonly rightFoot: THREE.Mesh;
  private readonly label: THREE.Sprite | null = null;
  private readonly crown: THREE.Group;
  private hat: THREE.Object3D | null = null;
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  /** Reaccion en curso (el gesto del cuerpo) y cuando arranco. */
  private emote: EmoteId | null = null;
  private emoteAt = 0;
  private phase = 0;
  private idle = Math.random() * 10;

  constructor(color: string, name: string | null, look: number, seed: number) {
    const shirt = psxLambert({ map: clothTexture(color, 7) });
    const burlap = psxLambert({ map: clothTexture(BURLAP, 9) });
    const pants = psxLambert({ color: PANTS });

    this.root.add(this.rig);

    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), shirt);
    body.scale.set(1, 1.15, 0.85);
    body.position.y = BODY_Y;
    this.rig.add(body);

    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y;
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(HEAD_R, 1), burlap);
    skull.scale.set(1, HEAD_SY, 1);
    this.head.add(skull);
    // Ojos de boton (uno apenas mas grande, segun la semilla: cosidos a mano).
    const button = psxBasic({ color: "#0e0c0b" });
    const thread = psxBasic({ color: "#6b5a44" });
    for (const side of [-1, 1]) {
      const r = side === 1 && seed % 2 === 0 ? 0.07 : 0.058;
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 8), button);
      eye.rotation.x = Math.PI / 2;
      eye.position.set(side * 0.12, EYE_Y, headRadiusAt(EYE_Y) + 0.005);
      const hole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), thread);
      hole.position.set(side * 0.12, EYE_Y, headRadiusAt(EYE_Y) + 0.022);
      hole.rotation.z = side * 0.6;
      this.head.add(eye, hole);
    }
    // Boca cosida: una linea con puntadas.
    const mouthZ = headRadiusAt(-0.12) - 0.005;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.012), thread);
    mouth.position.set(0, -0.12, mouthZ);
    this.head.add(mouth);
    for (let k = -2; k <= 2; k++) {
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), thread);
      stitch.position.set(k * 0.04, -0.12, mouthZ + 0.004);
      this.head.add(stitch);
    }
    this.rig.add(this.head);

    const handGeo = new THREE.IcosahedronGeometry(0.11, 0);
    this.leftHand = new THREE.Mesh(handGeo, burlap);
    this.rightHand = new THREE.Mesh(handGeo, burlap);
    this.rig.add(this.leftHand, this.rightHand);

    const footGeo = new THREE.IcosahedronGeometry(0.14, 0);
    this.leftFoot = new THREE.Mesh(footGeo, pants);
    this.rightFoot = new THREE.Mesh(footGeo, pants);
    for (const foot of [this.leftFoot, this.rightFoot]) foot.scale.set(1, 0.6, 1.4);
    this.rig.add(this.leftFoot, this.rightFoot);

    this.crown = makeCrown(0.9);
    this.crown.position.y = HEAD_TOP + 0.06;
    this.crown.visible = false;
    this.head.add(this.crown);

    this.setLook(look, color);

    if (name) {
      this.label = labelSprite(nameTexture(name, color), 0.3);
      this.label.position.y = LABEL_Y;
      this.root.add(this.label);
    }

    sharedShadow ??= shadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.0),
      new THREE.MeshBasicMaterial({ map: sharedShadow, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;

    this.animate(0, 0, true, 0);
  }

  /**
   * Accesorio (ver LOOKS en constants.ts). La corona lo tapa mientras la tenga. Todos
   * se apoyan SOBRE la cabeza: se miden con `HEAD_TOP` / `headRadiusAt`, nunca a ojo.
   */
  setLook(look: number, color: string): void {
    if (this.hat) {
      this.head.remove(this.hat);
      this.hat = null;
    }
    const cloth = psxLambert({ map: clothTexture(new THREE.Color(color).multiplyScalar(0.55).getStyle(), 13) });
    const felt = psxLambert({ color: "#1c1917" });
    let hat: THREE.Object3D | null = null;
    if (look === 1) {
      // Gorra: una copa un poco mas ancha que la cabeza, y la visera adelante. Arranca
      // arriba de los ojos (EYE_Y + su radio): mas abajo les pasaba el borde por encima.
      const g = new THREE.Group();
      const baseY = EYE_Y + 0.1;
      const r = headRadiusAt(baseY) + 0.02;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
      dome.scale.y = (HEAD_TOP - baseY + 0.04) / r;
      dome.position.y = baseY;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8, 1, false, -Math.PI / 2, Math.PI), cloth);
      brim.position.set(0, baseY + 0.005, r - 0.06);
      brim.rotation.x = 0.08;
      g.add(dome, brim);
      hat = g;
    } else if (look === 2) {
      // Gorro de fiesta: el cono apoya su base en la coronilla (pivote en la base).
      const g = new THREE.Group();
      g.position.y = HEAD_TOP - 0.05;
      g.rotation.z = -0.22;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 6), cloth);
      cone.position.y = 0.21;
      const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), psxLambert({ color: "#cfc6b4" }));
      pom.position.y = 0.44;
      g.add(cone, pom);
      hat = g;
    } else if (look === 3) {
      // Vincha: aro por fuera de la frente.
      const y = 0.12;
      const band = new THREE.Mesh(new THREE.TorusGeometry(headRadiusAt(y) + 0.03, 0.035, 4, 12), cloth);
      band.rotation.x = Math.PI / 2 - 0.2;
      band.position.y = y;
      hat = band;
    } else if (look === 4) {
      // Galera: ala ancha apoyada donde la cabeza ya se afina, y la copa alta.
      const g = new THREE.Group();
      const y = HEAD_TOP - 0.1;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 10), felt);
      brim.position.y = y;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.44, 10), felt);
      top.position.y = y + 0.23;
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.07, 10), cloth);
      ribbon.position.y = y + 0.06;
      g.add(brim, top, ribbon);
      g.rotation.z = 0.08;
      hat = g;
    }
    if (hat) {
      this.hat = hat;
      hat.visible = !this.crown.visible;
      this.head.add(hat);
    }
  }

  /** El record de la torre: lleva la corona puesta. */
  setCrown(on: boolean): void {
    this.crown.visible = on;
    if (this.hat) this.hat.visible = !on;
  }

  set visible(v: boolean) {
    this.root.visible = v;
    this.shadow.visible = v;
  }

  /** Atenua el nombre del que se desconecto de la sala. */
  setOffline(offline: boolean): void {
    if (this.label) this.label.material.opacity = offline ? 0.35 : 1;
  }

  /** Reaccion: la carita flota sobre la cabeza y el muñeco hace su gesto. */
  showEmote(id: EmoteId): void {
    if (!this.bubble) {
      this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      this.bubble.renderOrder = 11;
      this.bubble.layers.set(LABEL_LAYER);
      this.bubble.scale.set(0.55, 0.55, 1);
      this.root.add(this.bubble);
    }
    this.bubble.material.map = emoteFaceTexture(id);
    this.bubble.material.needsUpdate = true;
    this.bubble.visible = true;
    this.bubble.position.y = LABEL_Y + 0.5;
    this.bubbleUntil = performance.now() + EMOTE_MS;
    this.emote = id;
    this.emoteAt = performance.now();
  }

  /**
   * Gesto de la reaccion, encima de la animacion de caminar: se sacude de risa, salta
   * de sorpresa, tiembla de enojo, cabecea burlandose o baja la cabeza con las manos en
   * la cara si llora. Devuelve true mientras dura (las manos quedan a cargo del gesto).
   */
  private applyEmote(k: number): boolean {
    if (!this.emote) return false;
    const t = (performance.now() - this.emoteAt) / 1000;
    const life = EMOTE_MS / 1000;
    if (t > life) {
      this.emote = null;
      this.head.rotation.set(0, 0, 0);
      return false;
    }
    const fade = Math.min(1, (life - t) * 4);
    switch (this.emote) {
      case "risa":
        this.rig.position.y += Math.abs(Math.sin(t * 22)) * 0.06 * fade;
        this.head.rotation.x = -0.3 * fade;
        this.setHand(this.leftHand, -0.42, 0.72, 0.25, k);
        this.setHand(this.rightHand, 0.42, 0.72, 0.25, k);
        return true;
      case "sorpresa": {
        const jump = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) * 0.35 : 0;
        this.rig.position.y += jump;
        this.head.rotation.x = -0.15 * fade;
        this.setHand(this.leftHand, -0.3, 1.55, 0.25, k);
        this.setHand(this.rightHand, 0.3, 1.55, 0.25, k);
        return true;
      }
      case "enojo":
        this.rig.position.x = Math.sin(t * 60) * 0.03 * fade;
        this.head.rotation.x = 0.15 * fade;
        this.setHand(this.leftHand, -0.35, 0.95, 0.35, k);
        this.setHand(this.rightHand, 0.35, 0.95, 0.35, k);
        return true;
      case "burla":
        this.head.rotation.z = Math.sin(t * 10) * 0.35 * fade;
        this.setHand(this.leftHand, -0.62, 0.9 + Math.sin(t * 10) * 0.1, 0, k);
        this.setHand(this.rightHand, 0.18, 1.45, 0.34, k);
        return true;
      case "llanto":
        this.head.rotation.x = 0.4 * fade;
        this.rig.position.y += Math.sin(t * 14) * 0.015;
        this.setHand(this.leftHand, -0.14, 1.42, 0.34, k);
        this.setHand(this.rightHand, 0.14, 1.42, 0.34, k);
        return true;
    }
    return false;
  }

  /**
   * Animacion por procedimiento: caminando, pies que van y vienen y manos al reves;
   * quieto, respira (y la cabeza se ladea apenas, como un muñeco mal cosido); en el
   * aire, manos arriba.
   */
  animate(dt: number, speed: number, grounded: boolean, vy: number): void {
    const amount = Math.min(1, speed / SPEED);
    this.idle += dt;
    const k = Math.min(1, dt * 12);
    this.crown.rotation.y += dt * 0.8;

    if (grounded) {
      this.phase += dt * (5 + speed * 1.7);
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      const bob = Math.abs(c) * 0.07 * amount + Math.sin(this.idle * 2) * 0.015 * (1 - amount);
      this.rig.position.y = bob;
      this.rig.rotation.x = 0.08 * amount;
      this.head.rotation.z = Math.sin(this.idle * 0.7) * 0.12 * (1 - amount);
      this.leftFoot.position.set(-0.16, 0.08 + Math.max(0, s) * 0.12 * amount, s * 0.24 * amount);
      this.rightFoot.position.set(0.16, 0.08 + Math.max(0, -s) * 0.12 * amount, -s * 0.24 * amount);
      this.setHand(this.leftHand, -0.52, 0.76 + bob, -s * 0.28 * amount, k);
      this.setHand(this.rightHand, 0.52, 0.76 + bob, s * 0.28 * amount, k);
    } else {
      this.rig.position.y += (0 - this.rig.position.y) * k;
      const lean = vy < 0 ? -0.1 : 0.05;
      this.rig.rotation.x += (lean - this.rig.rotation.x) * k;
      this.leftFoot.position.set(-0.16, 0.15, 0.1);
      this.rightFoot.position.set(0.16, 0.11, -0.08);
      this.setHand(this.leftHand, -0.6, 1.42, 0, k);
      this.setHand(this.rightHand, 0.6, 1.42, 0, k);
    }

    this.rig.position.x = 0;
    this.applyEmote(k);
    if (this.bubble?.visible) {
      // La carita sube apenas y se va.
      const left = this.bubbleUntil - performance.now();
      this.bubble.position.y = LABEL_Y + 0.5 + (1 - Math.max(0, left) / EMOTE_MS) * 0.25;
      if (left <= 0) this.bubble.visible = false;
    }
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
