import * as THREE from "three";
import { BALL_R, CUSHION_W, HALF_L, HALF_W, RAIL_H } from "./constants";

/**
 * El taco: maple claro adelante, nogal oscuro atras, ferrula blanca y tiza azul en la punta.
 * El grupo tiene el origen en la PUNTA y apunta con su eje +Y hacia donde se tira, asi
 * posicionarlo es poner la punta y orientar el eje. Se acerca o se aleja de la blanca con
 * `pull` (la carga de potencia) y con un golpe corto en el tiro.
 */

const LENGTH = 1.45;
/** Cuanto aire le deja el taco por encima a la madera de la baranda. */
const RAIL_CLEARANCE = 0.016;
const MIN_ELEVATION = 0.1;
const MAX_ELEVATION = 0.85;

export class Cue {
  readonly group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly axis = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** Inclinacion actual del taco (rad): la usa la camara de la bola para ir siempre por encima de el. */
  elevation = MIN_ELEVATION;

  constructor(scene: THREE.Scene) {
    const part = (radiusTop: number, radiusBottom: number, length: number, y0: number, color: number, metal = 0): THREE.Mesh => {
      const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 14);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: metal });
      this.disposables.push(geo, mat);
      const m = new THREE.Mesh(geo, mat);
      // y0 es donde empieza (hacia la punta); el cilindro se centra en su largo.
      m.position.y = y0 - length / 2;
      m.castShadow = true;
      return m;
    };
    this.group.add(
      part(0.0052, 0.0052, 0.011, 0, 0x2f6fb5), // tiza
      part(0.0058, 0.0058, 0.024, -0.011, 0xf3ecd8), // ferrula
      part(0.0062, 0.0105, 0.78, -0.035, 0xe6cf9b), // fuste de maple
      part(0.0105, 0.0125, 0.012, -0.815, 0xc8a04a, 0.8), // anillo de laton
      part(0.0125, 0.0165, LENGTH - 0.827, -0.827, 0x2b1409), // empuñadura de nogal
    );
    this.group.visible = false;
    scene.add(this.group);
  }

  /**
   * Pone el taco detras de la blanca (cx, cz), apuntando a `angle` (atan2(z, x)). `pull` es
   * cuanto se aleja la punta de la bola, en metros.
   */
  setPose(cx: number, cz: number, angle: number, pull: number): void {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const gap = BALL_R + 0.012 + pull;
    const tipX = cx - dx * gap;
    const tipZ = cz - dz * gap;
    const tipY = BALL_R + 0.006;

    // Hasta donde llega el paño hacia atras del taco: ahi empieza la madera y el taco tiene que pasar POR ENCIMA.
    // La altura del eje crece con la distancia (tan(el) * d), asi que alcanza con verificarla en la cara de la
    // madera: se levanta la empuñadura lo justo. Lejos del borde queda el angulo bajo de siempre.
    let t = Infinity;
    const bx = -dx;
    const bz = -dz;
    if (bx > 1e-6) t = Math.min(t, (HALF_L - tipX) / bx);
    else if (bx < -1e-6) t = Math.min(t, (-HALF_L - tipX) / bx);
    if (bz > 1e-6) t = Math.min(t, (HALF_W - tipZ) / bz);
    else if (bz < -1e-6) t = Math.min(t, (-HALF_W - tipZ) / bz);
    t = Math.max(0, t);
    const need = Math.atan2(RAIL_H + RAIL_CLEARANCE - tipY, t + CUSHION_W);
    const el = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, need));
    this.elevation = el;

    this.axis.set(dx * Math.cos(el), -Math.sin(el), dz * Math.cos(el));
    this.group.position.set(tipX, tipY + Math.sin(el) * 0.012, tipZ);
    this.group.quaternion.setFromUnitVectors(this.up, this.axis);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
