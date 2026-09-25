import * as THREE from "three";

/**
 * Texturas voxel pintadas por codigo (ver DESIGN.md: "el mundo esta hecho de un
 * solo material, el pixel"). Todas son de 16x16 (8x8 la cara) y se filtran con
 * NearestFilter: un pixel de textura es un cuadrado duro en pantalla, nunca un
 * degradado. El ruido sale de un generador con semilla, asi el piso es identico en
 * todas las pantallas y en cada recarga.
 */

export const TEX = 16;

/** Material de la tapa de cada piso, de arriba hacia abajo. */
export const LAYER_PALETTES: readonly (readonly string[])[] = [
  // Arena: amarillo paja.
  ["#e8dba2", "#ddce8f", "#d3c27e", "#f0e4b3", "#c9b772"],
  // Arena roja: naranja teja.
  ["#cf7b3d", "#c16e35", "#d98945", "#b0612e", "#e0975a"],
  // Grava: gris piedra con granos oscuros.
  ["#8d8883", "#7c7772", "#a09a94", "#67625d", "#b1aaa3"],
  // Arcilla: gris azulado.
  ["#a1a8b6", "#969dac", "#abb2bf", "#8a91a0", "#b6bcc8"],
];

/** Carga explosiva de los laterales: el unico rojo saturado del escenario. */
const CHARGE = ["#c9372c", "#b83027", "#d8463b", "#a92a22"];
const BAND = ["#efe4cc", "#e0d4b8", "#f6eedb"];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], r: () => number): T {
  return list[Math.floor(r() * list.length)];
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return [canvas, canvas.getContext("2d")!];
}

function toTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

/** Ruido de la tapa: la grava lleva granos grandes, la arena grano fino. */
function paintSurface(
  ctx: CanvasRenderingContext2D,
  palette: readonly string[],
  r: () => number,
  rows: number,
): void {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < TEX; x++) {
      ctx.fillStyle = pick(palette, r);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Tapa del bloque de un piso. */
export function topTexture(layer: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(101 + layer * 17);
  paintSurface(ctx, LAYER_PALETTES[layer], r, TEX);
  // Un borde un escalon mas oscuro: separa los bloques entre si sin dibujar una grilla.
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(0, TEX - 1, TEX, 1);
  ctx.fillRect(TEX - 1, 0, 1, TEX);
  return toTexture(canvas);
}

/** Lateral: cinco filas del material de la tapa y debajo la carga roja con su fleje. */
export function sideTexture(layer: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(307 + layer * 31);
  const lip = 5;
  paintSurface(ctx, LAYER_PALETTES[layer], r, lip);
  for (let y = lip; y < TEX; y++) {
    const band = y === 9 || y === 10;
    for (let x = 0; x < TEX; x++) {
      ctx.fillStyle = band ? pick(BAND, r) : pick(CHARGE, r);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Mecha: dos pixeles oscuros en el fleje, que se leen como las marcas de la carga.
  ctx.fillStyle = "#3b2a22";
  ctx.fillRect(4, 9, 1, 2);
  ctx.fillRect(11, 9, 1, 2);
  // Sombra de contacto bajo el labio del material.
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, lip, TEX, 1);
  return toTexture(canvas);
}

/** Base del bloque: casi negra, es la cara que menos se ve. */
export function bottomTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(503);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      ctx.fillStyle = pick(["#5a1b16", "#4b1611", "#63201a"], r);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas);
}

/** Lava: pixeles gruesos naranja y amarillo, se desplaza despacio (ver Environment). */
export function lavaTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(709);
  const hot = ["#ffd24a", "#ffb52e", "#ff9a1f"];
  const warm = ["#f07418", "#e25f12", "#cf4e0e"];
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      // Venas: una funcion ondulada decide donde va lo mas caliente.
      const vein = Math.sin(x * 0.9 + Math.sin(y * 0.7) * 2) + Math.cos(y * 0.8 - x * 0.3);
      ctx.fillStyle = vein > 0.9 ? pick(hot, r) : pick(warm, r);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas, true);
}

/** Cara del muñeco (8x8): piel, pelo arriba, ojos y boca. */
export function faceTexture(skin: string, hair: string): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(8);
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = hair;
  ctx.fillRect(0, 0, 8, 2);
  ctx.fillRect(0, 2, 1, 1);
  ctx.fillRect(7, 2, 1, 1);
  // Ojos: blanco + pupila.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(1, 4, 2, 1);
  ctx.fillRect(5, 4, 2, 1);
  ctx.fillStyle = "#2a2a4a";
  ctx.fillRect(2, 4, 1, 1);
  ctx.fillRect(5, 4, 1, 1);
  ctx.fillStyle = "rgba(90,40,30,0.75)";
  ctx.fillRect(3, 6, 2, 1);
  return toTexture(canvas);
}

/** Textura lisa de un color con un grano minimo (para torso, brazos, piernas). */
export function clothTexture(base: string, seed: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(8);
  const r = rng(seed);
  const color = new THREE.Color(base);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const k = 0.9 + r() * 0.14;
      ctx.fillStyle = `#${color.clone().multiplyScalar(k).getHexString()}`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas);
}

/** Cartel del nombre: letra en negrita con sombra dura, sobre negro traslucido. */
export function nameTexture(name: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "bold 44px 'Trebuchet MS', 'Segoe UI', sans-serif";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(name).width) + 36;
  canvas.width = width;
  canvas.height = 64;
  ctx.font = font;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, width, 64);
  ctx.fillStyle = color;
  ctx.fillRect(0, 58, width, 6);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#3a3a3a";
  ctx.fillText(name, 21, 33);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, 18, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return { texture, aspect: width / 64 };
}

/** Sombra de contacto: disco oscuro de borde duro (la unica curva del juego). */
export function shadowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(32);
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.arc(16, 16, 10, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
