import * as THREE from "three";
import { LABEL_LAYER } from "./retro";

/**
 * Texturas de La Feria, todas pintadas por codigo (DESIGN.md: chiquitas y sucias,
 * 32-64 px, filtro al mas cercano, sin mipmaps: el titileo a lo lejos es de epoca)
 * y los carteles de texto (nombres, votos), que van a resolucion completa.
 */

const FONT = "'VT323', 'Courier New', monospace";
const TEXT = "#e8e4d8";
const PANEL = "rgba(8, 8, 10, 0.78)";
export const ACCENT = "#ff3b30";

/** RNG con semilla: la misma textura en todas las pantallas. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pixelTexture(canvas: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Textura "legible": con mipmaps y filtro lineal. Para lo que se tiene que leer de
 * lejos (afiches, carteles, el televisor): sin mipmaps, un afiche a 15 m es un
 * mosaico de pixeles que titila y no se reconoce que juego es.
 */
function crispTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  return tex;
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** Ruido de pixeles sobre una base: la suciedad de todas las texturas. */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, amount: number, rand: () => number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = 1 + (rand() - 0.5) * amount;
      ctx.fillStyle = shade(base, k);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function stains(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, rand: () => number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const s = 1 + Math.floor(rand() * 4);
    ctx.globalAlpha = 0.25 + rand() * 0.4;
    ctx.fillRect(x, y, s, s);
    ctx.fillRect(x + 1, y + s, Math.max(1, s - 1), 1 + Math.floor(rand() * 3));
  }
  ctx.globalAlpha = 1;
}

const cache = new Map<string, THREE.CanvasTexture>();
function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Tierra con manchas de pasto muerto. */
export function groundTexture(): THREE.CanvasTexture {
  return cached("ground", () => {
    const rand = rng(11);
    const [c, ctx] = canvas(64);
    speckle(ctx, 64, 64, "#3a3024", 0.45, rand);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = rand() < 0.5 ? "#4a4a2c" : "#2b2a1c";
      const x = Math.floor(rand() * 64);
      const y = Math.floor(rand() * 64);
      ctx.fillRect(x, y, 1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));
      if (rand() < 0.4) ctx.fillRect(x, y - 2, 1, 2);
    }
    stains(ctx, 64, 64, "#1c1812", 18, rand);
    return pixelTexture(c);
  });
}

/** Tablas de madera podrida (vetas horizontales). */
export function woodTexture(tone = "#5a4632"): THREE.CanvasTexture {
  return cached(`wood:${tone}`, () => {
    const rand = rng(23);
    const [c, ctx] = canvas(32);
    speckle(ctx, 32, 32, tone, 0.3, rand);
    ctx.fillStyle = shade(tone, 0.6);
    for (let y = 0; y < 32; y += 8) ctx.fillRect(0, y, 32, 1);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = shade(tone, 0.72);
      ctx.fillRect(Math.floor(rand() * 32), Math.floor(rand() * 32), 3 + Math.floor(rand() * 8), 1);
    }
    for (let y = 0; y < 32; y += 8) {
      ctx.fillStyle = "#1b150f";
      ctx.fillRect(2 + Math.floor(rand() * 4), y + 3, 1, 1);
      ctx.fillRect(26 + Math.floor(rand() * 4), y + 3, 1, 1);
    }
    stains(ctx, 32, 32, "#1c140c", 8, rand);
    return pixelTexture(c);
  });
}

/** Chapa oxidada. */
export function rustTexture(): THREE.CanvasTexture {
  return cached("rust", () => {
    const rand = rng(37);
    const [c, ctx] = canvas(32);
    speckle(ctx, 32, 32, "#4c4f52", 0.25, rand);
    stains(ctx, 32, 32, "#6b3a22", 30, rand);
    stains(ctx, 32, 32, "#8a4b2a", 16, rand);
    ctx.fillStyle = "#2c2e30";
    for (let x = 0; x < 32; x += 16) ctx.fillRect(x, 0, 1, 32);
    return pixelTexture(c);
  });
}

