import * as THREE from "three";
import { GOLD, STAGE_R } from "./constants";

/**
 * Texturas de Laser Show, pintadas por codigo (DESIGN.md "Prime Time"): nada se
 * carga de afuera.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Tapa del escenario: laca azul noche con anillos de LED concentricos y radios
 * finos, y la franja exterior un poco mas clara, que es la que dice "aca se termina".
 */
export function stageTopTexture(): THREE.CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas(size, size);
  const mid = size / 2;
  const grad = ctx.createRadialGradient(mid, mid, 40, mid, mid, mid);
  grad.addColorStop(0, "#1d2160");
  grad.addColorStop(0.75, "#141748");
  grad.addColorStop(1, "#0d0f33");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const px = mid / STAGE_R;
  // Radios finos, como las juntas de un piso giratorio.
  ctx.strokeStyle = "rgba(120, 140, 255, 0.10)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * px, mid + Math.sin(a) * px);
    ctx.lineTo(mid + Math.cos(a) * mid, mid + Math.sin(a) * mid);
    ctx.stroke();
  }
  // Anillos de LED: violeta tenue y uno dorado a mitad de camino.
  for (let r = 2; r < STAGE_R; r += 2) {
    ctx.strokeStyle = r === 4 ? "rgba(255, 201, 74, 0.35)" : "rgba(160, 120, 255, 0.22)";
    ctx.lineWidth = r === 4 ? 5 : 4;
    ctx.beginPath();
    ctx.arc(mid, mid, r * px, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Franja del borde.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(mid, mid, mid - 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(mid, mid, mid - 22, 0, Math.PI * 2);
  ctx.stroke();
  return toTexture(c);
}

/** Pantalla gigante del fondo: el nombre del show en letras de marquesina. */
export function screenTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 384);
  const grad = ctx.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, "#3a0f6b");
  grad.addColorStop(1, "#14062e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 384);
  // Trama de pixeles de pantalla LED.
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  for (let y = 0; y < 384; y += 6) ctx.fillRect(0, y, 1024, 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 150px 'Arial Black', 'Segoe UI', sans-serif";
  ctx.fillStyle = "#ff4a1c";
  ctx.fillText("LÁSER", 512 - 4, 140 + 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("LÁSER", 512, 140);
  ctx.font = "900 110px 'Arial Black', 'Segoe UI', sans-serif";
  ctx.fillStyle = "#3fd8ff";
  ctx.fillText("SHOW", 512 - 4, 280 + 4);
  ctx.fillStyle = GOLD;
  ctx.fillText("SHOW", 512, 280);
  return toTexture(c);
}

/** Halo suave y redondo (chispas, bombitas, destellos). */
export function glowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.75)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

/**
 * Franja de luz que un haz deja en el piso: brillante en el medio, se apaga hacia
 * los costados (en v). Se tiñe con el color del material.
 */
export function stripTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(4, 64);
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 64);
  return toTexture(c);
}

/** Visor del concursante: vidrio oscuro con dos ojos grandes. */
export function visorTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 64);
  ctx.fillStyle = "#151830";
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "#ffffff";
  for (const x of [42, 86]) {
    ctx.beginPath();
    ctx.ellipse(x, 32, 13, 17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#151830";
  for (const x of [45, 89]) {
    ctx.beginPath();
    ctx.arc(x, 35, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(8, 8, 112, 6);
  return toTexture(c);
}

/** Cartel del nombre: placa violeta con filete del color del asiento. */
export function nameTexture(name: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const [probe, pctx] = canvas(8, 8);
  void probe;
  const font = "900 42px 'Arial Black', 'Segoe UI', sans-serif";
  pctx.font = font;
  const width = Math.ceil(pctx.measureText(name).width) + 40;
  const [c, ctx] = canvas(width, 64);
  ctx.fillStyle = "rgba(28, 10, 60, 0.82)";
  roundRect(ctx, 0, 0, width, 64, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  roundRect(ctx, 3, 3, width - 6, 58, 16);
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, width / 2, 34);
  const texture = toTexture(c);
  texture.minFilter = THREE.LinearFilter;
  return { texture, aspect: width / 64 };
}

/** Sombra de contacto: disco oscuro difuso. */
export function shadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.6)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
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
