import {
  BEAM_HIGH_BOTTOM,
  BEAM_HIGH_TOP,
  BEAM_RADIUS,
  C_BONE,
  C_BONE_DARK,
  C_DEEP,
  C_EMBER,
  C_FLAME,
  C_SPARK,
  C_STONE,
  C_STONE_DARK,
  C_STONE_HOT,
  C_STONE_MID,
  C_VOID,
  C_WARM,
  FLOOR_D,
  FLOOR_W,
  PORCH,
  RUNNER_X,
  TUNNEL_H,
  VIEW_H,
  VIEW_W,
  WALL_H,
  Z_SCALE,
  mulberry32,
} from "./constants";
import { isoX, isoY } from "./iso";
import type { Beam, BeamKind } from "./Beam";
import type { BeamField } from "./BeamField";
import type { Particles } from "./Particles";
import type { Runner } from "./Runner";

/** Un corredor listo para dibujar (el propio y cada rival de la sala). */
export interface RunnerView {
  runner: Runner;
  /** True para el corredor del jugador local: se le marca el pie. */
  self: boolean;
  score: number;
}

/** Flecha de aviso en el borde por donde acaba de entrar una viga. */
export interface Warning {
  dir: 1 | -1;
  kind: BeamKind;
  life: number;
}

export const WARNING_LIFE = 0.85;

/** Antorchas: las unicas fuentes de luz de la sala (ver DESIGN.md). */
const TORCHES = [
  { x: 2.2, y: 0, z: 2.05 },
  { x: 6.0, y: 0, z: 2.3 },
  { x: 9.8, y: 0, z: 2.05 },
  { x: 0, y: 2.6, z: 2.5 },
  { x: 0, y: 6.2, z: 2.5 },
];

/** La viga se hunde un poco en el muro de atras y sobresale sobre el foso. */
const BEAM_Y0 = -0.55;
const BEAM_Y1 = FLOOR_D + 0.55;

