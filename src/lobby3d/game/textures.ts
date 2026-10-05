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

/** Una fila del cartel de records de la torre. */
export interface RecordRow {
  name: string;
  time: string;
  /** Es del jugador de esta pantalla: va en rojo. */
  mine: boolean;
}

/** Proporcion del cartel de records (ancho / alto). */
export const RECORD_BOARD_ASPECT = 0.8;

/**
 * Cartel de records de La Torre: el tablero de puntajes de una feria de pueblo que
 * alguien volvio a pintar (DESIGN.md "Cinta Gastada"). Madera podrida de grano gordo,
 * el titulo a pincel en rojo con chorreadas, las diez filas en pintura hueso, el
 * primero dorado con su corona y los tiempos propios en rojo. Encima, rayones y mugre
 * que nunca tapan una letra: se tiene que leer de lejos. Nitido y con mipmaps, como
 * los afiches.
 */
export function recordBoardTexture(rows: RecordRow[], state: "ok" | "loading" | "offline"): THREE.CanvasTexture {
  const K = 8;
  const w = 640;
  const h = Math.round(w / RECORD_BOARD_ASPECT);
  const [c, ctx] = canvas(w, h);
  const rand = rng(7331);
  // Tablas horizontales de madera, cada una con su tono.
  const plank = h / 10;
  for (let p = 0; p < 10; p++) {
    const tone = shade("#3b2d20", 0.85 + rand() * 0.3);
    for (let y = Math.round(p * plank); y < Math.round((p + 1) * plank); y += K) {
      for (let x = 0; x < w; x += K) {
        ctx.fillStyle = shade(tone, 1 + (rand() - 0.5) * 0.28);
        ctx.fillRect(x, y, K, K);
      }
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, Math.round((p + 1) * plank) - 3, w, 3);
  }
  // Marco pintado de rojo gastado y clavos en las esquinas.
  ctx.strokeStyle = "#7a1f18";
  ctx.lineWidth = 14;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, w - 48, h - 48);
  for (const [x, y] of [[30, 30], [w - 30, 30], [30, h - 30], [w - 30, h - 30]]) {
    ctx.fillStyle = "#8a8e90";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // Titulo a pincel, con sombra dura y chorreadas de pintura debajo.
  ctx.font = `92px ${FONT}`;
  ctx.fillStyle = "#1a0605";
  ctx.fillText("RECORDS", w / 2 + 4, 92 + 4);
  ctx.fillStyle = "#c0392b";
  ctx.fillText("RECORDS", w / 2, 92);
  for (let i = 0; i < 9; i++) {
    const x = w / 2 - 170 + rand() * 340;
    const len = 12 + rand() * 34;
    ctx.fillStyle = "#b3322a";
    ctx.fillRect(x, 118, 4, len);
    ctx.beginPath();
    ctx.arc(x + 2, 118 + len, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `54px ${FONT}`;
  ctx.fillStyle = "#ece3cc";
  ctx.fillText("DE LA TORRE", w / 2, 172);
  ctx.font = `34px ${FONT}`;
  ctx.fillStyle = "rgba(236, 227, 204, 0.8)";
  ctx.fillText("TODAS LAS SALAS", w / 2, 212);
  ctx.fillStyle = "rgba(224, 214, 191, 0.35)";
  ctx.fillRect(70, 232, w - 140, 2);

  const top = 262;
  const rowH = (h - top - 48) / 10;
  if (state !== "ok" || rows.length === 0) {
    ctx.font = `40px ${FONT}`;
    ctx.fillStyle = "rgba(224, 214, 191, 0.75)";
    const msg =
      state === "offline" ? ["SIN CONEXION", "CON EL RANKING"] : state === "loading" ? ["CARGANDO..."] : ["NADIE LLEGO", "A LA CIMA TODAVIA"];
    msg.forEach((line, i) => ctx.fillText(line, w / 2, top + rowH * 4 + i * 48));
  } else {
    rows.slice(0, 10).forEach((row, i) => {
      const y = top + rowH * (i + 0.5);
      const first = i === 0;
      // Claros y gordos: el filtro PS1 dibuja la escena a 400 lineas y se come lo fino.
      const color = row.mine ? "#ff4a3d" : first ? "#ffd65c" : i < 3 ? "#f2ead6" : "#ddd3bb";
      ctx.textAlign = "left";
      ctx.font = `${first ? 52 : 46}px ${FONT}`;
      // Numero de puesto en una chapita.
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(58, y - rowH * 0.36, 52, rowH * 0.72);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), 84, y + 2);
      ctx.textAlign = "left";
      let nameX = 126;
      if (first) {
        drawCrownGlyph(ctx, 126, y, 22);
        nameX = 166;
      }
      const name = row.name.toUpperCase();
      ctx.fillText(name, nameX, y + 2);
      ctx.textAlign = "right";
      ctx.fillText(row.time, w - 60, y + 2);
      // Puntos guia entre el nombre y el tiempo.
      const from = nameX + ctx.measureText(name).width + 14;
      const to = w - 60 - ctx.measureText(row.time).width - 14;
      ctx.fillStyle = "rgba(224, 214, 191, 0.25)";
      for (let x = from; x < to; x += 14) ctx.fillRect(x, y + 6, 4, 4);
    });
  }

  // Mugre y rayones encima de todo, suaves: nunca tapan una letra.
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.05 + rand() * 0.08})`;
    ctx.lineWidth = 1 + rand() * 2;
    const x = rand() * w;
    const y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 18);
    ctx.stroke();
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(20, 12, 6, ${0.06 + rand() * 0.1})`;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, 6 + rand() * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  return crispTexture(c);
}

