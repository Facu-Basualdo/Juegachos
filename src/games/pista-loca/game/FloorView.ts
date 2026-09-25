import * as THREE from "three";
import type { Floor } from "./Floor";
import { CELLS, CENTER, GRID, WOOL, cellCenter } from "./constants";
import { woolTexture } from "./textures";

const DEBRIS_POOL = 160;
const DEBRIS_LIFE = 1.0;
/** Rearmado: cada bloque sube desde abajo, con un retraso segun su distancia al centro. */
const RISE_TIME = 0.32;
const RISE_STAGGER = 0.022;
const RISE_FROM = -5;

interface Debris {
  mesh: THREE.Mesh;
  vy: number;
  spinX: number;
  spinZ: number;
  life: number;
}

/**
 * La pista: UNA sola `InstancedMesh` de lana en grises, teñida por instancia
 * (DESIGN.md). Cambiar el dibujo es reescribir los colores de las instancias.
 *
 * - `rebuild`: la pista entera vuelve a armarse desde abajo, como un telon que sube.
 * - `drop`: los bloques que no son del color pedido se esconden y en su lugar sale
 *   un bloque suelto que cae girando y se encoge (lo mismo que Derrumbe).
 */
export class FloorView {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly debris: Debris[] = [];
  private readonly debrisMats = new Map<number, THREE.MeshLambertMaterial>();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  /** Segundos desde que arranco el rearmado (-1 = quieto). */
  private riseT = -1;
  private readonly floor: Floor;

  constructor(floor: Floor) {
    this.floor = floor;
    this.material = new THREE.MeshLambertMaterial({ map: woolTexture() });
    this.mesh = new THREE.InstancedMesh(this.box, this.material, CELLS);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < CELLS; i++) {
      this.place(i, 0, 1);
      this.mesh.setColorAt(i, this.color.set(WOOL[9].hex));
    }
    this.group.add(this.mesh);

    const tex = this.material.map;
    WOOL.forEach((w, i) => {
      this.debrisMats.set(i, new THREE.MeshLambertMaterial({ map: tex, color: w.hex }));
    });
    for (let i = 0; i < DEBRIS_POOL; i++) {
      const mesh = new THREE.Mesh(this.box, this.debrisMats.get(0));
      mesh.visible = false;
      this.group.add(mesh);
      this.debris.push({ mesh, vy: 0, spinX: 0, spinZ: 0, life: 0 });
    }
    this.commit();
  }

  /** Aplica los colores del dibujo actual de la pista. `animate` = que suba desde abajo. */
  rebuild(animate: boolean): void {
    for (let i = 0; i < CELLS; i++) {
      this.mesh.setColorAt(i, this.color.set(WOOL[this.floor.colors[i]]?.hex ?? "#ffffff"));
      this.place(i, animate ? RISE_FROM : 0, 1);
    }
    this.riseT = animate ? 0 : -1;
    this.commit();
  }

  /** Cayeron estas celdas. */
  drop(cells: number[]): void {
    let free = 0;
    for (const i of cells) {
      this.place(i, 0, 0);
      // Solo una parte cae animada (el pool es finito); el resto desaparece.
      while (free < this.debris.length && this.debris[free].life > 0) free++;
      if (free >= this.debris.length || Math.random() > 0.45) continue;
      const d = this.debris[free];
      d.mesh.material = this.debrisMats.get(this.floor.colors[i]) ?? this.material;
      d.mesh.position.set(cellCenter(i % GRID), -0.55, cellCenter(Math.floor(i / GRID)));
      d.mesh.rotation.set(0, 0, 0);
      d.mesh.scale.setScalar(0.95);
      d.mesh.visible = true;
      d.vy = -1 - Math.random() * 2;
      d.spinX = (Math.random() - 0.5) * 6;
      d.spinZ = (Math.random() - 0.5) * 6;
      d.life = DEBRIS_LIFE * (0.7 + Math.random() * 0.3);
    }
    this.commit();
  }

  update(dt: number): void {
    if (this.riseT >= 0) {
      this.riseT += dt;
      let done = true;
      for (let i = 0; i < CELLS; i++) {
        const dist = Math.hypot((i % GRID) - CENTER, Math.floor(i / GRID) - CENTER);
        const t = (this.riseT - dist * RISE_STAGGER) / RISE_TIME;
        const f = Math.max(0, Math.min(1, t));
        if (f < 1) done = false;
        // Sube con un rebote chico al llegar.
        const ease = 1 - Math.pow(1 - f, 3);
        this.place(i, RISE_FROM * (1 - ease), 1);
      }
      this.commit();
      if (done) this.riseT = -1;
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 26 * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.rotation.x += d.spinX * dt;
      d.mesh.rotation.z += d.spinZ * dt;
      d.mesh.scale.setScalar(Math.max(0.01, 0.95 * (d.life / DEBRIS_LIFE)));
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  private place(i: number, dy: number, scale: number): void {
    this.dummy.position.set(cellCenter(i % GRID), -0.5 + dy, cellCenter(Math.floor(i / GRID)));
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  private commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
