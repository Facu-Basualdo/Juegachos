/**
 * Input: a single "action" (flap / start / restart) fired on Space / Enter /
 * click / tap. The Game decides what the action means from its current state.
 * Keyboard auto-repeat is ignored so holding a key can't spam flaps.
 */
export class InputController {
  private readonly element: HTMLElement;
  private readonly onAction: () => void;

  constructor(element: HTMLElement, onAction: () => void) {
    this.element = element;
    this.onAction = onAction;
    element.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  destroy(): void {
    this.element.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.onAction();
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowUp" || e.code === "KeyW") {
      e.preventDefault();
      this.onAction();
    }
  };
}
