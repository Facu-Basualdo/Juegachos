import * as THREE from "three";
import { TOWER_X, TOWER_Z } from "./constants";
import { makeBox, type CollisionWorld } from "./Physics";
import { decal, psxBasic, psxLambert } from "./retro";
import { RECORD_BOARD_ASPECT, recordBoardTexture, woodTexture, type RecordRow } from "./textures";

/** Donde va: 7.8 m al norte del mastil de la torre (a 1.8 m del espiral), de cara al claro. */
const BOARD_X = TOWER_X;
const BOARD_Z = TOWER_Z - 7.8;
const FACE_TARGET = { x: 0, z: 7.5 };
/** Alto del tablero pintado, y a que altura empieza (se lee parado, sin mirar al piso). */
const FACE_H = 3.75;
const FACE_W = FACE_H * RECORD_BOARD_ASPECT;
const BASE_Y = 0.8;

const BULB_ON = new THREE.Color("#ffb35c");
const BULB_BAD = new THREE.Color("#ff5a36");
const BULB_RED = new THREE.Color("#c0392b");
const BULB_OFF = new THREE.Color("#1a1410");

interface Bulb {
  mat: THREE.MeshBasicMaterial;
  dieAt: number;
  seed: number;
}

/**
 * El cartel de records de La Torre: el Top 10 GLOBAL (todas las salas, ver
 * `TOWER_BOARD`) pintado en un tablero de feria al pie de la torre. Madera podrida
 * sobre dos postes con un techito, una lampara de obra colgando que lo ilumina (lo que
 * se tiene que leer tiene su propia luz, DESIGN.md) y una guirnalda de lamparitas
 * alrededor que titila y se quema con la noche, como las del resto de la feria.
 *
 * El tablero pintado es una textura nitida sin niebla, como los afiches (`setRows` la
 * repinta cuando cambia el ranking); el resto pasa por el filtro PS1.
 */
export class RecordBoard {
  readonly group = new THREE.Group();
  private readonly faceMat: THREE.MeshBasicMaterial;
  private readonly lamp: THREE.PointLight;
  private readonly lampBulb: THREE.MeshBasicMaterial;
  private readonly bulbs: Bulb[] = [];
  private sig = "";

  constructor(world: CollisionWorld) {
    const yaw = Math.atan2(FACE_TARGET.x - BOARD_X, FACE_TARGET.z - BOARD_Z);
    this.group.position.set(BOARD_X, 0, BOARD_Z);
    this.group.rotation.y = yaw;

    const wood = psxLambert({ map: woodTexture("#3b2d20") });
    const woodDark = psxLambert({ map: woodTexture("#2a2118") });
    const top = BASE_Y + FACE_H;

    // Respaldo, postes y techito.
    const back = new THREE.Mesh(new THREE.BoxGeometry(FACE_W + 0.34, FACE_H + 0.34, 0.14), wood);
    back.position.set(0, BASE_Y + FACE_H / 2, 0);
    this.group.add(back);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, top + 0.5, 0.2), woodDark);
      post.position.set(side * (FACE_W / 2 - 0.25), (top + 0.5) / 2, -0.14);
      this.group.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(FACE_W + 0.8, 0.08, 0.7), woodDark);
    roof.position.set(0, top + 0.42, 0.2);
    roof.rotation.x = 0.28;
    this.group.add(roof);

    this.faceMat = decal(psxBasic({ map: recordBoardTexture([], "loading"), fog: false }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(FACE_W, FACE_H), this.faceMat);
    face.position.set(0, BASE_Y + FACE_H / 2, 0.075);
    this.group.add(face);

    // Lampara de obra colgando del techito, adelante del tablero.
    const wire = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.02), psxBasic({ color: "#111111" }));
    wire.position.set(0, top + 0.2, 0.72);
    this.group.add(wire);
    this.lampBulb = psxBasic({ color: BULB_ON });
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), this.lampBulb);
    bulb.position.set(0, top - 0.08, 0.72);
    this.group.add(bulb);
    this.lamp = new THREE.PointLight("#ffcf8a", 14, 7.5, 1.3);
    this.lamp.position.set(0, top - 0.2, 0.9);
    this.group.add(this.lamp);

    // Guirnalda alrededor del marco.
    const bulbGeo = new THREE.IcosahedronGeometry(0.055, 0);
    const pts: [number, number][] = [];
    const step = 0.34;
    const hw = FACE_W / 2 + 0.1;
    const y0 = BASE_Y - 0.1;
    const y1 = top + 0.1;
    for (let x = -hw; x <= hw; x += step) pts.push([x, y1], [x, y0]);
    for (let y = y0 + step; y < y1; y += step) pts.push([-hw, y], [hw, y]);
    let seed = 91;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const [x, y] of pts) {
      const mat = psxBasic({ color: BULB_ON });
      const m = new THREE.Mesh(bulbGeo, mat);
      m.position.set(x, y, 0.12);
      this.group.add(m);
      this.bulbs.push({ mat, dieAt: rand(), seed: rand() * 100 });
    }

    // Choca como un bloque entero (postes + tablero): no se lo atraviesa.
    world.boxes.push(makeBox(BOARD_X, (top + 0.5) / 2, BOARD_Z, FACE_W / 2 + 0.2, (top + 0.5) / 2, 0.18, yaw));
  }

  /** Repinta el tablero (solo si cambio algo: cada repintada es una textura nueva). */
  setRows(rows: RecordRow[], state: "ok" | "loading" | "offline"): void {
    const sig = `${state}|${rows.map((r) => `${r.name}:${r.time}:${r.mine}`).join("|")}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.faceMat.map?.dispose();
    this.faceMat.map = recordBoardTexture(rows, state);
    this.faceMat.needsUpdate = true;
  }

  /** Titileo de la guirnalda y de la lampara; con la noche se queman, en la final van rojas. */
  update(time: number, dread: number): void {
    const final = dread >= 0.99;
    for (const b of this.bulbs) {
      if (b.dieAt < dread * 0.75 && !final) {
        b.mat.color.copy(BULB_OFF);
        continue;
      }
      const flick = Math.sin(time * (7 + b.seed) + b.seed * 3) > 0.96 - dread * 0.2;
      b.mat.color.copy(final ? BULB_RED : flick ? BULB_OFF : b.dieAt < dread ? BULB_BAD : BULB_ON);
    }
    const flicker = Math.sin(time * 9.3) > 0.985 ? 0.25 : 1;
    this.lamp.intensity = (final ? 12 : 14 * (1 - dread * 0.3)) * flicker;
    this.lamp.color.copy(final ? BULB_RED : BULB_ON);
    this.lampBulb.color.copy(flicker < 1 ? BULB_OFF : final ? BULB_RED : BULB_ON);
  }
}
