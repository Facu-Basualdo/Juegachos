import * as THREE from "three";

/**
 * Texturas de Marea de Lava, pintadas por codigo (DESIGN.md "Ascenso de Basalto").
 * Las del muñeco son las de Derrumbe; las de roca y lava son propias. 16x16 y
 * NearestFilter: nada liso, nada borroso. Las de roca se repiten por metro (las UV
 * de la torre estan en coordenadas de mundo), asi un pixel mide lo mismo en todas
 * las plataformas.
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

function noiseTile(palette: readonly string[], seed: number, repeat: boolean): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(seed);
  paintSurface(ctx, palette, r, TEX);
  return toTexture(canvas, repeat);
}

/** Basalto de la pared del fondo: gris frio con vetas verticales. */
export function basaltTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(401);
  for (let x = 0; x < TEX; x++) {
    // Las vetas: cada columna tiene su tono, con ruido chico adentro.
    const col = pick(["#2f3139", "#2a2c33", "#363841", "#25272d"], r);
    for (let y = 0; y < TEX; y++) {
      ctx.fillStyle = r() < 0.2 ? pick(["#2a2b31", "#4a4c55"], r) : col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toTexture(canvas, true);
}

/** Piedra negra de las plataformas (tapa). */
export function blackstoneTexture(): THREE.CanvasTexture {
  return noiseTile(["#4a4552", "#554f5e", "#403b47", "#5c5566", "#4e4857"], 409, true);
}

/** Canto de las plataformas: un escalon mas claro, para que el borde se lea contra la pared. */
export function blackstoneSideTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(419);
  paintSurface(ctx, ["#6a6275", "#756c81", "#5f586a", "#7d7489"], r, TEX);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, TEX, 2);
  return toTexture(canvas, true);
}

/** Piedra luminosa: la tapa de las plataformas chicas y de la cima. */
export function glowstoneTexture(): THREE.CanvasTexture {
  return noiseTile(["#f2c14e", "#e8a93a", "#ffd970", "#c98a2c", "#fbe39a"], 431, true);
}

/** Lava: pixeles gruesos naranja y amarillo, se desplaza despacio. */
export function lavaTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  const r = rng(709);
  const hot = ["#ffd24a", "#ffb52e", "#ff9a1f"];
  const warm = ["#f07418", "#e25f12", "#cf4e0e"];
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
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
