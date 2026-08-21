import * as THREE from "three";
import { CANDY_RADIUS, COLOR_RELIC } from "./constants";

/**
 * The relic: a blood-ruby crystal that hovers at the centre of the cell and
 * tempts the bird into danger. Glows the same red as the far windows so the
 * eye reads reward and threat as one colour (see DESIGN.md).
 */
export class Candy {
  readonly object = new THREE.Group();
  private active = false;
  private spin = 0;
  private readonly light: THREE.PointLight;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_RELIC,
      emissive: new THREE.Color(COLOR_RELIC),
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.3,
      flatShading: true,
    });
    // Faceted crystal: a stretched octahedron core with a girdle.
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(CANDY_RADIUS, 0), mat);
    core.scale.set(0.8, 1.25, 0.8);
    this.object.add(core);

    const dark = new THREE.MeshStandardMaterial({
      color: 0x2a0308,
      roughness: 0.6,
      metalness: 0.4,
    });
    // A tarnished gold clasp around the middle for a reliquary feel.
    const clasp = new THREE.Mesh(new THREE.TorusGeometry(CANDY_RADIUS * 0.62, 0.06, 8, 16), dark);
    clasp.rotation.x = Math.PI / 2;
    this.object.add(clasp);

    this.light = new THREE.PointLight(COLOR_RELIC, 0, 4, 2);
    this.object.add(this.light);

    this.object.visible = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  spawn(y: number): void {
    this.object.position.set(0, y, 0);
    this.object.visible = true;
    this.active = true;
    this.spin = 0;
    this.light.intensity = 1.6;
  }

  collect(): void {
    this.active = false;
    this.object.visible = false;
    this.light.intensity = 0;
  }

  reset(): void {
    this.collect();
  }

  update(dt: number): void {
    if (!this.active) return;
    this.spin += dt;
    this.object.rotation.y = this.spin * 1.8;
    this.object.position.y += Math.sin(this.spin * 2) * 0.003;
    this.light.intensity = 1.4 + Math.sin(this.spin * 6) * 0.4;
  }
}
