import {
  CELL,
  COLS,
  INK,
  PAPER,
  ROWS,
  SPLAT_RADIUS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  seatColor,
} from "./constants";

/**
 * Render de Manchon. Ver DESIGN.md ("Tempera sobre papel"): nada de brillos ni
 * degrades de pantalla — pigmento opaco sobre una hoja con grano, bordes sucios y
 * una sola fuente de negro (la tinta del contorno).
 *
 * Dos decisiones que sostienen todo lo demas:
 *
 * 1. La grilla vive en un canvas OFFSCREEN y solo se repintan las celdas que
 *    cambiaron. Repintar 805 celdas por frame con textura por celda seria tirar
 *    el presupuesto de dibujo en algo que cambia de a diez celdas por snapshot.
 * 2. Cada celda se pinta DESBORDADA unos pixeles al azar (determinista por
 *    celda). Ese solapamiento es lo que hace que un territorio se lea como un
 *    manchon continuo de tempera y no como un tablero de ajedrez: los bordes
 *    internos desaparecen bajo el pigmento del vecino y solo queda dentado el
 *    contorno de la mancha.
 */

/** Cuanto se desborda como maximo cada celda sobre sus vecinas (px). */
const BLEED = 3.2;

export interface BrushView {
  seat: number;
  x: number;
  y: number;
  name: string;
  /** Aturdido: se dibuja tambaleando y sin pigmento en la punta. */
  stunned: boolean;
  /** Desconectado: se dibuja apagado (nadie lo esta manejando). */
  offline: boolean;
  /** El pincel propio, que lleva la marca del jugador. */
  mine: boolean;
  /**
   * Radio del pigmento "fresco" bajo el pincel, o 0 para no dibujarlo. Tapa el
   * hueco de un snapshot que queda entre el pincel dibujado y el ultimo rastro
   * confirmado por el server, sin tocar la grilla (ver Game.ts: el cliente no
   * pinta de forma predictiva porque no habria como despintar si el server no lo
   * confirma).
   */
  wet: number;
}

interface SplatFx {
  seat: number;
  x: number;
  y: number;
  /** Progreso de la animacion, 0 a 1. */
  age: number;
}

export class Renderer {
  /** Capa con el territorio pintado. Transparente donde todavia se ve el papel. */
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;
  private paper: CanvasPattern | null = null;
  private readonly splats: SplatFx[] = [];

  constructor() {
    this.layer = document.createElement("canvas");
    this.layer.width = VIEW_WIDTH;
    this.layer.height = VIEW_HEIGHT;
    this.layerCtx = this.layer.getContext("2d")!;
  }

  /** Repinta el tablero entero (llega con el `pt:init` del join o de un F5). */
  setGrid(grid: Int8Array<ArrayBufferLike>): void {
    this.layerCtx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    for (let idx = 0; idx < grid.length; idx++) {
      if (grid[idx] >= 0) this.paintCell(idx, grid[idx]);
    }
  }

  /** Aplica una celda del delta de un snapshot. */
  setCell(idx: number, seat: number): void {
    // Hay que borrar antes de pintar: el pigmento es opaco, pero el desborde de la
    // celda anterior sobresale de su rectangulo y quedaria asomando abajo.
    this.clearCell(idx);
    this.paintCell(idx, seat);
    // El desborde del vecino que quedo mordido por el clearRect se repone al
    // repintar su celda; para no llevar cuenta de eso se repintan los cuatro
    // vecinos, que es barato y deja el manchon sin costuras blancas.
    this.repaintNeighbours(idx);
  }

  addSplat(seat: number, x: number, y: number): void {
    this.splats.push({ seat, x, y, age: 0 });
  }

  update(dt: number): void {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.splats[i].age += dt / 0.45;
      if (this.splats[i].age >= 1) this.splats.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D, brushes: BrushView[], time: number): void {
    this.drawPaper(ctx);
    ctx.drawImage(this.layer, 0, 0);
    this.drawSplats(ctx);
    // Ordenados por Y: el que esta mas abajo tapa al de arriba, que es como se
    // apilan los objetos sobre una hoja.
    for (const brush of [...brushes].sort((a, b) => a.y - b.y)) {
      this.drawBrush(ctx, brush, time);
    }
    this.drawFrame(ctx);
  }

  // ---------- Papel ----------

  private drawPaper(ctx: CanvasRenderingContext2D): void {
    if (!this.paper) this.paper = makePaperPattern(ctx);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    if (this.paper) {
      ctx.fillStyle = this.paper;
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    }
  }

