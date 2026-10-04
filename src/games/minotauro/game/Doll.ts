/**
 * Teseo: el muñeco de bloques de la casa (el mismo de Marea de Lava, Pista Loca y
 * Derrumbe) visto en tres cuartos desde arriba, con la antorcha en la mano. Se dibuja
 * con rectangulos alineados al pixel, sin texturas: a 23x23 el muñeco mide ~25 px y
 * cualquier detalle mas fino se vuelve barro.
 *
 * Mira para cuatro lados: de frente (se le ve la cara), de espaldas (pelo) y de
 * perfil (el oeste es el espejo del este). La antorcha va siempre en la mano que da a
 * la camara, levantada, y `drawDoll` devuelve donde quedo la punta para que la llama
 * y las brasas salgan de ahi.
 */

export type Facing = "n" | "e" | "s" | "w";

export interface DollLook {
  shirt: string;
  skin: string;
  hair: string;
}

/** Pieles, pelos y remeras de los muñecos de la casa (ver Marea de Lava). */
const SKINS = ["#e9b98f", "#c98e62", "#8d5a3b", "#f1c9a5"];
const HAIRS = ["#3b2a1e", "#1f1a17", "#7a4b28", "#c9a255"];
const SHIRTS = ["#e2433b", "#3f7fe0", "#46b04a", "#f2c230", "#9b59d0", "#f08a2c", "#36c2c9", "#ef6fae"];
const PANTS = "#34406a";
const SHOES = "#2a1d14";
const STICK = "#6b3f1f";
const WRAP = "#3a2414";

/** El aspecto de un asiento de la sala (en solo, el 0). */
export function lookFor(seat: number): DollLook {
  const s = ((seat % 8) + 8) % 8;
  return { shirt: SHIRTS[s], skin: SKINS[s % SKINS.length], hair: HAIRS[(s * 3) % HAIRS.length] };
}

