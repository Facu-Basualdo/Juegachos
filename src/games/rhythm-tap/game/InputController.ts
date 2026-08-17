import { FIGURE_KEYS, LANE_COUNT, LANE_WIDTH } from "./constants";

/** Turns input into taps. A figure key resolves to a figure (which shape the
 *  player wants to clear), while a click/touch resolves to a column. Pointer
 *  coordinates are mapped back through the caller-supplied window -> view-x
 *  transform so a tap lands on the right column. */
export class InputController {
  private readonly target: HTMLElement;
  private readonly onFigure: (figure: number) => void;
  private readonly onLane: (lane: number) => void;
  private readonly toViewX: (clientX: number) => number;
  private readonly onStart: () => void;

  constructor(
    target: HTMLElement,
    onFigure: (figure: number) => void,
    onLane: (lane: number) => void,
    toViewX: (clientX: number) => number,
    onStart: () => void,
  ) {
    this.target = target;
    this.onFigure = onFigure;
    this.onLane = onLane;
    this.toViewX = toViewX;
    this.onStart = onStart;
    window.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("pointerdown", this.onPointerDown);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === "Enter") {
      e.preventDefault();
      this.onStart();
      return;
    }
    const figure = FIGURE_KEYS.indexOf(e.code);
    if (figure !== -1) {
      e.preventDefault();
      this.onFigure(figure);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    const viewX = this.toViewX(e.clientX);
    const lane = Math.floor(viewX / LANE_WIDTH);
    if (lane >= 0 && lane < LANE_COUNT) this.onLane(lane);
    // Fuera de las columnas (las bandas del letterbox) no hay nada que juzgar,
    // pero un toque sigue siendo un "quiero empezar": es el unico arranque que
    // hay en movil, donde no existe el Enter.
    else this.onStart();
  };
}
