import * as THREE from "three";
import { BALL_R, POCKET_HOLES, ballColor } from "./constants";

/**
 * Las 16 bolas. Cada una es una esfera de resina con barniz (clearcoat): lo que la hace
 * leer como bola de pool es la gota de luz de la lampara y el numero que gira con ella
 * (DESIGN.md: "Paño y Humo"). El texto y la franja se dibujan UNA vez en un canvas, y la
 * geometria es compartida. El giro sale de la velocidad angular de la fisica, asi que el
 * efecto (seguir, retroceso, lateral) se ve en como rota el numero.
 */

const TEX_W = 512;
const TEX_H = 256;

function bakeTexture(id: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const g = canvas.getContext("2d")!;
  const color = ballColor(id);
  const stripe = id > 8;

  if (stripe) {
    g.fillStyle = "#f3ecd8";
    g.fillRect(0, 0, TEX_W, TEX_H);
    g.fillStyle = color;
    g.fillRect(0, TEX_H * 0.24, TEX_W, TEX_H * 0.52);
  } else {
    g.fillStyle = color;
    g.fillRect(0, 0, TEX_W, TEX_H);
  }

  if (id === 0) {
    // La blanca no tiene numero: dos puntos chicos para que se vea hacia donde gira.
    g.fillStyle = "#7a7a7a";
    for (const cx of [TEX_W * 0.25, TEX_W * 0.75]) {
      g.beginPath();
      g.arc(cx, TEX_H / 2, 7, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    for (const cx of [TEX_W * 0.25, TEX_W * 0.75]) {
      g.fillStyle = "#f3ecd8";
      g.beginPath();
      g.arc(cx, TEX_H / 2, 40, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#101010";
      g.font = "bold 50px Arial, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(id), cx, TEX_H / 2 + 3);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class BallMeshes {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  private readonly textures: THREE.CanvasTexture[] = [];
  private readonly geometry = new THREE.SphereGeometry(BALL_R, 36, 24);
  private readonly axis = new THREE.Vector3();
  private readonly dq = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 16; i++) {
      const tex = bakeTexture(i);
      this.textures.push(tex);
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex,
        roughness: 0.22,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
      });
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.castShadow = true;
      mesh.position.y = BALL_R;
      // Cada bola arranca con su numero mirando para un lado distinto.
      mesh.rotation.set(Math.sin(i * 12.9898) * 3.1, Math.sin(i * 78.233) * 3.1, Math.sin(i * 37.719) * 3.1);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  /** Lo que reflejan las bolas (el paño abajo, la lampara arriba): ver `Game.buildReflections`. */
  setReflections(env: THREE.Texture, intensity: number): void {
    for (const m of this.meshes) {
      const mat = m.material as THREE.MeshPhysicalMaterial;
      mat.envMap = env;
      mat.envMapIntensity = intensity;
      mat.needsUpdate = true;
    }
  }

  setPos(i: number, x: number, z: number): void {
    const m = this.meshes[i];
    m.position.set(x, BALL_R, z);
    m.scale.setScalar(1);
  }

  setVisible(i: number, visible: boolean): void {
    this.meshes[i].visible = visible;
  }

  /** Gira la bola segun su velocidad angular (rad/s) durante `dt` segundos. */
  spin(i: number, wx: number, wy: number, wz: number, dt: number): void {
    const w = Math.hypot(wx, wy, wz);
    if (w < 1e-6) return;
    this.axis.set(wx / w, wy / w, wz / w);
    this.dq.setFromAxisAngle(this.axis, w * dt);
    this.meshes[i].quaternion.premultiply(this.dq);
  }

  /**
   * Caida a la tronera: `since` segundos desde que el centro cruzo el borde del paño. La bola
   * rueda hacia el centro del agujero y se hunde en la bolsa (no se achica: una bola de verdad no
   * cambia de tamaño). Devuelve false cuando ya no se ve.
   */
  drop(i: number, x: number, z: number, since: number): boolean {
    const m = this.meshes[i];
    let hole = POCKET_HOLES[0];
    let best = Infinity;
    for (const h of POCKET_HOLES) {
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < best) {
        best = d;
        hole = h;
      }
    }
    const t = Math.min(1, since / 0.32);
    const e = t * t * (3 - 2 * t);
    m.visible = since < 0.7;
    m.scale.setScalar(1);
    m.position.set(x + (hole.x - x) * e, BALL_R - 0.075 * t * t, z + (hole.z - z) * e);
    return m.visible;
  }

  dispose(): void {
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
    for (const t of this.textures) t.dispose();
    this.geometry.dispose();
  }
}
