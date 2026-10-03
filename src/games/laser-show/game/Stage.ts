import * as THREE from "three";
import { GOLD, PYLON_R, STAGE_R } from "./constants";
import { glowTexture, screenTexture, stageTopTexture } from "./textures";

const STUDIO = new THREE.Color("#0b0820");
const BULBS = 84;
/** Altura de la torre del centro. */
export const PYLON_H = 2.3;
const AUDIENCE = 520;

/**
 * El estudio (DESIGN.md "Prime Time"): un escenario laqueado colgado sobre un foso
 * oscuro, con la torre de lasers en el centro, la marquesina de bombitas doradas en
 * el borde, las gradas con el publico en silueta y la pantalla gigante del fondo.
 * Todo lo que no es el escenario esta apagado, para que los lasers griten.
 */
export class Stage {
  private readonly bulbs: THREE.InstancedMesh;
  private readonly bulbColor = new THREE.Color();
  private readonly head = new THREE.Group();
  private readonly headMat: THREE.MeshBasicMaterial;
  private readonly headGlow: THREE.Sprite;
  private readonly spots = new THREE.Group();
  private readonly phones: THREE.InstancedMesh;
  private readonly phoneOn: Float32Array;
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.background = STUDIO;
    scene.fog = new THREE.Fog(STUDIO, 30, 70);
    scene.add(new THREE.HemisphereLight("#b9b2ff", "#1a0f30", 1.0));
    const key = new THREE.DirectionalLight("#ffffff", 1.2);
    key.position.set(5, 20, 12);
    scene.add(key);

