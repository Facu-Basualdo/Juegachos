import * as THREE from "three";

/**
 * Texturas del galpon, todas pintadas por codigo (DESIGN.md: plastico pintado,
 * colores planos). El ruido sale de un generador con semilla, asi el escenario es
 * identico en todas las pantallas.
 */

export const TRACKSUIT = "#1f8a7a";
export const TRACKSUIT_DARK = "#18705f";

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

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function texture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

/** Nube de dibujo: circulos blancos encimados con la panza un poco mas oscura. */
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, r: () => number): void {
  const puffs = 5 + Math.floor(r() * 4);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < puffs; i++) {
    pts.push([x + (i - puffs / 2) * s * 0.55 + (r() - 0.5) * s * 0.3, y - r() * s * 0.45, s * (0.45 + r() * 0.35)]);
  }
  ctx.fillStyle = "#d9ecf7";
  for (const [px, py, pr] of pts) {
    ctx.beginPath();
    ctx.arc(px, py + pr * 0.18, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  for (const [px, py, pr] of pts) {
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.94, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Mural de las paredes: cielo celeste pintado con nubes gordas (se repite a lo ancho). */
export function muralTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#5fb0e8");
  g.addColorStop(0.7, "#9fd3f2");
  g.addColorStop(1, "#c4e6f7");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  const r = rng(41);
  for (let i = 0; i < 9; i++) {
    const x = 60 + i * 115 + (r() - 0.5) * 50;
    const y = 90 + r() * 300;
    cloud(ctx, x, y, 34 + r() * 30, r);
  }
  // Zocalo: franja baja un poco mas oscura, donde la pared toca la arena.
  ctx.fillStyle = "rgba(60, 90, 110, 0.18)";
  ctx.fillRect(0, 490, 1024, 22);
  const tex = texture(c, true);
  return tex;
}

/** Arena de la cancha: tostada, lisa, con un grano suave. */
export function sandTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = "#dcc59b";
  ctx.fillRect(0, 0, 256, 256);
  const r = rng(77);
  const tones = ["#d3ba8c", "#e3cfa8", "#cfb384", "#e8d6b2"];
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = tones[Math.floor(r() * tones.length)];
    const s = 1 + r() * 2.5;
    ctx.fillRect(r() * 256, r() * 256, s, s);
  }
  return texture(c, true);
}

/** Frente del jogging: numero chico en el pecho izquierdo. */
export function tracksuitFront(num: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = TRACKSUIT;
  ctx.fillRect(0, 0, 128, 128);
  // Cierre del buzo.
  ctx.fillStyle = TRACKSUIT_DARK;
  ctx.fillRect(62, 0, 4, 128);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(74, 22, 40, 26);
  ctx.fillStyle = "#1c1c1c";
  ctx.font = "bold 22px 'Arial Black', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(num, 94, 36);
  return texture(c);
}

/** Espalda del jogging: el numero grande, que es lo que se ve con la camara detras. */
export function tracksuitBack(num: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = TRACKSUIT;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 50px 'Arial Black', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(num, 64, 58);
  return texture(c);
}

/** Tela lisa del jogging (mangas, costados) con la raya blanca opcional. */
export function tracksuitPlain(stripe: boolean): THREE.CanvasTexture {
  const [c, ctx] = canvas(32, 32);
  ctx.fillStyle = TRACKSUIT;
  ctx.fillRect(0, 0, 32, 32);
  if (stripe) {
    ctx.fillStyle = "#f4f4f0";
    ctx.fillRect(13, 0, 6, 32);
  }
  return texture(c);
}

/** Cara del jugador: ojos y boca simples sobre la piel, pelo arriba. */
export function faceTexture(skin: string, hair: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(32, 32);
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = hair;
  ctx.fillRect(0, 0, 32, 8);
  ctx.fillStyle = "#222";
  ctx.fillRect(8, 15, 4, 4);
  ctx.fillRect(20, 15, 4, 4);
  ctx.fillStyle = "rgba(110,50,40,0.8)";
  ctx.fillRect(12, 24, 8, 2);
  return texture(c);
}

/** Cartel del nombre: numero y nombre, con la franja del color del asiento. */
export function nameTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "bold 40px 'Trebuchet MS', 'Segoe UI', sans-serif";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 32;
  c.width = width;
  c.height = 58;
  ctx.font = font;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, width, 58);
  ctx.fillStyle = color;
  ctx.fillRect(0, 52, width, 6);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 16, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { texture: tex, aspect: width / 58 };
}

/** Mancha de la eliminacion: roja, plana, de borde irregular (dibujo animado). */
export function bloodTexture(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const r = rng(900 + seed);
  ctx.fillStyle = "#b3121b";
  ctx.beginPath();
  ctx.arc(64, 64, 34, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const d = 28 + r() * 26;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + r() * 11, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(54, 54, 10, 0, Math.PI * 2);
  ctx.fill();
  return texture(c);
}

/** Sombra de contacto debajo de cada figura. */
export function shadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Mascara negra de guardia con su figura blanca (circulo, triangulo o cuadrado). */
export function maskTexture(shape: 0 | 1 | 2): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "#f2f2f2";
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (shape === 0) ctx.arc(32, 32, 15, 0, Math.PI * 2);
  else if (shape === 1) {
    ctx.moveTo(32, 15);
    ctx.lineTo(49, 46);
    ctx.lineTo(15, 46);
    ctx.closePath();
  } else ctx.rect(17, 17, 30, 30);
  ctx.stroke();
  return texture(c);
}
