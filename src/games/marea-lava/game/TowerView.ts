import * as THREE from "three";
import type { Tower } from "./Tower";
import { blackstoneSideTexture, blackstoneTexture, glowstoneTexture } from "./textures";

/** Constructor de una geometria de quads con UV en metros. */
class QuadBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  /** Quad por sus cuatro esquinas (antihorario visto desde afuera) y su normal. */
  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
    uvs: [number, number][],
  ): void {
    const base = this.pos.length / 3;
    for (const [i, p] of [a, b, c, d].entries()) {
      this.pos.push(...p);
      this.nor.push(...n);
      this.uv.push(...uvs[i]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * La torre entera en TRES mallas: tapas de piedra negra, tapas de piedra luminosa
 * (las chicas y la cima) y todos los cantos. Es estatica, asi que se arma una vez.
 * Las UV van en metros: un bloque de textura mide un metro en todas las
 * plataformas, sin estirarse con el tamaño (DESIGN.md: el pixel es el material).
 */
export class TowerView {
  readonly group = new THREE.Group();

  constructor(tower: Tower) {
    const rockTop = new QuadBuilder();
    const glowTop = new QuadBuilder();
    const sides = new QuadBuilder();

    for (const p of tower.plats) {
      const x0 = p.x - p.w / 2;
      const x1 = p.x + p.w / 2;
      const z0 = p.z - p.d / 2;
      const z1 = p.z + p.d / 2;
      const y1 = p.y;
      const y0 = p.y - p.h;
      const top = p.kind === "rock" ? rockTop : glowTop;
      top.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [
        [x0, z1],
        [x1, z1],
        [x1, z0],
        [x0, z0],
      ]);
      // Cantos: frente (+Z), fondo (-Z), derecha (+X), izquierda (-X) y la base.
      sides.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
      sides.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [
        [x1, y0],
        [x0, y0],
        [x0, y1],
        [x1, y1],
      ]);
      sides.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [
        [z1, y0],
        [z0, y0],
        [z0, y1],
        [z1, y1],
      ]);
      sides.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [
        [z0, y0],
        [z1, y0],
        [z1, y1],
        [z0, y1],
      ]);
      sides.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ]);
    }

    this.group.add(
      new THREE.Mesh(rockTop.build(), new THREE.MeshLambertMaterial({ map: blackstoneTexture() })),
      // La piedra luminosa brilla un poco sola: avisa "esta cuesta" desde la penumbra.
      new THREE.Mesh(
        glowTop.build(),
        new THREE.MeshLambertMaterial({ map: glowstoneTexture(), emissive: "#7a4a10", emissiveIntensity: 0.9 }),
      ),
      new THREE.Mesh(sides.build(), new THREE.MeshLambertMaterial({ map: blackstoneSideTexture() })),
    );

    // Una bandera en cada cima (hay una por camino).
    for (const top of tower.plats.filter((p) => p.kind === "top")) {
      this.group.add(this.flag(top.x + top.w / 2 - 0.6, top.y, top.z));
    }
  }

  /** Bandera de bloques en la cima. */
  private flag(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), new THREE.MeshLambertMaterial({ color: "#d9d4c7" }));
    pole.position.set(0, 1.6, 0);
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.9, 0.08),
      new THREE.MeshLambertMaterial({ color: "#e2433b", emissive: "#401010" }),
    );
    cloth.position.set(0.75, 2.7, 0);
    g.add(pole, cloth);
    g.position.set(x, y, z);
    return g;
  }
}
