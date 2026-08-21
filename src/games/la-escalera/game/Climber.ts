import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { rampPoint, SLOPE_ANGLE } from "./ramp";
import {
  COLOR_SKIN,
  COLOR_SUIT,
  COLOR_SUIT_DARK,
  COLOR_HELMET,
  COLOR_BONE,
  COLOR_RUBBER,
} from "./constants";

/**
 * El muñeco: un obrero rechoncho de dibujo animado (cabeza grande, casco
 * amarillo, mameluco azul apagado) subiendo una escalera que baja. Es la unica
 * figura del cuadro, asi que lee por silueta: casco = la nota saturada,
 * mameluco casi negro contra el hierro (ver DESIGN.md).
 *
 * Toda la animacion es procedural (sin skinning): ciclo de piernas, balanceo de
 * brazos, un envion por acierto, un manotazo por error y un tumbo al morir.
 */
export class Climber {
  readonly object = new THREE.Group();

  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();

  private phase = 0; // ciclo de pasos
  private hopTime = 0; // envion tras un acierto
  private stumbleTime = 0; // manotazo tras un error
  private dead = false;
  private deadTime = 0;
  private readonly tumble = new THREE.Vector3();

  constructor() {
    this.build();
    this.torso.scale.setScalar(1.2);
    this.object.add(this.torso);
  }

  private build(): void {
    const suit = toonMat(COLOR_SUIT);
    const suitDark = toonMat(COLOR_SUIT_DARK);
    const skin = toonMat(COLOR_SKIN);

    // Torso: caja gorda, hombros anchos, cintura corta.
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.38), suit);
    chest.position.y = 0.95;
    this.torso.add(chest);

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.28, 0.34), suitDark);
    hips.position.y = 0.62;
    this.torso.add(hips);

    // Banda reflectiva: la unica linea clara del mameluco, para leer la espalda.
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.64, 0.09, 0.4),
      toonMat(COLOR_BONE, { emissive: COLOR_BONE, emissiveIntensity: 0.1 }),
    );
    stripe.position.y = 0.86;
    this.torso.add(stripe);

    // Cabeza + casco.
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.4), skin);
    this.head.add(skull);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      toonMat(COLOR_HELMET, { emissive: COLOR_HELMET, emissiveIntensity: 0.04 }),
    );
    helmet.position.y = 0.14;
    helmet.scale.set(1, 0.9, 1.05);
    this.head.add(helmet);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.16), toonMat(COLOR_HELMET));
    brim.position.set(0, 0.16, -0.26);
    this.head.add(brim);
    this.head.position.y = 1.46;
    this.torso.add(this.head);

    // Brazos: pivote en el hombro, mano al final.
    for (const [group, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.18), suit);
      upper.position.y = -0.23;
      group.add(upper);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.2), skin);
      hand.position.y = -0.5;
      group.add(hand);
      group.position.set(side * 0.38, 1.16, 0);
      this.torso.add(group);
    }

    // Piernas: pivote en la cadera, bota al final.
    for (const [group, side] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as const) {
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.22), suitDark);
      thigh.position.y = -0.25;
      group.add(thigh);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.32), toonMat(COLOR_RUBBER));
      boot.position.set(0, -0.55, -0.04);
      group.add(boot);
      group.position.set(side * 0.16, 0.6, 0);
      this.torso.add(group);
    }

    // Sombra de contacto barata: mancha oscura bajo los pies.
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), glowMat(0x000000, 0.35));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.torso.add(blob);

    this.torso.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  reset(): void {
    this.dead = false;
    this.deadTime = 0;
    this.hopTime = 0;
    this.stumbleTime = 0;
    this.phase = 0;
    this.tumble.set(0, 0, 0);
    this.object.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.torso.position.set(0, 0, 0);
    this.torso.scale.setScalar(1.2);
    this.object.visible = true;
  }

  /** Acierto: un envion hacia arriba y los brazos al escalon de adelante. */
  hop(): void {
    this.hopTime = 0.26;
  }

  /** Error: resbalon, brazos abiertos y cuerpo hacia atras. */
  stumble(): void {
    this.stumbleTime = 0.45;
  }

  /** Cae al pozo: tumbo libre hasta las puas. */
  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.deadTime = 0;
    this.tumble.set((Math.random() - 0.5) * 6, 4 + Math.random() * 2, 3.4);
  }

  get isDead(): boolean {
    return this.dead;
  }

  /**
   * Coloca y anima al muñeco.
   * @param t posicion en la rampa (0 = puas, 1 = arriba)
   * @param effort 0..1 cuanto esta peleando la escalera (velocidad del ciclo)
   */
  update(dt: number, t: number, effort: number): void {
    if (this.dead) {
      this.deadTime += dt;
      this.tumble.y -= 22 * dt;
      this.object.position.addScaledVector(this.tumble, dt);
      this.object.rotation.x -= 7 * dt;
      this.object.rotation.z += 3.2 * dt;
      if (this.object.position.y < -2.6) this.object.visible = false;
      return;
    }

    rampPoint(t, this.object.position, 0.06);
    this.object.rotation.set(0, 0, 0);

    this.hopTime = Math.max(0, this.hopTime - dt);
    this.stumbleTime = Math.max(0, this.stumbleTime - dt);
    this.phase += dt * (5.5 + effort * 7);

    const hop = this.hopTime / 0.26; // 1 -> 0
    const trip = this.stumbleTime / 0.45;

    // El cuerpo se inclina hacia la subida; el tropiezo lo tira para atras.
    this.torso.rotation.x = -SLOPE_ANGLE * 0.45 + trip * 0.65;
    this.torso.rotation.z = Math.sin(this.phase * 0.5) * 0.05 + trip * 0.25;
    this.torso.position.y = Math.abs(Math.sin(this.phase)) * 0.05 + hop * 0.22;

    // Piernas alternadas: siempre subiendo escalones, aunque pierda terreno.
    const swing = Math.sin(this.phase) * 0.85;
    this.legL.rotation.x = swing * 0.7 - 0.15;
    this.legR.rotation.x = -swing * 0.7 - 0.15;

    // Brazos: contra-balanceo normal, arriba en el envion, abiertos al resbalar.
    const armSwing = -swing * 0.6;
    this.armL.rotation.x = armSwing - hop * 1.5 - trip * 0.4;
    this.armR.rotation.x = -armSwing - hop * 1.5 - trip * 0.4;
    this.armL.rotation.z = trip * 0.9;
    this.armR.rotation.z = -trip * 0.9;

    // La cabeza mira las pantallas de arriba.
    this.head.rotation.x = -0.12 - hop * 0.1;
  }

  /** Pose quieta del menu / countdown: respira y mira arriba. */
  idle(t: number, elapsed: number): void {
    rampPoint(t, this.object.position, 0.06);
    this.object.rotation.set(0, 0, 0);
    this.torso.rotation.set(-SLOPE_ANGLE * 0.3, 0, 0);
    this.torso.position.y = Math.sin(elapsed * 1.8) * 0.03;
    this.legL.rotation.x = -0.15;
    this.legR.rotation.x = -0.15;
    this.armL.rotation.set(0.1, 0, 0.08);
    this.armR.rotation.set(0.1, 0, -0.08);
    this.head.rotation.x = -0.14;
  }
}
