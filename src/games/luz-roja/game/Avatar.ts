import * as THREE from "three";
import { SPEED, playerNumber, seatColor } from "./constants";
import {
  bloodTexture,
  faceTexture,
  nameTexture,
  shadowTexture,
  tracksuitBack,
  tracksuitFront,
  tracksuitPlain,
} from "./textures";

const SKINS = ["#e9b98f", "#c98e62", "#8d5a3b", "#f1c9a5"];
const HAIRS = ["#2b1f18", "#15110f", "#6b3f22", "#b58a4a"];

const LEG_H = 0.8;
const BODY_H = 0.72;
const HEAD = 0.44;
/** Duracion de la caida de espaldas. */
const FALL_TIME = 0.35;

let sharedShadow: THREE.CanvasTexture | null = null;

/**
 * Jugador en jogging verde con su numero (DESIGN.md: todos visten igual y el
 * numero es la identidad). El numero grande va en la espalda, que es lo que se ve
 * con la camara detras. El color del asiento aparece solo en la franja del cartel.
 *
 * El origen del grupo son los pies. `body` es el pivote de la caida: al quedar
 * eliminado gira hacia atras y queda tendido, con la mancha debajo.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  readonly number: string;
  private readonly body = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly label: THREE.Sprite | null = null;
  private readonly blood: THREE.Mesh;
  private phase = 0;
  /** Segundos desde la caida (-1 = en pie). */
  private fallT = -1;

  constructor(seat: number, name: string, showLabel: boolean) {
    this.number = playerNumber(name);
    const skin = SKINS[seat % SKINS.length];
    const hair = HAIRS[(seat * 3) % HAIRS.length];

    const plain = new THREE.MeshLambertMaterial({ map: tracksuitPlain(false) });
    const striped = new THREE.MeshLambertMaterial({ map: tracksuitPlain(true) });
    const front = new THREE.MeshLambertMaterial({ map: tracksuitFront(this.number) });
    const back = new THREE.MeshLambertMaterial({ map: tracksuitBack(this.number) });
    const skinMat = new THREE.MeshLambertMaterial({ color: skin });
    const hairMat = new THREE.MeshLambertMaterial({ color: hair });
    const shoe = new THREE.MeshLambertMaterial({ color: "#f2f2ee" });
    const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(skin, hair) });

    this.root.add(this.body);

    for (const [leg, side] of [
      [this.leftLeg, -1],
      [this.rightLeg, 1],
    ] as const) {
      const pants = new THREE.Mesh(new THREE.BoxGeometry(0.24, LEG_H - 0.12, 0.25), striped);
      pants.position.y = -(LEG_H - 0.12) / 2;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.34), shoe);
      foot.position.set(0, -LEG_H + 0.06, 0.04);
      leg.add(pants, foot);
      leg.position.set(side * 0.13, LEG_H, 0);
      this.body.add(leg);
    }

    // Torso: numero chico adelante (+Z), grande atras (-Z).
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, BODY_H, 0.28), [
      plain,
      plain,
      plain,
      plain,
      front,
      back,
    ]);
    torso.position.y = LEG_H + BODY_H / 2;
    this.body.add(torso);

    for (const [arm, side] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as const) {
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.55, 0.21), striped);
      sleeve.position.y = -0.27;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.16, 0.19), skinMat);
      hand.position.y = -0.62;
      arm.add(sleeve, hand);
      arm.position.set(side * 0.35, LEG_H + BODY_H - 0.05, 0);
      this.body.add(arm);
    }

    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD, HEAD, HEAD), [
      skinMat,
      skinMat,
      hairMat,
      skinMat,
      faceMat,
      hairMat,
    ]);
    head.position.y = LEG_H + BODY_H + HEAD / 2 + 0.02;
    this.body.add(head);

    if (showLabel) {
      const { texture, aspect } = nameTexture(`${this.number} ${name}`, seatColor(seat));
      this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
      this.label.renderOrder = 10;
      this.label.scale.set(0.36 * aspect, 0.36, 1);
      this.label.position.y = LEG_H + BODY_H + HEAD + 0.45;
      this.root.add(this.label);
    }

    // Mancha: hija del grupo (no del pivote), en el piso detras de los pies, que es
    // donde queda el torso al caer de espaldas.
    this.blood = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshLambertMaterial({ map: bloodTexture(seat), transparent: true, depthWrite: false }),
    );
    this.blood.rotation.x = -Math.PI / 2;
    this.blood.position.set(0, 0.015, -0.85);
    this.blood.visible = false;
    this.root.add(this.blood);

    sharedShadow ??= shadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: sharedShadow, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
  }

  get down(): boolean {
    return this.fallT >= 0;
  }

  /** Eliminado: cae de espaldas y aparece la mancha. */
  kill(): void {
    if (this.fallT >= 0) return;
    this.fallT = 0;
    this.blood.visible = true;
    this.blood.scale.setScalar(0.05);
    if (this.label) this.label.visible = false;
  }

  setOffline(offline: boolean): void {
    if (this.label) (this.label.material as THREE.SpriteMaterial).opacity = offline ? 0.35 : 1;
  }

  /** Ubica el grupo y su sombra. */
  place(x: number, z: number, yaw: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.shadow.position.set(x, 0.01, z);
  }

  animate(dt: number, speed: number): void {
    if (this.fallT >= 0) {
      this.fallT += dt;
      const f = Math.min(1, this.fallT / FALL_TIME);
      // Caida con un rebotecito al final.
      const ease = f < 1 ? f * f : 1;
      this.body.rotation.x = -(Math.PI / 2) * ease;
      this.body.position.y = f < 1 ? 0 : 0.14;
      this.blood.scale.setScalar(Math.min(1, 0.05 + this.fallT * 1.6));
      this.shadow.visible = false;
      for (const limb of [this.leftArm, this.rightArm]) limb.rotation.z *= 0.8;
      return;
    }
    const amount = Math.min(1, speed / SPEED);
    this.phase += dt * (5 + speed * 1.8);
    const swing = Math.sin(this.phase) * 0.9 * amount;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing;
    this.rightArm.rotation.x = swing;
  }
}
