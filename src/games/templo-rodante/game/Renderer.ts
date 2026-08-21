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
  ORIGIN_X,
  ORIGIN_Y,
  PORCH,
  RUNNER_X,
  TILE_HH,
  TILE_HW,
  TUNNEL_H,
  VIEW_H,
  VIEW_W,
  WALL_H,
  Z_SCALE,
  mulberry32,
} from "./constants";
import { isoX, isoY } from "./iso";
import { C_BLOOD, C_BLOOD_DARK, pathSplat, type Blood } from "./Blood";
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

/**
 * Donde se DIBUJA el herraje de una antorcha, adelantado sobre el paramento.
 * Los sillares sobresalen hasta ~0.21, asi que una antorcha clavada en el plano
 * del muro (y=0 / x=0) queda hundida detras de sus propios bloques. Solo mueve
 * el dibujo: la posicion de la LUZ sigue siendo la de `TORCHES`, porque correrla
 * dos decimas no cambia nada del sombreado y si obligaria a rehornear la sala.
 */
function torchMount(t: { x: number; y: number; z: number }): number[] {
  const x = t.x === 0 ? 0.24 : t.x;
  const y = t.y === 0 ? 0.24 : t.y;
  return [isoX(x, y), isoY(x, y, t.z)];
}

/** La viga se hunde un poco en el muro de atras y sobresale sobre el foso. */
const BEAM_Y0 = -0.55;
const BEAM_Y1 = FLOOR_D + 0.55;

// --- Modelo de luz ---------------------------------------------------------
// Los tres numeros que deciden si la sala se ve como una cueva o como un
// diorama plano. Ver lightAt() para por que TORCH_SOFT no puede subir.
/** Piso de luz: la brasa del subsuelo. Bajo = la luz hay que ganarsela. */
const AMBIENT = 0.05;
/**
 * Alcance de una antorcha. El falloff es de RANGO FINITO -- cae a cero exacto a
 * esta distancia -- y no el 1/d^2 fisico de antes. Con 1/d^2 las cinco fuentes
 * siempre suman algo en toda la sala, el total pasa de 1 en casi todos lados y
 * el clamp final aplana el gradiente: era la razon de que el piso fuera un ocre
 * uniforme. Con rango finito hay zonas que NINGUNA antorcha alcanza, que es lo
 * que hace que exista sombra de verdad.
 */
const TORCH_RANGE = 7.5;
/** Exposicion del piso y de los cuerpos sobre la suma cruda de atenuaciones. */
const FLOOR_GAIN = 1.65;
/** Exposicion del muro. Mas baja: la piedra vertical recibe la llama de refilon. */
const WALL_GAIN = 0.78;
/** Radio del charco que cada antorcha derrama en las losas (unidades de mundo). */
const POOL_R = 3.6;

// --- Espesor de la sala ----------------------------------------------------
// En esta isometria solo son visibles las caras que miran a +x, +y y +z. Para
// los dos muros eso quiere decir que la cara EXTERIOR (la que da al vacio) no se
// ve nunca: por si sola, la masa hacia afuera no dibuja nada. Lo unico que puede
// mostrar que el muro tiene espesor es su REMATE SUPERIOR, que es una cara +z.
// De ahi que el muro se leyera como una placa de canto: no tenia remate.
/** Cuanto cuerpo tiene el muro hacia afuera de la sala. */
const WALL_T = 0.7;
/** Cuanto vuela la moldura de remate hacia adentro de la sala. */
const CAP_OUT = 0.2;
/** Alto del friso vertical de la moldura, bajo su tapa. */
const CAP_FACE = 0.17;
/** Ancho del zocalo que enmarca la plataforma por fuera de los muros. */
const PLINTH = 0.9;

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
function lightRaw(x: number, y: number, z: number): number {
  let l = 0;
  for (const t of TORCHES) {
    const d = Math.hypot(x - t.x, y - t.y, z - t.z);
    if (d >= TORCH_RANGE) continue;
    const k = 1 - d / TORCH_RANGE;
    l += k * k;
  }
  return l;
}

/**
 * Luz que le llega al PISO en (x, y), 0..1. Es la misma funcion que tinta cada
 * losa horneada y cada cuerpo, asi que la sala entera queda iluminada por las
 * MISMAS fuentes: no hay luz ambiente que rellene las sombras por comodidad.
 */
function lightAt(x: number, y: number): number {
  // La distancia es 3D contra la antorcha REAL, que esta a media altura del
  // muro: por eso el charco del piso nunca llega al blanco de la llama.
  let l = AMBIENT + lightRaw(x, y, 0) * FLOOR_GAIN;
  // La brasa del foso lame el canto de adelante.
  l += 0.13 * Math.max(0, (y - 4.2) / FLOOR_D);
  return Math.min(1, l);
}

/**
 * Luz que le llega a un bloque de muro. Va aparte del piso porque la piedra
 * vertical recibe la llama de refilon (`WALL_GAIN`) y porque hay que apagar
 * activamente lo que queda POR ENCIMA de las antorchas: el fuego sube poco y
 * arriba del muro esta el techo, que no existe y tiene que irse a negro.
 */
function wallLight(x: number, y: number, z: number): number {
  const above = Math.max(0, (z - 2.1) / Math.max(0.001, WALL_H - 2.1));
  const l = AMBIENT + lightRaw(x, y, z) * WALL_GAIN;
  return Math.min(1, l) * (1 - above * 0.72);
}

