import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import { DIR_ROTATION, type Direction } from "./directions";
import {
  PROMPT_VISIBLE,
  SCREEN_SIZE,
  SCREEN_SIZE_NEXT,
  SCREEN_GAP,
  SCREEN_ROW_LIFT,
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
 * color lo pone el material de cada pantalla.
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

interface Screen {
  group: THREE.Group;
  glyph: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

/**
 * El rack de monitores colgado sobre la boca de la escalera: una pantalla
 * grande con la flecha que hay que apretar AHORA y una fila chica arriba con
 * las que vienen. Es la unica fuente de informacion del juego, asi que es
 * tambien la unica cosa (con las lamparas y el pozo) a la que se le concede luz.
 */
export class PromptRack {
  readonly object = new THREE.Group();
  /** Luz del rack: tiñe la boca de la escalera segun acierto / error. */
  readonly light: THREE.PointLight;

  private readonly current: Screen;
  private readonly upcoming: Screen[] = [];
  private readonly timerBar: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private flash = 0;
  private flashColor = new THREE.Color(COLOR_EMBER);
  private readonly baseColor = new THREE.Color(COLOR_EMBER);

  constructor() {
    this.object.position.set(0, SCREEN_Y, SCREEN_Z);
    this.object.rotation.x = 0.16; // apenas inclinado hacia el jugador

    this.current = this.makeScreen(SCREEN_SIZE, COLOR_EMBER, 1);
    this.object.add(this.current.group);

    const lift = SCREEN_ROW_LIFT;
    for (let i = 0; i < PROMPT_VISIBLE - 1; i++) {
      const screen = this.makeScreen(SCREEN_SIZE_NEXT, COLOR_BONE, 0.46);
      screen.group.position.set((i - (PROMPT_VISIBLE - 2) / 2) * SCREEN_GAP, lift, 0);
      this.upcoming.push(screen);
      this.object.add(screen.group);
    }

    // Barra de tiempo bajo la pantalla grande: cuanto queda para esta flecha.
    const barBack = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_SIZE, 0.1),
      glowMat(COLOR_IRON, 0.6),
    );
    barBack.position.set(0, -SCREEN_SIZE * 0.62, 0.06);
    this.object.add(barBack);

    this.timerBar = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_SIZE, 0.1),
      glowMat(COLOR_BONE, 1),
    );
    this.timerBar.position.set(0, -SCREEN_SIZE * 0.62, 0.07);
    this.object.add(this.timerBar);

    // Viga de la que cuelga todo.
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(SCREEN_GAP * PROMPT_VISIBLE + 1.4, 0.32, 0.5),
      toonMat(COLOR_IRON_DARK),
    );
    beam.position.set(0, lift + SCREEN_SIZE_NEXT * 0.82, -0.1);
    this.object.add(beam);

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(SCREEN_SIZE * 1.9, 0.16, 0.12),
      toonMat(COLOR_GOLD_DEEP),
    );
    plate.position.set(0, -SCREEN_SIZE * 0.78, 0.02);
    this.object.add(plate);

    // De algo tiene que colgar: dos tensores que se van fuera de cuadro.
    const rodGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6);
    for (const side of [-1, 1]) {
      const rod = new THREE.Mesh(rodGeo, toonMat(COLOR_IRON_DARK));
      rod.position.set(side * (SCREEN_GAP * 1.6), lift + SCREEN_SIZE_NEXT * 0.82 + 1.7, -0.1);
      this.object.add(rod);
    }

    this.light = new THREE.PointLight(COLOR_EMBER, 20, 12, 2);
    this.light.position.set(0, 0, 1.6);
    this.object.add(this.light);
  }

  private makeScreen(size: number, color: number, glyphOpacity: number): Screen {
    const group = new THREE.Group();

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(size * 1.16, size * 1.16, 0.22),
      toonMat(COLOR_IRON_DARK),
    );
    frame.position.z = -0.08;
    group.add(frame);

    // Fondo del panel: negro con un tenue lavado del color de la pantalla.
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(size, size), glowMat(color, 0.1));
    panel.position.z = 0.05;
    group.add(panel);

    const glyph = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.86, size * 0.86),
      new THREE.MeshBasicMaterial({
        map: getArrowTexture(),
        color,
        transparent: true,
        opacity: glyphOpacity,
        depthWrite: false,
        fog: false,
      }),
    );
    glyph.position.z = 0.07;
    group.add(glyph);

    return { group, glyph, panel };
  }

  /** `queue[0]` es la flecha actual; el resto llena la fila de arriba. */
  setQueue(queue: readonly Direction[]): void {
    if (queue.length > 0) this.current.glyph.rotation.z = DIR_ROTATION[queue[0]];
    for (let i = 0; i < this.upcoming.length; i++) {
      const dir = queue[i + 1];
      const screen = this.upcoming[i];
      screen.group.visible = dir !== undefined;
      if (dir !== undefined) screen.glyph.rotation.z = DIR_ROTATION[dir];
    }
  }

  /** `p` en [0, 1]: cuanto tiempo le queda a la flecha actual. */
  setProgress(p: number): void {
    const clamped = Math.max(0, Math.min(1, p));
    this.timerBar.scale.x = clamped;
    // Se pone rubi cuando esta por vencerse: el aviso llega antes que el castigo.
    this.timerBar.material.color.set(clamped < 0.28 ? COLOR_RUBY : COLOR_BONE);
  }

  flashHit(): void {
    this.flash = 1;
    this.flashColor.set(COLOR_BONE);
  }

  flashMiss(): void {
    this.flash = 1;
    this.flashColor.set(COLOR_RUBY);
  }

  reset(): void {
    this.flash = 0;
    this.setProgress(1);
  }

  update(dt: number, elapsed: number): void {
    this.flash = Math.max(0, this.flash - dt * 3.4);

    const color = this.baseColor.clone().lerp(this.flashColor, this.flash);
    this.current.glyph.material.color.copy(color);
    this.current.panel.material.color.copy(color);
    this.current.panel.material.opacity = 0.12 + this.flash * 0.2;
    this.light.color.copy(color);
    this.light.intensity = 16 + this.flash * 40 + Math.sin(elapsed * 6) * 1.5;

    // Respiracion de la pantalla actual: nunca esta del todo quieta.
    const breathe = 1 + Math.sin(elapsed * 4.2) * 0.015 + this.flash * 0.08;
    this.current.group.scale.setScalar(breathe);
  }
}
