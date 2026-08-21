import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { DIR_ROTATION, type Direction } from "./directions";
import {
  SCREEN_SIZE,
  SCREEN_Y,
  SCREEN_Z,
  COLOR_IRON_DARK,
  COLOR_IRON,
  COLOR_BONE,
  COLOR_EMBER,
  COLOR_RUBY,
  COLOR_GOLD_DEEP,
} from "./constants";

const MATRIX_GRID = 17;

let arrowTexture: THREE.CanvasTexture | null = null;

/**
 * Glifo de flecha (apuntando arriba) dibujado como matriz de puntos, igual que
 * los carteles de la sala de maquinas: la forma se rasteriza a una grilla y
 * cada celda encendida se pinta como un punto. Blanco sobre transparente; el
 * color lo pone el material de la pantalla.
 */
function getArrowTexture(): THREE.CanvasTexture {
  if (arrowTexture) return arrowTexture;

  // 1. Mascara chica: la flecha vectorial rasterizada a la grilla.
  const mask = document.createElement("canvas");
  mask.width = MATRIX_GRID;
  mask.height = MATRIX_GRID;
  const mctx = mask.getContext("2d")!;
  mctx.fillStyle = "#fff";
  mctx.beginPath();
  const s = MATRIX_GRID;
  mctx.moveTo(0.5 * s, 0.08 * s);
  mctx.lineTo(0.94 * s, 0.52 * s);
  mctx.lineTo(0.68 * s, 0.52 * s);
  mctx.lineTo(0.68 * s, 0.92 * s);
  mctx.lineTo(0.32 * s, 0.92 * s);
  mctx.lineTo(0.32 * s, 0.52 * s);
  mctx.lineTo(0.06 * s, 0.52 * s);
  mctx.closePath();
  mctx.fill();
  const data = mctx.getImageData(0, 0, MATRIX_GRID, MATRIX_GRID).data;

  // 2. Textura: un punto redondo por celda encendida.
  const size = 256;
  const cell = size / MATRIX_GRID;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < MATRIX_GRID; y++) {
    for (let x = 0; x < MATRIX_GRID; x++) {
      if (data[(y * MATRIX_GRID + x) * 4 + 3] < 110) continue;
      ctx.beginPath();
      ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  arrowTexture = new THREE.CanvasTexture(canvas);
  arrowTexture.colorSpace = THREE.SRGBColorSpace;
  return arrowTexture;
}

/**
 * El cartel colgado sobre la boca de la escalera: **una sola** pantalla de
 * matriz de puntos con la flecha que hay que apretar ahora, mas su barra de
 * tiempo. No hay fila de "las que vienen": la flecha actual es lo unico que el
 * jugador tiene que mirar, y cualquier cosa arriba de ella le roba el ojo.
 *
 * Feedback: el acierto **no** enciende nada (solo un golpe de escala, el cambio
 * de glifo ya avisa); el error tiñe la pantalla y su luz de rubi. Encender en
 * blanco cada acierto lavaba la pantalla varias veces por segundo.
 */
export class PromptRack {
  readonly object = new THREE.Group();
  /** Luz del cartel: tiñe la boca de la escalera. Ambar salvo cuando errás. */
  readonly light: THREE.PointLight;

  private readonly group = new THREE.Group();
  private readonly glyph: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly timerBar: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private missFlash = 0;
  private pop = 0;
  private readonly baseColor = new THREE.Color(COLOR_EMBER);
  private readonly missColor = new THREE.Color(COLOR_RUBY);
  private readonly color = new THREE.Color(COLOR_EMBER);

  constructor() {
    this.object.position.set(0, SCREEN_Y, SCREEN_Z);
    this.object.rotation.x = 0.16; // apenas inclinado hacia el jugador

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(SCREEN_SIZE * 1.16, SCREEN_SIZE * 1.16, 0.22),
      toonMat(COLOR_IRON_DARK),
    );
    frame.position.z = -0.08;
    this.group.add(frame);

    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_SIZE, SCREEN_SIZE),
      glowMat(COLOR_EMBER, 0.12),
    );
    this.panel.position.z = 0.05;
    this.group.add(this.panel);

    this.glyph = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_SIZE * 0.86, SCREEN_SIZE * 0.86),
      new THREE.MeshBasicMaterial({
        map: getArrowTexture(),
        color: COLOR_EMBER,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.glyph.position.z = 0.07;
    this.group.add(this.glyph);
    this.object.add(this.group);

    // Barra de tiempo bajo la pantalla: cuanto queda para esta flecha.
    const barBack = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_SIZE, 0.11),
      glowMat(COLOR_IRON, 0.6),
    );
    barBack.position.set(0, -SCREEN_SIZE * 0.62, 0.06);
    this.object.add(barBack);

    this.timerBar = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_SIZE, 0.11),
      glowMat(COLOR_BONE, 1),
    );
    this.timerBar.position.set(0, -SCREEN_SIZE * 0.62, 0.07);
    this.object.add(this.timerBar);

    // Viga y tensores de los que cuelga el cartel.
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(SCREEN_SIZE * 2.9, 0.32, 0.5),
      toonMat(COLOR_IRON_DARK),
    );
    beam.position.set(0, SCREEN_SIZE * 0.9, -0.1);
    this.object.add(beam);

    const rodGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6);
    for (const side of [-1, 1]) {
      const rod = new THREE.Mesh(rodGeo, toonMat(COLOR_IRON_DARK));
      rod.position.set(side * SCREEN_SIZE * 0.75, SCREEN_SIZE * 0.9 + 1.7, -0.1);
      this.object.add(rod);
    }

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(SCREEN_SIZE * 1.6, 0.16, 0.12),
      toonMat(COLOR_GOLD_DEEP),
    );
    plate.position.set(0, -SCREEN_SIZE * 0.78, 0.02);
    this.object.add(plate);

    this.light = new THREE.PointLight(COLOR_EMBER, 16, 12, 2);
    this.light.position.set(0, 0, 1.6);
    this.object.add(this.light);
  }

  /** Solo importa `queue[0]`: es la unica flecha que se muestra. */
  setQueue(queue: readonly Direction[]): void {
    if (queue.length > 0) this.glyph.rotation.z = DIR_ROTATION[queue[0]];
  }

  /** `p` en [0, 1]: cuanto tiempo le queda a la flecha actual. */
  setProgress(p: number): void {
    const clamped = Math.max(0, Math.min(1, p));
    this.timerBar.scale.x = clamped;
    // Se pone rubi cuando esta por vencerse: el aviso llega antes que el castigo.
    this.timerBar.material.color.set(clamped < 0.28 ? COLOR_RUBY : COLOR_BONE);
  }

  /** Acierto: golpe de escala, sin destello (ver comentario de la clase). */
  flashHit(): void {
    this.pop = 1;
  }

  flashMiss(): void {
    this.missFlash = 1;
  }

  reset(): void {
    this.missFlash = 0;
    this.pop = 0;
    this.setProgress(1);
  }

  update(dt: number, elapsed: number): void {
    this.missFlash = Math.max(0, this.missFlash - dt * 3.4);
    this.pop = Math.max(0, this.pop - dt * 5);

    this.color.copy(this.baseColor).lerp(this.missColor, this.missFlash);
    this.glyph.material.color.copy(this.color);
    this.panel.material.color.copy(this.color);
    this.panel.material.opacity = 0.12 + this.missFlash * 0.3;
    this.light.color.copy(this.color);
    this.light.intensity = 16 + this.missFlash * 30 + Math.sin(elapsed * 6) * 1.5;

    // Respiracion + golpe de escala del acierto: nunca esta del todo quieta.
    const breathe = 1 + Math.sin(elapsed * 4.2) * 0.015 + this.pop * 0.06;
    this.group.scale.setScalar(breathe);
  }
}
