import * as THREE from "three";
import { LAVA_START_Y, TOP_Y, WALL_HALF, WALL_Z } from "./constants";
import { basaltTexture, lavaTexture } from "./textures";

const NIGHT = new THREE.Color("#0a0c18");
const SPARKS = 90;

/**
 * La pared de basalto, la lava y la luz (DESIGN.md "Ascenso de Basalto").
 *
 * La lava es la unica luz calida: un plano emisivo que ignora la niebla, mas una
 * luz puntual naranja pegada a su superficie que sube con ella. Asi las plataformas
 * cercanas a la lava se encienden por abajo y las altas quedan en azul humo: el
 * peligro se lee por el color de la roca.
 */
export class Stage {
  private readonly lava: THREE.Mesh;
  private readonly lavaTex: THREE.CanvasTexture;
  private readonly glow: THREE.PointLight;
  private readonly lantern: THREE.PointLight;
  private readonly sparks: THREE.Points;
  private readonly sparkLife = new Float32Array(SPARKS);
  private lavaAcc = 0;
  private level = LAVA_START_Y;

  constructor(scene: THREE.Scene) {
    scene.background = NIGHT;
    scene.fog = new THREE.Fog(NIGHT, 20, 56);
    scene.add(new THREE.HemisphereLight("#6a78a8", "#ff7a2a", 1.15));
    const moon = new THREE.DirectionalLight("#c4d0ff", 1.3);
    moon.position.set(-6, 20, 14);
    scene.add(moon);

    // Pared del fondo: alta, mas ancha que la zona trepable.
    const tex = basaltTexture();
    const wallW = WALL_HALF * 2 + 16;
    const wallH = TOP_Y + 30;
    tex.repeat.set(wallW, wallH);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(wallW, wallH), new THREE.MeshLambertMaterial({ map: tex }));
    wall.position.set(0, wallH / 2 - 12, WALL_Z);
    scene.add(wall);

    this.lavaTex = lavaTexture();
    this.lavaTex.repeat.set(60, 30);
    this.lava = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshBasicMaterial({ map: this.lavaTex, fog: false }));
    this.lava.rotation.x = -Math.PI / 2;
    this.lava.position.set(0, LAVA_START_Y, 4);
    scene.add(this.lava);

    this.glow = new THREE.PointLight("#ff7a22", 60, 22, 1.6);
    scene.add(this.glow);
    // Farol frio que sigue al jugador: las plataformas cerca tienen que leerse
    // aunque la lava este lejos (DESIGN.md: se ve lo justo para el proximo salto).
    this.lantern = new THREE.PointLight("#cfd8ff", 22, 14, 1.4);
    scene.add(this.lantern);

    // Chispas cuadradas que suben desde la superficie y se apagan.
    const pos = new Float32Array(SPARKS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: "#ffb347", size: 0.22, sizeAttenuation: true, fog: false }),
    );
    scene.add(this.sparks);
    for (let i = 0; i < SPARKS; i++) this.respawnSpark(i, true);
  }

  /** Mueve la lava a su altura del momento. */
  setLava(y: number): void {
    this.level = y;
    this.lava.position.y = y;
    this.glow.position.set(0, y + 2.5, 2);
  }

  /** Donde esta la accion (el jugador o a quien se mira): ahi va el farol. */
  setFocus(x: number, y: number): void {
    this.lantern.position.set(x, y + 3, 3);
  }

  update(dt: number): void {
    // Se desplaza a saltos de un pixel de textura: si se deslizara suave se veria borrosa.
    this.lavaAcc += dt;
    if (this.lavaAcc > 0.12) {
      this.lavaAcc = 0;
      this.lavaTex.offset.x = (this.lavaTex.offset.x + 1 / 16) % 1;
      this.lavaTex.offset.y = (this.lavaTex.offset.y + 1 / 32) % 1;
    }
    const attr = this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < SPARKS; i++) {
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) {
        this.respawnSpark(i, false);
        continue;
      }
      attr.setY(i, attr.getY(i) + dt * 1.6);
    }
    attr.needsUpdate = true;
  }

  private respawnSpark(i: number, initial: boolean): void {
    const attr = this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(i, (Math.random() - 0.5) * 30, this.level + (initial ? Math.random() * 3 : 0.05), -3 + Math.random() * 9);
    this.sparkLife[i] = 0.6 + Math.random() * 1.6;
  }
}