  /** Marco de tinta: la hoja tiene un borde, y ademas marca donde termina el juego. */
  private drawFrame(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, VIEW_WIDTH - 3, VIEW_HEIGHT - 3);
    ctx.restore();
  }

  // ---------- Territorio ----------

  private clearCell(idx: number): void {
    const col = idx % COLS;
    const row = (idx - col) / COLS;
    this.layerCtx.clearRect(
      col * CELL - BLEED,
      row * CELL - BLEED,
      CELL + BLEED * 2,
      CELL + BLEED * 2,
    );
  }

  private repaintNeighbours(idx: number): void {
    const col = idx % COLS;
    const row = (idx - col) / COLS;
    for (const [dc, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const owner = this.owners[r * COLS + c];
      if (owner >= 0) this.paintCell(r * COLS + c, owner);
    }
  }

  /** Duenio conocido de cada celda, para poder repintar vecinos sin pedirselo al juego. */
  private owners: Int8Array<ArrayBufferLike> = new Int8Array(COLS * ROWS).fill(-1);

  /** Sincroniza el mapa de duenios del renderer (lo llama el juego al aplicar deltas). */
  setOwners(owners: Int8Array<ArrayBufferLike>): void {
    this.owners = owners;
  }

  private paintCell(idx: number, seat: number): void {
    const ctx = this.layerCtx;
    const col = idx % COLS;
    const row = (idx - col) / COLS;
    const x = col * CELL;
    const y = row * CELL;
    const base = seatColor(seat);

    // Cuatro desbordes distintos por celda: el contorno de la mancha nunca cae
    // sobre la linea recta de la grilla.
    const l = x - rnd(idx, 1) * BLEED;
    const t = y - rnd(idx, 2) * BLEED;
    const r = x + CELL + rnd(idx, 3) * BLEED;
    const b = y + CELL + rnd(idx, 4) * BLEED;

    // El pigmento no queda parejo: cada celda carga un poco mas o un poco menos.
    ctx.fillStyle = shade(base, 0.9 + rnd(idx, 5) * 0.2);
    ctx.fillRect(l, t, r - l, b - t);

    // Un segundo pase mas chico y translucido: la pincelada de arriba, que le da
    // grano al color plano.
    ctx.globalAlpha = 0.16 + rnd(idx, 6) * 0.16;
    ctx.fillStyle = rnd(idx, 7) > 0.5 ? shade(base, 1.18) : shade(base, 0.78);
    const iw = CELL * (0.4 + rnd(idx, 8) * 0.4);
    const ih = CELL * (0.4 + rnd(idx, 9) * 0.4);
    ctx.fillRect(x + rnd(idx, 10) * (CELL - iw), y + rnd(idx, 11) * (CELL - ih), iw, ih);
    ctx.globalAlpha = 1;
  }

  // ---------- Pinceles y efectos ----------

  private drawSplats(ctx: CanvasRenderingContext2D): void {
    for (const fx of this.splats) {
      const color = seatColor(fx.seat);
      const radius = SPLAT_RADIUS * (0.3 + fx.age * 0.95);
      ctx.save();
      ctx.globalAlpha = (1 - fx.age) * 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 6 * (1 - fx.age) + 1;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      // Gotas saltando hacia afuera: un anillo limpio parece una onda de radar,
      // no pintura que revienta.
      ctx.fillStyle = color;
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2 + fx.seat;
        const dist = radius * (0.85 + rnd(i, fx.seat) * 0.45);
        ctx.beginPath();
        ctx.arc(
          fx.x + Math.cos(angle) * dist,
          fx.y + Math.sin(angle) * dist,
          (1 - fx.age) * 5 * (0.5 + rnd(i, fx.seat + 20)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawBrush(ctx: CanvasRenderingContext2D, brush: BrushView, time: number): void {
    const color = seatColor(brush.seat);
    // Aturdido: el pincel tambalea. Es la senal de que no esta pintando.
    const wobble = brush.stunned ? Math.sin(time * 22 + brush.seat) * 3 : 0;
    const x = brush.x + wobble;
    const y = brush.y;

    ctx.save();

    // Pigmento recien soltado, todavia sin confirmar por el server.
    if (brush.wet > 0 && !brush.stunned) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, brush.wet, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Sombra: la hoja esta abajo y el pincel apoya sobre ella.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 5, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = brush.offline ? 0.45 : 1;

    // Cuerpo.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();

    // Contorno de tinta (la unica linea negra del juego).
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Reflejo de pigmento humedo, arriba a la izquierda.
    ctx.globalAlpha = brush.offline ? 0.2 : 0.55;
    ctx.fillStyle = shade(color, 1.5);
    ctx.beginPath();
    ctx.ellipse(x - 3.5, y - 4, 3.6, 2.6, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Marca del pincel propio: un anillo de tinta que no se confunde con el color
    // (con ocho jugadores, buscarse por color solo no alcanza).
    if (brush.mine) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -time * 14;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Gotas girando cuando esta aturdido.
    if (brush.stunned) {
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 3; i++) {
        const angle = time * 6 + (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * 19, y - 15 + Math.sin(angle) * 5, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Nombre: escrito sobre el papel, no sobre un cartel.
    ctx.font = "600 11px 'Trebuchet MS', 'Gill Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = PAPER;
    ctx.strokeText(brush.name, x, y - 15);
    ctx.fillStyle = INK;
    ctx.globalAlpha = brush.offline ? 0.4 : 0.85;
    ctx.fillText(brush.name, x, y - 15);

    ctx.restore();
  }
}

/**
 * Grano del papel: ruido fino precocinado en un tile chico y repetido. Es lo que
 * evita que el crema se lea como un fondo plano de CSS.
 */
function makePaperPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const size = 128;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;

  const img = tctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = rnd(i, 3) - 0.5;
    const o = i * 4;
    // Fibras claras y oscuras sobre transparente: el crema lo pone el fillRect de
    // abajo, asi el grano tambien se ve sobre el pigmento.
    img.data[o] = n > 0 ? 255 : 60;
    img.data[o + 1] = n > 0 ? 250 : 50;
    img.data[o + 2] = n > 0 ? 235 : 40;
    img.data[o + 3] = Math.abs(n) > 0.42 ? 26 : 10;
  }
  tctx.putImageData(img, 0, 0);
  return ctx.createPattern(tile, "repeat");
}

/** Ruido determinista: la misma celda tiene siempre la misma mancha. */
function rnd(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Aclara (factor > 1) u oscurece (factor < 1) un color hexadecimal. */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r}, ${g}, ${b})`;
}
