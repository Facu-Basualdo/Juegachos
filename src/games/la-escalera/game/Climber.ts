import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { rampPoint, SLOPE_ANGLE } from "./ramp";
import {
  SPIKE_TIP_Y,
  PIT_START_Z,
  PIT_FLOOR_Y,
  COLOR_SKIN,
  COLOR_SUIT,
  COLOR_SUIT_DARK,
  COLOR_HELMET,
  COLOR_BONE,
  COLOR_RUBBER,
} from "./constants";

/**
 * El muñeco: un obrero rechoncho de dibujo animado (cabeza grande, casco
 * amarillo, mameluco azul apagado) **corriendo** escalera arriba. Nunca camina
 * ni se queda quieto: la escalera baja, asi que aunque este perdiendo terreno
 * siempre esta corriendo hacia arriba — es lo que vende el chiste del juego.
 *
 * Toda la animacion es procedural (sin skinning): brazos y piernas tienen codo
 * y rodilla (grupos anidados) porque un ciclo de carrera con miembros rigidos
 * lee como marcha de juguete; con la flexion lee como alguien apurado.
 */
export class Climber {
  readonly object = new THREE.Group();

  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];

  private phase = 0; // ciclo de carrera
  private hopTime = 0; // envion tras un acierto
  private stumbleTime = 0; // manotazo tras un error
  private dead = false;
  private impaled = false;
  private impaleEvent = false;
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

    // Brazos: hombro -> brazo -> codo -> antebrazo + mano.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.17), suit);
      upper.position.y = -0.16;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.16), suitDark);
      fore.position.y = -0.15;
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.15, 0.19), skin);
      hand.position.y = -0.34;
      elbow.add(hand);
      shoulder.add(elbow);

      shoulder.position.set(side * 0.38, 1.16, 0);
      this.torso.add(shoulder);
      this.arms.push({ shoulder, elbow });
    }

    // Piernas: cadera -> muslo -> rodilla -> pantorrilla + bota.
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.22), suitDark);
      thigh.position.y = -0.16;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.32;
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.2), suitDark);
      shin.position.y = -0.15;
      knee.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.15, 0.32), toonMat(COLOR_RUBBER));
      boot.position.set(0, -0.34, -0.05);
      knee.add(boot);
      hip.add(knee);

      hip.position.set(side * 0.16, 0.6, 0);
      this.torso.add(hip);
      this.legs.push({ hip, knee });
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
    this.impaled = false;
    this.impaleEvent = false;
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

  /** Cae al pozo: tumbo libre hasta quedar ensartado en las puas. */
  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.tumble.set((Math.random() - 0.5) * 2.5, 4.6 + Math.random() * 1.2, 5.2);
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** True **una sola vez**, el frame en que el cuerpo toca las puas. */
  consumeImpale(): boolean {
    if (!this.impaleEvent) return false;
    this.impaleEvent = false;
    return true;
  }

  /**
   * Coloca y anima al muñeco.
   * @param t posicion en la rampa (0 = puas, 1 = arriba)
   * @param effort 0..1 cuanto esta peleando la escalera (cadencia de la carrera)
   */
  update(dt: number, t: number, effort: number): void {
    if (this.dead) {
      this.updateDeath(dt);
      return;
    }

    rampPoint(t, this.object.position, 0.06);
    this.object.rotation.set(0, 0, 0);

    this.hopTime = Math.max(0, this.hopTime - dt);
    this.stumbleTime = Math.max(0, this.stumbleTime - dt);
    this.run(dt, 9.5 + effort * 5.5, 1);
  }

  /** Menu y countdown: sigue corriendo en el lugar, apenas mas tranquilo. */
  idle(t: number, elapsed: number): void {
    rampPoint(t, this.object.position, 0.06);
    this.object.rotation.set(0, 0, 0);
    this.hopTime = 0;
    this.stumbleTime = 0;
    this.run(1 / 60, 6.5, 0.75, elapsed);
  }

  /**
   * Ciclo de carrera. `cadence` es la velocidad del ciclo y `power` cuanto
   * amplifica la zancada; el tropiezo y el envion se montan encima.
   */
  private run(dt: number, cadence: number, power: number, breathe = 0): void {
    this.phase += dt * cadence;

    const hop = this.hopTime / 0.26; // 1 -> 0
    const trip = this.stumbleTime / 0.45;
    const swing = Math.sin(this.phase);
    const lift = Math.abs(Math.sin(this.phase)); // dos apoyos por ciclo

    // Cuerpo: inclinado hacia la subida, rebotando con cada zancada. El
    // tropiezo lo tira para atras y le saca la inclinacion.
    this.torso.rotation.x = -SLOPE_ANGLE * 0.55 - 0.12 * power + trip * 0.8;
    this.torso.rotation.z = Math.sin(this.phase) * 0.06 * power + trip * 0.25;
    this.torso.position.y = lift * 0.07 * power + hop * 0.22 + Math.sin(breathe * 1.8) * 0.01;

    // Piernas: muslo adelante-atras y rodilla que se pliega al recoger.
    for (let i = 0; i < this.legs.length; i++) {
      const dir = i === 0 ? 1 : -1;
      const s = swing * dir;
      const { hip, knee } = this.legs[i];
      hip.rotation.x = s * 1.05 * power - 0.25;
      knee.rotation.x = -Math.max(0, -s) * 1.5 * power - 0.15;
    }

    // Brazos: contrafase de las piernas, codo siempre flexionado (corriendo,
    // no marchando). En el envion suben los dos; al resbalar se abren.
    for (let i = 0; i < this.arms.length; i++) {
      const dir = i === 0 ? -1 : 1;
      const s = swing * dir;
      const { shoulder, elbow } = this.arms[i];
      shoulder.rotation.x = s * 0.8 * power - 0.25 - hop * 1.6 - trip * 0.5;
      shoulder.rotation.z = -dir * (0.12 + trip * 0.9);
      elbow.rotation.x = -1.0 - Math.max(0, s) * 0.5 + hop * 0.5;
    }

    // La cabeza mira el cartel de arriba.
    this.head.rotation.x = -0.18 - hop * 0.1;
  }

  /** Caida al pozo y quedada final sobre las puas. */
  private updateDeath(dt: number): void {
    if (this.impaled) return;

    this.tumble.y -= 22 * dt;
    this.object.position.addScaledVector(this.tumble, dt);
    this.object.rotation.x -= 6.5 * dt;
    this.object.rotation.z += 2.8 * dt;

    // El pozo empieza pasado el peine de abajo: sin el chequeo de z el cuerpo
    // quedaba tirado en la plataforma, a un metro de las puas.
    // Red de seguridad: si el tumbo lo pasa de largo del pozo, se lo traga el
    // fondo en vez de dejarlo cayendo para siempre.
    if (this.object.position.y < PIT_FLOOR_Y - 3) {
      this.impaled = true;
      this.object.visible = false;
      return;
    }

    if (this.object.position.y <= SPIKE_TIP_Y && this.object.position.z >= PIT_START_Z) {
      this.object.position.y = SPIKE_TIP_Y;
      this.impaled = true;
      this.impaleEvent = true;
      // Queda boca abajo, desmadejado sobre los hierros.
      this.object.rotation.set(-Math.PI / 2 + 0.25, (Math.random() - 0.5) * 0.6, 0.35);
      this.torso.rotation.set(0, 0, 0);
      for (const { hip, knee } of this.legs) {
        hip.rotation.x = 0.5 + Math.random() * 0.4;
        knee.rotation.x = -0.6 - Math.random() * 0.5;
      }
      for (const { shoulder, elbow } of this.arms) {
        shoulder.rotation.x = 1.5 + Math.random() * 0.5;
        elbow.rotation.x = -0.3;
      }
      this.head.rotation.x = 0.6;
    }
  }
}