/** Direccion a la que mira, a partir de un desplazamiento (el eje dominante manda). */
export function facingOf(dx: number, dy: number, prev: Facing): Facing {
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return prev;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

export interface DollPose {
  facing: Facing;
  /** Fase del paso (radianes); avanza con la distancia recorrida. */
  phase: number;
  /** 0 quieto, 1 caminando a pleno. */
  stride: number;
  time: number;
}

/**
 * Dibuja el muñeco parado en (x, y) (los pies) con altura total ~10u, `u` en px.
 * Devuelve la punta de la antorcha en px.
 */
export function drawDoll(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, look: DollLook, pose: DollPose): { x: number; y: number } {
  const swing = Math.sin(pose.phase) * pose.stride;
  const bob = -Math.abs(Math.sin(pose.phase)) * 0.45 * pose.stride + Math.sin(pose.time * 2.2) * 0.12 * (1 - pose.stride);
  const oy = y + bob * u;
  const mirror = pose.facing === "w";

  // Sombra en el piso (no rebota con el paso).
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.beginPath();
  ctx.ellipse(x, y + 0.2 * u, 2.7 * u, 1.05 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, oy);
  if (mirror) ctx.scale(-1, 1);
  // Rectangulo en unidades del muñeco, redondeado al pixel en pantalla.
  const R = (ax: number, ay: number, aw: number, ah: number, color: string): void => {
    const x0 = Math.round(ax * u);
    const y0 = Math.round(ay * u);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, Math.max(1, Math.round((ax + aw) * u) - x0), Math.max(1, Math.round((ay + ah) * u) - y0));
  };
  const shirt = look.shirt;
  const shirtD = shade(look.shirt, 0.72);
  const skin = look.skin;
  const skinD = shade(look.skin, 0.8);
  const pantsD = shade(PANTS, 0.72);

  let tip: { x: number; y: number };
  if (pose.facing === "s" || pose.facing === "n") {
    const front = pose.facing === "s";
    // Piernas: la que avanza se acorta un poco (se levanta).
    const liftL = Math.max(0, swing) * 0.8;
    const liftR = Math.max(0, -swing) * 0.8;
    R(-1.9, -2.7, 1.8, 2.7 - liftL, PANTS);
    R(0.1, -2.7, 1.8, 2.7 - liftR, PANTS);
    R(-1.9, -0.7 - liftL, 1.8, 0.7, SHOES);
    R(0.1, -0.7 - liftR, 1.8, 0.7, SHOES);
    // Torso, con la parte de abajo en sombra (la luz viene de arriba, de la antorcha).
    R(-2.1, -6.2, 4.2, 3.6, shirt);
    R(-2.1, -3.2, 4.2, 0.6, shirtD);
    // Brazo libre: se balancea.
    const free = front ? 1 : -1;
    const fs = -swing * 0.5;
    R(free > 0 ? 2.1 : -3.5, -6.1 + fs, 1.4, 1.8, shirt);
    R(free > 0 ? 2.1 : -3.5, -4.3 + fs, 1.4, 1.2, skin);
    // Brazo de la antorcha: levantado, la mano a la altura del hombro.
    const tx = free > 0 ? -3.5 : 2.1;
    R(tx, -6.4, 1.4, 1.3, shirt);
    R(tx, -7.4, 1.4, 1.1, skin);
    const hx = tx + 0.7;
    tip = { x: hx + (free > 0 ? -0.5 : 0.5), y: -11.4 };
    drawStick(ctx, hx * u, -6.8 * u, tip.x * u, tip.y * u, u);
    // Cabeza.
    R(-2.1, -10.5, 4.2, 4.3, skin);
    if (front) {
      R(-2.1, -10.5, 4.2, 1.2, look.hair);
      R(-2.1, -9.3, 0.6, 0.8, look.hair);
      R(1.5, -9.3, 0.6, 0.8, look.hair);
      R(-1.5, -8.4, 1.0, 0.6, "#ffffff");
      R(0.5, -8.4, 1.0, 0.6, "#ffffff");
      R(-1.0, -8.4, 0.5, 0.6, "#2a2a4a");
      R(0.5, -8.4, 0.5, 0.6, "#2a2a4a");
      R(-0.5, -7.1, 1.0, 0.35, "rgba(90, 40, 30, 0.75)");
      R(-2.1, -6.6, 4.2, 0.4, skinD);
    } else {
      R(-2.1, -10.5, 4.2, 3.9, look.hair);
      R(-2.1, -6.6, 4.2, 0.4, skinD);
    }
  } else {
    // Perfil mirando al este (el oeste es el espejo).
    const a = swing * 0.9;
    // Pierna de atras primero, mas oscura.
    R(-0.8 - a, -2.7, 1.6, 2.7, pantsD);
    R(-0.8 - a, -0.7, 1.9, 0.7, SHOES);
    // Brazo de atras.
    R(-0.6 + swing * 0.5, -6.0, 1.2, 1.8, shirtD);
    R(-0.6 + swing * 0.5, -4.2, 1.2, 1.1, skinD);
    // Torso.
    R(-1.3, -6.2, 2.6, 3.6, shirt);
    R(-1.3, -3.2, 2.6, 0.6, shirtD);
    // Pierna de adelante.
    R(-0.8 + a, -2.7, 1.6, 2.7, PANTS);
    R(-0.8 + a, -0.7, 1.9, 0.7, SHOES);
    // Brazo de la antorcha: estirado hacia adelante y arriba.
    R(-0.6, -6.2, 1.3, 1.5, shirt);
    R(0.6, -6.6, 1.6, 1.0, skin);
    tip = { x: 3.0, y: -11.2 };
    drawStick(ctx, 1.5 * u, -5.9 * u, tip.x * u, tip.y * u, u);
    // Cabeza: cara hacia +x, pelo atras y arriba.
    R(-1.9, -10.5, 3.8, 4.3, skin);
    R(-1.9, -10.5, 3.8, 1.2, look.hair);
    R(-1.9, -9.3, 1.7, 2.4, look.hair);
    R(0.9, -8.4, 0.8, 0.6, "#ffffff");
    R(1.2, -8.4, 0.5, 0.6, "#2a2a4a");
    R(1.0, -7.1, 0.7, 0.35, "rgba(90, 40, 30, 0.75)");
    R(-1.9, -6.6, 3.8, 0.4, skinD);
  }
  ctx.restore();
  return { x: x + (mirror ? -tip.x : tip.x) * u, y: oy + tip.y * u };
}

/** Palo de la antorcha con la vuelta de tela engrasada arriba. */
function drawStick(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, u: number): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = STICK;
  ctx.lineWidth = Math.max(1.5, u * 0.65);
  ctx.beginPath();
  ctx.moveTo(x0, y0 + u * 0.8);
  ctx.lineTo(x1, y1 + u * 0.6);
  ctx.stroke();
  ctx.strokeStyle = WRAP;
  ctx.lineWidth = Math.max(2, u * 0.95);
  const k = 0.82;
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + u * 0.7);
  ctx.lineTo(x1, y1 + u * 0.6);
  ctx.stroke();
  ctx.restore();
}
