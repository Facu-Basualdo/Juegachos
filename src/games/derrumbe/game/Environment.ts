import * as THREE from "three";
import { LAVA_Y } from "./constants";
import { lavaTexture } from "./textures";

const SKY = new THREE.Color("#8ec5f2");
const CLOUDS = 26;

/**
 * Cielo de mediodia, nubes de bloques y la lava del fondo (DESIGN.md).
 *
 * - Luz: un hemisferio (cielo celeste arriba, rebote naranja de la lava abajo) mas
 *   un sol alto y fijo. Sin mapas de sombras: la profundidad sale del sombreado por
 *   cara de Lambert y de la niebla.
 * - Niebla lineal hacia el celeste: los pisos de abajo se aclaran, asi el piso en
 *   el que estas es siempre el mas contrastado.
 * - La lava ignora la niebla (`fog: false`): es la unica superficie con luz propia.
 */
export class Environment {
  private readonly lavaTex: THREE.CanvasTexture;
  private readonly clouds: THREE.InstancedMesh;
  private readonly cloudData: { x: number; z: number; y: number; w: number; d: number }[] = [];
  private readonly dummy = new THREE.Object3D();
  private lavaAcc = 0;

  constructor(scene: THREE.Scene) {
    scene.background = SKY;
    scene.fog = new THREE.Fog(SKY, 34, 95);

    scene.add(new THREE.HemisphereLight("#dff0ff", "#e0773a", 1.55));
    const sun = new THREE.DirectionalLight("#fff4de", 1.9);
    sun.position.set(18, 40, 11);
    scene.add(sun);

    this.lavaTex = lavaTexture();
    this.lavaTex.repeat.set(48, 48);
    const lava = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ map: this.lavaTex, fog: false }),
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = LAVA_Y;
    scene.add(lava);

    // Nubes: prismas blancos chatos a gran altura que derivan despacio.
    this.clouds = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#d8e8f5", fog: false }),
      CLOUDS,
    );
    this.clouds.frustumCulled = false;
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < CLOUDS; i++) {
      this.cloudData.push({
        x: (rand() - 0.5) * 220,
        z: (rand() - 0.5) * 220,
        y: 52 + rand() * 14,
        w: 8 + rand() * 16,
        d: 5 + rand() * 10,
      });
    }
    scene.add(this.clouds);
    this.update(0);
  }

  update(dt: number): void {
    // La lava se desplaza en pixeles enteros de textura, a saltos: si se deslizara
    // suave se veria borrosa, y el mundo no tiene nada borroso.
    this.lavaAcc += dt;
    if (this.lavaAcc > 0.14) {
      this.lavaAcc = 0;
      this.lavaTex.offset.x = (this.lavaTex.offset.x + 1 / 16) % 1;
      this.lavaTex.offset.y = (this.lavaTex.offset.y + 1 / 32) % 1;
    }

    for (let i = 0; i < this.cloudData.length; i++) {
      const c = this.cloudData[i];
      c.x += dt * 1.2;
      if (c.x > 110) c.x -= 220;
      this.dummy.position.set(c.x, c.y, c.z);
      this.dummy.scale.set(c.w, 1.6, c.d);
      this.dummy.updateMatrix();
      this.clouds.setMatrixAt(i, this.dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }
}
