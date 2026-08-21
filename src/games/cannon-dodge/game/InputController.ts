/**
 * Input for Cannon Dodge. Movement is a held state read each frame as a vector
 * (`vecX` / `vecY`, each -1..1). Keyboard uses WASD / arrows (digital); touch
 * spawns a floating analog joystick under the finger. `onAction` (Enter / tap)
 * starts and restarts the run.
 */
export class InputController {
  private readonly target: HTMLElement;
  private readonly onAction: () => void;

  private up = false;
  private down = false;
  private left = false;
  private right = false;

  // Touch joystick state.
  private joyId: number | null = null;
  private joyOx = 0;
  private joyOy = 0;
  private joyX = 0;
  private joyY = 0;
  private readonly joyEl: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private static readonly JOY_MAX = 46; // px travel for full deflection

  constructor(target: HTMLElement, handlers: { onAction: () => void }) {
    this.target = target;
    this.onAction = handlers.onAction;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);

    this.joyEl = document.createElement("div");
    this.joyEl.className = "joystick";
    this.joyKnob = document.createElement("div");
    this.joyKnob.className = "joystick__knob";
    this.joyEl.append(this.joyKnob);
    target.append(this.joyEl);
  }

  get vecX(): number {
    const k = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    return k !== 0 ? k : this.joyX;
  }

  get vecY(): number {
    const k = (this.down ? 1 : 0) - (this.up ? 1 : 0);
    return k !== 0 ? k : this.joyY;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.joyEl.remove();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        this.up = true;
        e.preventDefault();
        break;
      case "ArrowDown":
      case "KeyS":
        this.down = true;
        e.preventDefault();
        break;
      case "ArrowLeft":
      case "KeyA":
        this.left = true;
        e.preventDefault();
        break;
      case "ArrowRight":
      case "KeyD":
        this.right = true;
        e.preventDefault();
        break;
      case "Enter":
      case "Space":
        e.preventDefault();
        if (!e.repeat) this.onAction();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        this.up = false;
        break;
      case "ArrowDown":
      case "KeyS":
        this.down = false;
        break;
      case "ArrowLeft":
      case "KeyA":
        this.left = false;
        break;
      case "ArrowRight":
      case "KeyD":
        this.right = false;
        break;
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Any tap starts / restarts the run.
    this.onAction();
    if (e.pointerType !== "touch") return;
    e.preventDefault();
    this.joyId = e.pointerId;
    this.joyOx = e.clientX;
    this.joyOy = e.clientY;
    this.joyX = 0;
    this.joyY = 0;
    this.joyEl.style.left = `${e.clientX}px`;
    this.joyEl.style.top = `${e.clientY}px`;
    this.joyKnob.style.transform = "translate(-50%, -50%)";
    this.joyEl.classList.add("is-active");
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.joyId !== e.pointerId) return;
    const dx = e.clientX - this.joyOx;
    const dy = e.clientY - this.joyOy;
    const dist = Math.hypot(dx, dy);
    const max = InputController.JOY_MAX;
    const clamped = Math.min(dist, max);
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    this.joyX = (nx * clamped) / max;
    this.joyY = (ny * clamped) / max;
    this.joyKnob.style.transform = `translate(calc(-50% + ${nx * clamped}px), calc(-50% + ${ny * clamped}px))`;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.joyId !== e.pointerId) return;
    this.joyId = null;
    this.joyX = 0;
    this.joyY = 0;
    this.joyEl.classList.remove("is-active");
  };
}
