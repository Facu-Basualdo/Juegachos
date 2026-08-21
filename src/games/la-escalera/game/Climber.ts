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

export interface ClimberSkin {
  /** Color del mameluco (los rivales van en otros colores). */
  suit?: number;
  suitDark?: number;
  helmet?: number;
}

/**
 * El muñeco: un obrero con mameluco corriendo escalera arriba. Nunca camina ni
 * se queda quieto: la escalera baja, asi que aunque este perdiendo terreno
 * siempre esta corriendo hacia arriba — es lo que vende el chiste del juego.
 *
 * **Proporciones humanas, no de juguete**: cabeza chica (~1/8 del alto),
 * hombros mas anchos que la cadera, torso que se afina en la cintura y miembros
 * de **capsulas** (no cajas), asi la silueta es redondeada y no de bloques
 * apilados. Sigue siendo low-poly y cel-shaded — lo que cambio es la anatomia.
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

  constructor(skin: ClimberSkin = {}) {
    this.build(skin);
    this.torso.scale.setScalar(2.7);
    this.object.add(this.torso);
  }

  private build(skin: ClimberSkin): void {
    const suit = toonMat(skin.suit ?? COLOR_SUIT);
    const suitDark = toonMat(skin.suitDark ?? COLOR_SUIT_DARK);
    const flesh = toonMat(COLOR_SKIN);
    const rubber = toonMat(COLOR_RUBBER);
    const helmetMat = toonMat(skin.helmet ?? COLOR_HELMET, {
      emissive: skin.helmet ?? COLOR_HELMET,
      emissiveIntensity: 0.04,
    });
    const tape = toonMat(COLOR_BONE, { emissive: COLOR_BONE, emissiveIntensity: 0.1 });

    // Torso: pecho ancho que se afina hacia la cintura (cilindros aplastados en
    // Z), no una caja. Es lo que mas saca el aire de "muñeco de bloques".
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.34, 10), suit);
    chest.position.y = 1.24;
    chest.scale.z = 0.62;
    this.torso.add(chest);

    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.16, 0.2, 10), suit);
    waist.position.y = 1.0;
    waist.scale.z = 0.66;
    this.torso.add(waist);

    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.185, 0.18, 10), suitDark);
    pelvis.position.y = 0.86;
    pelvis.scale.z = 0.7;
    this.torso.add(pelvis);

    // Hombros: una capsula cruzada le da la linea de los hombros de una.
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.28, 3, 8), suit);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.y = 1.4;
    shoulders.scale.z = 0.8;
    this.torso.add(shoulders);

    // Bandas reflectivas: la unica linea clara del mameluco.
    const bandGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.045, 10, 1, true);
    for (const y of [1.16, 1.3]) {
      const band = new THREE.Mesh(bandGeo, tape);
      band.position.y = y;
      band.scale.set(1.02, 1, 0.64);
      this.torso.add(band);
    }

    // Numero al dorso del mameluco, como el uniforme de la referencia.
    const number = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), this.numberMaterial());
    number.position.set(0, 1.25, -0.145);
    number.rotation.y = Math.PI;
    this.torso.add(number);

    // Cuello + cabeza chica (proporcion humana) + casco.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), flesh);
    neck.position.y = 1.5;
    this.torso.add(neck);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), flesh);
    skull.scale.set(1, 1.12, 1.05);
    this.head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.13), flesh);
    jaw.position.set(0, -0.08, 0.02);
    this.head.add(jaw);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      helmetMat,
    );
    helmet.position.y = 0.02;
    helmet.scale.set(1.05, 0.95, 1.1);
    this.head.add(helmet);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 12, 1, false, Math.PI * 0.15, Math.PI * 0.7), helmetMat);
    brim.position.set(0, 0.02, 0);
    brim.rotation.y = Math.PI;
    brim.scale.z = 1.3;
    this.head.add(brim);
    this.head.position.y = 1.62;
    this.torso.add(this.head);

    // Brazos: hombro -> brazo -> codo -> antebrazo + mano. Capsulas.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.24, 3, 8), suit);
      upper.position.y = -0.15;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 3, 8), suit);
      fore.position.y = -0.13;
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), flesh);
      hand.position.y = -0.27;
      hand.scale.set(1, 1.2, 0.8);
      elbow.add(hand);
      shoulder.add(elbow);

      shoulder.position.set(side * 0.2, 1.38, 0);
      this.torso.add(shoulder);
      this.arms.push({ shoulder, elbow });
    }

    // Piernas: cadera -> muslo -> rodilla -> pantorrilla + bota.
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 3, 8), suit);
      thigh.position.y = -0.19;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.38;
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.28, 3, 8), suitDark);
      shin.position.y = -0.17;
      knee.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.24), rubber);
      boot.position.set(0, -0.34, -0.04);
      knee.add(boot);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), rubber);
      toe.position.set(0, -0.34, -0.14);
      toe.scale.set(1, 0.8, 1.1);
      knee.add(toe);
      hip.add(knee);

      hip.position.set(side * 0.1, 0.84, 0);
      this.torso.add(hip);
      this.legs.push({ hip, knee });
    }

    // Sombra de contacto barata: mancha oscura bajo los pies.
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), glowMat(0x000000, 0.35));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.torso.add(blob);

    this.torso.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  /** Chapa con el numero del uniforme (mismo dibujo para todos, va al dorso). */
  private numberMaterial(): THREE.MeshBasicMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 72;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0d1120";
    ctx.fillRect(0, 0, 128, 72);
    ctx.fillStyle = "#d8d2c2";
    ctx.font = "bold 52px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("001", 64, 38);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75 });
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
    this.torso.scale.setScalar(2.7);
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
