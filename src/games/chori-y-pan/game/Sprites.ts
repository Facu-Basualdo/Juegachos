import type { Hero } from "./Level";

/** Lo que el dibujo necesita saber de un personaje en este cuadro. */
export interface HeroPose {
  hero: Hero;
  /** Pies (centro) en px. */
  x: number;
  y: number;
  /** px por celda. */
  s: number;
  face: 1 | -1;
  /** Fase de las patas (avanza caminando). */
  walk: number;
  /** -1 (aplastado) .. 1 (estirado). */
  stretch: number;
  /** 0 vivo; 0-1 avance de la muerte. */
  dead: number;
  time: number;
  /** Mirando la puerta (festejo). */
  happy: boolean;
  /** Transparencia (el compañero remoto cuando se pierde la señal). */
  alpha?: number;
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/**
 * Halo calido para las extremidades negras: sin el, los palitos se pierden contra la
 * pared oscura del templo.
 */
function rim(g: CanvasRenderingContext2D, s: number, on: boolean): void {
  g.shadowColor = on ? "rgba(255, 222, 160, 0.75)" : "transparent";
  g.shadowBlur = on ? Math.max(2, 0.08 * s) : 0;
}

/** Pierna de goma (dibujo animado de los 30) con zapatilla; `k` balancea el paso. */
function hoseLeg(g: CanvasRenderingContext2D, hx: number, hy: number, len: number, k: number, s: number, face: number, shoe: string): void {
  const fx = hx + k * 0.16 * s;
  const fy = hy + len - Math.max(0, -k) * 0.06 * s;
  g.strokeStyle = "#1c1a1e";
  g.lineWidth = Math.max(2, 0.085 * s);
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(hx, hy);
  g.quadraticCurveTo(hx + k * 0.12 * s, hy + len * 0.55, fx, fy - 0.06 * s);
  rim(g, s, true);
  g.stroke();
  rim(g, s, false);
  // Zapatilla: puntera hacia donde mira, suela blanca.
  g.fillStyle = shoe;
  g.beginPath();
  g.ellipse(fx + face * 0.06 * s, fy - 0.05 * s, 0.12 * s, 0.07 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f4f1ea";
  g.fillRect(fx + face * 0.06 * s - 0.12 * s, fy - 0.02 * s, 0.24 * s, 0.03 * s);
}

/** Brazo de goma con guante blanco. */
function hoseArm(g: CanvasRenderingContext2D, sx: number, sy: number, ex: number, ey: number, s: number): void {
  g.strokeStyle = "#1c1a1e";
  g.lineWidth = Math.max(2, 0.07 * s);
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(sx, sy);
  g.quadraticCurveTo((sx + ex) / 2 + (ex - sx) * 0.3, sy - 0.05 * s, ex, ey);
  rim(g, s, true);
  g.stroke();
  rim(g, s, false);
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#1c1a1e";
  g.lineWidth = Math.max(1, 0.03 * s);
  g.beginPath();
  g.arc(ex, ey + 0.03 * s, 0.085 * s, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

/**
 * El Chori: un chorizo ACOSTADO, sin pan (pedido del programador, con la referencia del
 * pancho de dibujo animado de los 30): cuerpo horizontal rojo cobrizo con marcas de
 * parrilla y los nudos del hilo en las puntas, ojos grandes con el parpado a media asta,
 * sonrisa con dientes, brazos y piernas de goma, guantes blancos y zapatillas.
 */
export function drawChori(g: CanvasRenderingContext2D, p: HeroPose): void {
  const s = p.s;
  const soaked = p.dead;
  const sy = 1 + p.stretch * 0.14;
  const sx = 1 - p.stretch * 0.08;
  const face = p.face;
  g.save();
  g.globalAlpha = p.alpha ?? 1;
  g.translate(p.x, p.y);
  if (soaked > 0) g.rotate(face * 0.35 * Math.min(1, soaked * 2));
  const legLen = 0.5 * s;
  const bodyH = 0.5 * s;
  const bodyW = 1.0 * s;
  const cy = -legLen - bodyH / 2 + 0.04 * s;
  // Piernas (atras del cuerpo).
  const k = Math.sin(p.walk);
  hoseLeg(g, -0.13 * s, cy + bodyH * 0.35, legLen + 0.02 * s, k, s, face, "#f2c230");
  hoseLeg(g, 0.13 * s, cy + bodyH * 0.35, legLen + 0.02 * s, -k, s, face, "#f2c230");
  g.save();
  g.translate(0, cy);
  g.scale(sx, sy);
  // Brazos de goma a los costados, con guantes.
  const arm = Math.sin(p.walk + Math.PI / 2) * 0.05 * s;
  hoseArm(g, -bodyW * 0.42, 0.06 * s, -bodyW * 0.62, 0.22 * s + arm, s);
  hoseArm(g, bodyW * 0.42, 0.06 * s, bodyW * 0.62, 0.22 * s - arm, s);
  // Cuerpo: capsula horizontal.
  const base = lerpColor("#b8462a", "#4a5a70", soaked);
  const grad = g.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
  grad.addColorStop(0, lerpColor("#d8683e", "#6a7a90", soaked));
  grad.addColorStop(0.45, base);
  grad.addColorStop(1, lerpColor("#6e2010", "#2a3444", soaked));
  g.fillStyle = grad;
  g.strokeStyle = "#2a0e06";
  g.lineWidth = Math.max(1.2, 0.035 * s);
  g.beginPath();
  g.roundRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, bodyH / 2);
  g.fill();
  g.stroke();
  // Marcas de parrilla.
  g.save();
  g.beginPath();
  g.roundRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, bodyH / 2);
  g.clip();
  g.strokeStyle = lerpColor("#5a1a0c", "#1a2230", soaked);
  g.lineWidth = 0.06 * s;
  for (const ox of [-0.34, 0.3]) {
    g.beginPath();
    g.moveTo(ox * s - 0.08 * s, bodyH / 2);
    g.lineTo(ox * s + 0.08 * s, -bodyH / 2);
    g.stroke();
  }
  g.fillStyle = "rgba(255, 220, 190, 0.3)";
  g.beginPath();
  g.ellipse(-0.05 * s, -bodyH * 0.27, bodyW * 0.33, bodyH * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Nudos del hilo en las puntas.
  g.strokeStyle = "#e9dcc0";
  g.lineWidth = Math.max(1, 0.04 * s);
  for (const side of [-1, 1]) {
    const ex = side * (bodyW / 2 - 0.02 * s);
    g.beginPath();
    g.moveTo(ex, -0.07 * s);
    g.lineTo(ex, 0.07 * s);
    g.moveTo(ex, 0);
    g.quadraticCurveTo(ex + side * 0.12 * s, -0.08 * s, ex + side * 0.1 * s, -0.16 * s);
    g.stroke();
  }
  // Cara: ojos grandes con el parpado a media asta, sonrisa con dientes.
  const blink = Math.sin(p.time * 1.7) > 0.985 && soaked === 0;
  for (const side of [-1, 1]) {
    const ex = side * 0.12 * s + face * 0.06 * s;
    const ey = -0.13 * s;
    g.fillStyle = "#fffaf0";
    g.strokeStyle = "#1a0c06";
    g.lineWidth = Math.max(1, 0.03 * s);
    g.beginPath();
    g.ellipse(ex, ey, 0.1 * s, 0.17 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (!blink) {
      g.fillStyle = "#14080a";
      g.beginPath();
      g.ellipse(ex + face * 0.035 * s, ey + 0.05 * s, 0.045 * s, 0.065 * s, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Parpado (de vivo, canchero; empapado, triste).
    g.fillStyle = base;
    g.beginPath();
    const lid = blink ? 1 : soaked > 0 ? 0.65 : p.happy ? 0.25 : 0.45;
    g.ellipse(ex, ey, 0.1 * s, 0.17 * s, 0, Math.PI, Math.PI + Math.PI * lid);
    g.lineTo(ex, ey);
    g.fill();
    g.beginPath();
    g.ellipse(ex, ey - 0.17 * s + 0.34 * s * lid * 0.5, 0.1 * s, 0.17 * s * lid, 0, Math.PI, 0);
    g.fill();
    g.strokeStyle = "#1a0c06";
    g.beginPath();
    g.moveTo(ex - 0.1 * s, ey - 0.17 * s + 0.34 * s * lid * 0.5);
    g.lineTo(ex + 0.1 * s, ey - 0.17 * s + 0.34 * s * lid * 0.5);
    g.stroke();
  }
  // Sonrisa con dientes.
  const mx = face * 0.06 * s;
  g.fillStyle = "#fffaf0";
  g.strokeStyle = "#1a0c06";
  g.lineWidth = Math.max(1, 0.03 * s);
  g.beginPath();
  if (soaked > 0) {
    g.arc(mx, 0.16 * s, 0.09 * s, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
  } else {
    g.moveTo(mx - 0.17 * s, 0.07 * s);
    g.quadraticCurveTo(mx, 0.24 * s, mx + 0.17 * s, 0.07 * s);
    g.quadraticCurveTo(mx, 0.12 * s, mx - 0.17 * s, 0.07 * s);
    g.fill();
    g.stroke();
    g.beginPath();
    for (const tx of [-0.08, 0, 0.08]) {
      g.moveTo(mx + tx * s, 0.1 * s);
      g.lineTo(mx + tx * s, 0.17 * s);
    }
    g.stroke();
  }
  g.restore();
  g.restore();
}

/**
 * El Pan: una baguette parada (pedido del programador, con referencia): larga, dorada,
 * con los cortes en diagonal, ojitos de punto, sonrisa grande y bracitos y patitas de
 * palito. Tostada (muerta en las brasas) se va a negro.
 */
export function drawPan(g: CanvasRenderingContext2D, p: HeroPose): void {
  const s = p.s;
  const burnt = p.dead;
  const sy = 1 + p.stretch * 0.14;
  const sx = 1 - p.stretch * 0.1;
  const face = p.face;
  g.save();
  g.globalAlpha = p.alpha ?? 1;
  g.translate(p.x, p.y);
  if (burnt > 0) g.rotate(face * 0.12 * Math.min(1, burnt * 2));
  const legLen = 0.22 * s;
  const w = 0.42 * s;
  const h = 1.42 * s;
  // Patitas de palito.
  const k = Math.sin(p.walk);
  g.strokeStyle = "#141010";
  g.lineWidth = Math.max(1.5, 0.05 * s);
  g.lineCap = "round";
  rim(g, s, true);
  for (const [side, kk] of [
    [-1, k],
    [1, -k],
  ] as const) {
    const hx = side * 0.08 * s;
    g.beginPath();
    g.moveTo(hx, -legLen - 0.02 * s);
    g.lineTo(hx + kk * 0.07 * s, 0);
    g.lineTo(hx + kk * 0.07 * s + face * 0.06 * s, 0);
    g.stroke();
  }
  g.save();
  g.translate(0, -legLen);
  g.scale(sx, sy);
  const top = -h;
  // Bracitos de palito.
  const arm = Math.sin(p.walk + Math.PI / 2) * 0.04 * s;
  g.beginPath();
  g.moveTo(-w / 2 + 0.02 * s, top + h * 0.5);
  g.quadraticCurveTo(-w / 2 - 0.14 * s, top + h * 0.56, -w / 2 - 0.12 * s, top + h * 0.7 + arm);
  g.moveTo(w / 2 - 0.02 * s, top + h * 0.5);
  g.quadraticCurveTo(w / 2 + 0.14 * s, top + h * 0.56, w / 2 + 0.12 * s, top + h * 0.7 - arm);
  g.stroke();
  rim(g, s, false);
  // Cuerpo: baguette.
  const base = lerpColor("#e3a14e", "#2a2220", burnt);
  const grad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  grad.addColorStop(0, lerpColor("#c98436", "#141010", burnt));
  grad.addColorStop(0.35, lerpColor("#f2b866", "#3a302c", burnt));
  grad.addColorStop(0.7, base);
  grad.addColorStop(1, lerpColor("#c27a2c", "#141010", burnt));
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(-w / 2, top, w, h, w / 2);
  g.fill();
  // Cortes en diagonal: oscuros con el centro claro.
  g.save();
  g.beginPath();
  g.roundRect(-w / 2, top, w, h, w / 2);
  g.clip();
  for (let i = 0; i < 6; i++) {
    const yy = top + h * (0.1 + i * 0.155);
    g.strokeStyle = lerpColor("#b06a24", "#100c0a", burnt);
    g.lineWidth = 0.085 * s;
    g.beginPath();
    g.moveTo(-w * 0.32, yy + 0.07 * s);
    g.lineTo(w * 0.32, yy - 0.07 * s);
    g.stroke();
    g.strokeStyle = lerpColor("#fbdca6", "#3a302c", burnt);
    g.lineWidth = 0.035 * s;
    g.beginPath();
    g.moveTo(-w * 0.18, yy + 0.04 * s);
    g.lineTo(w * 0.18, yy - 0.04 * s);
    g.stroke();
  }
  g.restore();
  // Cara: ojitos de punto y sonrisa grande.
  const fy = top + h * 0.36;
  const fx = face * 0.04 * s;
  const blink = Math.sin(p.time * 1.5 + 2) > 0.985 && burnt === 0;
  g.fillStyle = "#14100e";
  for (const side of [-1, 1]) {
    g.beginPath();
    if (blink) g.ellipse(fx + side * 0.1 * s, fy, 0.045 * s, 0.012 * s, 0, 0, Math.PI * 2);
    else g.arc(fx + side * 0.1 * s, fy, 0.045 * s, 0, Math.PI * 2);
    g.fill();
    if (!blink) {
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(fx + side * 0.1 * s - 0.015 * s, fy - 0.015 * s, 0.014 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#14100e";
    }
  }
  if (burnt > 0) {
    g.strokeStyle = "#14100e";
    g.lineWidth = Math.max(1, 0.035 * s);
    g.beginPath();
    g.arc(fx, fy + 0.2 * s, 0.08 * s, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
  } else {
    g.fillStyle = "#14100e";
    g.beginPath();
    g.moveTo(fx - 0.15 * s, fy + 0.08 * s);
    g.quadraticCurveTo(fx, fy + (p.happy ? 0.32 : 0.26) * s, fx + 0.15 * s, fy + 0.08 * s);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(fx - 0.12 * s, fy + 0.1 * s);
    g.quadraticCurveTo(fx, fy + 0.15 * s, fx + 0.12 * s, fy + 0.1 * s);
    g.lineTo(fx + 0.1 * s, fy + 0.13 * s);
    g.quadraticCurveTo(fx, fy + 0.17 * s, fx - 0.1 * s, fy + 0.13 * s);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.restore();
}
