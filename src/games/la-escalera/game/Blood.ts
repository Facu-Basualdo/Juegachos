import * as THREE from "three";
import { PIT_FLOOR_Y, COLOR_BLOOD, COLOR_BLOOD_DARK } from "./constants";

interface Drop {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

let splatTexture: THREE.CanvasTexture | null = null;

/** Mancha irregular con salpicaduras satelite: una sola textura, rotada y
 * escalada al azar en cada calco, alcanza para que ninguna se repita a la vista. */
function getSplatTexture(): THREE.CanvasTexture {
  if (splatTexture) return splatTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";

  // Cuerpo central: un circulo deformado por ruido radial.
  ctx.beginPath();
  const c = size / 2;
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = c * (0.42 + Math.sin(a * 3 + 1.2) * 0.08 + Math.sin(a * 7) * 0.05 + Math.random() * 0.05);
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Gotas sueltas alrededor.
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = c * (0.45 + Math.random() * 0.5);
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 1.5 + Math.random() * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  splatTexture = new THREE.CanvasTexture(canvas);
  splatTexture.colorSpace = THREE.SRGBColorSpace;
  return splatTexture;
}

const MAX_DECALS = 90;

/**
 * Sangre. Se dispara una sola vez, cuando el cuerpo llega a las puas, y tiene
 * que ser desmedida: un estallido de gotas que vuelan y caen, un chorro que
 * sigue saliendo un par de segundos, calcos que se acumulan en el fondo del
 * pozo, hilos escurriendo por los hierros y un charco que crece y no para.
 *
 * Es puramente cosmetico: no toca el estado del juego ni la colision.
 */
export class Blood {
  readonly object = new THREE.Group();

  private readonly drops: Drop[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private readonly drips: THREE.Mesh[] = [];
  private pool: THREE.Mesh | null = null;
  private poolScale = 0;
  private gushTime = 0;
  private readonly gushAt = new THREE.Vector3();

  private static readonly DROP_GEO = new THREE.SphereGeometry(0.045, 5, 4);
  private static readonly DECAL_GEO = new THREE.PlaneGeometry(1, 1);

  private readonly dropMat = new THREE.MeshBasicMaterial({ color: COLOR_BLOOD, fog: false });
  private readonly decalMat = new THREE.MeshBasicMaterial({
    map: getSplatTexture(),
    color: COLOR_BLOOD,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    fog: false,
  });
  private readonly poolMat = new THREE.MeshBasicMaterial({
    map: getSplatTexture(),
    color: COLOR_BLOOD_DARK,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    fog: false,
  });

  /** El cuerpo toco las puas: reventa todo. */
  burst(at: THREE.Vector3): void {
    this.gushAt.copy(at);
    this.gushTime = 2.2;

    for (let i = 0; i < 110; i++) this.spawnDrop(at, 7.5);

    // Salpicadura inmediata alrededor del impacto.
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 1.9;
      this.addDecal(at.x + Math.cos(a) * d, at.z + Math.sin(a) * d, 0.35 + Math.random() * 0.8);
    }

    // Hilos escurriendo por los hierros, justo debajo del cuerpo.
    for (let i = 0; i < 9; i++) {
      const drip = new THREE.Mesh(Blood.DECAL_GEO, this.decalMat);
      const len = 0.5 + Math.random() * 1.1;
      drip.scale.set(0.1 + Math.random() * 0.13, len, 1);
      drip.position.set(
        at.x + (Math.random() - 0.5) * 1.5,
        at.y - len / 2 + 0.15,
        at.z + 0.35 + Math.random() * 0.5,
      );
      this.object.add(drip);
      this.drips.push(drip);
    }

    // Charco que crece debajo de todo.
    this.pool = new THREE.Mesh(Blood.DECAL_GEO, this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(at.x, PIT_FLOOR_Y + 0.008, at.z);
    this.pool.scale.setScalar(0.01);
    this.poolScale = 0.01;
    this.object.add(this.pool);
  }

  private spawnDrop(at: THREE.Vector3, speed: number): void {
    const mesh = new THREE.Mesh(Blood.DROP_GEO, this.dropMat);
    mesh.position.copy(at);
    mesh.position.x += (Math.random() - 0.5) * 0.5;
    mesh.position.z += (Math.random() - 0.5) * 0.5;
    const dir = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 1.5 + 0.2,
      (Math.random() - 0.5) * 2,
    ).normalize();
    const s = speed * (0.25 + Math.random());
    mesh.scale.setScalar(0.6 + Math.random() * 1.5);
    this.object.add(mesh);
    this.drops.push({ mesh, vel: dir.multiplyScalar(s), life: 3 });
  }

  private addDecal(x: number, z: number, scale: number): void {
    const decal = new THREE.Mesh(Blood.DECAL_GEO, this.decalMat);
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = Math.random() * Math.PI * 2;
    decal.position.set(x, PIT_FLOOR_Y + 0.014 + this.decals.length * 0.0006, z);
    decal.scale.set(scale, scale * (0.7 + Math.random() * 0.6), 1);
    this.object.add(decal);
    this.decals.push(decal);

    if (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift()!;
      this.object.remove(old);
    }
  }

  reset(): void {
    for (const d of this.drops) this.object.remove(d.mesh);
    this.drops.length = 0;
    for (const d of this.decals) this.object.remove(d);
    this.decals.length = 0;
    for (const d of this.drips) this.object.remove(d);
    this.drips.length = 0;
    if (this.pool) {
      this.object.remove(this.pool);
      this.pool = null;
    }
    this.poolScale = 0;
    this.gushTime = 0;
  }

  update(dt: number): void {
    // Chorro: sigue saliendo un rato despues del golpe.
    if (this.gushTime > 0) {
      this.gushTime -= dt;
      const rate = Math.max(0, this.gushTime / 2.2);
      const n = Math.round(rate * 5);
      for (let i = 0; i < n; i++) this.spawnDrop(this.gushAt, 3.2);
    }

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      d.vel.y -= 20 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      // Al tocar el fondo del pozo la gota se convierte en mancha.
      if (d.mesh.position.y <= PIT_FLOOR_Y + 0.02 || d.life <= 0) {
        this.object.remove(d.mesh);
        this.drops.splice(i, 1);
        if (d.life > 0) {
          this.addDecal(d.mesh.position.x, d.mesh.position.z, 0.18 + Math.random() * 0.45);
        }
      }
    }

    // El charco crece y se queda: la partida termino, la mancha no.
    if (this.pool) {
      this.poolScale += (3.4 - this.poolScale) * Math.min(1, dt * 0.9);
      this.pool.scale.set(this.poolScale, this.poolScale * 0.8, 1);
    }
  }
}