    this.buildStage(scene);
    this.bulbs = this.buildBulbs(scene);
    this.headMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    this.headGlow = this.buildPylon(scene);
    this.buildStudio(scene);
    const { phones, on } = this.buildAudience(scene);
    this.phones = phones;
    this.phoneOn = on;
    this.buildSpots(scene);
    this.setPylon(null);
  }

  private buildStage(scene: THREE.Scene): void {
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(STAGE_R, 96),
      new THREE.MeshPhongMaterial({ map: stageTopTexture(), shininess: 90, specular: "#5a5aa0" }),
    );
    top.rotation.x = -Math.PI / 2;
    scene.add(top);
    // Canto blanco laqueado y una pollera dorada que se angosta hacia abajo.
    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(STAGE_R, STAGE_R, 0.5, 96, 1, true),
      new THREE.MeshPhongMaterial({ color: "#f4f1ff", shininess: 120, specular: "#ffffff" }),
    );
    side.position.y = -0.25;
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(STAGE_R, STAGE_R * 0.55, 2.2, 96, 1, true),
      new THREE.MeshPhongMaterial({ color: "#5a3a12", emissive: "#2a1606", shininess: 60 }),
    );
    skirt.position.y = -1.6;
    scene.add(side, skirt);
  }

  /** Marquesina: bombitas doradas en el canto del escenario, corriendo en ronda. */
  private buildBulbs(scene: THREE.Scene): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial(), BULBS);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < BULBS; i++) {
      const a = (i / BULBS) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * (STAGE_R + 0.02), -0.25, Math.sin(a) * (STAGE_R + 0.02));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, this.bulbColor.set(GOLD));
    }
    scene.add(mesh);
    return mesh;
  }

  /** La torre de lasers: columna blanca con aros de luz y un cabezal que gira. */
  private buildPylon(scene: THREE.Scene): THREE.Sprite {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(PYLON_R * 0.8, PYLON_R, PYLON_H, 32),
      new THREE.MeshPhongMaterial({ color: "#eeeaff", shininess: 110, specular: "#ffffff" }),
    );
    body.position.y = PYLON_H / 2;
    scene.add(body);
    for (const y of [0.35, 0.9, 1.45]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(PYLON_R * (1 - (y / PYLON_H) * 0.2) + 0.02, 0.05, 8, 40),
        new THREE.MeshBasicMaterial({ color: "#a77bff" }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      scene.add(ring);
    }
    // Cabezal: un disco con cuatro lentes, del color de la barrida que viene.
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(PYLON_R * 0.85, PYLON_R * 0.8, 0.35, 32),
      new THREE.MeshPhongMaterial({ color: "#2a2550", shininess: 80 }),
    );
    this.head.add(cap);
    for (let i = 0; i < 4; i++) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.12), this.headMat);
      const a = (i / 4) * Math.PI * 2;
      lens.position.set(Math.cos(a) * PYLON_R * 0.8, 0, Math.sin(a) * PYLON_R * 0.8);
      lens.lookAt(0, 0, 0);
      this.head.add(lens);
    }
    this.head.position.y = PYLON_H + 0.18;
    scene.add(this.head);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: "#ffffff",
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(3.2);
    glow.position.y = PYLON_H + 0.25;
    scene.add(glow);
    return glow;
  }

  /** Piso del estudio alrededor del foso y la pantalla gigante del fondo. */
  private buildStudio(scene: THREE.Scene): void {
    const floor = new THREE.Mesh(
      new THREE.RingGeometry(15, 60, 64),
      new THREE.MeshPhongMaterial({ color: "#140d2c", shininess: 40 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    scene.add(floor);
    // Borde del foso: una linea de luz violeta.
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(15, 0.08, 6, 96),
      new THREE.MeshBasicMaterial({ color: "#6b3cff" }),
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = -2.95;
    scene.add(lip);

    const screen = new THREE.Mesh(new THREE.PlaneGeometry(20, 7.5), new THREE.MeshBasicMaterial({ map: screenTexture() }));
    screen.position.set(0, 7, -30);
    scene.add(screen);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(20.8, 8.3), new THREE.MeshBasicMaterial({ color: GOLD }));
    frame.position.set(0, 7, -30.05);
    scene.add(frame);
  }

  /**
   * Publico en silueta en las gradas, todo alrededor, con alguna luz de celular que
   * se prende y se apaga. Cabezas en una sola InstancedMesh.
   */
  private buildAudience(scene: THREE.Scene): { phones: THREE.InstancedMesh; on: Float32Array } {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const heads = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.32, 0.5, 4, 8),
      new THREE.MeshLambertMaterial({ color: "#2a1d52" }),
      AUDIENCE,
    );
    const phones = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.26),
      new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide }),
      AUDIENCE,
    );
    const on = new Float32Array(AUDIENCE);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < AUDIENCE; i++) {
      const tier = i % 4;
      const r = 22 + tier * 2.4 + rand() * 0.6;
      const a = rand() * Math.PI * 2;
      const y = -2.4 + tier * 1.3;
      dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.9 + rand() * 0.3);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, color.setHSL(0.72 + rand() * 0.08, 0.3, 0.07 + rand() * 0.06));
      dummy.position.set(Math.cos(a) * (r - 0.4), y + 0.6, Math.sin(a) * (r - 0.4));
      dummy.lookAt(0, y + 0.6, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      phones.setMatrixAt(i, dummy.matrix);
      on[i] = rand() < 0.05 ? 1 : 0;
      phones.setColorAt(i, color.set(on[i] > 0 ? "#dfe8ff" : "#000000"));
    }
    scene.add(heads, phones);
    return { phones, on };
  }

  /** Cuatro haces de reflector que barren el aire, tenues para no lavar los lasers. */
  private buildSpots(scene: THREE.Scene): void {
    const h = 22;
    const geo = new THREE.ConeGeometry(2.4, h, 20, 1, true);
    geo.translate(0, -h / 2, 0);
    ["#a77bff", GOLD, "#ff8ad8", "#7fb0ff"].forEach((c, i) => {
      const beam = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: c,
          transparent: true,
          opacity: 0.045,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      beam.rotation.z = 0.5;
      const pivot = new THREE.Group();
      const a = (i / 4) * Math.PI * 2 + 0.6;
      pivot.position.set(Math.cos(a) * 18, 18, Math.sin(a) * 18);
      pivot.add(beam);
      pivot.userData.base = a;
      this.spots.add(pivot);
    });
    scene.add(this.spots);
  }

  /** El cabezal de la torre toma el color de la barrida que viene (null = en reposo). */
  setPylon(color: string | null): void {
    this.headMat.color.set(color ?? "#c8c0ff");
    (this.headGlow.material as THREE.SpriteMaterial).color.set(color ?? "#7d6bd6");
    (this.headGlow.material as THREE.SpriteMaterial).opacity = color ? 0.9 : 0.35;
  }

  update(dt: number): void {
    this.t += dt;
    // Marquesina: una de cada cuatro bombitas encendida, corriendo en ronda.
    const step = Math.floor(this.t * 12);
    for (let i = 0; i < BULBS; i++) {
      const lit = (i + step) % 4 === 0;
      this.bulbs.setColorAt(i, this.bulbColor.set(lit ? "#fff3c4" : "#7a5a18"));
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    this.head.rotation.y += dt * 1.6;
    this.spots.children.forEach((pivot, i) => {
      pivot.rotation.y = Math.sin(this.t * 0.35 + i * 1.7) * 0.9 + (pivot.userData.base as number);
      pivot.rotation.x = Math.sin(this.t * 0.5 + i) * 0.25;
    });
    // Celulares del publico: se prenden un rato y se apagan.
    let dirty = false;
    for (let i = 0; i < AUDIENCE; i += 7) {
      const k = (i * 13 + step) % 211;
      if (k === 0) {
        this.phoneOn[i] = this.phoneOn[i] > 0 ? 0 : 1;
        this.phones.setColorAt(i, this.bulbColor.set(this.phoneOn[i] > 0 ? "#dfe8ff" : "#000000"));
        dirty = true;
      }
    }
    if (dirty && this.phones.instanceColor) this.phones.instanceColor.needsUpdate = true;
  }
}
