/**
 * Movement input: a **held** left/right state, exactly like the balance games.
 *
 * Three sources feed the same two flags — keyboard (A/D or arrows), the on-screen
 * buttons built for coarse pointers, and holding either half of the screen. The
 * start / retry action is not handled here: it lives on the `Hud` overlay, so that a
 * tap during play steers instead of restarting.
 */
export class InputController {
  private readonly target: HTMLElement;

  private leftKey = false;
  private rightKey = false;
  private leftTouch = false;
  private rightTouch = false;
  private leftHalf = false;
  private rightHalf = false;

  private readonly controls: HTMLDivElement;

  constructor(target: HTMLElement) {
    this.target = target;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);

    this.controls = this.buildTouchControls();
    target.append(this.controls);
  }

  /** Horizontal input: -1 (left) .. 1 (right). */
  get dir(): number {
    const left = this.leftKey || this.leftTouch || this.leftHalf;
    const right = this.rightKey || this.rightTouch || this.rightHalf;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  /** Drops every held flag — used on blur and whenever a run resets. */
  clear = (): void => {
    this.leftKey = false;
    this.rightKey = false;
    this.leftTouch = false;
    this.rightTouch = false;
    this.leftHalf = false;
    this.rightHalf = false;
  };

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.controls.remove();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.leftKey = true;
        break;
      case "ArrowRight":
      case "KeyD":
        this.rightKey = true;
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.leftKey = false;
        break;
      case "ArrowRight":
      case "KeyD":
        this.rightKey = false;
        break;
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    const rect = this.target.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) this.leftHalf = true;
    else this.rightHalf = true;
  };

  private onPointerUp = (): void => {
    this.leftHalf = false;
    this.rightHalf = false;
  };

  private buildTouchControls(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "touch-controls";
    wrap.append(
      this.makeButton(
        "‹",
        () => (this.leftTouch = true),
        () => (this.leftTouch = false),
      ),
      this.makeButton(
        "›",
        () => (this.rightTouch = true),
        () => (this.rightTouch = false),
      ),
    );
    return wrap;
  }

  private makeButton(label: string, onDown: () => void, onUp: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "touch-btn";
    btn.textContent = label;
    // Stop propagation so a button press doesn't also register as a screen-half hold.
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onDown();
    });
    const release = (e: Event): void => {
      e.stopPropagation();
      onUp();
    };
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
    return btn;
  }
}
