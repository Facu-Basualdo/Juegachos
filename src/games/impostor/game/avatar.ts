/**
 * Retratos de ficha policial generados desde el nombre (DESIGN.md, "Ficha policial").
 * El mismo nombre da la misma cara en todas las pantallas sin que viaje nada por la red.
 * Devuelve SVG en linea: sin assets. El blanco y negro calido lo pone el CSS (filtro sobre
 * `.im-face`), asi el color de piel y pelo sigue distinguiendo a los personajes.
 */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

const SKINS = ["#f1cfae", "#e2b48c", "#c68b62", "#9a6340", "#6e4429"];
const HAIRS = ["#1c1714", "#3b2618", "#6d4526", "#b98a4a", "#9c3f22", "#8e8b86"];
const COATS = ["#2c2f36", "#3a3128", "#23282e", "#4a3b2e", "#2f3a33", "#3d2f36"];

/** Numero de detenido de 4 cifras (la pizarra de la ficha). */
export function bookingNumber(name: string): string {
  return String(hash(`nro:${name}`) % 9000 + 1000);
}

/** Cara de ficha policial del jugador `name`, como SVG en linea. */
export function mugshot(name: string): string {
  const r = rng(hash(name));
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const skin = pick(SKINS);
  const hair = pick(HAIRS);
  const coat = pick(COATS);
  const headRx = 19 + r() * 4;
  const headRy = 23 + r() * 3;
  const hairStyle = Math.floor(r() * 7);
  const eyeStyle = Math.floor(r() * 6);
  const mouthStyle = Math.floor(r() * 5);
  const brow = (r() - 0.5) * 6; // inclinacion de las cejas: + enojado, - preocupado
  const extra = Math.floor(r() * 7);
  const cx = 50;
  const cy = 46;
  const eyeY = cy - 2;
  const top = cy - headRy;
  const parts: string[] = [];

  // Hombros y saco, con el cuello de la camisa.
  parts.push(`<path d="M8 100 C 12 78, 30 72, 50 72 C 70 72, 88 78, 92 100 Z" fill="${coat}"/>`);
  parts.push(`<path d="M40 73 L50 86 L60 73 Z" fill="#e9e4d8"/>`);
  if (r() < 0.5) parts.push(`<path d="M48 78 L52 78 L54 96 L50 100 L46 96 Z" fill="#7d1419"/>`);
  parts.push(`<rect x="${cx - 7}" y="${cy + headRy - 8}" width="14" height="12" fill="${skin}"/>`);

  // Pelo de atras (largo) antes que la cabeza.
  if (hairStyle === 2) {
    parts.push(`<path d="M${cx - headRx - 3} ${cy} Q ${cx - headRx - 4} ${top - 6}, ${cx} ${top - 5} Q ${cx + headRx + 4} ${top - 6}, ${cx + headRx + 3} ${cy} L ${cx + headRx + 2} ${cy + 22} L ${cx - headRx - 2} ${cy + 22} Z" fill="${hair}"/>`);
  }

  // Orejas y cabeza.
  parts.push(`<ellipse cx="${cx - headRx}" cy="${eyeY + 3}" rx="3.5" ry="5" fill="${skin}"/>`);
  parts.push(`<ellipse cx="${cx + headRx}" cy="${eyeY + 3}" rx="3.5" ry="5" fill="${skin}"/>`);
  parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${headRx}" ry="${headRy}" fill="${skin}"/>`);
  // Sombra de la lampara: la mitad de abajo de la cara un poco mas oscura.
  parts.push(`<path d="M${cx - headRx} ${cy + 4} Q ${cx} ${cy + headRy + 6}, ${cx + headRx} ${cy + 4} Q ${cx} ${cy + headRy - 2}, ${cx - headRx} ${cy + 4} Z" fill="rgba(0,0,0,0.12)"/>`);

  // Pelo / sombrero.
  switch (hairStyle) {
    case 0: // corto
      parts.push(`<path d="M${cx - headRx} ${cy - 4} Q ${cx - headRx} ${top - 4}, ${cx} ${top - 3} Q ${cx + headRx} ${top - 4}, ${cx + headRx} ${cy - 4} Q ${cx + 8} ${top + 7}, ${cx - headRx} ${cy - 4} Z" fill="${hair}"/>`);
      break;
    case 1: // pelado con costados
      parts.push(`<path d="M${cx - headRx} ${cy - 2} q 2 -8 6 -10 l 0 10 Z M${cx + headRx} ${cy - 2} q -2 -8 -6 -10 l 0 10 Z" fill="${hair}"/>`);
      parts.push(`<ellipse cx="${cx - 6}" cy="${top + 7}" rx="6" ry="2.5" fill="rgba(255,255,255,0.22)"/>`);
      break;
    case 2: // largo: flequillo
      parts.push(`<path d="M${cx - headRx - 1} ${cy - 2} Q ${cx - headRx} ${top - 5}, ${cx} ${top - 4} Q ${cx + headRx} ${top - 5}, ${cx + headRx + 1} ${cy - 2} Q ${cx + 6} ${top + 10}, ${cx - 4} ${top + 9} Q ${cx - 12} ${top + 12}, ${cx - headRx - 1} ${cy - 2} Z" fill="${hair}"/>`);
      break;
    case 3: // rulos
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        parts.push(`<circle cx="${cx + Math.cos(a) * (headRx - 1)}" cy="${cy - 6 + Math.sin(a) * (headRy - 2)}" r="6.5" fill="${hair}"/>`);
      }
      break;
    case 4: // sombrero de ala (fedora): la marca del noir
      parts.push(`<ellipse cx="${cx}" cy="${top + 7}" rx="${headRx + 13}" ry="5" fill="#15130f"/>`);
      parts.push(`<path d="M${cx - headRx + 2} ${top + 7} Q ${cx - headRx + 2} ${top - 12}, ${cx} ${top - 13} Q ${cx + headRx - 2} ${top - 12}, ${cx + headRx - 2} ${top + 7} Z" fill="#1f1c17"/>`);
      parts.push(`<rect x="${cx - headRx + 2}" y="${top + 1}" width="${(headRx - 2) * 2}" height="4" fill="#7d1419"/>`);
      break;
    case 5: // gorra
      parts.push(`<path d="M${cx - headRx} ${top + 9} Q ${cx - headRx} ${top - 6}, ${cx} ${top - 6} Q ${cx + headRx} ${top - 6}, ${cx + headRx} ${top + 9} Z" fill="${pick(COATS)}"/>`);
      parts.push(`<path d="M${cx - headRx} ${top + 9} L ${cx + headRx + 12} ${top + 9} Q ${cx + headRx + 10} ${top + 14}, ${cx + 4} ${top + 13} Z" fill="#15130f"/>`);
      break;
    default: // peinado para atras
      parts.push(`<path d="M${cx - headRx} ${cy - 6} Q ${cx - headRx - 1} ${top - 6}, ${cx + 2} ${top - 5} Q ${cx + headRx + 2} ${top - 3}, ${cx + headRx} ${cy - 6} Q ${cx} ${top + 3}, ${cx - headRx} ${cy - 6} Z" fill="${hair}"/>`);
      parts.push(`<path d="M${cx - 8} ${top} q 8 -2 16 1" stroke="rgba(255,255,255,0.25)" stroke-width="1.2" fill="none"/>`);
  }

  // Cejas.
  const bw = 7;
  parts.push(`<path d="M${cx - 14} ${eyeY - 6 - brow / 2} L ${cx - 14 + bw} ${eyeY - 6 + brow / 2}" stroke="${hair === "#8e8b86" ? "#5a5752" : hair}" stroke-width="2.4" stroke-linecap="round"/>`);
  parts.push(`<path d="M${cx + 14} ${eyeY - 6 - brow / 2} L ${cx + 14 - bw} ${eyeY - 6 + brow / 2}" stroke="${hair === "#8e8b86" ? "#5a5752" : hair}" stroke-width="2.4" stroke-linecap="round"/>`);

  // Ojos.
  const ink = "#1b1712";
  switch (eyeStyle) {
    case 0:
      parts.push(`<circle cx="${cx - 9}" cy="${eyeY}" r="2.1" fill="${ink}"/><circle cx="${cx + 9}" cy="${eyeY}" r="2.1" fill="${ink}"/>`);
      break;
    case 1: // entrecerrados, desconfiados
      parts.push(`<path d="M${cx - 13} ${eyeY} q 4 -2.2 8 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M${cx + 5} ${eyeY} q 4 -2.2 8 0" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
      break;
    case 2: // abiertos
      parts.push(`<ellipse cx="${cx - 9}" cy="${eyeY}" rx="4" ry="3" fill="#f4f0e6"/><ellipse cx="${cx + 9}" cy="${eyeY}" rx="4" ry="3" fill="#f4f0e6"/><circle cx="${cx - 8.5}" cy="${eyeY + 0.4}" r="1.8" fill="${ink}"/><circle cx="${cx + 9.5}" cy="${eyeY + 0.4}" r="1.8" fill="${ink}"/>`);
      break;
    case 3: // anteojos redondos
      parts.push(`<circle cx="${cx - 9}" cy="${eyeY}" r="1.9" fill="${ink}"/><circle cx="${cx + 9}" cy="${eyeY}" r="1.9" fill="${ink}"/>`);
      parts.push(`<circle cx="${cx - 9}" cy="${eyeY}" r="5.8" stroke="${ink}" stroke-width="1.6" fill="none"/><circle cx="${cx + 9}" cy="${eyeY}" r="5.8" stroke="${ink}" stroke-width="1.6" fill="none"/><path d="M${cx - 3.2} ${eyeY} h 6.4" stroke="${ink}" stroke-width="1.6"/>`);
      break;
    case 4: // anteojos oscuros
      parts.push(`<rect x="${cx - 16}" y="${eyeY - 4}" width="13" height="7" rx="2" fill="${ink}"/><rect x="${cx + 3}" y="${eyeY - 4}" width="13" height="7" rx="2" fill="${ink}"/><path d="M${cx - 3} ${eyeY - 1} h 6" stroke="${ink}" stroke-width="1.6"/>`);
      parts.push(`<path d="M${cx - 14} ${eyeY - 2.5} l 4 0" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`);
      break;
    default: // mirando de reojo
      parts.push(`<ellipse cx="${cx - 9}" cy="${eyeY}" rx="3.6" ry="2.4" fill="#f4f0e6"/><ellipse cx="${cx + 9}" cy="${eyeY}" rx="3.6" ry="2.4" fill="#f4f0e6"/><circle cx="${cx - 10.8}" cy="${eyeY}" r="1.7" fill="${ink}"/><circle cx="${cx + 7.2}" cy="${eyeY}" r="1.7" fill="${ink}"/>`);
  }

  // Nariz.
  parts.push(`<path d="M${cx} ${eyeY + 2} q -3 7 -1 9 q 2 1 4 -0.5" stroke="rgba(60,30,15,0.45)" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);

  // Boca.
  const my = cy + headRy * 0.52;
  switch (mouthStyle) {
    case 0:
      parts.push(`<path d="M${cx - 6} ${my} h 12" stroke="#5a2a20" stroke-width="2" stroke-linecap="round"/>`);
      break;
    case 1: // sonrisa torcida
      parts.push(`<path d="M${cx - 6} ${my} q 6 2.5 11 -2" stroke="#5a2a20" stroke-width="2" fill="none" stroke-linecap="round"/>`);
      break;
    case 2: // enojado
      parts.push(`<path d="M${cx - 6} ${my + 1.5} q 6 -4 12 0" stroke="#5a2a20" stroke-width="2" fill="none" stroke-linecap="round"/>`);
      break;
    case 3: // sorprendido
      parts.push(`<ellipse cx="${cx}" cy="${my}" rx="2.6" ry="3.2" fill="#5a2a20"/>`);
      break;
    default: // sonrisa
      parts.push(`<path d="M${cx - 7} ${my - 1} q 7 6 14 0" stroke="#5a2a20" stroke-width="2" fill="none" stroke-linecap="round"/>`);
  }

  // Un detalle.
  switch (extra) {
    case 0: // bigote
      parts.push(`<path d="M${cx - 9} ${my - 3.5} q 4.5 -4 9 -1 q 4.5 -3 9 1 q -4 1.5 -9 0 q -5 1.5 -9 0 Z" fill="${hair}"/>`);
      break;
    case 1: // barba de dias
      for (let i = 0; i < 26; i++) {
        const a = Math.PI * (0.15 + r() * 0.7);
        const d = headRy * (0.55 + r() * 0.4);
        parts.push(`<circle cx="${cx + Math.cos(a) * headRx * 0.9 * (r() < 0.5 ? -1 : 1)}" cy="${cy + Math.sin(a) * d}" r="0.7" fill="rgba(30,20,15,0.55)"/>`);
      }
      break;
    case 2: // cicatriz
      parts.push(`<path d="M${cx + 10} ${eyeY + 4} l 5 9 M${cx + 10.5} ${eyeY + 7} l 3 -1 M${cx + 12} ${eyeY + 10} l 3 -1" stroke="#8a4a3a" stroke-width="1.2" stroke-linecap="round"/>`);
      break;
    case 3: // aro
      parts.push(`<circle cx="${cx - headRx - 0.5}" cy="${eyeY + 9}" r="2" stroke="#e4b64c" stroke-width="1.2" fill="none"/>`);
      break;
    case 4: // pecas
      for (let i = 0; i < 8; i++) {
        parts.push(`<circle cx="${cx + (i % 2 ? 1 : -1) * (7 + r() * 6)}" cy="${eyeY + 6 + r() * 4}" r="0.8" fill="rgba(120,60,30,0.55)"/>`);
      }
      break;
    default:
      break;
  }

  return `<svg class="im-face" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
}
