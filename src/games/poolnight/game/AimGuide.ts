import * as THREE from "three";
import { BALL_R, HALF_L, HALF_W } from "./constants";

/**
 * La guia de punteria: se dibuja SOBRE el paño (DESIGN.md: la informacion vive en el mundo,
 * no en un panel). Es pura geometria del lado del cliente: la linea de la blanca hasta el
 * primer contacto, la bola fantasma ahi, y las dos salidas (la de la bola golpeada y la
 * de la blanca). **No predice el efecto ni las bandas**, a proposito: ahi esta la dificultad.
 */

export interface PredictBall {
  x: number;
  z: number;
  alive: boolean;
}

const Y = 0.0045;

export class AimGuide {
  readonly group = new THREE.Group();
  private readonly main: THREE.Line;
  private readonly objectLine: THREE.Line;
  private readonly cueLine: THREE.Line;
  private readonly ring: THREE.Mesh;
  private readonly mainPos = new Float32Array(6);
  private readonly objPos = new Float32Array(6);
  private readonly cuePos = new Float32Array(6);
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(scene: THREE.Scene) {
    const mk = (pos: Float32Array, color: number, opacity: number, dashed: boolean): THREE.Line => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.045, gapSize: 0.03, depthWrite: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      this.disposables.push(geo, mat);
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.group.add(line);
      return line;
    };
    this.main = mk(this.mainPos, 0xfff1cf, 0.8, true);
    this.objectLine = mk(this.objPos, 0xfff1cf, 0.5, false);
    this.cueLine = mk(this.cuePos, 0xfff1cf, 0.3, false);

    const ringGeo = new THREE.RingGeometry(BALL_R - 0.0025, BALL_R, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    this.disposables.push(ringGeo, ringMat);
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);

    this.group.visible = false;
    scene.add(this.group);
  }

  setColor(hex: number): void {
    for (const l of [this.main, this.objectLine, this.cueLine]) (l.material as THREE.LineBasicMaterial).color.setHex(hex);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  hide(): void {
    this.group.visible = false;
  }

  /** Dibuja la guia desde la blanca (cx, cz) hacia `angle`. Las bolas del tablero son las que se esquivan. */
  update(balls: PredictBall[], cx: number, cz: number, angle: number): void {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);

    // Hasta donde llega la blanca sin tocar nada: la banda (el centro no puede pasar de HALF - R).
    let tBest = Infinity;
    if (dx > 1e-9) tBest = Math.min(tBest, (HALF_L - BALL_R - cx) / dx);
    if (dx < -1e-9) tBest = Math.min(tBest, (-HALF_L + BALL_R - cx) / dx);
    if (dz > 1e-9) tBest = Math.min(tBest, (HALF_W - BALL_R - cz) / dz);
    if (dz < -1e-9) tBest = Math.min(tBest, (-HALF_W + BALL_R - cz) / dz);
    tBest = Math.max(0, tBest);

    // La primera bola que le cierra el paso: choque de circulos de radio 2R.
    let hit = -1;
    for (let i = 1; i < balls.length; i++) {
      if (!balls[i].alive) continue;
      const rx = cx - balls[i].x;
      const rz = cz - balls[i].z;
      const b = rx * dx + rz * dz;
      const c = rx * rx + rz * rz - 4 * BALL_R * BALL_R;
      if (c < 0) continue;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < tBest) {
        tBest = t;
        hit = i;
      }
    }

    const gx = cx + dx * tBest;
    const gz = cz + dz * tBest;
    this.setLine(this.mainPos, this.main, cx, cz, gx, gz);
    this.ring.position.set(gx, Y, gz);

    if (hit < 0) {
      this.objectLine.visible = false;
      this.cueLine.visible = false;
    } else {
      const ox = balls[hit].x;
      const oz = balls[hit].z;
      // La bola golpeada sale por la linea de centros (del fantasma a su centro).
      const nx = (ox - gx) / (2 * BALL_R);
      const nz = (oz - gz) / (2 * BALL_R);
      this.setLine(this.objPos, this.objectLine, ox, oz, ox + nx * 0.45, oz + nz * 0.45);
      this.objectLine.visible = true;
      // La blanca sale por la tangente (sin efecto).
      const dot = dx * nx + dz * nz;
      let tx = dx - dot * nx;
      let tz = dz - dot * nz;
      const tl = Math.hypot(tx, tz);
      if (tl > 0.05) {
        tx /= tl;
        tz /= tl;
        this.setLine(this.cuePos, this.cueLine, gx, gz, gx + tx * 0.3 * tl, gz + tz * 0.3 * tl);
        this.cueLine.visible = true;
      } else {
        this.cueLine.visible = false;
      }
    }
    this.group.visible = true;
  }

  private setLine(buf: Float32Array, line: THREE.Line, ax: number, az: number, bx: number, bz: number): void {
    buf[0] = ax;
    buf[1] = Y;
    buf[2] = az;
    buf[3] = bx;
    buf[4] = Y;
    buf[5] = bz;
    const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
