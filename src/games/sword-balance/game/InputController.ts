/**
 * Hold-to-lean input. Left / Right (arrows or A/D) or holding down the left /
 * right half of the screen apply a continuous corrective lean. `lean()` returns
 * -1 (left held), +1 (right held) or 0 (none / both), drained by the loop.
 */
export class InputController {
  private leftKey = false;
  private rightKey = false;
  private readonly pointers = new Map<number, "left" | "right">();
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") this.leftKey = true;
    else if (e.code === "ArrowRight" || e.code === "KeyD") this.rightKey = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") this.leftKey = false;
    else if (e.code === "ArrowRight" || e.code === "KeyD") this.rightKey = false;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, e.clientX < window.innerWidth / 2 ? "left" : "right");
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  /** -1 = lean left, +1 = lean right, 0 = neutral (nothing or both sides). */
  lean(): number {
    let left = this.leftKey;
    let right = this.rightKey;
    for (const side of this.pointers.values()) {
      if (side === "left") left = true;
      else right = true;
    }
    if (left === right) return 0;
    return left ? -1 : 1;
  }

  clear(): void {
    this.leftKey = false;
    this.rightKey = false;
    this.pointers.clear();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
  }
}
