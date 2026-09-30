import * as THREE from "three";

/**
 * Carteles dibujados en canvas. La escena no usa texturas pintadas (DESIGN.md:
 * los colores los hace la luz); lo unico con canvas es el texto y las portadas.
 */

const FONT = "'Archivo', 'Trebuchet MS', 'Segoe UI', sans-serif";
const INK = "#173042";
const CREAM = "#fff8ea";

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface LabelTexture {
  texture: THREE.CanvasTexture;
  /** Ancho / alto, para escalar el sprite sin deformarlo. */
  aspect: number;
}

/** Nombre sobre la cabeza: pildora crema con borde del color del jugador. */
export function nameTexture(name: string, color: string): LabelTexture {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `800 40px ${FONT}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(name).width) + 44;
  const h = 64;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  roundRect(ctx, 3, 3, w - 6, h - 6, (h - 6) / 2);
  ctx.fillStyle = "rgba(255, 248, 234, 0.92)";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, w / 2, h / 2 + 2);
  return { texture: toTexture(canvas), aspect: w / h };
}

/** Globo de una reaccion ("GG", "Hola"): globo blanco con piquito abajo. */
export function bubbleTexture(text: string): LabelTexture {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `900 44px ${FONT}`;
  ctx.font = font;
  const w = Math.max(96, Math.ceil(ctx.measureText(text).width) + 48);
  const h = 88;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  roundRect(ctx, 4, 4, w - 8, h - 26, 22);
  ctx.moveTo(w / 2 - 12, h - 23);
  ctx.lineTo(w / 2, h - 6);
  ctx.lineTo(w / 2 + 12, h - 23);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  roundRect(ctx, 4, 4, w - 8, h - 26, 22);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, (h - 22) / 2 + 3);
  return { texture: toTexture(canvas), aspect: w / h };
}

/** Placa de texto (titulo bajo cada portada, "LISTO", contador de votos). */
export function plaqueTexture(text: string, opts: { bg?: string; fg?: string; size?: number } = {}): LabelTexture {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const size = opts.size ?? 38;
  const font = `900 ${size}px ${FONT}`;
  ctx.font = font;
  const h = Math.round(size * 1.6);
  const w = Math.ceil(ctx.measureText(text).width) + Math.round(size * 1.1);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  roundRect(ctx, 3, 3, w - 6, h - 6, 12);
  ctx.fillStyle = opts.bg ?? CREAM;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = opts.fg ?? INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 2);
  return { texture: toTexture(canvas), aspect: w / h };
}

/** Cartel del pedestal cuando no hay juego elegido: el codigo de la sala. */
export function crestTexture(title: string, subtitle: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#9fd8f2");
  g.addColorStop(1, "#ffd9a8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 112px ${FONT}`;
  ctx.fillText(title, 256, 210);
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText(subtitle, 256, 330);
  return toTexture(canvas);
}

/** Sombra de contacto: disco oscuro con borde suave. */
export function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, "rgba(20, 40, 50, 0.42)");
  g.addColorStop(1, "rgba(20, 40, 50, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Sprite con una textura de cartel, alto `height` en metros. */
export function labelSprite(label: LabelTexture, height: number): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: label.texture, depthTest: false, transparent: true }),
  );
  sprite.renderOrder = 10;
  sprite.scale.set(height * label.aspect, height, 1);
  return sprite;
}

/** Cambia el cartel de un sprite liberando la textura anterior. */
export function setSpriteLabel(sprite: THREE.Sprite, label: LabelTexture, height: number): void {
  const mat = sprite.material;
  mat.map?.dispose();
  mat.map = label.texture;
  mat.needsUpdate = true;
  sprite.scale.set(height * label.aspect, height, 1);
}
