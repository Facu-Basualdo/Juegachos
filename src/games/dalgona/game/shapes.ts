/**
 * Las cuatro figuras de la serie, como contornos CERRADOS en coordenadas de galleta
 * (radio 1, x a la derecha, y para ABAJO como el canvas). El paraguas es un contorno
 * unico que recorre la cupula, los festones, el mango y el gancho, asi se talla de
 * una sola pasada como los demas.
 */

export type ShapeId = "circle" | "triangle" | "star" | "umbrella";

export interface ShapeDef {
  id: ShapeId;
  name: string;
  /** Puntos si se saca entera (mas dificil, mas puntos). */
  points: number;
  outline: [number, number][];
}

export const SHAPE_ORDER: ShapeId[] = ["circle", "triangle", "star", "umbrella"];

function circle(): [number, number][] {
  const pts: [number, number][] = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * 0.42, Math.sin(a) * 0.42]);
  }
  return pts;
}

function polygon(corners: [number, number][]): [number, number][] {
  return corners;
}

function triangle(): [number, number][] {
  const r = 0.5;
  const pts: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r + 0.06]);
  }
  return polygon(pts);
}

function star(): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.52 : 0.23;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r + 0.04]);
  }
  return polygon(pts);
}

/**
 * Paraguas: cupula (media elipse), cuatro festones abajo, mango de 0.07 de ancho que
 * cuelga del festón del medio y un gancho que dobla a la izquierda con la punta
 * redondeada. Se arma en y hacia ARRIBA y al final se invierte.
 */
function umbrella(): [number, number][] {
  const pts: [number, number][] = [];
  const add = (x: number, y: number) => pts.push([x, y]);
  const rx = 0.52;
  const ry = 0.4;
  const w = 0.07;
  const half = w / 2;
  const stemBottom = -0.38;
  const rib = 0.26;
  const sag = 0.08;
  const scallop = (x: number) => {
    // Altura del borde de abajo de la cupula: arcos entre varillas cada `rib`.
    const t = (((x + rx) % rib) + rib) % rib / rib;
    return sag * Math.sin(Math.PI * t);
  };
  // Cupula, de izquierda a derecha por arriba.
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI - (i / 48) * Math.PI;
    add(Math.cos(a) * rx, Math.sin(a) * ry);
  }
  // Festones de derecha a izquierda hasta el mango (lado derecho del mango).
  for (let x = rx - 0.01; x > half; x -= 0.01) add(x, scallop(x));
  add(half, scallop(half));
  // Mango: baja por el lado derecho.
  for (let y = scallop(half) - 0.02; y > stemBottom; y -= 0.02) add(half, y);
  // Gancho: arco exterior de centro (-0.10, stemBottom), a la izquierda.
  const cx = -0.1;
  const ro = 0.1 + half;
  const ri = 0.1 - half;
  for (let i = 0; i <= 24; i++) {
    const a = -(i / 24) * Math.PI;
    add(cx + Math.cos(a) * ro, stemBottom + Math.sin(a) * ro);
  }
  // Punta redondeada del gancho.
  const tipX = cx - 0.1;
  for (let i = 1; i < 10; i++) {
    const a = Math.PI - (i / 10) * Math.PI;
    add(tipX + Math.cos(a) * half, stemBottom + Math.sin(a) * half);
  }
  // Arco interior de vuelta.
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (i / 16) * Math.PI;
    add(cx + Math.cos(a) * ri, stemBottom + Math.sin(a) * ri);
  }
  // Sube por el lado izquierdo del mango.
  for (let y = stemBottom + 0.02; y < scallop(-half); y += 0.02) add(-half, y);
  add(-half, scallop(-half));
  // Festones de ahi a la izquierda.
  for (let x = -half - 0.01; x > -rx; x -= 0.01) add(x, scallop(x));
  // Centrada en el alto (arriba 0.40, abajo del gancho -0.515) e invertida para el canvas.
  const mid = (0.4 + stemBottom - ro) / 2;
  return pts.map(([x, y]) => [x, -(y - mid)]);
}

export const SHAPES: Record<ShapeId, ShapeDef> = {
  circle: { id: "circle", name: "CIRCULO", points: 100, outline: circle() },
  triangle: { id: "triangle", name: "TRIANGULO", points: 150, outline: triangle() },
  star: { id: "star", name: "ESTRELLA", points: 250, outline: star() },
  umbrella: { id: "umbrella", name: "PARAGUAS", points: 400, outline: umbrella() },
};