/** Proporcion (ancho / alto) de la pizarra de la noche: apaisada, el cartel de records es vertical. */
export const NIGHT_BOARD_ASPECT = 1.4;

/** Una fila de la pizarra de la noche. */
export interface NightRow {
  rank: number;
  name: string;
  points: number;
  /** Lo que sumo en el ultimo juego (null si no jugo ninguno todavia). */
  gained: number | null;
  /** Color de su remera (asiento), para reconocerlo en la feria. */
  color: string;
  mine: boolean;
}

export interface NightBoardView {
  rows: NightRow[];
  /** Titulo del ultimo juego terminado, o null si todavia no se jugo ninguno. */
  lastTitle: string | null;
  winners: string[];
  played: number;
}

/**
 * Tiza: el texto en dos pasadas corridas un pixel, la de abajo transparente, mas un
 * polvillo de puntitos. Se lee claro (es lo que importa) pero no es pintura lisa.
 */
function chalkText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, rand: () => number): void {
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = color;
  ctx.fillText(text, x + 1.5, y + 1);
  ctx.globalAlpha = 0.95;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
  const w = ctx.measureText(text).width;
  const left = ctx.textAlign === "center" ? x - w / 2 : ctx.textAlign === "right" ? x - w : x;
  ctx.fillStyle = "rgba(20, 24, 21, 0.55)";
  for (let i = 0; i < w / 5; i++) ctx.fillRect(left + rand() * w, y - 14 + rand() * 28, 2, 2);
}

/**
 * La pizarra de la noche de La Feria: un pizarron de tiza en un marco de chapa, con la
 * franja roja y blanca de los puestos de feria arriba. Distinta a proposito del cartel
 * de records de la torre (tablas pintadas, vertical, "RECORDS" a pincel): esta es la
 * tabla de la sala, se borra y se vuelve a escribir. Arriba, el ultimo juego y quien lo
 * gano; abajo, los puntos acumulados de todos los juegos de la noche, cada nombre en
 * la tiza del color de su remera y con lo que sumo en el ultimo juego.
 */
