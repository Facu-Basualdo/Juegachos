import { mulberry32 } from "./constants";

/** Sangre fresca y sangre encharcada. Mismos tonos que usa La Escalera. */
export const C_BLOOD = "#8e0a16";
export const C_BLOOD_DARK = "#4a0209";

/**
 * Una mancha pegada a una superficie de la sala.
 *
 * Las coordenadas son del PLANO en el que vive, no de pantalla, porque el
 * renderer las dibuja cargando la matriz de ese plano (igual que los charcos de
 * luz y el hollin). Asi la mancha se apoya en la piedra en vez de flotar
 * delante, que es lo que delata a cualquier calco pintado en pantalla.
 */
export interface BloodSplat {
  /** `floor` = plano z=0, con (u,v) = (x,y). `back` = muro y=0, con (u,v) = (x,z). */
  surface: "floor" | "back";
  u: number;
  v: number;
  /** Radio en unidades de mundo. */
  r: number;
  rot: number;
  /** Semilla de la forma: la misma mancha se dibuja igual en cada cuadro. */
  seed: number;
  dark: boolean;
}

/** Tope de manchas. Se recortan las mas viejas, no las mas chicas. */
const MAX_SPLATS = 120;

/**
 * Las manchas que deja una muerte. Persisten hasta que arranca la partida
 * siguiente: la sala se acuerda de los que perdio (ver DESIGN.md).
 */
export class Blood {
  readonly splats: BloodSplat[] = [];

  clear(): void {
    this.splats.length = 0;
  }

  private add(surface: "floor" | "back", u: number, v: number, r: number, dark: boolean): void {
    if (this.splats.length >= MAX_SPLATS) this.splats.shift();
    this.splats.push({
      surface,
      u,
      v,
      r,
      rot: Math.random() * Math.PI * 2,
      seed: (Math.random() * 0xffffffff) >>> 0,
      dark,
    });
  }

  /**
   * Reventon en (x, y): charco al pie, salpicadura abierta por las losas y
   * rociado contra el muro de atras.
   */
  explode(x: number, y: number): void {
    // Charco central, oscuro y ancho.
    this.add("floor", x, y, 0.85, true);
    this.add("floor", x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.5, 0.6, false);

    // Salpicadura por el piso. La densidad cae con la distancia (sqrt), asi que
    // se concentra cerca del cuerpo y se abre en gotas sueltas hacia afuera.
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * 3.6;
      this.add(
        "floor",
        x + Math.cos(a) * d,
        y + Math.sin(a) * d,
        0.14 + Math.random() * 0.36 * (1 - d / 4.4),
        Math.random() < 0.3,
      );
    }

    // Contra el muro de atras. Se abre en `x` alrededor del punto de muerte y
    // sube poco: es un rociado bajo, a la altura de un cuerpo reventado.
    for (let i = 0; i < 11; i++) {
      this.add(
        "back",
        x + (Math.random() - 0.5) * 5,
        0.15 + Math.random() * Math.random() * 2.1,
        0.12 + Math.random() * 0.3,
        Math.random() < 0.25,
      );
    }
  }
}

/**
 * Traza la silueta de una mancha en el contexto ya transformado al plano.
 * Circulo deformado por ruido, con gotas satelite alrededor -- misma receta que
 * la textura de salpicadura de La Escalera, pero dibujada en vivo porque aca las
 * manchas viven en el plano del mundo y no en una textura.
 */
export function pathSplat(ctx: CanvasRenderingContext2D, s: BloodSplat): void {
  const rnd = mulberry32(s.seed);
  ctx.beginPath();
  for (let i = 0; i <= 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const rr =
      s.r * (0.6 + Math.sin(a * 3 + 1.2) * 0.15 + Math.sin(a * 7) * 0.09 + rnd() * 0.12);
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  // Gotas sueltas alrededor: son las que hacen que el borde no lea como un
  // circulo con ruido, que es como se ve una mancha sin satelites.
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = s.r * (0.72 + rnd() * 0.95);
    const rr = s.r * (0.05 + rnd() * 0.15);
    ctx.moveTo(Math.cos(a) * d + rr, Math.sin(a) * d);
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, Math.PI * 2);
  }
}
