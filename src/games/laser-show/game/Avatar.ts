import * as THREE from "three";
import { SPEED, seatColor } from "./constants";
import { nameTexture, shadowTexture, visorTexture } from "./textures";

/** Duracion de la animacion del empujon, en s. */
const PUSH_ANIM = 0.32;
/** Alto de la capsula del cuerpo (sin las patitas). */
const BODY_LEN = 0.7;
const BODY_RAD = 0.32;
const LEG_H = 0.22;

let sharedShadow: THREE.CanvasTexture | null = null;
let sharedVisor: THREE.CanvasTexture | null = null;

/**
 * Concursante de juguete brillante (DESIGN.md "Prime Time"): cuerpo de capsula del
 * color del asiento, visor con dos ojos, bracitos y patitas. El origen del grupo son
 * los pies. Agacharse lo aplasta como un resorte (`rig.scale`), y eso tiene que leerse
 * desde la camara lejana.
 *
 * La sombra de contacto va aparte (`shadow`), agregada directo a la escena.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly shadow: THREE.Mesh;
  /** Todo lo que se aplasta al agacharse (el cartel del nombre no). */
  private readonly rig = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly label: THREE.Sprite | null = null;
  private phase = 0;
  private pushT = 0;

  constructor(seat: number, name: string | null) {
    const color = seatColor(seat);
    const shell = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: "#ffffff" });
    const dark = new THREE.MeshPhongMaterial({ color: "#2b2650", shininess: 40 });
    sharedVisor ??= visorTexture();

    for (const [leg, side] of [
      [this.leftLeg, -1],
      [this.rightLeg, 1],
    ] as const) {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.14, 4, 8), dark);
      mesh.position.y = -0.09;
      leg.add(mesh);
      leg.position.set(side * 0.13, LEG_H, 0);
      this.rig.add(leg);
    }

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_RAD, BODY_LEN, 6, 16), shell);
    body.position.y = LEG_H + BODY_RAD + BODY_LEN / 2;
    this.rig.add(body);

    // Visor: una placa curva al frente (+Z, hacia donde mira), con los ojos.
    const visor = new THREE.Mesh(
      new THREE.CylinderGeometry(BODY_RAD + 0.015, BODY_RAD + 0.015, 0.24, 20, 1, true, -0.95, 1.9),
      new THREE.MeshBasicMaterial({ map: sharedVisor }),
    );
    visor.position.y = LEG_H + BODY_RAD + BODY_LEN * 0.85;
    this.rig.add(visor);

    for (const [arm, side] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as const) {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.26, 4, 8), shell);
      mesh.position.y = -0.17;
      arm.add(mesh);
      arm.position.set(side * (BODY_RAD + 0.06), LEG_H + BODY_LEN * 0.75, 0);
      arm.rotation.z = side * 0.25;
      this.rig.add(arm);
    }
    this.root.add(this.rig);

    if (name) {
      const { texture, aspect } = nameTexture(name, color);
      this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
      this.label.renderOrder = 10;
      this.label.scale.set(0.55 * aspect, 0.55, 1);
      this.label.position.y = 2.15;
      this.root.add(this.label);
    }

    sharedShadow ??= shadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: sharedShadow, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
  }

  set visible(v: boolean) {
    this.root.visible = v;
    if (!v) this.shadow.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setOffline(offline: boolean): void {
    if (this.label) (this.label.material as THREE.SpriteMaterial).opacity = offline ? 0.35 : 1;
  }

  push(): void {
    this.pushT = PUSH_ANIM;
  }

  /**
   * Animacion por procedimiento: al correr se bambolea y balancea brazos y patitas;
   * en el aire abre los brazos.
   */
  animate(dt: number, speed: number, grounded: boolean, _ducking?: boolean): void {
    const amount = Math.min(1, speed / SPEED);
    if (grounded) {
      this.phase += dt * (7 + speed * 1.8);
      const swing = Math.sin(this.phase) * 0.9 * amount;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing;
      this.rightArm.rotation.x = swing;
      this.leftArm.rotation.z = -0.25;
      this.rightArm.rotation.z = 0.25;
      this.rig.rotation.z = Math.sin(this.phase) * 0.06 * amount;
      this.rig.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * amount;
    } else {
      const k = Math.min(1, dt * 12);
      this.leftArm.rotation.z += (-1.2 - this.leftArm.rotation.z) * k;
      this.rightArm.rotation.z += (1.2 - this.rightArm.rotation.z) * k;
      this.leftLeg.rotation.x += (0.4 - this.leftLeg.rotation.x) * k;
      this.rightLeg.rotation.x += (-0.3 - this.rightLeg.rotation.x) * k;
      this.rig.rotation.z *= 1 - k;
      this.rig.position.y *= 1 - k;
    }
    if (this.pushT <= 0) return;
    this.pushT = Math.max(0, this.pushT - dt);
    const t = 1 - this.pushT / PUSH_ANIM;
    const reach = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
    this.leftArm.rotation.x = this.rightArm.rotation.x = -1.55 * reach;
    this.leftArm.rotation.z = this.rightArm.rotation.z = 0;
  }
}
