/** Teclado / mouse / touch → un solo callback "tap" (impulso). */
export class InputController {
  private readonly target: HTMLElement;
  private readonly onTap: () => void;

  constructor(target: HTMLElement, onTap: () => void) {
    this.target = target;
    this.onTap = onTap;
    window.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("pointerdown", this.onPointerDown);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Enter") {
      e.preventDefault();
      this.onTap();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.onTap();
  };
}
