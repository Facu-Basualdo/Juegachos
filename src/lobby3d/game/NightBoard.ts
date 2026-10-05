import * as THREE from "three";
import { makeBox, type CollisionWorld } from "./Physics";
import { decal, psxBasic, psxLambert } from "./retro";
import { NIGHT_BOARD_ASPECT, nightBoardTexture, rustTexture, type NightBoardView } from "./textures";

/**
 * Donde va: al sur, detras del spawn, de cara al centro. Las carteleras ocupan el norte
 * (el arco llega hasta z ~ 4.5 en las dos puntas), la torre el suroeste y el cartel de
 * records el sureste: esta queda en el medio de los dos, sin tapar ningun afiche (a los
 * costados del arco, vista desde el centro, se superponia con los afiches de la punta).
 * El cajon mas cercano, en (4.4, 13), queda a ~7 m.
 */
const BOARD_X = 0;
const BOARD_Z = 19;
const FACE_TARGET = { x: 0, z: 0 };
const FACE_H = 2.7;
const FACE_W = FACE_H * NIGHT_BOARD_ASPECT;
const BASE_Y = 0.95;

const LAMP_ON = new THREE.Color("#ffd9a0");
const LAMP_OFF = new THREE.Color("#1a1410");

/**
 * La pizarra de la noche de La Feria (pedido del programador): quien gano el ultimo
 * juego y los puntos acumulados de todos los juegos de la sala. Se actualiza al volver
 * de cada juego. No reemplaza al cartel de records de la torre (`RecordBoard`): son dos
 * carteles distintos a proposito, y este se ve distinto (pizarron de tiza apaisado en
 * un marco de chapa oxidada, contra tablas pintadas en vertical).
 *
 * Como todo lo que se tiene que leer, tiene su propia luz (una lampara de obra con
 * jaula) y la cara va nitida y sin niebla; el marco pasa por el filtro PS1.
 */
export class NightBoard {
  readonly group = new THREE.Group();
  private readonly faceMat: THREE.MeshBasicMaterial;
  private readonly lamp: THREE.PointLight;
  private readonly lampBulb: THREE.MeshBasicMaterial;
  private sig = "";

  constructor(world: CollisionWorld) {
    const yaw = Math.atan2(FACE_TARGET.x - BOARD_X, FACE_TARGET.z - BOARD_Z);
    this.group.position.set(BOARD_X, 0, BOARD_Z);
    this.group.rotation.y = yaw;

    const rust = psxLambert({ map: rustTexture() });
    const top = BASE_Y + FACE_H;

    // Marco de chapa (cuatro listones) y dos patas en A, como un pizarron de feria.
    const t = 0.16;
    const frame: Array<[number, number, number, number]> = [
      [0, top + t / 2, FACE_W + 2 * t, t],
      [0, BASE_Y - t / 2, FACE_W + 2 * t, t],
      [-(FACE_W / 2 + t / 2), BASE_Y + FACE_H / 2, t, FACE_H],
      [FACE_W / 2 + t / 2, BASE_Y + FACE_H / 2, t, FACE_H],
    ];
    for (const [x, y, w, h] of frame) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), rust);
      bar.position.set(x, y, 0);
      this.group.add(bar);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(FACE_W, FACE_H, 0.06), rust);
    back.position.set(0, BASE_Y + FACE_H / 2, -0.04);
    this.group.add(back);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, top + 0.3, 0.12), rust);
      leg.position.set(side * (FACE_W / 2 - 0.3), (top + 0.3) / 2, -0.1);
      leg.rotation.x = -0.06;
      this.group.add(leg);
      // Pata trasera inclinada: el pizarron se sostiene solo.
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, top, 0.1), rust);
      brace.position.set(side * (FACE_W / 2 - 0.3), top / 2, -0.75);
      brace.rotation.x = 0.32;
      this.group.add(brace);
    }

    this.faceMat = decal(psxBasic({ map: nightBoardTexture({ rows: [], lastTitle: null, winners: [], played: 0 }), fog: false }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(FACE_W, FACE_H), this.faceMat);
    face.position.set(0, BASE_Y + FACE_H / 2, 0.065);
    this.group.add(face);

    // Lampara de obra con jaula, en un brazo arriba del pizarron.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), rust);
    arm.position.set(0, top + 0.25, 0.4);
    this.group.add(arm);
    this.lampBulb = psxBasic({ color: LAMP_ON });
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), this.lampBulb);
    bulb.position.set(0, top + 0.08, 0.85);
    this.group.add(bulb);
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), psxBasic({ color: "#2b2b2b", wireframe: true }));
    cage.position.copy(bulb.position);
    this.group.add(cage);
    this.lamp = new THREE.PointLight("#ffd9a0", 15, 8, 1.3);
    this.lamp.position.set(0, top - 0.1, 1.1);
    this.group.add(this.lamp);

    // Choca como un bloque (pizarron + patas).
    world.boxes.push(makeBox(BOARD_X, (top + 0.3) / 2, BOARD_Z, FACE_W / 2 + 0.25, (top + 0.3) / 2, 0.5, yaw));
  }

  /** Repinta la pizarra solo si cambio algo (cada repintada es una textura nueva). */
  set(view: NightBoardView): void {
    const sig = JSON.stringify(view);
    if (sig === this.sig) return;
    this.sig = sig;
    this.faceMat.map?.dispose();
    this.faceMat.map = nightBoardTexture(view);
    this.faceMat.needsUpdate = true;
  }

  /** La lampara titila de vez en cuando y baja con la noche, como el resto de la feria. */
  update(time: number, dread: number): void {
    const flicker = Math.sin(time * 7.1 + 1.3) > 0.988 ? 0.2 : 1;
    this.lamp.intensity = 15 * (1 - dread * 0.3) * flicker;
    this.lampBulb.color.copy(flicker < 1 ? LAMP_OFF : LAMP_ON);
  }
}
