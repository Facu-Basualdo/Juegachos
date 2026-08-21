import { codeToDirection, DIR_GLYPH, DIRECTIONS, type Direction } from "./directions";

interface InputHandlers {
  /** Una flecha (teclado o cruceta tactil). */
  onDirection: (dir: Direction) => void;
  /** Empezar / reintentar (Enter, Espacio o toque en el overlay). */
  onAction: () => void;
}

/**
 * Entrada del juego: cuatro flechas + una accion. Teclado (flechas o WASD,
 * Enter / Espacio para arrancar) y, en pantallas tactiles, una cruceta propia
 * montada sobre el canvas. La repeticion automatica del teclado se ignora: cada
 * flecha del rack se responde con una pulsacion, no manteniendo la tecla.
 */
export class InputController {
  private readonly handlers: InputHandlers;
  private readonly pad: HTMLDivElement;

  constructor(container: HTMLElement, handlers: InputHandlers) {
    this.handlers = handlers;
    window.addEventListener("keydown", this.handleKeyDown);
    this.pad = this.buildTouchPad();
    container.append(this.pad);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    this.pad.remove();
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const dir = codeToDirection(e.code);
    if (dir) {
      e.preventDefault();
      this.handlers.onDirection(dir);
      return;
    }
    if (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter") {
      e.preventDefault();
      this.handlers.onAction();
    }
  };

  /** Cruceta tactil: el CSS la muestra solo en punteros gruesos. */
  private buildTouchPad(): HTMLDivElement {
    const pad = document.createElement("div");
    pad.className = "touch-pad";
    for (const dir of DIRECTIONS) {
      const btn = document.createElement("button");
      btn.className = `touch-btn touch-btn--${dir}`;
      btn.type = "button";
      btn.textContent = DIR_GLYPH[dir];
      btn.setAttribute("aria-label", dir);
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handlers.onDirection(dir);
      });
      pad.append(btn);
    }
    return pad;
  }
}
