/**
 * Input: horizontal steering (-1..1) from A/D + arrows or a pointer drag, plus
 * throw edge-events from the throw keys (Space / W / Up / J / K) and a quick tap
 * on the canvas. Steering keeps the drag analog like the other 2.5D runners.
 */
export class InputController {
  private readonly target: HTMLElement;
  private readonly onThrow: () => void;
  private leftHeld = false;
  private rightHeld = false;
  private pointerActive = false;
  private pointerX = 0;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private moved = false;

  constructor(target: HTMLElement, onThrow: () => void) {
    this.target = target;
    this.onThrow = onThrow;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  /** Horizontal steering, -1 (left) .. 1 (right). */
  get dirX(): number {
    if (this.pointerActive) return this.pointerX;
    if (this.leftHeld === this.rightHeld) return 0;
    return this.leftHeld ? -1 : 1;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") this.leftHeld = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") this.rightHeld = true;
    if (!e.repeat && (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp" || e.code === "KeyJ" || e.code === "KeyK")) {
      this.onThrow();
    }
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") this.leftHeld = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") this.rightHeld = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerActive = true;
    this.moved = false;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downTime = performance.now();
    this.applyPointer(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerActive) return;
    if (Math.abs(e.clientX - this.downX) > 8 || Math.abs(e.clientY - this.downY) > 8) this.moved = true;
    this.applyPointer(e);
  };

  private applyPointer(e: PointerEvent): void {
    const scale = Math.min(window.innerWidth, window.innerHeight) * 0.32;
    const cx = window.innerWidth / 2;
    this.pointerX = clamp01((e.clientX - cx) / scale);
  }

  private onPointerUp = (): void => {
    // A quick, still tap throws a pizza; a drag was steering.
    if (this.pointerActive && !this.moved && performance.now() - this.downTime < 260) {
      this.onThrow();
    }
    this.pointerActive = false;
    this.pointerX = 0;
  };
}

function clamp01(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
