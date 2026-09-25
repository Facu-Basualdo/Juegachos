import * as THREE from "three";

/**
 * Texturas de Pista Loca, pintadas por codigo (DESIGN.md "Baile de Bloques"). Las
 * del muñeco son las de Derrumbe; la de la lana va en GRISES para que el color lo
 * ponga cada instancia de la pista. Filtro NearestFilter: nada liso, nada borroso.
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

/**
 * Lana en grises: tejido de pixeles claros con un borde un escalon mas oscuro. El
 * color real lo multiplica la instancia, asi toda la pista es una sola malla.
 */
export function woolTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(211);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      // Trama diagonal suave, como el tejido de la lana.
      const weave = (x + y) % 4 === 0 ? 0.86 : 1;
      const v = Math.round((0.84 + r() * 0.16) * weave * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(0, TEX - 1, TEX, 1);
  ctx.fillRect(TEX - 1, 0, 1, TEX);
  return toTexture(canvas);
}

/** Reflejo de la bola de espejos: un cuadrado blanco de borde duro. */
export function glintTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(3, 3, 10, 10);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(1, 1, 14, 14);
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
