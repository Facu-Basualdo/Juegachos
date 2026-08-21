import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { getDotTexture } from "./dotTexture";
import { RAMP_LENGTH, SLOPE_ANGLE, rampPoint } from "./ramp";
import {
  COLOR_STONE,
  COLOR_IRON_DARK,
  COLOR_EMBER,
  COLOR_EMBER_DEEP,
  COLOR_GOLD,
} from "./constants";

const MOTE_COUNT = 90;

/** Textura de muro: reja industrial oscura, apenas legible, para que la piedra
 * no lea como plastico liso pero tampoco compita con la escalera. */
function wallTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#14151c";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(120, 128, 145, 0.16)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i * size) / 4;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  for (let i = 0; i < 160; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 10);
  return tex;
}

/**
 * El hueco alrededor de la escalera: muros de reja, vigas, cadenas colgando,
 * lamparas de aviso ambar (la unica luz calida) y polvo en suspension. Es
 * escenografia: nada de aca colisiona ni puntua, solo encierra.
 */
export class Environment {
  readonly object = new THREE.Group();
  readonly lights = new THREE.Group();

  private readonly lamps: { mesh: THREE.Mesh; light: THREE.PointLight; seed: number }[] = [];
  private motes!: THREE.Points;
  private readonly moteSpeed: number[] = [];

  constructor() {
    this.buildWalls();
    this.buildGirders();
    this.buildChains();
    this.buildLamps();
    this.buildMotes();
  }

  private buildWalls(): void {
    const tex = wallTexture();
    const mat = toonMat(COLOR_STONE);
    mat.map = tex;

    const mid = rampPoint(0.5);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 13, RAMP_LENGTH + 8), mat);
      wall.position.set(side * 6.2, mid.y + 2.2, mid.z - 1.5);
      wall.rotation.x = SLOPE_ANGLE * 0.35; // acompaña la subida sin ser paralelo
      wall.receiveShadow = true;
      this.object.add(wall);
    }

    // Fondo: pared del final del hueco, para que arriba no sea vacio absoluto.
    const back = new THREE.Mesh(new THREE.BoxGeometry(14, 16, 0.6), mat);
    back.position.set(0, 6.5, -14.5);
    this.object.add(back);
  }

  private buildGirders(): void {
    const mat = toonMat(COLOR_IRON_DARK);
    // Solo por detras del rack de pantallas (z <= -2): una viga cruzando por
    // delante tapaba justo la flecha, que es lo unico que hay que leer.
    for (let i = 0; i < 5; i++) {
      const z = -2 - i * 3.6;
      const t = (-2 - z) / 18;
      const y = 9.6 + t * 3.2;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, 0.55), mat);
      beam.position.set(0, y, z);
      this.object.add(beam);

      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.2, 0.4), mat);
        post.position.set(side * 5.6, y - 1.6, z);
        this.object.add(post);
      }
    }
  }

  private buildChains(): void {
    const mat = toonMat(COLOR_IRON_DARK);
    const geo = new THREE.CylinderGeometry(0.045, 0.045, 1, 5);
    for (let i = 0; i < 9; i++) {
      const side = i % 2 ? 1 : -1;
      const z = 0.4 - i * 2.1;
      const len = 1.6 + Math.random() * 3.4;
      const chain = new THREE.Mesh(geo, mat);
      chain.scale.y = len;
      chain.position.set(side * (4.2 + Math.random() * 1.4), 9.8 - len / 2 + Math.random(), z);
      this.object.add(chain);

      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 5, 8), mat);
      hook.position.copy(chain.position);
      hook.position.y -= len / 2;
      hook.rotation.y = Math.PI / 2;
      this.object.add(hook);
    }
  }

  private buildLamps(): void {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const t = 0.18 + (i / 3) * 0.66;
      const at = rampPoint(t);

      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.5, 0.4),
        toonMat(COLOR_IRON_DARK),
      );
      housing.position.set(side * 4.5, at.y + 3.1, at.z);
      this.object.add(housing);

      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 10, 8),
        glowMat(COLOR_EMBER, 0.95),
      );
      bulb.position.copy(housing.position);
      bulb.position.x -= side * 0.26;
      this.object.add(bulb);

      const cage = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.03, 5, 10),
        toonMat(COLOR_GOLD),
      );
      cage.position.copy(bulb.position);
      cage.rotation.y = Math.PI / 2;
      this.object.add(cage);

      // Sin sombras: son cuatro y solo aportan temperatura, no informacion.
      const light = new THREE.PointLight(COLOR_EMBER_DEEP, 12, 9, 2);
      light.position.copy(bulb.position);
      this.lights.add(light);

      this.lamps.push({ mesh: bulb, light, seed: Math.random() * 10 });
    }
  }

  private buildMotes(): void {
    const positions = new Float32Array(MOTE_COUNT * 3);
    for (let i = 0; i < MOTE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 11;
      positions[i * 3 + 1] = Math.random() * 12;
      positions[i * 3 + 2] = -12 + Math.random() * 20;
      this.moteSpeed.push(0.25 + Math.random() * 0.7);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09,
      map: getDotTexture(),
      color: 0xb9b2a0,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, mat);
    this.object.add(this.motes);
  }

  update(dt: number, elapsed: number): void {
    // Parpadeo de lamparas: senos superpuestos + ruido, nunca un ciclo limpio.
    for (const lamp of this.lamps) {
      const f =
        0.72 +
        Math.sin(elapsed * 7.3 + lamp.seed) * 0.12 +
        Math.sin(elapsed * 2.1 + lamp.seed * 3) * 0.1 +
        Math.random() * 0.06;
      lamp.light.intensity = 12 * f;
      (lamp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + f * 0.45;
    }

    // Polvo cayendo: refuerza que todo en este hueco baja.
    const pos = this.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < MOTE_COUNT; i++) {
      let y = pos.getY(i) - this.moteSpeed[i] * dt;
      if (y < -1) y = 12;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }
}
