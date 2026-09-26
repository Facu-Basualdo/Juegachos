import * as THREE from "three";

/**
 * Texturas de La Cuerda, pintadas por codigo (DESIGN.md "Patio de Pastel"). Las del
 * muñeco son las de Marea de Lava; las del decorado son propias. 16x16 y
 * NearestFilter: nada liso, nada borroso. Las del decorado se repiten por metro (las
 * UV se escalan con el tamaño de cada caja), asi un pixel mide lo mismo en todas.
 */

export const TEX = 16;

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

function noiseTile(palette: readonly string[], seed: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(seed);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      ctx.fillStyle = pick(palette, r);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas, true);
}

/** Tablones del puente: verde agua gastado, con la junta entre tablon y tablon. */
export function plankTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(503);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      ctx.fillStyle = pick(["#7fc8b8", "#76bfae", "#88d0c0", "#6fb6a6"], r);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Una junta cada medio metro (la textura mide 1 m).
  ctx.fillStyle = "#4f8f82";
  ctx.fillRect(0, 0, TEX, 1);
  ctx.fillRect(0, TEX / 2, TEX, 1);
  return toTexture(canvas, true);
}

/** Canto del puente y de las plataformas: blanco tiza, para que el borde se lea contra el vacio. */
export function edgeTexture(): THREE.CanvasTexture {
  return noiseTile(["#f4efe9", "#ebe4dc", "#fbf7f2", "#e2dad1"], 509);
}

/** Baldosas de las plataformas de salida y meta: rosa, en damero de 1 m. */
export function tileTexture(a: string, b: string, seed: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(seed);
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const base = (x < TEX / 2) === (y < TEX / 2) ? ca : cb;
      const k = 0.93 + r() * 0.1;
      ctx.fillStyle = `#${base.clone().multiplyScalar(k).getHexString()}`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas, true);
}

/** Pilares y escaleras del decorado: pastel liso con grano minimo. */
export function pastelTexture(base: string, seed: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(seed);
  const color = new THREE.Color(base);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const k = 0.95 + r() * 0.07;
      ctx.fillStyle = `#${color.clone().multiplyScalar(k).getHexString()}`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, TEX, 1);
  return toTexture(canvas, true);
}

/** Cuerda trenzada: franjas diagonales oscuras. */
export function ropeTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      ctx.fillStyle = (x + y) % 8 < 4 ? "#3a2c3f" : "#5a4560";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas, true);
}

/** Cara de los muñecos gigantes: dos ojos cuadrados y una boca recta, sin gesto. */
export function giantFaceTexture(skin: string): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(8);
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = "#1c1a24";
  ctx.fillRect(1, 3, 2, 2);
  ctx.fillRect(5, 3, 2, 2);
  ctx.fillRect(3, 6, 2, 1);
  return toTexture(canvas);
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

/** Sombra de contacto: disco oscuro de borde duro. */
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
