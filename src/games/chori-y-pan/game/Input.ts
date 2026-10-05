import type { Hero } from "./Level";
import type { HeroInput } from "./World";

/**
 * Teclado y botones en pantalla. En local (una compu, dos personas) el Chori va con las
 * flechas y el Pan con WASD, como el original. Online cada uno maneja SU heroe con
 * cualquiera de los dos juegos de teclas (`single`).
 */
export class Input {
  private readonly down = new Set<string>();
  /** Botones en pantalla (celu): izquierda, derecha, salto. */
  private readonly touch = { left: false, right: false, jump: false };
  single: Hero | null = null;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
  }

  setTouch(key: "left" | "right" | "jump", on: boolean): void {
    this.touch[key] = on;
  }

  private k(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  read(hero: Hero): HeroInput {
    const arrows = { left: this.k("ArrowLeft"), right: this.k("ArrowRight"), jump: this.k("ArrowUp") };
    const wasd = { left: this.k("KeyA"), right: this.k("KeyD"), jump: this.k("KeyW") };
    if (this.single === hero) {
      return {
        left: arrows.left || wasd.left || this.touch.left,
        right: arrows.right || wasd.right || this.touch.right,
        jump: arrows.jump || wasd.jump || this.k("Space") || this.touch.jump,
      };
    }
    if (this.single) return { left: false, right: false, jump: false };
    return hero === "chori" ? arrows : wasd;
  }
}
