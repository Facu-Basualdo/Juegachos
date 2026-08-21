/** Las cuatro flechas del juego. */
export type Direction = "left" | "up" | "right" | "down";

export const DIRECTIONS: readonly Direction[] = ["left", "up", "right", "down"];

/** Rotacion (rad) del glifo, que se dibuja apuntando hacia arriba. */
export const DIR_ROTATION: Record<Direction, number> = {
  up: 0,
  left: Math.PI / 2,
  down: Math.PI,
  right: -Math.PI / 2,
};

/** Simbolo para el HUD / botones tactiles. */
export const DIR_GLYPH: Record<Direction, string> = {
  left: "◀",
  up: "▲",
  right: "▶",
  down: "▼",
};

/** `KeyboardEvent.code` -> direccion. Flechas y WASD. */
export function codeToDirection(code: string): Direction | null {
  switch (code) {
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowUp":
    case "KeyW":
      return "up";
    case "ArrowRight":
    case "KeyD":
      return "right";
    case "ArrowDown":
    case "KeyS":
      return "down";
    default:
      return null;
  }
}