// --- utilidades de color ---------------------------------------------------

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Mezcla dos colores y devuelve `#rrggbb`. Que la salida sea del MISMO formato
 * que la entrada no es cosmetico: `mix(mix(a, b, t), c, u)` se usa por todos
 * lados, y con una salida `rgb(...)` el `hex()` de adentro parseaba NaN, el
 * `fillStyle` quedaba invalido y el canvas seguia pintando con el color
 * anterior. Sintoma: el piso entero salia casi negro.
 */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function poly(ctx: CanvasRenderingContext2D, pts: number[][], fill: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Cuanta luz de antorcha llega al punto (x, y) del piso, 0..1. Es la misma
 * funcion que decide el tono de cada losa horneada y el rim de cada cuerpo, asi
 * que la sala entera queda iluminada por las MISMAS fuentes: no hay una luz
 * ambiente que rellene las sombras por comodidad (ver DESIGN.md).
 */
function lightAt(x: number, y: number): number {
  // La brasa del subsuelo es el piso de luz de la sala: nada llega a ser negro.
  let l = 0.16;
  for (const t of TORCHES) {
    const d = Math.hypot(x - t.x, y - t.y) + 1.6;
    l += 4.6 / (d * d);
  }
  // Y sube un poco mas por el frente y por el costado abierto.
  l += 0.16 * Math.max(0, (y - 3.5) / FLOOR_D) + 0.1 * Math.max(0, (x - 8) / FLOOR_W);
  return Math.min(1, l);
}

/** Todo el dibujo 2D. La sala estatica se hornea una vez en un canvas aparte. */
export class Renderer {
  private bg: HTMLCanvasElement | null = null;
  private time = 0;

  update(dt: number): void {
    this.time += dt;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    field: BeamField,
    runners: RunnerView[],
    particles: Particles,
    warnings: Warning[],
    showNames: boolean,
  ): void {
    if (!this.bg) this.bg = this.bake();
    ctx.drawImage(this.bg, 0, 0);

    this.drawTorchFlames(ctx);
    this.drawShadows(ctx, field, runners);

    // Orden por profundidad: lo que tiene menor x esta mas atras. Los corredores
    // comparten x, asi que van en el medio, ordenados por carril.
    const behind = field.beams.filter((b) => b.x < RUNNER_X);
    const front = field.beams.filter((b) => b.x >= RUNNER_X);
    for (const b of behind) this.drawBeam(ctx, b);

    const ordered = [...runners].sort((a, b) => a.runner.y - b.runner.y);
    for (const v of ordered) this.drawRunner(ctx, v, showNames);

    for (const b of front) this.drawBeam(ctx, b);

    this.drawParticles(ctx, particles);
    for (const w of warnings) this.drawWarning(ctx, w);
    this.drawFirelight(ctx);
  }

  // ------------------------------------------------------------------ estatica

  /** Hornea el fondo: vacio, muros, soportes de antorcha, losas y foso. */
  private bake(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext("2d")!;
    const rand = mulberry32(0x7e3fa1);

    // Vacio de fondo, apenas teñido de brasa hacia abajo.
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, C_VOID);
    sky.addColorStop(0.55, C_DEEP);
    sky.addColorStop(1, "#241005");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    this.bakeWall(ctx, rand, "back");
    this.bakeWall(ctx, rand, "left");
    this.bakeTorchMounts(ctx);
    this.bakePorch(ctx, -1);
    this.bakePorch(ctx, 1);
    this.bakeFloor(ctx, rand);
    this.bakeRim(ctx);

    // Viñeta: la sala se apaga hacia los bordes de la pantalla.
    const vig = ctx.createRadialGradient(
      VIEW_W / 2,
      VIEW_H * 0.56,
      VIEW_H * 0.28,
      VIEW_W / 2,
      VIEW_H * 0.56,
      VIEW_H * 0.98,
    );
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    return canvas;
  }

  /** Un muro de bloques trabados. "back" corre sobre y=0, "left" sobre x=0. */
  private bakeWall(ctx: CanvasRenderingContext2D, rand: () => number, side: "back" | "left"): void {
    // El muro de la izquierda es solo un DINTEL: por debajo esta el vano por el
    // que entran rodando las vigas, asi que no puede bajar hasta el piso.
    const zFloor = side === "left" ? TUNNEL_H : 0;
    const len = side === "back" ? FLOOR_W : FLOOR_D + 0.6;
    const start = side === "back" ? -PORCH : -0.6;
    const rowH = 0.6;
    const rows = Math.ceil((WALL_H - zFloor) / rowH);
    const at = (u: number, z: number): number[] =>
      side === "back" ? [isoX(u, 0), isoY(u, 0, z)] : [isoX(0, u), isoY(0, u, z)];

    for (let r = 0; r < rows; r++) {
      const z0 = zFloor + r * rowH;
      const z1 = Math.min(WALL_H, z0 + rowH);
      // Trabado de albañil: las filas impares arrancan corridas media pieza.
      const shift = r % 2 === 0 ? 0 : 0.55;
      for (let u = start + shift - 1.1; u < len; u += 1.1) {
        const u0 = Math.max(start, u);
        const u1 = Math.min(len, u + 1.1);
        if (u1 - u0 < 0.12) continue;
        const j = 0.045; // junta
        const cx = (u0 + u1) / 2;
        const lit = side === "back" ? lightAt(cx, 0.4) : lightAt(0.4, cx);
        // Arriba se apaga: las antorchas estan a media altura y el fuego sube poco.
        const fall = Math.max(0, 1 - z0 / (WALL_H * 0.9));
        // La piedra recede: el muro se queda un paso por detras del piso.
        const warmth = Math.min(1, lit * (0.3 + 0.6 * fall) * 0.72);
        // Los extremos del muro se hunden en negro en vez de cortarse en seco:
        // del lado del vano eso es la boca del pasillo, del otro es la salida.
        const edge = Math.min(1, (len - cx) / 2.4, (cx - start) / 1.6);
        const base = mix(
          C_VOID,
          mix(C_STONE_DARK, C_STONE_HOT, warmth * 0.9 + rand() * 0.09),
          Math.max(0, edge),
        );
        poly(
          ctx,
          [
            at(u0 + j, z0 + j * 0.6),
            at(u1 - j, z0 + j * 0.6),
            at(u1 - j, z1 - j * 0.6),
            at(u0 + j, z1 - j * 0.6),
          ],
          base,
        );
        // Canto superior encendido: la cara que mira a la llama.
        if (warmth > 0.12) {
          ctx.globalAlpha = Math.min(0.5, warmth * 0.55);
          poly(
            ctx,
            [
              at(u0 + j, z1 - 0.1),
              at(u1 - j, z1 - 0.1),
              at(u1 - j, z1 - j * 0.6),
              at(u0 + j, z1 - j * 0.6),
            ],
            mix(C_STONE_HOT, C_WARM, 0.35),
          );
          ctx.globalAlpha = 1;
        }
        // Algun bloque hundido, para que la pared no sea un tejido perfecto.
        if (rand() < 0.09) {
          ctx.globalAlpha = 0.35;
          poly(
            ctx,
            [at(u0 + j, z0 + j), at(u1 - j, z0 + j), at(u1 - j, z1 - j), at(u0 + j, z1 - j)],
            C_VOID,
          );
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  /** Los soportes de hierro de cada antorcha (la llama va en la capa viva). */
  private bakeTorchMounts(ctx: CanvasRenderingContext2D): void {
    for (const t of TORCHES) {
      const x = isoX(t.x, t.y);
      const y = isoY(t.x, t.y, t.z);
      ctx.fillStyle = "#1a1008";
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 20);
      ctx.lineTo(x + 5, y + 20);
      ctx.lineTo(x + 3, y - 2);
      ctx.lineTo(x - 3, y - 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#3a2412";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, 8, 3.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Antesala en penumbra: por ahi entran y salen las vigas. */
  private bakePorch(ctx: CanvasRenderingContext2D, dir: -1 | 1): void {
    const x0 = dir === -1 ? -PORCH : FLOOR_W;
    const x1 = dir === -1 ? 0 : FLOOR_W + PORCH;
    for (let x = x0; x < x1 - 0.001; x += 0.65) {
      const xe = Math.min(x1, x + 0.65);
      // Se apaga hacia afuera: la boca del pasillo es negra.
      const f = dir === -1 ? (x - x0) / PORCH : 1 - (xe - x0) / PORCH;
      const c = mix(C_VOID, C_STONE, Math.max(0, f) * 0.75);
      poly(
        ctx,
        [
          [isoX(x, 0), isoY(x, 0)],
          [isoX(xe, 0), isoY(xe, 0)],
          [isoX(xe, FLOOR_D), isoY(xe, FLOOR_D)],
          [isoX(x, FLOOR_D), isoY(x, FLOOR_D)],
        ],
        c,
      );
    }
  }

  /** Las losas: piedra continua, juntas en sombra y desgaste acumulado. */
  private bakeFloor(ctx: CanvasRenderingContext2D, rand: () => number): void {
    const corner = (x: number, y: number): number[] => [isoX(x, y), isoY(x, y)];

    // 1) Una losa por celda, CONTIGUAS. Dibujarlas separadas por una junta de
    // fondo las convertia en una reja: lo que se leia era el hueco, no la piedra.
    for (let gx = 0; gx < FLOOR_W; gx++) {
      for (let gy = 0; gy < FLOOR_D; gy++) {
        const lit = lightAt(gx + 0.5, gy + 0.5);
        const wear = rand();
        // El rango va de la penumbra al ocre encendido: si el desgaste aplana
        // demasiado, la sala pierde el gradiente de las antorchas y se ve plana.
        const c = mix(mix(C_DEEP, C_STONE_HOT, lit), C_STONE_MID, 0.06 + wear * 0.14);
        poly(
          ctx,
          [corner(gx, gy), corner(gx + 1, gy), corner(gx + 1, gy + 1), corner(gx, gy + 1)],
          c,
        );
      }
    }

    // 2) Manchas de hollin: donde el fuego pego mil veces.
    for (let i = 0; i < 9; i++) {
      const cx = rand() * FLOOR_W;
      const cy = rand() * FLOOR_D;
      const r = 22 + rand() * 46;
      const g = ctx.createRadialGradient(isoX(cx, cy), isoY(cx, cy), 1, isoX(cx, cy), isoY(cx, cy), r);
      g.addColorStop(0, "rgba(10,6,4,0.34)");
      g.addColorStop(1, "rgba(10,6,4,0)");
      ctx.fillStyle = g;
      ctx.fillRect(isoX(cx, cy) - r, isoY(cx, cy) - r, r * 2, r * 2);
    }

    // 3) Las juntas son ranuras: van en SOMBRA, con el canto de la losa
    // siguiente encendido justo al lado (que es de donde viene la luz).
    const line = (ax: number, ay: number, bx: number, by: number): void => {
      ctx.beginPath();
      ctx.moveTo(isoX(ax, ay), isoY(ax, ay));
      ctx.lineTo(isoX(bx, by), isoY(bx, by));
      ctx.stroke();
    };
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? "rgba(10,6,4,0.5)" : "rgba(255,217,160,0.1)";
      ctx.lineWidth = pass === 0 ? 1.8 : 1;
      const off = pass === 0 ? 0 : 0.035;
      for (let gx = 1; gx < FLOOR_W; gx++) line(gx + off, 0, gx + off, FLOOR_D);
      for (let gy = 1; gy < FLOOR_D; gy++) line(0, gy + off, FLOOR_W, gy + off);
    }

    // 4) Grietas de brasa: el subsuelo asomando entre las losas.
    const cracks: number[][] = [
      [1.2, 5.4, 3.4, 6.8],
      [8.4, 1.1, 10.6, 2.4],
      [4.6, 7.1, 6.8, 7.8],
    ];
    for (const [ax, ay, bx, by] of cracks) {
      const g = ctx.createLinearGradient(isoX(ax, ay), isoY(ax, ay), isoX(bx, by), isoY(bx, by));
      g.addColorStop(0, "rgba(255,122,24,0)");
      g.addColorStop(0.5, "rgba(255,122,24,0.8)");
      g.addColorStop(1, "rgba(255,122,24,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.6;
      line(ax, ay, bx, by);
    }

    // 5) La linea de accion: la franja gastada por donde pasan todas las vigas.
    ctx.globalAlpha = 0.16;
    poly(
      ctx,
      [
        corner(RUNNER_X - 0.55, 0),
        corner(RUNNER_X + 0.55, 0),
        corner(RUNNER_X + 0.55, FLOOR_D),
        corner(RUNNER_X - 0.55, FLOOR_D),
      ],
      C_WARM,
    );
    ctx.globalAlpha = 1;
  }

  /** Espesor de la plataforma en los bordes de adelante, con la brasa del foso. */
  private bakeRim(ctx: CanvasRenderingContext2D): void {
    const drop = 0.42 * Z_SCALE;
    const xa = -PORCH;
    const xb = FLOOR_W + PORCH;
    const faceFront: number[][] = [
      [isoX(xa, FLOOR_D), isoY(xa, FLOOR_D)],
      [isoX(xb, FLOOR_D), isoY(xb, FLOOR_D)],
      [isoX(xb, FLOOR_D), isoY(xb, FLOOR_D) + drop],
      [isoX(xa, FLOOR_D), isoY(xa, FLOOR_D) + drop],
    ];
    poly(ctx, faceFront, C_STONE_DARK);
    poly(
      ctx,
      [
        [isoX(xb, 0), isoY(xb, 0)],
        [isoX(xb, FLOOR_D), isoY(xb, FLOOR_D)],
        [isoX(xb, FLOOR_D), isoY(xb, FLOOR_D) + drop],
        [isoX(xb, 0), isoY(xb, 0) + drop],
      ],
      C_VOID,
    );

    // Brasa lamiendo el canto desde abajo.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(faceFront[0][0], faceFront[0][1]);
    for (let i = 1; i < faceFront.length; i++) ctx.lineTo(faceFront[i][0], faceFront[i][1]);
    ctx.closePath();
    ctx.clip();
    const g = ctx.createLinearGradient(
      0,
      isoY(FLOOR_W / 2, FLOOR_D) + drop,
      0,
      isoY(FLOOR_W / 2, FLOOR_D) - 6,
    );
    g.addColorStop(0, "rgba(255,122,24,0.55)");
    g.addColorStop(1, "rgba(255,122,24,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  // --------------------------------------------------------------------- vivo

  /** Llama de cada antorcha: respira con un ruido lento, no titila nervioso. */
  private drawTorchFlames(ctx: CanvasRenderingContext2D): void {
    TORCHES.forEach((t, i) => {
      const p = this.time * 1.7 + i * 2.3;
      const breathe = 0.8 + 0.2 * Math.sin(p) + 0.08 * Math.sin(p * 2.7 + 1.1);
      const x = isoX(t.x, t.y);
      const y = isoY(t.x, t.y, t.z) - 6;
      const h = 15 * breathe;

      // El halo va sumado (es luz); la llama va pintada normal. Sumarla tambien
      // la saturaba a blanco y la antorcha se leia como un cono de papel.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const R = 150 * breathe;
      const halo = ctx.createRadialGradient(x, y - h * 0.4, 1, x, y - h * 0.4, R);
      halo.addColorStop(0, "rgba(255,170,80,0.2)");
      halo.addColorStop(0.3, "rgba(255,122,24,0.09)");
      halo.addColorStop(1, "rgba(255,122,24,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(x - R, y - R, R * 2, R * 2);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = C_EMBER;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.quadraticCurveTo(x - 3.4, y - h * 0.7, x, y - h);
      ctx.quadraticCurveTo(x + 3.4, y - h * 0.7, x + 5, y);
      ctx.quadraticCurveTo(x, y + 3.5, x - 5, y);
      ctx.fill();
      ctx.fillStyle = C_FLAME;
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.36, 2.6, h * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C_SPARK;
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.2, 1.3, h * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  /** Capa final de luz calida: el temblor del fuego se contagia a toda la sala. */
  private drawFirelight(ctx: CanvasRenderingContext2D): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 1.35) * Math.sin(this.time * 0.61 + 2);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.03 + 0.025 * pulse;
    const g = ctx.createLinearGradient(0, VIEW_H, 0, VIEW_H * 0.25);
    g.addColorStop(0, C_EMBER);
    g.addColorStop(1, "rgba(255,122,24,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  /**
   * Sombras en el piso. Es LA pista de altura del juego: la viga rasante lleva
   * su sombra pegada al cuerpo y la alta la deja despegada varios pixeles abajo,
   * asi que se puede decidir "salto" o "me agacho" sin leer un icono.
   */
  private drawShadows(
    ctx: CanvasRenderingContext2D,
    field: BeamField,
    runners: RunnerView[],
  ): void {
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";
    for (const b of field.beams) {
      const high = b.kind === "high";
      ctx.globalAlpha = high ? 0.68 : 0.5;
      ctx.lineWidth = high ? 13 : 17;
      ctx.beginPath();
      ctx.moveTo(isoX(b.x, BEAM_Y0), isoY(b.x, BEAM_Y0));
      ctx.lineTo(isoX(b.x, BEAM_Y1), isoY(b.x, BEAM_Y1));
      ctx.stroke();
    }
    ctx.fillStyle = "#000";
    for (const v of runners) {
      const r = v.runner;
      const lift = Math.min(1, r.feetZ / 1.2);
      ctx.globalAlpha = 0.5 * (1 - lift * 0.62);
      ctx.beginPath();
      ctx.ellipse(isoX(r.x, r.y), isoY(r.x, r.y), 13 - lift * 4.5, 6 - lift * 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Una viga: cilindro con pinchos girando. */
  private drawBeam(ctx: CanvasRenderingContext2D, beam: Beam): void {
    const low = beam.kind === "low";
    const zc = low ? BEAM_RADIUS : (BEAM_HIGH_BOTTOM + BEAM_HIGH_TOP) / 2;
    const ax = isoX(beam.x, BEAM_Y0);
    const ay = isoY(beam.x, BEAM_Y0, zc);
    const bx = isoX(beam.x, BEAM_Y1);
    const by = isoY(beam.x, BEAM_Y1, zc);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular en pantalla, siempre apuntando hacia arriba.
    let px = -dy / len;
    let py = dx / len;
    if (py > 0) {
      px = -px;
      py = -py;
    }
    // El radio dibujado SALE de la franja de altura que ocupa la viga: si el
    // cilindro fuera mas fino que su hitbox, mataria sin llegar a tocarte.
    const R = ((beam.zMax - beam.zMin) / 2) * Z_SCALE;
    const spikeLen = 13;

    const spikes: { t: number; c: number }[] = [];
    const count = 15;
    for (let i = 0; i < count; i++) {
      spikes.push({ t: (i + 0.5) / count, c: Math.cos(beam.spin * Math.PI * 2 + i * 1.9) });
    }

    const spikeBack = low ? mix(C_EMBER, C_VOID, 0.45) : C_BONE_DARK;
    const spikeFront = low ? C_FLAME : C_BONE;

    const spike = (s: { t: number; c: number }, fill: string): void => {
      const sx = ax + dx * s.t;
      const sy = ay + dy * s.t;
      const reach = (R + spikeLen) * s.c;
      const half = 5.5;
      ctx.beginPath();
      ctx.moveTo(sx + (dx / len) * half, sy + (dy / len) * half);
      ctx.lineTo(sx - (dx / len) * half, sy - (dy / len) * half);
      ctx.lineTo(sx + px * reach, sy + py * reach);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    // Los que salen hacia arriba quedan detras del cilindro; los de abajo delante.
    for (const s of spikes) if (s.c > 0) spike(s, spikeBack);

    // Cuerpo: contorno, gradiente perpendicular y filo especular.
    ctx.lineCap = "round";
    ctx.strokeStyle = low ? "#4a1503" : "#2b2318";
    ctx.lineWidth = R * 2 + 5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const g = ctx.createLinearGradient(mx + px * R, my + py * R, mx - px * R, my - py * R);
    if (low) {
      g.addColorStop(0, C_SPARK);
      g.addColorStop(0.28, C_FLAME);
      g.addColorStop(0.7, C_EMBER);
      g.addColorStop(1, "#6b1e02");
    } else {
      g.addColorStop(0, "#fff8e8");
      g.addColorStop(0.3, C_BONE);
      g.addColorStop(0.75, C_BONE_DARK);
      g.addColorStop(1, "#4a4032");
    }
    ctx.strokeStyle = g;
    ctx.lineWidth = R * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Anillos: la piedra tiene juntas, y eso es lo que deja ver el giro.
    ctx.save();
    ctx.globalAlpha = low ? 0.3 : 0.42;
    ctx.strokeStyle = low ? "#7a2503" : "#5d5240";
    ctx.lineWidth = 1.6;
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      const rx = ax + dx * t;
      const ry = ay + dy * t;
      ctx.beginPath();
      ctx.moveTo(rx + px * R * 0.92, ry + py * R * 0.92);
      ctx.lineTo(rx - px * R * 0.92, ry - py * R * 0.92);
      ctx.stroke();
    }
    ctx.restore();

    for (const s of spikes) if (s.c <= 0) spike(s, spikeFront);

    if (low) {
      // La rasante deja las losas encendidas a su paso.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createLinearGradient(mx, my - 26, mx, my + 26);
      glow.addColorStop(0, "rgba(255,122,24,0)");
      glow.addColorStop(0.5, "rgba(255,122,24,0.4)");
      glow.addColorStop(1, "rgba(255,122,24,0)");
      ctx.strokeStyle = glow;
      ctx.lineWidth = R * 2.9;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Un corredor. La pose se lee por silueta antes que por color (DESIGN.md). */
  private drawRunner(ctx: CanvasRenderingContext2D, view: RunnerView, showNames: boolean): void {
    const r = view.runner;
    const bx = isoX(r.x, r.y);
    const by = isoY(r.x, r.y, r.feetZ);
    const lit = 0.35 + 0.65 * lightAt(r.x, r.y);

    if (r.dead) {
      // Un cuerpo caido pierde el color: se apaga a piedra y queda de escenario.
      const t = Math.min(1, r.deadFor * 3);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = mix(C_STONE_DARK, C_STONE, lit * 0.5);
      ctx.beginPath();
      ctx.ellipse(bx, by - 5 + t * 2, 17, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix(r.color, C_STONE_DARK, 0.72);
      ctx.beginPath();
      ctx.ellipse(bx - 4, by - 8, 8, 5.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (showNames) this.drawTag(ctx, bx, by - 26, view, 0.4);
      return;
    }

    const H = r.height * Z_SCALE;
    const bob = r.airborne ? 0 : Math.sin(r.phase) * (r.ducking ? 0.8 : 2.1);
    const top = by - H + bob;
    const tunic = mix(r.color, "#000000", 1 - lit * 0.85);
    const tunicLit = mix(r.color, C_WARM, 0.3 * lit);
    const skin = mix("#c98d5c", "#000000", 1 - lit * 0.9);

    ctx.save();

    if (r.ducking) {
      // --- Agachado: bulto largo y BAJO, medido contra el piso y no contra la
      // altura de pie. La silueta tiene que gritar "se tiro al suelo" de lejos,
      // asi que se estira en horizontal y se aplasta el doble en vertical.
      ctx.fillStyle = mix(C_STONE_DARK, "#000000", 0.35);
      ctx.beginPath();
      ctx.ellipse(bx - 17, by - 5, 9, 4.5, -0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(bx - 4, by - 11, 18, 10, -0.13, 0, Math.PI * 2);
      ctx.fillStyle = tunic;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = tunicLit;
      ctx.lineWidth = 3;
      ctx.translate(2, 2.5);
      ctx.stroke();
      ctx.restore();

      // Mano apoyada adelante, como quien se tira a resbalar.
      ctx.strokeStyle = tunic;
      ctx.lineWidth = 3.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bx + 5, by - 13);
      ctx.lineTo(bx + 18, by - 3);
      ctx.stroke();

      this.drawHood(ctx, bx + 13, by - 14, tunic, tunicLit, skin, 0.6);
    } else {
      // --- De pie o en el aire ---
      ctx.fillStyle = mix(C_STONE_DARK, "#000000", 0.35);
      if (r.airborne) {
        ctx.beginPath();
        ctx.ellipse(bx - 4, by - 5, 4.2, 5.2, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(bx + 5, by - 3, 4.2, 5.2, -0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const sw = Math.sin(r.phase) * 5;
        ctx.fillRect(bx - 6 + sw, by - 15, 4.6, 15);
        ctx.fillRect(bx + 1.6 - sw, by - 15, 4.6, 15);
      }

      // Tunica: campana de pie, linea mas larga y angosta en el aire.
      const w = r.airborne ? 8.2 : 9.6;
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.62, top + H * 0.2);
      ctx.lineTo(bx + w * 0.62, top + H * 0.2);
      ctx.lineTo(bx + w * 1.25, by - (r.airborne ? 8 : 12));
      ctx.quadraticCurveTo(bx, by - (r.airborne ? 4 : 8), bx - w * 1.25, by - (r.airborne ? 8 : 12));
      ctx.closePath();
      ctx.fillStyle = tunic;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = tunicLit;
      ctx.lineWidth = 2.6;
      ctx.translate(2, 2);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = mix(C_STONE_HOT, "#000000", 1 - lit);
      ctx.fillRect(bx - 8, top + H * 0.5, 16, 3.2);

      this.drawHood(ctx, bx, top + 6.5, tunic, tunicLit, skin, 1);

      // Brazos: arriba en el salto, bombeando en el trote.
      ctx.strokeStyle = tunic;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (r.airborne) {
        ctx.moveTo(bx - 6, top + H * 0.34);
        ctx.lineTo(bx - 11, top - 2);
        ctx.moveTo(bx + 6, top + H * 0.34);
        ctx.lineTo(bx + 11, top - 1);
      } else {
        const sw = Math.sin(r.phase + Math.PI) * 4;
        ctx.moveTo(bx - 7, top + H * 0.33);
        ctx.lineTo(bx - 10 + sw, top + H * 0.62);
        ctx.moveTo(bx + 7, top + H * 0.33);
        ctx.lineTo(bx + 10 - sw, top + H * 0.62);
      }
      ctx.stroke();
    }

    // Marca del propio corredor: un aro encendido a los pies.
    if (view.self) {
      ctx.strokeStyle = "rgba(255,217,160,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(bx, by, 15, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    if (showNames) this.drawTag(ctx, bx, top - 14, view, view.self ? 0.95 : 0.72);
  }

  /** Cabeza encapuchada. `tilt` inclina el pico hacia adelante al agacharse. */
  private drawHood(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tunic: string,
    tunicLit: string,
    skin: string,
    tilt: number,
  ): void {
    ctx.fillStyle = tunic;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x + 2.4, y + 0.6, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tunicLit;
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 1 + (1 - tilt) * 3);
    ctx.lineTo(x - 1 - (1 - tilt) * 6, y - 8.5 * tilt - 1);
    ctx.lineTo(x + 4 - (1 - tilt) * 4, y - 5.5 * tilt);
    ctx.closePath();
    ctx.fill();
  }

  /** Cartelito con el nombre y las vigas esquivadas (solo en sala). */
  private drawTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    view: RunnerView,
    alpha: number,
  ): void {
    const label = `${view.runner.name} ${view.score}`;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "600 11px Consolas, 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(10,6,4,0.62)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = view.runner.dead ? C_BONE_DARK : view.runner.color;
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  /** Flecha en el borde por donde acaba de entrar una viga. */
  private drawWarning(ctx: CanvasRenderingContext2D, w: Warning): void {
    const t = w.life / WARNING_LIFE;
    if (t <= 0) return;
    const wx = w.dir === 1 ? -PORCH * 0.55 : FLOOR_W + PORCH * 0.55;
    const x = isoX(wx, FLOOR_D / 2);
    const y = isoY(wx, FLOOR_D / 2, 1.5);
    const up = w.kind === "low"; // rasante -> saltar
    const color = up ? C_FLAME : C_BONE;

    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.6) * (0.55 + 0.45 * Math.sin(this.time * 22));
    ctx.translate(x, y);
    ctx.scale(1, up ? 1 : -1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(12, 2);
    ctx.lineTo(4.5, 2);
    ctx.lineTo(4.5, 15);
    ctx.lineTo(-4.5, 15);
    ctx.lineTo(-4.5, 2);
    ctx.lineTo(-12, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, particles: Particles): void {
    for (const p of particles.items) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `rgba(${p.color},${a})`;
      ctx.beginPath();
      ctx.arc(isoX(p.x, p.y), isoY(p.x, p.y, p.z), p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
