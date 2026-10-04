import * as THREE from "three";

/** Remeras de los asientos de la sala (las de los muñecos de la casa). */
export const SEAT_COLORS = ["#e2433b", "#3f7fe0", "#46b04a", "#f2c230", "#9b59d0", "#f08a2c", "#36c2c9", "#ef6fae"];
const SKINS = ["#e9b98f", "#c98e62", "#8d5a3b", "#f1c9a5"];
const PANTS = "#34406a";

export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % 8) + 8) % 8];
}

/** Cupula a rayas: gajos blancos y del color del asiento. */
function canopyTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 32;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#fff4dc" : color;
    g.fillRect(i * 32, 0, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cartel con el nombre (y lo que cobro): letra de bloque con sombra dura. */
function labelTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = "44px Righteous, sans-serif";
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w;
  c.height = 64;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(10, 6, 20, 0.6)";
  g.beginPath();
  g.roundRect(0, 4, w, 56, 28);
  g.fill();
  g.fillStyle = "#000";
  g.fillText(text, w / 2 + 2, 35);
  g.fillStyle = color;
  g.fillText(text, w / 2, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / 64 };
}

/**
 * Un jugador que se bajo: salta del cohete, abre el paracaidas y baja flotando,
 * meciendose, con su nombre. Vive unos segundos y se descarta.
 */
export class Parachute {
  readonly group = new THREE.Group();
  private readonly canopy: THREE.Group;
  private readonly rig = new THREE.Group();
  private vx: number;
  private vy: number;
  private age = 0;
  private readonly sway: number;
  readonly life = 9;

  constructor(seat: number, text: string, x: number, y: number, z: number, dir: number) {
    const shirt = seatColor(seat);
    const skin = SKINS[seat % SKINS.length];
    const lam = (color: string) => new THREE.MeshLambertMaterial({ color });

    // Muñeco de bloques (mismas proporciones que el de la casa, en chico).
    const doll = new THREE.Group();
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.12), lam(PANTS));
    legs.position.y = 0.15;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.14), lam(shirt));
    body.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), lam(skin));
    head.position.y = 0.72;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), lam(shirt));
    armL.position.set(-0.17, 0.62, 0);
    armL.rotation.z = 0.5;
    const armR = armL.clone();
    armR.position.x = 0.17;
    armR.rotation.z = -0.5;
    doll.add(legs, body, head, armL, armR);
    this.rig.add(doll);

    // Cupula + cuerdas.
    this.canopy = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.3),
      new THREE.MeshLambertMaterial({ map: canopyTexture(shirt), side: THREE.DoubleSide }),
    );
    dome.scale.y = 0.6;
    this.canopy.add(dome);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.68, 0.12, Math.sin(a) * 0.68), new THREE.Vector3(0, -1.0, 0));
    }
    this.canopy.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#e8dcc4" })));
    this.canopy.position.y = 1.75;
    this.canopy.scale.setScalar(0.01);
    this.rig.add(this.canopy);
    this.group.add(this.rig);

    const { tex, aspect } = labelTexture(text, shirt);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    label.scale.set(0.42 * aspect, 0.42, 1);
    label.position.y = 2.75;
    label.renderOrder = 10;
    this.group.add(label);

    this.group.position.set(x, y, z);
    this.vx = dir * (1.6 + Math.random() * 0.8);
    this.vy = 3.2;
    this.sway = Math.random() * 6;
  }

  /** Avanza; devuelve false cuando ya hay que sacarlo. */
  update(dt: number, time: number): boolean {
    this.age += dt;
    // Primero el salto (sube un poco y cae), despues abre y flota.
    const open = Math.min(1, Math.max(0, (this.age - 0.35) / 0.4));
    this.canopy.scale.setScalar(0.01 + open * 0.99);
    const terminal = -0.9 - (1 - open) * 6;
    this.vy = Math.max(terminal, this.vy - 9.8 * dt * (1 - open * 0.92));
    this.vx *= Math.exp(-dt * (0.4 + open * 0.8));
    this.group.position.x += this.vx * dt;
    this.group.position.y += this.vy * dt;
    this.rig.rotation.z = Math.sin(time * 1.6 + this.sway) * 0.18 * open;
    return this.age < this.life;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = ([] as (THREE.Material | undefined)[]).concat(m.material as THREE.Material | THREE.Material[] | undefined);
      for (const mat of mats) {
        (mat as { map?: THREE.Texture | null } | undefined)?.map?.dispose();
        mat?.dispose();
      }
    });
  }
}