export function nightBoardTexture(view: NightBoardView): THREE.CanvasTexture {
  const w = 800;
  const h = Math.round(w / NIGHT_BOARD_ASPECT);
  const [c, ctx] = canvas(w, h);
  const rand = rng(4242);

  // Franja de feria (roja y blanca, gastada).
  const band = 64;
  for (let x = 0, i = 0; x < w; x += 40, i++) {
    ctx.fillStyle = i % 2 === 0 ? "#8e1f18" : "#cfc5ae";
    ctx.fillRect(x, 0, 40, band);
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  for (let i = 0; i < 160; i++) ctx.fillRect(rand() * w, rand() * band, 3 + rand() * 8, 2 + rand() * 4);
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, band - 6, w, 6);

  // Pizarron: verde casi negro, con borrones de tiza vieja.
  ctx.fillStyle = "#1b221e";
  ctx.fillRect(0, band, w, h - band);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(200, 205, 195, ${0.025 + rand() * 0.04})`;
    ctx.beginPath();
    ctx.ellipse(rand() * w, band + rand() * (h - band), 40 + rand() * 120, 10 + rand() * 26, (rand() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `46px ${FONT}`;
  // Chapa oscura atornillada sobre la franja: sobre las rayas el titulo no se leia.
  const titleW = ctx.measureText("GANADORES DE LA NOCHE").width + 48;
  ctx.fillStyle = "#16100c";
  ctx.fillRect(w / 2 - titleW / 2, 8, titleW, band - 18);
  ctx.strokeStyle = "#5a2a1c";
  ctx.lineWidth = 3;
  ctx.strokeRect(w / 2 - titleW / 2, 8, titleW, band - 18);
  ctx.fillStyle = "#f4ecd8";
  ctx.fillText("GANADORES DE LA NOCHE", w / 2, band / 2 - 2);

  // El ultimo juego y quien lo gano.
  const chalk = "#e8e4d8";
  const gold = "#ffd65c";
  if (view.lastTitle) {
    ctx.font = `40px ${FONT}`;
    chalkText(ctx, `ULTIMO JUEGO: ${view.lastTitle.toUpperCase()}`, w / 2, band + 38, chalk, rand);
    ctx.font = `52px ${FONT}`;
    const who = view.winners.length === 0 ? "NADIE" : view.winners.join(", ").toUpperCase();
    const verb = view.winners.length > 1 ? "GANARON" : "GANO";
    chalkText(ctx, `${verb} ${who}`, w / 2, band + 86, gold, rand);
  } else {
    ctx.font = `40px ${FONT}`;
    chalkText(ctx, "TODAVIA NO SE JUGO NADA", w / 2, band + 50, chalk, rand);
    ctx.font = `30px ${FONT}`;
    chalkText(ctx, "VOTEN UN AFICHE Y A JUGAR", w / 2, band + 88, "rgba(232, 228, 216, 0.7)", rand);
  }
  // Raya de tiza, torcida.
  ctx.strokeStyle = "rgba(232, 228, 216, 0.4)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(60, band + 120);
  for (let x = 60; x <= w - 60; x += 40) ctx.lineTo(x, band + 120 + (rand() - 0.5) * 4);
  ctx.stroke();

  // Tabla acumulada.
  const top = band + 136;
  const bottom = h - 46;
  const rows = view.rows.slice(0, 8);
  const rowH = Math.min(52, (bottom - top) / Math.max(rows.length, 1));
  rows.forEach((row, i) => {
    const y = top + rowH * (i + 0.5);
    const lead = row.rank === 1 && row.points > 0;
    ctx.font = `${lead ? 46 : 42}px ${FONT}`;
    ctx.textAlign = "center";
    chalkText(ctx, String(row.rank), 82, y, lead ? gold : chalk, rand);
    let nameX = 120;
    if (lead) {
      drawCrownGlyph(ctx, 132, y, 18);
      nameX = 160;
    }
    ctx.textAlign = "left";
    const name = row.name.toUpperCase() + (row.mine ? " (VOS)" : "");
    chalkText(ctx, name, nameX, y, row.color, rand);
    ctx.textAlign = "right";
    const pts = `${row.points} PTS`;
    chalkText(ctx, pts, w - 150, y, lead ? gold : chalk, rand);
    if (row.gained !== null && row.gained > 0) {
      ctx.font = `34px ${FONT}`;
      chalkText(ctx, `+${row.gained}`, w - 62, y, gold, rand);
    }
    // Puntos guia entre el nombre y los puntos.
    ctx.font = `${lead ? 46 : 42}px ${FONT}`;
    const from = nameX + ctx.measureText(name).width + 14;
    const to = w - 150 - ctx.measureText(pts).width - 14;
    ctx.fillStyle = "rgba(232, 228, 216, 0.22)";
    for (let x = from; x < to; x += 14) ctx.fillRect(x, y + 6, 4, 4);
  });
  if (rows.length === 0) {
    ctx.font = `34px ${FONT}`;
    ctx.textAlign = "center";
    chalkText(ctx, "SIN JUGADORES", w / 2, (top + bottom) / 2, "rgba(232, 228, 216, 0.6)", rand);
  }

  ctx.font = `28px ${FONT}`;
  ctx.textAlign = "right";
  const played = view.played === 1 ? "1 JUEGO JUGADO" : `${view.played} JUEGOS JUGADOS`;
  chalkText(ctx, played, w - 40, h - 24, "rgba(232, 228, 216, 0.55)", rand);

  // Tiza gastada encima: nunca tapa una letra.
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(232, 228, 216, ${0.02 + rand() * 0.04})`;
    ctx.lineWidth = 1 + rand() * 2;
    const x = rand() * w;
    const y = band + rand() * (h - band);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 80, y + (rand() - 0.5) * 10);
    ctx.stroke();
  }
  return crispTexture(c);
}

/** Corona dorada chiquita (la del primero del cartel). */
function drawCrownGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "#ffcf4a";
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.55);
  ctx.lineTo(x, y - s * 0.35);
  ctx.lineTo(x + s * 0.4, y + s * 0.05);
  ctx.lineTo(x + s * 0.8, y - s * 0.6);
  ctx.lineTo(x + s * 1.2, y + s * 0.05);
  ctx.lineTo(x + s * 1.6, y - s * 0.35);
  ctx.lineTo(x + s * 1.6, y + s * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(x + s * 0.7, y + s * 0.15, s * 0.2, s * 0.2);
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