/** Franjas de peligro gastadas (plataformas que se mueven, barras que barren). */
export function hazardTexture(): THREE.CanvasTexture {
  return cached("hazard", () => {
    const rand = rng(41);
    const [c, ctx] = canvas(32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const band = Math.floor((x + y) / 8) % 2 === 0;
        const base = band ? "#b8902a" : "#1d1c1a";
        ctx.fillStyle = shade(base, 1 + (rand() - 0.5) * 0.35);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    stains(ctx, 32, 32, "#6b3a22", 14, rand);
    return pixelTexture(c);
  });
}

/** Barra roja y blanca (los barredores). */
export function barTexture(): THREE.CanvasTexture {
  return cached("bar", () => {
    const rand = rng(43);
    const [c, ctx] = canvas(32, 8);
    for (let x = 0; x < 32; x++) {
      const base = Math.floor(x / 8) % 2 === 0 ? "#8e1f18" : "#cfc8b8";
      for (let y = 0; y < 8; y++) {
        ctx.fillStyle = shade(base, 1 + (rand() - 0.5) * 0.3);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    stains(ctx, 32, 8, "#3a1a10", 6, rand);
    return pixelTexture(c);
  });
}

/** Chapa a cuadros de la largada del parkour. */
export function checkerTexture(): THREE.CanvasTexture {
  return cached("checker", () => {
    const rand = rng(47);
    const [c, ctx] = canvas(16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const base = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? "#c9c2b0" : "#1a1917";
        ctx.fillStyle = shade(base, 1 + (rand() - 0.5) * 0.3);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return pixelTexture(c);
  });
}

/** Corteza de pino (los troncos del bosque). */
export function barkTexture(): THREE.CanvasTexture {
  return cached("bark", () => {
    const rand = rng(53);
    const [c, ctx] = canvas(16, 32);
    speckle(ctx, 16, 32, "#2a2119", 0.5, rand);
    ctx.fillStyle = "#15100b";
    for (let i = 0; i < 10; i++) ctx.fillRect(Math.floor(rand() * 16), Math.floor(rand() * 32), 1, 3 + Math.floor(rand() * 6));
    return pixelTexture(c);
  });
}

/** Tela cosida de los muñecos (del color del asiento). */
export function clothTexture(color: string, seed: number): THREE.CanvasTexture {
  return cached(`cloth:${color}`, () => {
    const rand = rng(seed);
    const [c, ctx] = canvas(16);
    speckle(ctx, 16, 16, color, 0.35, rand);
    ctx.fillStyle = shade(color, 0.45);
    for (let y = 1; y < 16; y += 3) ctx.fillRect(7, y, 2, 1);
    stains(ctx, 16, 16, "#140f0a", 5, rand);
    return pixelTexture(c);
  });
}

/**
 * Afiche viejo: la portada del juego a 256 px, apenas amarillenta y con manchas de
 * humedad en los bordes. Se tiene que reconocer de lejos que juego es (pedido del
 * programador): por eso va nitida y con mipmaps, y el deterioro no le pisa el medio.
 * Arranca negra y se pinta cuando carga la imagen.
 */
export function posterTexture(src: string, seed: number): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#15120e";
  ctx.fillRect(0, 0, S, S);
  const tex = crispTexture(c);
  const img = new Image();
  img.onload = () => {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, S, S);
    // Papel viejo: un poco amarillento, sin apagar la imagen.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#e8dcc4";
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = "source-over";
    // Manchas de humedad solo en el borde (el medio es lo que se tiene que leer).
    const rand = rng(seed);
    ctx.fillStyle = "#2a2016";
    for (let i = 0; i < 40; i++) {
      const side = Math.floor(rand() * 4);
      const along = rand() * S;
      const depth = rand() * S * 0.1;
      const x = side === 0 ? depth : side === 1 ? S - depth : along;
      const y = side === 2 ? depth : side === 3 ? S - depth : along;
      ctx.globalAlpha = 0.15 + rand() * 0.35;
      ctx.fillRect(x, y, 3 + rand() * 10, 3 + rand() * 10);
    }
    ctx.globalAlpha = 1;
    // Esquina rota.
    ctx.fillStyle = "#15120e";
    ctx.beginPath();
    ctx.moveTo(S, 0);
    ctx.lineTo(S - 24 - Math.floor(rand() * 30), 0);
    ctx.lineTo(S, 24 + Math.floor(rand() * 30));
    ctx.fill();
    tex.needsUpdate = true;
  };
  img.src = src;
  return tex;
}

/**
 * Cartel pintado ("LISTO", "LA TORRE", el titulo bajo cada afiche). `w` x `h` es la
 * proporcion; se dibuja a 8x esa medida y con mipmaps para que se lea de lejos (el
 * fondo de madera si mantiene el grano gordo).
 */
export function signTexture(text: string, opts: { fg?: string; bg?: string; w?: number; h?: number } = {}): THREE.CanvasTexture {
  const K = 8;
  const w = (opts.w ?? 64) * K;
  const h = (opts.h ?? 16) * K;
  const [c, ctx] = canvas(w, h);
  const rand = rng(text.length * 31 + w);
  if (opts.bg) {
    // Madera de grano gordo: el ruido se pinta en bloques de K pixeles.
    for (let y = 0; y < h; y += K) {
      for (let x = 0; x < w; x += K) {
        ctx.fillStyle = shade(opts.bg, 1 + (rand() - 0.5) * 0.3);
        ctx.fillRect(x, y, K, K);
      }
    }
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  ctx.fillStyle = opts.fg ?? "#d9d2c0";
  let size = Math.floor(h * 0.82);
  ctx.font = `${size}px ${FONT}`;
  // Titulos largos ("TELEFONO CORTADO"): se achica la letra hasta que entre.
  while (ctx.measureText(text).width > w * 0.94 && size > 8) {
    size -= 2;
    ctx.font = `${size}px ${FONT}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + K / 2);
  return crispTexture(c);
}

/**
 * Carita de una reaccion, dibujada (no son emojis: el repo los prohibe). Una cara de
 * arpillera como la de los muñecos, con la expresion de cada reaccion. Se usa sobre la
 * cabeza del muñeco y en los botones del HUD.
 */
export function drawEmoteFace(ctx: CanvasRenderingContext2D, id: string, S: number): void {
  const c = S / 2;
  const r = S * 0.44;
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Cara
  ctx.fillStyle = id === "enojo" ? "#b8483e" : "#b89f78";
  ctx.strokeStyle = "#1a1512";
  ctx.lineWidth = S * 0.05;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const ink = "#15110e";
  const eyeY = c - S * 0.08;
  const ex = S * 0.15;
  const dot = (x: number, y: number, rr: number): void => {
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  };
  const line = (pts: number[][], w = S * 0.05, color = ink): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  };
  switch (id) {
    case "risa":
      // Ojos cerrados de risa y boca grande abierta.
      line([[c - ex - S * 0.07, eyeY + 2], [c - ex, eyeY - S * 0.05], [c - ex + S * 0.07, eyeY + 2]]);
      line([[c + ex - S * 0.07, eyeY + 2], [c + ex, eyeY - S * 0.05], [c + ex + S * 0.07, eyeY + 2]]);
      ctx.fillStyle = "#3a1410";
      ctx.beginPath();
      ctx.moveTo(c - S * 0.2, c + S * 0.06);
      ctx.lineTo(c + S * 0.2, c + S * 0.06);
      ctx.arc(c, c + S * 0.06, S * 0.2, 0, Math.PI);
      ctx.fill();
      break;
    case "sorpresa":
      dot(c - ex, eyeY, S * 0.065);
      dot(c + ex, eyeY, S * 0.065);
      line([[c - ex - S * 0.07, eyeY - S * 0.13], [c - ex + S * 0.05, eyeY - S * 0.15]], S * 0.035);
      line([[c + ex - S * 0.05, eyeY - S * 0.15], [c + ex + S * 0.07, eyeY - S * 0.13]], S * 0.035);
      ctx.fillStyle = "#3a1410";
      ctx.beginPath();
      ctx.ellipse(c, c + S * 0.17, S * 0.08, S * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "enojo":
      dot(c - ex, eyeY + S * 0.02, S * 0.045);
      dot(c + ex, eyeY + S * 0.02, S * 0.045);
      line([[c - ex - S * 0.1, eyeY - S * 0.12], [c - S * 0.04, eyeY - S * 0.03]]);
      line([[c + ex + S * 0.1, eyeY - S * 0.12], [c + S * 0.04, eyeY - S * 0.03]]);
      line([[c - S * 0.16, c + S * 0.22], [c, c + S * 0.14], [c + S * 0.16, c + S * 0.22]]);
      break;
    case "burla":
      // Guiño y la lengua afuera.
      line([[c - ex - S * 0.07, eyeY], [c - ex + S * 0.07, eyeY]]);
      dot(c + ex, eyeY, S * 0.055);
      line([[c - S * 0.17, c + S * 0.1], [c + S * 0.17, c + S * 0.1]]);
      ctx.fillStyle = "#c0504d";
      ctx.beginPath();
      ctx.moveTo(c - S * 0.02, c + S * 0.1);
      ctx.lineTo(c + S * 0.14, c + S * 0.1);
      ctx.arc(c + S * 0.06, c + S * 0.12, S * 0.08, 0, Math.PI);
      ctx.fill();
      break;
    case "llanto":
      line([[c - ex - S * 0.07, eyeY - S * 0.04], [c - ex + S * 0.06, eyeY + S * 0.01]]);
      line([[c + ex + S * 0.07, eyeY - S * 0.04], [c + ex - S * 0.06, eyeY + S * 0.01]]);
      line([[c - S * 0.15, c + S * 0.22], [c, c + S * 0.14], [c + S * 0.15, c + S * 0.22]]);
      ctx.fillStyle = "#4f81bd";
      for (const x of [c - ex, c + ex]) {
        ctx.beginPath();
        ctx.moveTo(x, eyeY + S * 0.06);
        ctx.quadraticCurveTo(x - S * 0.06, eyeY + S * 0.2, x, eyeY + S * 0.22);
        ctx.quadraticCurveTo(x + S * 0.06, eyeY + S * 0.2, x, eyeY + S * 0.06);
        ctx.fill();
      }
      break;
  }
}

/** Textura de la carita (para el sprite sobre la cabeza). */
export function emoteFaceTexture(id: string): THREE.CanvasTexture {
  return cached(`emote:${id}`, () => {
    const [c, ctx] = canvas(128);
    drawEmoteFace(ctx, id, 128);
    return crispTexture(c);
  });
}

export interface LabelTexture {
  texture: THREE.CanvasTexture;
  /** Ancho / alto, para escalar el sprite sin deformarlo. */
  aspect: number;
}

function labelCanvas(text: string, size: number, border: string | null, bg = PANEL, fg = TEXT): LabelTexture {
  const [c, ctx] = canvas(8, 8);
  const font = `${size}px ${FONT}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + Math.round(size * 0.8);
  const h = Math.round(size * 1.35);
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (border) {
    ctx.fillStyle = border;
    ctx.fillRect(0, h - 4, w, 4);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { texture: tex, aspect: w / h };
}

/** Nombre sobre la cabeza, con una raya del color del jugador. */
export function nameTexture(name: string, color: string): LabelTexture {
  return labelCanvas(name, 44, color);
}

/** Globo de una reaccion. */
export function bubbleTexture(text: string): LabelTexture {
  return labelCanvas(text, 52, ACCENT, "rgba(232, 228, 216, 0.92)", "#0b0b0d");
}

/** Placa de texto (contador de votos, marcador, record de la torre). */
export function plaqueTexture(text: string, opts: { bg?: string; fg?: string; size?: number } = {}): LabelTexture {
  return labelCanvas(text, opts.size ?? 40, null, opts.bg ?? PANEL, opts.fg ?? TEXT);
}

/** Sombra de contacto: disco oscuro con borde suave. */
export function shadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(32);
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  g.addColorStop(0, "rgba(0, 0, 0, 0.6)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Sprite con una textura de cartel, alto `height` en metros. Va en la capa de
 * carteles: se dibuja despues del filtro retro, a resolucion completa.
 */
export function labelSprite(label: LabelTexture, height: number): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: label.texture, depthTest: false, transparent: true }),
  );
  sprite.renderOrder = 10;
  sprite.layers.set(LABEL_LAYER);
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
