import * as THREE from "three";
import type { Arena } from "./Arena";
import { CELLS_PER_LAYER, GRID, LAYERS, cellCenterX, surfaceY } from "./constants";
import { bottomTexture, sideTexture, topTexture } from "./textures";

/** Bloques cayendo a la vez como maximo (el resto cae sin animacion). */
const DEBRIS_POOL = 90;
const DEBRIS_LIFE = 0.9;

interface Debris {
  mesh: THREE.Mesh;
  vy: number;
  spinX: number;
  spinZ: number;
  life: number;
}

/**
 * Dibuja los cuatro pisos: un `InstancedMesh` por piso (una textura por material
 * de cara), asi el mundo entero son cuatro mallas por mas bloques que tenga.
 *
 * Tres estados visibles por bloque, como pide DESIGN.md:
 *  - Entero: quieto, color de textura.
 *  - Mecha prendida: titila en blanco (color de instancia por encima de 1, que
 *    satura la textura) y se hunde un poco a medida que se consume.
 *  - Caido: la instancia se esconde (escala 0) y en su lugar sale un bloque suelto
 *    que cae girando y se encoge.
 */
export class FloorView {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly materials: THREE.Material[][] = [];
  /** Indice de instancia de cada celda dentro de la malla de su piso (-1 fuera). */
  private readonly instanceOf = new Int32Array(CELLS_PER_LAYER * LAYERS).fill(-1);
  /** Celdas animadas en el frame anterior, para devolverlas a su lugar. */
  private readonly animated = new Set<number>();
  private readonly debris: Debris[] = [];
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  private readonly arena: Arena;

  constructor(arena: Arena) {
    this.arena = arena;
    const bottom = bottomTexture();
    for (let layer = 0; layer < LAYERS; layer++) {
      const side = new THREE.MeshLambertMaterial({ map: sideTexture(layer) });
      const top = new THREE.MeshLambertMaterial({ map: topTexture(layer) });
      const base = new THREE.MeshLambertMaterial({ map: bottom });
      // Orden de caras de BoxGeometry: +x, -x, +y, -y, +z, -z.
      const faces = [side, side, top, base, side, side];
      this.materials.push(faces);

      const cells = arena.mask.filter((idx) => Math.floor(idx / CELLS_PER_LAYER) === layer);
      const mesh = new THREE.InstancedMesh(this.boxGeometry, faces, cells.length);
      // Los bloques escondidos (escala 0) confunden el volumen de culling; son
      // cuatro mallas, no vale la pena.
      mesh.frustumCulled = false;
      cells.forEach((idx, i) => {
        this.instanceOf[idx] = i;
        this.placeInstance(mesh, idx, i, 0, 0, 0, 1);
        mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    for (let i = 0; i < DEBRIS_POOL; i++) {
      const mesh = new THREE.Mesh(this.boxGeometry, this.materials[0]);
      mesh.visible = false;
      this.group.add(mesh);
      this.debris.push({ mesh, vy: 0, spinX: 0, spinZ: 0, life: 0 });
    }
  }

  /** Redibuja todo el piso segun el estado de la arena (despues de un `dr:init`). */
  syncAll(): void {
    for (const idx of this.arena.mask) {
      if (this.arena.isSolidIndex(idx)) this.restore(idx);
      else this.hide(idx);
    }
  }

  /** Un bloque cayo: se esconde y sale el bloque suelto. */
  drop(idx: number, animate: boolean): void {
    this.hide(idx);
    if (!animate) return;
    const d = this.debris.find((item) => item.life <= 0);
    if (!d) return;
    const layer = Math.floor(idx / CELLS_PER_LAYER);
    const rest = idx % CELLS_PER_LAYER;
    d.mesh.material = this.materials[layer];
    d.mesh.position.set(cellCenterX(rest % GRID), surfaceY(layer) - 0.62, cellCenterX(Math.floor(rest / GRID)));
    d.mesh.rotation.set(0, 0, 0);
    d.mesh.scale.setScalar(0.96);
    d.mesh.visible = true;
    d.vy = -1.5;
    d.spinX = (Math.random() - 0.5) * 5;
    d.spinZ = (Math.random() - 0.5) * 5;
    d.life = DEBRIS_LIFE;
  }

  /** El server corrigio una prediccion: el bloque vuelve a estar. */
  restore(idx: number): void {
    const layer = Math.floor(idx / CELLS_PER_LAYER);
    const i = this.instanceOf[idx];
    if (i < 0) return;
    const mesh = this.meshes[layer];
    this.placeInstance(mesh, idx, i, 0, 0, 0, 1);
    mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.animated.delete(idx);
  }

  update(dt: number, now: number): void {
    const touched = new Set<number>();

    // Mecha: titileo blanco + hundimiento proporcional a lo consumido.
    const blink = Math.floor(now / 70) % 2 === 0;
    for (const idx of this.arena.fusingCells) {
      const layer = Math.floor(idx / CELLS_PER_LAYER);
      const i = this.instanceOf[idx];
      if (i < 0) continue;
      const f = this.arena.fuse(idx, now);
      const mesh = this.meshes[layer];
      const jitter = 0.035 * f;
      this.placeInstance(
        mesh,
        idx,
        i,
        (Math.random() - 0.5) * jitter,
        -0.14 * f,
        (Math.random() - 0.5) * jitter,
        1,
      );
      // Por encima de 1 el color de instancia satura la textura hacia el blanco.
      const flash = blink ? 1.25 + f * 1.1 : 1.05;
      mesh.setColorAt(i, this.color.setRGB(flash, flash, flash));
      touched.add(layer);
      this.animated.add(idx);
    }
    // Los que dejaron de titilar sin caer (restaurados) vuelven a su lugar.
    for (const idx of this.animated) {
      if (this.arena.fusingCells.has(idx)) continue;
      this.animated.delete(idx);
      if (this.arena.isSolidIndex(idx)) this.restore(idx);
    }
    for (const layer of touched) {
      const mesh = this.meshes[layer];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 26 * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.rotation.x += d.spinX * dt;
      d.mesh.rotation.z += d.spinZ * dt;
      d.mesh.scale.setScalar(Math.max(0.01, 0.96 * (d.life / DEBRIS_LIFE)));
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  private hide(idx: number): void {
    const layer = Math.floor(idx / CELLS_PER_LAYER);
    const i = this.instanceOf[idx];
    if (i < 0) return;
    const mesh = this.meshes[layer];
    this.placeInstance(mesh, idx, i, 0, 0, 0, 0);
    mesh.instanceMatrix.needsUpdate = true;
    this.animated.delete(idx);
  }

  private placeInstance(
    mesh: THREE.InstancedMesh,
    idx: number,
    i: number,
    dx: number,
    dy: number,
    dz: number,
    scale: number,
  ): void {
    const layer = Math.floor(idx / CELLS_PER_LAYER);
    const rest = idx % CELLS_PER_LAYER;
    this.dummy.position.set(
      cellCenterX(rest % GRID) + dx,
      surfaceY(layer) - 0.5 + dy,
      cellCenterX(Math.floor(rest / GRID)) + dz,
    );
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix);
  }
}