/** Todo el dibujo 2D. La sala estatica se hornea una vez en un canvas aparte. */
export class Renderer {
  private bg: HTMLCanvasElement | null = null;
  /**
   * Capa de FRENTE: el muro izquierdo. Va aparte del fondo porque tiene que
   * taparle la parte de arriba a las vigas que todavia estan en el pasillo. Con
   * todo el muro horneado en `bg`, una viga que venia entrando se dibujaba
   * entera por encima del dintel, de la moldura y hasta de una antorcha, y en
   * vez de emerger de un tunel parecia apoyada arriba de la pared.
   *
   * Es seguro pintarlo delante de TODO lo de la sala: el dintel vive de
   * `TUNNEL_H` (1.9) para arriba y en pantalla eso lo deja muy por encima de
   * cualquier cosa que este dentro del cuarto -- corredores (z <= 1) y vigas
   * (z <= 1.2) --, asi que la unica cosa con la que llega a solaparse es
   * justamente una viga todavia afuera, que es la que hay que ocluir.
   */
  private fg: HTMLCanvasElement | null = null;
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
    blood: Blood,
  ): void {
    if (!this.bg) this.bg = this.bake();
    if (!this.fg) this.fg = this.bakeFg();
    ctx.drawImage(this.bg, 0, 0);

    // La sangre va pegada a la piedra: encima del fondo horneado y debajo de
    // todo lo que se mueve.
    this.drawBlood(ctx, blood);
    this.drawShadows(ctx, field, runners);

    // Orden por profundidad: lo que tiene menor x esta mas atras. Los corredores
    // comparten x, asi que van en el medio, ordenados por carril.
    const behind = field.beams.filter((b) => b.x < RUNNER_X);
    const front = field.beams.filter((b) => b.x >= RUNNER_X);
    this.drawBeams(ctx, behind);

    // El muro izquierdo, encima de las vigas que todavia vienen por el pasillo.
    ctx.drawImage(this.fg, 0, 0);

    // Las llamas van despues del muro para que las antorchas del dintel no
    // queden tapadas por su propia pared.
    this.drawTorchFlames(ctx);

    const ordered = [...runners].sort((a, b) => a.runner.y - b.runner.y);
    for (const v of ordered) this.drawRunner(ctx, v, showNames);

    this.drawBeams(ctx, front);

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

    // Fondo. Arriba es ROCA de la caverna, no vacio: lo que se ve por encima y
    // por detras de los muros tiene que ser la piedra en la que esta excavada la
    // sala. Con negro puro ahi, las dos esquinas de arriba se leian como el
    // recorte del diorama contra la nada, que es justo lo que habia que tapar.
    // Abajo si se mantiene oscuro: eso es el foso sobre el que flota la
    // plataforma, y ahi el vacio es deliberado.
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, "#241a15");
    sky.addColorStop(0.34, "#1b120d");
    sky.addColorStop(0.62, C_DEEP);
    sky.addColorStop(1, "#1d0d04");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Vetas de roca en la franja de arriba, para que esa piedra tenga materia y
    // no sea un degradado liso (que a esta escala vuelve a leerse como fondo).
    const veins = mulberry32(0x2b91f7);
    ctx.save();
    for (let i = 0; i < 22; i++) {
      const vx = veins() * VIEW_W;
      const vy = veins() * VIEW_H * 0.5;
      const vr = 40 + veins() * 150;
      ctx.globalAlpha = 0.16 + veins() * 0.2;
      const g = ctx.createRadialGradient(vx, vy, 1, vx, vy, vr);
      g.addColorStop(0, veins() < 0.5 ? "#2f2118" : "#120b07");
      g.addColorStop(1, "rgba(20,12,8,0)");
      ctx.fillStyle = g;
      ctx.fillRect(vx - vr, vy - vr, vr * 2, vr * 2);
    }
    ctx.restore();

    // Resplandor del aire alrededor de la sala. Sin esto la plataforma queda
    // recortada sobre negro plano y lee como un diorama flotando en la nada; el
    // halo insinua que la caverna sigue mas alla del charco de luz y le da al
    // borde de la piedra algo contra que recortarse.
    const air = ctx.createRadialGradient(
      VIEW_W * 0.47,
      VIEW_H * 0.52,
      VIEW_H * 0.1,
      VIEW_W * 0.47,
      VIEW_H * 0.52,
      VIEW_H * 1.05,
    );
    air.addColorStop(0, "rgba(126,58,16,0.5)");
    air.addColorStop(0.45, "rgba(74,32,10,0.26)");
    air.addColorStop(1, "rgba(20,8,3,0)");
    ctx.fillStyle = air;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    this.bakeWall(ctx, rand, "back");
    this.bakeTorchMounts(ctx, "back");
    this.bakePorch(ctx, -1);
    this.bakePorch(ctx, 1);
    this.bakeFloor(ctx, rand);
    this.bakeLightPools(ctx);
    this.bakeContactShadow(ctx);
    this.bakeRim(ctx);
    this.bakePlinth(ctx);

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
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    return canvas;
  }

  /**
   * Un muro de sillares trabados. "back" corre sobre y=0, "left" sobre x=0.
   *
   * Cada bloque es un PRISMA, no un cuadrilatero: se le dibuja la cara frontal,
   * el canto superior y el costado. Antes era un solo poligono plano por bloque,
   * y esa es exactamente la razon por la que el muro de atras leia como un
   * carton pintado -- sin canto ni costado no hay nada que indique espesor, asi
   * que el ojo lo toma como un mosaico impreso sobre una superficie lisa. Los
   * bloques ademas sobresalen cantidades distintas (`depth`), que es lo que
   * convierte el paramento en silleria en vez de en un tejido regular.
   */
  private bakeWall(ctx: CanvasRenderingContext2D, rand: () => number, side: "back" | "left"): void {
    // El muro de la izquierda es solo un DINTEL: por debajo esta el vano por el
    // que entran rodando las vigas, asi que no puede bajar hasta el piso.
    const zFloor = side === "left" ? TUNNEL_H : 0;
    // Cada muro sigue MAS ALLA de la sala hasta salirse del cuadro. Terminaban
    // justo en el borde del cuarto, y como lo que hay detras es el vacio, las
    // dos esquinas de arriba quedaban abiertas a negro: se veia el corte del
    // diorama en vez de una habitacion que sigue. `OVERRUN` es cuanto se pasan;
    // esta calculado para que el extremo caiga fuera de VIEW_W / VIEW_H, asi que
    // no hace falta afinarlo salvo que cambie la proyeccion.
    const OVERRUN = 6;
    const len = (side === "back" ? FLOOR_W : FLOOR_D + 0.6) + OVERRUN;
    const start = side === "back" ? -PORCH : -0.6;
    const rowH = 0.6;
    const rows = Math.ceil((WALL_H - zFloor) / rowH);

    /** Proyecta un punto: `u` a lo largo del muro, `d` cuanto sale hacia la sala. */
    const at = (u: number, d: number, z: number): number[] =>
      side === "back" ? [isoX(u, d), isoY(u, d, z)] : [isoX(d, u), isoY(d, u, z)];

    // --- 1. Muro macizo de fondo (backing) --------------------------------
    // Paño continuo de piedra detras de toda la silleria. Es lo que hace que por
    // las juntas y por los huecos entre sillares se vea PIEDRA EN SOMBRA y no el
    // vacio negro del fondo: sin el, cada bloque parecia flotar recortado sobre
    // la nada. Va segmentado en vez de como un unico poligono plano para que
    // reciba el mismo gradiente de antorchas que el resto del muro; un paño de
    // color liso vuelve a delatar la placa.
    for (let u = start; u < len - 0.001; u += 0.5) {
      const ue = Math.min(len, u + 0.5);
      const uc = (u + ue) / 2;
      // Mismo criterio que los sillares: solido hasta el extremo de afuera.
      const edgeB = Math.max(0, Math.min(1, (uc - start) / 1.6 + 0.35));
      for (let z = zFloor; z < WALL_H - 0.001; z += 0.5) {
        const ze = Math.min(WALL_H, z + 0.5);
        const zc = (z + ze) / 2;
        const w = side === "back" ? wallLight(uc, 0.35, zc) : wallLight(0.35, uc, zc);
        poly(
          ctx,
          [at(u, 0, z), at(ue, 0, z), at(ue, 0, ze), at(u, 0, ze)],
          mix(C_VOID, mix("#150c07", C_STONE_DARK, w * 0.85), edgeB),
        );
      }
    }

    // De ARRIBA hacia abajo: un sillar saliente se corre hacia abajo en pantalla
    // y pisa al de la fila siguiente, asi que la fila de abajo tiene que
    // dibujarse despues para que la oclusion salga bien.
    for (let r = rows - 1; r >= 0; r--) {
      const z0 = zFloor + r * rowH;
      const z1 = Math.min(WALL_H, z0 + rowH);
      // Trabado de albañil: las filas impares arrancan corridas media pieza.
      const shift = r % 2 === 0 ? 0 : 0.55;
      for (let u = start + shift - 1.1; u < len; u += 1.1) {
        const u0 = Math.max(start, u);
        const u1 = Math.min(len, u + 1.1);
        if (u1 - u0 < 0.12) continue;
        // Junta angosta: con el relieve puesto, cada bloque adelantado deja ver
        // el paramento de fondo por el hueco, asi que una junta que antes era
        // solo una linea pasa a leerse como un agujero y el muro parece
        // derruido en vez de trabado.
        const j = 0.028;
        const cx = (u0 + u1) / 2;
        // La luz se evalua en el CENTRO del bloque y con su altura real, asi
        // cada antorcha enciende de verdad los bloques que tiene al lado y deja
        // caer los de mas alla.
        const zc = (z0 + z1) / 2;
        const warmth = side === "back" ? wallLight(cx, 0.35, zc) : wallLight(0.35, cx, zc);
        // El muro ya NO se desvanece a negro en su extremo de afuera. Ese fade
        // era la otra mitad del problema de las esquinas abiertas: aunque el
        // paño llegara hasta el borde, se apagaba antes y volvia a dejar el
        // hueco. Ahora llega solido y quien lo apaga es la viñeta general, que
        // oscurece por igual todo el perimetro del cuadro.
        const fade = Math.max(0, Math.min(1, (cx - start) / 1.6 + 0.35));
        const base = mix(
          C_VOID,
          mix(C_STONE_DARK, C_STONE_HOT, warmth * 0.9 + rand() * 0.09),
          fade,
        );

        const roll = rand();
        if (roll < 0.035) {
          // Sillar HUNDIDO: se mete hacia adentro, asi que no se le ve ni canto
          // ni costado, solo la cara en sombra al fondo de su hueco.
          poly(
            ctx,
            [
              at(u0 + j, -0.05, z0 + j * 0.6),
              at(u1 - j, -0.05, z0 + j * 0.6),
              at(u1 - j, -0.05, z1 - j * 0.6),
              at(u0 + j, -0.05, z1 - j * 0.6),
            ],
            mix(base, C_VOID, 0.55),
          );
          continue;
        }

        // Cuanto sale este sillar. La minoria que sale mucho es la que rompe la
        // regularidad; el resto tiene apenas el espesor suficiente para que se
        // le vea el canto. Deliberadamente CHICO: con el relieve al doble el
        // muro dejaba de leerse como un paramento y pasaba a parecer una pila de
        // cajas sueltas. Alcanza con insinuar el espesor.
        const d = roll > 0.9 ? 0.15 + rand() * 0.06 : 0.05 + rand() * 0.04;

        // Costado (mira hacia +u): en sombra, es lo que da el espesor lateral.
        poly(
          ctx,
          [
            at(u1 - j, 0, z0 + j * 0.6),
            at(u1 - j, d, z0 + j * 0.6),
            at(u1 - j, d, z1 - j * 0.6),
            at(u1 - j, 0, z1 - j * 0.6),
          ],
          mix(base, C_VOID, 0.5),
        );

        // Canto superior: la cara que mira hacia arriba, hacia la llama.
        poly(
          ctx,
          [
            at(u0 + j, 0, z1 - j * 0.6),
            at(u1 - j, 0, z1 - j * 0.6),
            at(u1 - j, d, z1 - j * 0.6),
            at(u0 + j, d, z1 - j * 0.6),
          ],
          mix(base, mix(C_STONE_HOT, C_WARM, 0.4), 0.28 + warmth * 0.34),
        );

        // Cara frontal.
        poly(
          ctx,
          [
            at(u0 + j, d, z0 + j * 0.6),
            at(u1 - j, d, z0 + j * 0.6),
            at(u1 - j, d, z1 - j * 0.6),
            at(u0 + j, d, z1 - j * 0.6),
          ],
          base,
        );

        // Desgaste: el canto de abajo de la cara se come de comido y se oscurece.
        if (rand() < 0.42) {
          ctx.globalAlpha = 0.3 * fade;
          poly(
            ctx,
            [
              at(u0 + j, d, z0 + j * 0.6),
              at(u1 - j, d, z0 + j * 0.6),
              at(u1 - j, d, z0 + 0.14),
              at(u0 + j, d, z0 + 0.14),
            ],
            C_VOID,
          );
          ctx.globalAlpha = 1;
        }
      }
    }

    // --- 2. Remate superior (moldura) -------------------------------------
    // Losa continua que corre a lo largo del muro y cierra la hilera de arriba,
    // que hasta ahora terminaba en un borde dentado contra el vacio. Es ademas
    // la UNICA cara que puede mostrar el espesor del muro (ver WALL_T): vuela
    // desde -WALL_T por afuera hasta +CAP_OUT por adentro, o sea que su ancho en
    // pantalla es literalmente el grosor de la pared. Va al final para que tape
    // el borde de arriba de los sillares.
    const capTop = WALL_H + CAP_FACE;
    for (let u = start; u < len - 0.001; u += 0.5) {
      const ue = Math.min(len, u + 0.5);
      const uc = (u + ue) / 2;
      // La moldura tambien corre entera hasta el borde del cuadro: si se apagara
      // antes que los sillares, el remate terminaria en el aire a media pared.
      const edgeC = Math.max(0, Math.min(1, (uc - start) / 1.6 + 0.35));
      const w = side === "back" ? wallLight(uc, 0.3, WALL_H) : wallLight(0.3, uc, WALL_H);
      const stone = mix(C_STONE_DARK, C_STONE_HOT, w);

      // Tapa (cara +z). Es la que se ve como el grosor del muro.
      poly(
        ctx,
        [at(u, -WALL_T, capTop), at(ue, -WALL_T, capTop), at(ue, CAP_OUT, capTop), at(u, CAP_OUT, capTop)],
        mix(C_VOID, mix(stone, C_WARM, 0.16 + w * 0.2), edgeC),
      );
      // Friso: el canto vertical de la moldura, ya en sombra respecto de la tapa.
      poly(
        ctx,
        [at(u, CAP_OUT, capTop), at(ue, CAP_OUT, capTop), at(ue, CAP_OUT, WALL_H - 0.02), at(u, CAP_OUT, WALL_H - 0.02)],
        mix(C_VOID, mix(stone, C_VOID, 0.3), edgeC),
      );
      // Sombra que la moldura arroja sobre el primer sillar que tiene debajo.
      ctx.globalAlpha = 0.34 * edgeC;
      poly(
        ctx,
        [at(u, CAP_OUT, WALL_H - 0.02), at(ue, CAP_OUT, WALL_H - 0.02), at(ue, CAP_OUT, WALL_H - 0.2), at(u, CAP_OUT, WALL_H - 0.2)],
        C_VOID,
      );
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Hornea la capa de frente: el muro izquierdo y sus herrajes de antorcha.
   * Semilla propia -- ya no comparte el `rand` del fondo -- asi que su
   * despiece es distinto del que tenia, pero igual de determinista.
   */
  private bakeFg(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext("2d")!;
    this.bakeWall(ctx, mulberry32(0x51d0c3), "left");
    this.bakeCornerPost(ctx);
    this.bakeTorchMounts(ctx, "left");
    return canvas;
  }

  /**
   * Pilastra en la esquina donde se juntan los dos muros.
   *
   * Los muros se hornean por separado y hasta ahora se cruzaban ahi sin mas: uno
   * quedaba pisando al otro y la esquina era una superposicion, con las hiladas
   * de los dos paños chocando en angulos que no cierran. Un pilar es como se
   * resuelve de verdad -- absorbe el encuentro y deja una arista limpia -- y
   * ademas le da a la sala una vertical, que es lo unico que no tenia.
   *
   * Arranca en `TUNNEL_H` y no en el piso: por debajo esta el vano por el que
   * ruedan las vigas, y un pilar que bajara hasta las losas se les pondria
   * justo en el camino.
   */
  private bakeCornerPost(ctx: CanvasRenderingContext2D): void {
    const s = 0.54; // lado del pilar
    const z0 = TUNNEL_H;
    const z1 = WALL_H + CAP_FACE;
    const at = (x: number, y: number, z: number): number[] => [isoX(x, y), isoY(x, y, z)];
    const lit = wallLight(s * 0.5, s * 0.5, (z0 + z1) / 2);
    const stone = mix(C_STONE_DARK, C_STONE_HOT, lit);

    // Cara que mira a +y (hacia la sala, del lado del muro de atras).
    poly(ctx, [at(0, s, z0), at(s, s, z0), at(s, s, z1), at(0, s, z1)], mix(stone, C_VOID, 0.34));
    // Cara que mira a +x (del lado del dintel).
    poly(ctx, [at(s, 0, z0), at(s, s, z0), at(s, s, z1), at(s, 0, z1)], mix(stone, C_VOID, 0.12));
    // Tapa.
    poly(
      ctx,
      [at(0, 0, z1), at(s, 0, z1), at(s, s, z1), at(0, s, z1)],
      mix(stone, C_WARM, 0.2 + lit * 0.2),
    );
    // Arista viva entre las dos caras: es la vertical que ordena la esquina.
    ctx.strokeStyle = mix(stone, C_WARM, 0.3);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(at(s, s, z0)[0], at(s, s, z0)[1]);
    ctx.lineTo(at(s, s, z1)[0], at(s, s, z1)[1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * Los soportes de hierro de las antorchas de un muro (la llama va en la capa
   * viva). Va filtrado por muro porque los dos muros viven en canvas distintos:
   * el de atras en el fondo y el izquierdo en la capa de frente.
   */
  private bakeTorchMounts(ctx: CanvasRenderingContext2D, side: "back" | "left"): void {
    for (const t of TORCHES) {
      if ((side === "left") !== (t.x === 0)) continue;
      const [x, y] = torchMount(t);
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
        // El desgaste se ve SOLO donde hay luz que lo revele: multiplicarlo por
        // `lit` es lo que impide que la variacion de piedra levante las losas en
        // penumbra y devuelva el piso al ocre uniforme de antes.
        const c = mix(mix(C_VOID, C_STONE_HOT, lit), C_STONE_MID, (0.05 + wear * 0.16) * lit);
        poly(
          ctx,
          [corner(gx, gy), corner(gx + 1, gy), corner(gx + 1, gy + 1), corner(gx, gy + 1)],
          c,
        );
      }
    }

    // 2) Manchas de hollin.
    this.bakeSoot(ctx, rand);

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

  /**
   * Hollin en las losas: donde el fuego pego mil veces.
   *
   * Dos cosas lo hacian leer como manchas de humedad o como un desenfoque mal
   * puesto, y las dos estan arregladas aca:
   *
   * 1. Eran gradientes radiales en coordenadas de PANTALLA, o sea circulos
   *    perfectos sobre un piso en perspectiva. Ahora van dibujados dentro del
   *    plano del piso (misma matriz iso que `bakeLightPools`), asi que se
   *    apoyan en las losas en vez de flotar delante de ellas.
   * 2. Un degradado gaussiano puro es exactamente lo que el ojo lee como
   *    "blur", no como suciedad. El hollin es ACUMULACION: un cumulo de
   *    manchitas chicas e irregulares da grano y borde roto, que es lo que lo
   *    hace parecer depositado sobre la piedra.
   *
   * Ademas ya no caen al azar por toda la sala: las grandes se anclan al pie de
   * cada antorcha, que es lo unico que en este cuarto tizna algo.
   */
  private bakeSoot(ctx: CanvasRenderingContext2D, rand: () => number): void {
    ctx.save();
    ctx.setTransform(TILE_HW, TILE_HH, -TILE_HW, TILE_HH, ORIGIN_X, ORIGIN_Y);
    ctx.beginPath();
    ctx.rect(0, 0, FLOOR_W, FLOOR_D);
    ctx.clip();
    ctx.fillStyle = "#0a0604";

    const blob = (cx: number, cy: number, R: number, strength: number): void => {
      const n = 16;
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        // sqrt() para que la densidad sea pareja en AREA y no se apelotone todo
        // en el centro, que volveria a dar el nucleo compacto tipo gaussiana.
        const d = Math.sqrt(rand()) * R;
        const rr = R * (0.16 + rand() * 0.3);
        ctx.globalAlpha = strength * (0.2 + rand() * 0.45) * (1 - (d / R) * 0.75);
        ctx.beginPath();
        ctx.ellipse(
          cx + Math.cos(a) * d,
          cy + Math.sin(a) * d,
          rr,
          rr * (0.6 + rand() * 0.6),
          rand() * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    };

    // Al pie de cada antorcha: el tizne de la llama que lleva ahi mil años.
    for (const t of TORCHES) {
      blob(t.x === 0 ? 0.85 : t.x, t.y === 0 ? 0.85 : t.y, 1.5 + rand() * 0.5, 0.5);
    }
    // Y unas pocas sueltas, mas debiles, para que el piso no quede simetrico.
    for (let i = 0; i < 4; i++) {
      blob(1 + rand() * (FLOOR_W - 2), 1 + rand() * (FLOOR_D - 2), 0.7 + rand() * 0.7, 0.3);
    }

    ctx.restore();
  }

  /**
   * El charco que cada antorcha derrama en las losas que tiene debajo.
   *
   * Va dibujado DENTRO del plano del piso: se le carga al contexto la matriz de
   * la proyeccion iso, con lo cual un `arc()` redondo sale como la elipse que le
   * corresponde apoyada en el suelo. Pintarlo como un circulo en coordenadas de
   * pantalla (que es lo que hacia el halo de la llama, y lo unico que habia) lee
   * como una calcomania flotando delante de la sala, no como luz tocando piedra.
   */
  private bakeLightPools(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setTransform(TILE_HW, TILE_HH, -TILE_HW, TILE_HH, ORIGIN_X, ORIGIN_Y);

    // Recortado a la plataforma: la luz no se derrama sobre el vacio de al lado.
    ctx.beginPath();
    ctx.rect(0, 0, FLOOR_W, FLOOR_D);
    ctx.clip();

    ctx.globalCompositeOperation = "lighter";
    for (const t of TORCHES) {
      // El charco cae al PIE del muro, no bajo la antorcha: la llama esta a
      // media altura y la luz se abre hacia adentro de la sala al bajar.
      const px = t.x === 0 ? 0.9 : t.x;
      const py = t.y === 0 ? 0.9 : t.y;
      const g = ctx.createRadialGradient(px, py, 0, px, py, POOL_R);
      g.addColorStop(0, "rgba(255,150,58,0.30)");
      g.addColorStop(0.45, "rgba(255,122,24,0.12)");
      g.addColorStop(1, "rgba(255,122,24,0)");
      ctx.fillStyle = g;
      ctx.fillRect(px - POOL_R, py - POOL_R, POOL_R * 2, POOL_R * 2);
    }
    ctx.restore();
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

  /**
   * Oclusion de contacto: la franja de sombra donde cada muro se apoya en el
   * piso.
   *
   * Este renderer no tiene motor de sombras -- no hay luces ni caras que
   * proyecten nada, solo poligonos pintados -- asi que la oclusion se hornea a
   * mano. Sin ella el charco de luz de una antorcha llega hasta la base del muro
   * con la misma intensidad que en medio de la sala, que es justamente lo que
   * hace que el muro parezca apoyado ENCIMA del piso y no encastrado en el.
   *
   * Va despues de `bakeLightPools` a proposito: la sombra tiene que ganarle a la
   * luz en el rincon, no al reves.
   */
  private bakeContactShadow(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setTransform(TILE_HW, TILE_HH, -TILE_HW, TILE_HH, ORIGIN_X, ORIGIN_Y);
    ctx.beginPath();
    ctx.rect(0, 0, FLOOR_W, FLOOR_D);
    ctx.clip();

    // Pie del muro de atras (y = 0), abriendose hacia la sala.
    const back = ctx.createLinearGradient(0, 0, 0, 1.7);
    back.addColorStop(0, "rgba(6,3,2,0.66)");
    back.addColorStop(0.45, "rgba(6,3,2,0.22)");
    back.addColorStop(1, "rgba(6,3,2,0)");
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, FLOOR_W, 1.7);

    // Pie del dintel de la izquierda (x = 0). Mas suave: ahi abajo esta el vano
    // por el que entran las vigas, asi que no hay muro macizo que ocluya.
    const left = ctx.createLinearGradient(0, 0, 1.3, 0);
    left.addColorStop(0, "rgba(6,3,2,0.4)");
    left.addColorStop(1, "rgba(6,3,2,0)");
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, 1.3, FLOOR_D);

    ctx.restore();
  }

  /**
   * Zocalo perimetral: un escalon que corre por los dos bordes visibles de la
   * plataforma (el frente y el costado derecho) sobresaliendo hacia afuera.
   *
   * Es lo que convierte el corte isometrico en un diorama deliberado. Sin el, la
   * plataforma terminaba en un canto unico y recto contra el vacio, que lee como
   * "aca se acabo el dibujo" en vez de como una pieza que alguien construyo: al
   * ojo le falta un remate abajo igual que le faltaba arriba, y el remate de
   * arriba es la moldura de `bakeWall`. Los dos bordes que se ven son los que
   * miran a +y (frente) y a +x (derecha); el resto queda detras de los muros.
   *
   * Trabaja en pixeles y no en unidades de mundo, como `bakeRim`, porque la
   * caida vertical de la plataforma ya estaba expresada asi.
   */
  private bakePlinth(ctx: CanvasRenderingContext2D): void {
    const xa = -PORCH;
    const xb = FLOOR_W + PORCH;
    const drop = 0.42 * Z_SCALE; // el mismo espesor de plataforma de bakeRim
    const ledge = 0.26 * Z_SCALE; // lo que baja el escalon del zocalo
    const p = PLINTH;

    // El contorno arranca y termina en el fondo (y = 0), envolviendo los tres
    // lados. El tramo de la izquierda no llega a mostrar cara de espesor -- mira
    // a -x y en esta isometria eso no se ve -- pero su tapa es la que cierra la
    // esquina: sin ella el escalon nacia de golpe a media plataforma y dejaba
    // una muesca en el canto.
    const inner: number[][] = [
      [xa, 0],
      [xa, FLOOR_D],
      [xb, FLOOR_D],
      [xb, 0],
    ];
    const outer: number[][] = [
      [xa - p, 0],
      [xa - p, FLOOR_D + p],
      [xb + p, FLOOR_D + p],
      [xb + p, 0],
    ];
    const at = (pt: number[], dy: number): number[] => [
      isoX(pt[0], pt[1]),
      isoY(pt[0], pt[1]) + dy,
    ];

    // Cara superior del escalon: la banda entre el canto de la plataforma y el
    // contorno de afuera, ambos a la altura del pie de la plataforma.
    poly(
      ctx,
      [
        ...inner.map((pt) => at(pt, drop)),
        ...[...outer].reverse().map((pt) => at(pt, drop)),
      ],
      mix(C_STONE_DARK, C_VOID, 0.32),
    );

    // Espesor del escalon, tramo por tramo para que cada cara tenga su tono: la
    // que mira al frente recibe algo mas de brasa que la del costado.
    const band = (a: number[], b: number[], fill: string): void => {
      poly(ctx, [at(a, drop), at(b, drop), at(b, drop + ledge), at(a, drop + ledge)], fill);
    };
    band(outer[1], outer[2], mix(C_STONE_DARK, C_VOID, 0.52)); // frente (+y)
    band(outer[2], outer[3], mix(C_STONE_DARK, C_VOID, 0.68)); // derecha (+x)

    // La brasa del foso tambien lame el canto del zocalo, si no el escalon queda
    // como una pieza pegada aparte en vez de como parte de la misma piedra.
    ctx.save();
    ctx.beginPath();
    const front = [
      at(outer[1], drop),
      at(outer[2], drop),
      at(outer[2], drop + ledge),
      at(outer[1], drop + ledge),
    ];
    ctx.moveTo(front[0][0], front[0][1]);
    for (let i = 1; i < front.length; i++) ctx.lineTo(front[i][0], front[i][1]);
    ctx.closePath();
    ctx.clip();
    const g = ctx.createLinearGradient(
      0,
      isoY(FLOOR_W / 2, FLOOR_D + p) + drop + ledge,
      0,
      isoY(FLOOR_W / 2, FLOOR_D + p) + drop - 4,
    );
    g.addColorStop(0, "rgba(255,122,24,0.3)");
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
      const [mx, my] = torchMount(t);
      const x = mx;
      const y = my - 6;
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
    // Mismo recorte que en drawBeams, pero a ras del piso y cortando justo en el
    // paramento (y = 0): la sombra tambien arranca en BEAM_Y0, o sea adentro del
    // muro, y sin cortarla trepaba por la pared. A diferencia de la viga, la
    // sombra no tiene que meterse en el hueco. Uno solo para todas: van a z = 0.
    this.clipAtWall(ctx, 0, 0);
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

  /**
   * Las manchas de sangre, cada una dibujada DENTRO del plano al que pertenece.
   *
   * Misma tecnica que los charcos de luz y el hollin: se le carga al contexto la
   * matriz del plano y se dibuja en coordenadas de mundo, con lo cual la mancha
   * se apoya en la piedra. Son dos matrices distintas porque son dos planos
   * distintos -- el piso (z = 0) y el muro de atras (y = 0) --, y esa es toda la
   * diferencia entre sangre pegada a una superficie y una calcomania flotando.
   */
  private drawBlood(ctx: CanvasRenderingContext2D, blood: Blood): void {
    if (!blood.splats.length) return;
    for (const surface of ["floor", "back"] as const) {
      const group = blood.splats.filter((s) => s.surface === surface);
      if (!group.length) continue;
      ctx.save();
      if (surface === "floor") {
        ctx.setTransform(TILE_HW, TILE_HH, -TILE_HW, TILE_HH, ORIGIN_X, ORIGIN_Y);
        ctx.beginPath();
        ctx.rect(-PORCH, 0, FLOOR_W + PORCH * 2, FLOOR_D);
        ctx.clip();
      } else {
        // Plano del muro: (x, z) -> pantalla. La z va hacia ARRIBA, de ahi el
        // -Z_SCALE.
        ctx.setTransform(TILE_HW, TILE_HH, 0, -Z_SCALE, ORIGIN_X, ORIGIN_Y);
        ctx.beginPath();
        ctx.rect(-PORCH, 0, FLOOR_W + PORCH * 2, WALL_H);
        ctx.clip();
      }
      for (const s of group) {
        ctx.save();
        ctx.translate(s.u, s.v);
        ctx.rotate(s.rot);
        ctx.globalAlpha = s.dark ? 0.9 : 0.78;
        ctx.fillStyle = s.dark ? C_BLOOD_DARK : C_BLOOD;
        pathSplat(ctx, s);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  /**
   * Recorta todo lo que quede del lado de ADENTRO del muro de atras, medido a la
   * altura `zc`. El plano del muro es y = 0 y en pantalla se proyecta como una
   * recta; el poligono se cierra muy por fuera del cuadro para que sea de hecho
   * un semiplano.
   */
  private clipAtWall(ctx: CanvasRenderingContext2D, zc: number, yCut = -0.18): void {
    const ax = isoX(-30, yCut);
    const ay = isoY(-30, yCut, zc);
    const bx = isoX(60, yCut);
    const by = isoY(60, yCut, zc);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + VIEW_W, by + VIEW_H);
    ctx.lineTo(ax - VIEW_W, ay + VIEW_H);
    ctx.closePath();
    ctx.clip();
  }

  /**
   * Dibuja un lote de vigas recortadas contra el muro de atras.
   *
   * Cada viga arranca en BEAM_Y0 (-0.55), o sea DENTRO del muro, para que se vea
   * entrando y no flotando con una punta al aire. Pero el muro esta horneado en
   * el fondo y las vigas se pintan despues, asi que ese tramo se dibujaba ENCIMA
   * de la pared y la viga cruzaba la piedra por delante. El muro de atras no
   * puede mudarse a la capa de frente como el izquierdo: en el carril mas pegado
   * al fondo la cabeza del corredor se solapa con el pie del muro, y pintarlo
   * delante se la comeria. Asi que se recorta la viga por el plano y = 0.
   *
   * Va AGRUPADO por tipo y no viga por viga porque el clip es caro: uno por viga
   * costaba ~5 fps en render por software. Solo hay dos alturas posibles, asi
   * que alcanzan dos recortes por lote. Las rasantes van primero: si alguna vez
   * se solapan, la alta es la que tiene que quedar encima.
   */
  private drawBeams(ctx: CanvasRenderingContext2D, beams: Beam[]): void {
    if (!beams.length) return;
    for (const kind of ["low", "high"] as BeamKind[]) {
      const group = beams.filter((b) => b.kind === kind);
      if (!group.length) continue;
      const zc = kind === "low" ? BEAM_RADIUS : (BEAM_HIGH_BOTTOM + BEAM_HIGH_TOP) / 2;
      ctx.save();
      this.clipAtWall(ctx, zc);
      for (const b of group) this.drawBeam(ctx, b);
      ctx.restore();
    }
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
    // Corta a proposito: la pua no puede engordar la silueta. El grosor del
    // cilindro esta atado al hitbox y no se puede bajar (ver arriba), asi que lo
    // unico que se puede recortar para que la viga no parezca un tronco es lo
    // que sobresale de ella.
    const spikeLen = 9;

    const spikes: { t: number; c: number }[] = [];
    const count = 15;
    for (let i = 0; i < count; i++) {
      spikes.push({ t: (i + 0.5) / count, c: Math.cos(beam.spin * Math.PI * 2 + i * 1.9) });
    }

    // En la rasante las puas van OSCURAS contra el cuerpo incandescente: en
    // color de llama se recortaban clarito sobre naranja y leian como banderines
    // de papel. Piedra ennegrecida sobre brasa es lo que las hace amenazantes.
    const spikeBack = low ? mix(C_EMBER, C_VOID, 0.72) : C_BONE_DARK;
    const spikeFront = low ? mix(C_EMBER, C_VOID, 0.42) : C_BONE;

    const spike = (s: { t: number; c: number }, fill: string): void => {
      const sx = ax + dx * s.t;
      const sy = ay + dy * s.t;
      const reach = (R + spikeLen) * s.c;
      // Raiz ancha: una pua que sale de un tocon lee como parte de la piedra;
      // el triangulo isosceles fino leia como un diente de papel pegado encima.
      const half = 7.5;
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
      // Hueso, no porcelana: el highlight arranca en marfil y la mitad de abajo
      // se va enseguida a hueso viejo. Con un blanco puro arriba el cilindro
      // perdia toda materia y quedaba un tubo de plastico.
      g.addColorStop(0, "#f3ecd8");
      g.addColorStop(0.26, C_BONE);
      g.addColorStop(0.62, C_BONE_DARK);
      g.addColorStop(1, "#3b3327");
    }
    ctx.strokeStyle = g;
    ctx.lineWidth = R * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // --- Facetas: lo que hace que la viga se vea RODAR ---------------------
    // Los anillos perpendiculares que habia aca no podian mostrar el giro: son
    // perpendiculares al eje de rotacion, asi que rodar no los mueve. Lo que si
    // barre son las bandas LONGITUDINALES. Una banda en la superficie a angulo
    // `ang` aparece corrida `R*sin(ang)` en perpendicular y con el ancho
    // escorzado por `cos(ang)`; al girar, las bandas nacen en un borde, se
    // ensanchan al pasar por el frente y se cierran en el otro.
    const bandLine = (off: number, w: number, color: string, alpha: number): void => {
      if (w < 0.5) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(ax + px * off, ay + py * off);
      ctx.lineTo(bx + px * off, by + py * off);
      ctx.stroke();
    };

    ctx.save();
    const FACETS = 7;
    for (let i = 0; i < FACETS; i++) {
      // Jitter determinista por banda (mismo `i` -> mismo desvio siempre, asi la
      // piedra no hierve mientras gira). Sin esto las bandas salen equiespaciadas
      // y del mismo ancho, y el cilindro lee como un tubo corrugado en vez de
      // como piedra: lo que delata el patron es la REGULARIDAD, no el contraste.
      const jit = Math.sin(i * 12.9898) * 43758.5453;
      const wob = (jit - Math.floor(jit)) - 0.5;
      const ang = ((i + wob * 0.55) / FACETS) * Math.PI * 2 + beam.spin * Math.PI * 2;
      const c = Math.cos(ang);
      if (c <= 0.04) continue; // esa cara mira para el otro lado
      const off = Math.sin(ang) * R * 0.86;
      const w = (c * (R * 2 * 0.95) / FACETS) * (0.7 + Math.abs(wob) * 1.4);
      const darkBand = i % 2 === 0;
      if (low) {
        bandLine(off, w, darkBand ? "#7d2a05" : "#ffb268", darkBand ? 0.42 : 0.2);
      } else {
        bandLine(off, w, darkBand ? "#645a47" : "#fdf7ea", darkBand ? 0.44 : 0.24);
      }
    }
    ctx.restore();

    // Borde inferior ahogado: el hitbox obliga a un cilindro grueso, pero la
    // MASA LUMINOSA puede ser mas angosta que el. Apagar el canto de abajo es lo
    // que le saca el aspecto de tubo de PVC sin tocar la geometria de colision.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = low ? "#3d1102" : "#241d14";
    ctx.lineWidth = R * 0.5;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(ax - px * R * 0.78, ay - py * R * 0.78);
    ctx.lineTo(bx - px * R * 0.78, by - py * R * 0.78);
    ctx.stroke();
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

    // --- El extremo que se mete en el muro se APAGA ------------------------
    // `clipAtWall` corta la viga contra la pared, y un corte sobre piedra
    // encendida deja un canto plano bien visible: se ve seccionada. La solucion
    // no es dibujarle una boca de agujero encima (probado: un ovalo oscuro
    // pegado en la punta es peor que el corte), sino que para cuando el recorte
    // llega, el cilindro YA este en negro. Que es lo que pasa de verdad: adentro
    // del hueco no le llega ninguna antorcha. Asi el corte cae sobre pixeles
    // oscuros contra piedra oscura y deja de existir como borde.
    const fadeFrom = 1.15; // en `y` de mundo, donde arranca a apagarse
    const fx0 = isoX(beam.x, fadeFrom);
    const fy0 = isoY(beam.x, fadeFrom, zc);
    const fade = ctx.createLinearGradient(fx0, fy0, ax, ay);
    fade.addColorStop(0, "rgba(9,5,3,0)");
    fade.addColorStop(0.55, "rgba(9,5,3,0.6)");
    fade.addColorStop(1, "rgba(9,5,3,0.98)");
    ctx.strokeStyle = fade;
    // Ajustado al cilindro, no a las puas: pasarse de ancho pinta una mancha
    // oscura sobre los sillares de alrededor, que se nota mas que la pua suelta
    // que queda sin apagar.
    ctx.lineWidth = R * 2 + 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(fx0, fy0);
    ctx.lineTo(ax, ay);
    ctx.stroke();
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
    // Respiracion, no trote. El corredor esta CLAVADO en RUNNER_X -- la sala se
    // mueve alrededor suyo, el no avanza -- asi que un ciclo de carrera se leia
    // como alguien pedaleando en el aire. `phase` sigue siendo el reloj, pero
    // muy desacelerado (0.18) y con amplitud chica.
    const bob = r.airborne ? 0 : Math.sin(r.phase * 0.18) * (r.ducking ? 0.5 : 0.8);
    const top = by - H + bob;
    const tunic = mix(r.color, "#000000", 1 - lit * 0.85);
    const tunicLit = mix(r.color, C_WARM, 0.3 * lit);
    const skin = mix("#c98d5c", "#000000", 1 - lit * 0.9);

    ctx.save();

    // Cerco oscuro alrededor de toda la figura. El corredor mide ~56 px en una
    // sala que ahora tiene charcos de luz muy claros, y sin esto la tunica se
    // funde con las losas encendidas justo donde hay que leer la pose. Como
    // sombra proyectada de canvas sale gratis para cada `fill` de abajo, sin
    // tener que re-trazar el contorno pieza por pieza.
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 5;

    if (r.ducking) {
      // --- Agachado: bulto largo y BAJO, medido contra el piso y no contra la
      // altura de pie. La silueta tiene que gritar "se tiro al suelo" de lejos.
      // Es una CUÑA asimetrica -- espalda arqueada atras, cuello y capucha
      // bajando hacia adelante -- y no la elipse simetrica que habia: una elipse
      // lisa se lee como una mancha en el piso y no como un cuerpo deslizandose,
      // y ademas se tragaba la capucha hasta dejarla en un puntito al costado.
      ctx.save();
      ctx.translate(bx, by + bob * 0.5);

      // Pierna de atras, doblada y arrastrando.
      ctx.strokeStyle = mix(C_STONE_DARK, "#000000", 0.35);
      ctx.lineCap = "round";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-3, -10);
      ctx.lineTo(-14, -6.5);
      ctx.lineTo(-20, -2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-18, -6);
      ctx.quadraticCurveTo(-14, -19.5, 0, -20);
      ctx.quadraticCurveTo(12, -19.5, 16, -12);
      ctx.quadraticCurveTo(9, -3, -6, -3.5);
      ctx.closePath();
      ctx.fillStyle = tunic;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = tunicLit;
      ctx.lineWidth = 3;
      ctx.translate(2, 2.5);
      ctx.stroke();
      ctx.restore();

      // Brazo estirado adelante, como quien se tira a resbalar.
      ctx.strokeStyle = tunic;
      ctx.lineWidth = 3.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(9, -12);
      ctx.lineTo(21, -4);
      ctx.stroke();

      this.drawHood(ctx, 14, -13.5, tunic, tunicLit, skin, 0.55);

      // Rim sobre la espalda arqueada, que es el canto que mira a la llama.
      this.rimStroke(ctx, r, lit, () => {
        ctx.moveTo(-17, -7);
        ctx.quadraticCurveTo(-13, -18.4, 0, -18.9);
        ctx.quadraticCurveTo(9, -18.6, 13, -13.6);
      });
      ctx.restore();
    } else {
      // --- Corriendo o en el aire ------------------------------------------
      // Todo el cuerpo se dibuja en coordenadas LOCALES con el origen en los
      // pies (y negativa hacia arriba) y se vuelca de una sola vez. Antes cada
      // pieza se posicionaba en coordenadas de pantalla, que es lo que hacia
      // imposible inclinar la figura: sin inclinacion, correr y saltar eran la
      // misma campana con dos anchos distintos, y el DESIGN.md pide justamente
      // "la inclinacion del que corre" como una de las tres siluetas.
      ctx.save();
      ctx.translate(bx, by + bob);
      ctx.rotate(
        r.airborne
          ? -0.12 // en el aire el cuerpo se endereza y se abre hacia atras
          : 0.07, // en guardia: apenas volcado, listo para reaccionar
      );

      const dark = mix(C_STONE_DARK, "#000000", 0.35);
      const hipY = -H * 0.44;

      // Piernas. En guardia: plantadas y apenas abiertas, con el peso repartido.
      // En el salto: recogidas. Aca habia una zancada animada, pero el corredor
      // no se desplaza -- las vigas vienen hacia el -- asi que mover las piernas
      // leia como pedalear en el aire en vez de como carrera.
      ctx.strokeStyle = dark;
      ctx.lineCap = "round";
      ctx.lineWidth = 5;
      ctx.beginPath();
      if (r.airborne) {
        ctx.moveTo(0, hipY);
        ctx.lineTo(-9, -13);
        ctx.moveTo(0, hipY);
        ctx.lineTo(8, -4);
      } else {
        ctx.moveTo(-1.5, hipY);
        ctx.lineTo(-6.5, 0);
        ctx.moveTo(1.5, hipY);
        ctx.lineTo(6.5, -0.5);
      }
      ctx.stroke();

      // Tunica: mas angosta que la campana de antes y con la tela volando hacia
      // atras al correr (el `back` extra), que es lo que da direccion a la pose.
      const w = r.airborne ? 8 : 8.6;
      // El ruedo termina bien por encima del piso: con el ruedo largo que habia
      // la tunica tapaba las piernas enteras y la zancada era invisible, que es
      // justo lo unico que distingue al que corre del que esta parado.
      const hemY = r.airborne ? -16 : -21;
      const flare = r.airborne ? 1.1 : 1.25;
      // La tela ya casi no vuela hacia atras: ese vuelo lo justificaba la
      // carrera, y de pie quieto la tunica simplemente cae.
      const back = r.airborne ? 0 : 1.5;
      ctx.beginPath();
      ctx.moveTo(-w * 0.6, -H * 0.8);
      ctx.lineTo(w * 0.6, -H * 0.8);
      ctx.lineTo(w * flare, hemY);
      ctx.quadraticCurveTo(0, hemY + 5, -w * flare - back, hemY + back * 0.5);
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
      ctx.fillRect(-8, -H * 0.5, 16, 3.2);

      this.drawHood(ctx, 0, -H + 6.5, tunic, tunicLit, skin, 1);

      // Brazos: arriba en el salto, sueltos y algo separados del cuerpo en
      // guardia (tampoco bombean: no hay carrera que acompañar).
      ctx.strokeStyle = tunic;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (r.airborne) {
        ctx.moveTo(-6, -H * 0.66);
        ctx.lineTo(-11, -H - 2);
        ctx.moveTo(6, -H * 0.66);
        ctx.lineTo(11, -H - 1);
      } else {
        ctx.moveTo(-7, -H * 0.67);
        ctx.lineTo(-10.5, -H * 0.36);
        ctx.moveTo(7, -H * 0.67);
        ctx.lineTo(10.5, -H * 0.36);
      }
      ctx.stroke();

      // Rim, todavia dentro del sistema local: asi acompaña la inclinacion en
      // vez de quedar colgado horizontal encima de una cabeza volcada.
      this.rimStroke(ctx, r, lit, () =>
        // Justo POR DENTRO del radio de la capucha (7): por fuera el arco se
        // despegaba de la cabeza y leia como un asa colgada encima del corredor.
        ctx.arc(0, -H + 6.5, 6.6, Math.PI * 1.06, Math.PI * 1.92),
      );
      ctx.restore();
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

  /**
   * El filo que la llama le pone al canto de arriba del cuerpo. Es lo que ata al
   * corredor a la iluminacion de la sala en vez de dejarlo como una figura
   * pegada encima, y crece con la luz del lugar donde esta parado.
   *
   * Recibe el trazo como callback para poder dibujarse DENTRO del sistema de
   * coordenadas de cada pose -- el de la carrera esta rotado -- en vez de una
   * sola vez al final en coordenadas de pantalla.
   */
  private rimStroke(
    ctx: CanvasRenderingContext2D,
    r: Runner,
    lit: number,
    path: () => void,
  ): void {
    const prevBlur = ctx.shadowBlur;
    ctx.shadowBlur = 0;
    ctx.globalAlpha = Math.min(0.8, 0.15 + lit * 0.62);
    ctx.strokeStyle = mix(r.color, C_WARM, 0.62);
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = prevBlur;
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
    // La capucha es una GOTA con el pico hacia adelante, no un circulo. Un
    // circulo con un disco de piel adentro leia como una perla o un casco: la
    // cara clara media casi lo mismo que la capucha y se comia la silueta justo
    // en la parte mas alta del cuerpo, que es donde el ojo busca la pose.
    // Adentro de una capucha no se ve una cara, se ve oscuridad.
    const lean = 3.2 * tilt; // cuanto se adelanta el pico
    ctx.beginPath();
    ctx.moveTo(x - 6.4, y + 2.2);
    ctx.quadraticCurveTo(x - 6.8, y - 7.4, x + lean * 0.4, y - 7.6);
    ctx.quadraticCurveTo(x + 6.4 + lean, y - 6.2, x + 6.2 + lean, y + 1.4);
    ctx.quadraticCurveTo(x + 1, y + 4.6, x - 6.4, y + 2.2);
    ctx.closePath();
    ctx.fillStyle = tunic;
    ctx.fill();

    // El hueco de la capucha. Sigue derivando de `skin` para que se apague junto
    // con el resto del cuerpo cuando el corredor esta en penumbra.
    ctx.beginPath();
    ctx.ellipse(x + 2 + lean * 0.5, y + 0.6, 3.1, 3.4, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = mix(skin, "#000000", 0.76);
    ctx.fill();

    // Filo de la tela por donde le pega la llama.
    ctx.strokeStyle = tunicLit;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - 5.6, y - 1.4);
    ctx.quadraticCurveTo(x - 4.6, y - 7, x + lean * 0.4, y - 6.9);
    ctx.stroke();
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
