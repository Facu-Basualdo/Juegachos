import * as THREE from "three";
import { SPEED, seatColor } from "./constants";
import { clothTexture, faceTexture, nameTexture, shadowTexture } from "./textures";

/** Pieles y pelos neutros (DESIGN.md: la remera es el unico color personal). */
const SKINS = ["#e9b98f", "#c98e62", "#8d5a3b", "#f1c9a5"];
const HAIRS = ["#3b2a1e", "#1f1a17", "#7a4b28", "#c9a255"];
const PANTS = "#34406a";

const LEG_H = 0.72;
const BODY_H = 0.72;
const HEAD = 0.46;

let sharedShadow: THREE.CanvasTexture | null = null;

/**
 * Muñeco de bloques: cabeza, torso, dos brazos y dos piernas, todos prismas con
 * textura pixelada. Brazos y piernas cuelgan de un pivote en el hombro / la cadera
 * para balancearse al correr. El origen del grupo son los pies.
 *
 * La sombra de contacto va aparte (`shadow`), agregada directo a la escena: la
 * posiciona el juego sobre el primer bloque que haya debajo, porque es lo que dice
 * donde vas a caer.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly label: THREE.Sprite | null = null;
  private phase = 0;

  constructor(seat: number, name: string | null) {
    const shirt = seatColor(seat);
    const skin = SKINS[seat % SKINS.length];
    const hair = HAIRS[(seat * 3) % HAIRS.length];

    const shirtMat = new THREE.MeshLambertMaterial({ map: clothTexture(shirt, 11 + seat) });
    const skinMat = new THREE.MeshLambertMaterial({ map: clothTexture(skin, 31 + seat) });
    const pantsMat = new THREE.MeshLambertMaterial({ map: clothTexture(PANTS, 51 + seat) });
    const hairMat = new THREE.MeshLambertMaterial({ map: clothTexture(hair, 71 + seat) });
    const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(skin, hair) });

    // Piernas: pivote en la cadera.
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

    // Brazos: pivote en el hombro. La manga es de la remera y la mano de piel.
    for (const [arm, side] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as const) {
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.22), shirtMat);
      sleeve.position.y = -0.21;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.28, 0.21), skinMat);
      hand.position.y = -0.56;
      arm.add(sleeve, hand);
      arm.position.set(side * 0.35, LEG_H + BODY_H - 0.04, 0);
      this.root.add(arm);
    }

    // Cabeza: la cara en la cara +Z (hacia donde mira), pelo arriba y atras.
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

    if (name) {
      const { texture, aspect } = nameTexture(name, shirt);
      this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
      this.label.renderOrder = 10;
      this.label.scale.set(0.42 * aspect, 0.42, 1);
      this.label.position.y = LEG_H + BODY_H + HEAD + 0.5;
      this.root.add(this.label);
    }

    sharedShadow ??= shadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: sharedShadow, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
  }

  set visible(v: boolean) {
    this.root.visible = v;
    if (!v) this.shadow.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** Atenua el cartel del que se desconecto. */
  setOffline(offline: boolean): void {
    if (this.label) (this.label.material as THREE.SpriteMaterial).opacity = offline ? 0.35 : 1;
  }

  /**
   * Animacion por procedimiento: al correr brazos y piernas se balancean en
   * oposicion, en el aire se abren, y cayendo rapido los brazos van arriba.
   */
  animate(dt: number, speed: number, grounded: boolean, vy: number): void {
    const amount = Math.min(1, speed / SPEED);
    if (grounded) {
      this.phase += dt * (6 + speed * 1.6);
      const swing = Math.sin(this.phase) * 0.85 * amount;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing;
      this.rightArm.rotation.x = swing;
      this.leftArm.rotation.z = 0;
      this.rightArm.rotation.z = 0;
      return;
    }
    const falling = vy < -9;
    const k = Math.min(1, dt * 12);
    const armZ = falling ? 2.6 : 0.5;
    this.leftArm.rotation.z += (-armZ - this.leftArm.rotation.z) * k;
    this.rightArm.rotation.z += (armZ - this.rightArm.rotation.z) * k;
    const flail = falling ? Math.sin(performance.now() / 60) * 0.4 : 0;
    this.leftArm.rotation.x += (flail - this.leftArm.rotation.x) * k;
    this.rightArm.rotation.x += (-flail - this.rightArm.rotation.x) * k;
    this.leftLeg.rotation.x += (0.45 - this.leftLeg.rotation.x) * k;
    this.rightLeg.rotation.x += (-0.3 - this.rightLeg.rotation.x) * k;
  }
}
