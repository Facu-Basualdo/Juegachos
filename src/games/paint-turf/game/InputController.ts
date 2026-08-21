/**
 * Input de Manchon: teclado en la compu, joystick virtual en el celular.
 *
 * Lo que sale de aca es una DIRECCION (un vector de largo <= 1) y un pedido de
 * salpicon, no una posicion: el server es el que mueve el pincel. Ver
 * `server/src/games/paintturf.ts`.
 *
 * El listener de puntero cuelga del `container`, nunca del canvas: la pantalla de
 * espera / fin de ronda es un overlay que tapa el canvas, y un listener colgado
 * ahi no recibe nada en un celular (es el bug documentado en el CLAUDE.md raiz).
 */

/** Radio (px CSS) desde el origen del arrastre en el que el joystick satura. */
const JOYSTICK_RANGE = 52;
/** Zona muerta: por debajo de esto el pincel se queda quieto. */
const JOYSTICK_DEAD = 10;

export interface JoystickView {
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class InputController {
  private readonly target: HTMLElement;
  private readonly keys = new Set<string>();

  /** Pedido de salpicon pendiente (se consume una sola vez). */
  private splatPending = false;
  /** Evita que mantener apretada la tecla dispare un salpicon por frame. */
  private splatKeyHeld = false;

  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private curX = 0;
  private curY = 0;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerUp);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("pointercancel", this.onPointerUp);
  }

  /** Direccion pedida, de largo <= 1. El joystick tiene prioridad sobre el teclado. */
  get direction(): { x: number; y: number } {
    if (this.pointerId !== null) {
      const dx = this.curX - this.originX;
      const dy = this.curY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len < JOYSTICK_DEAD) return { x: 0, y: 0 };
      const scale = Math.min(len, JOYSTICK_RANGE) / len;
      return { x: (dx * scale) / JOYSTICK_RANGE, y: (dy * scale) / JOYSTICK_RANGE };
    }

    let x = 0;
    let y = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) x -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) x += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) y -= 1;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) y += 1;
    return { x, y };
  }

  /** Joystick activo, en px CSS, para dibujarlo. null cuando no se esta tocando. */
  get joystick(): JoystickView | null {
    if (this.pointerId === null) return null;
    return { originX: this.originX, originY: this.originY, x: this.curX, y: this.curY };
  }

  /** Devuelve true una sola vez por pedido de salpicon. */
  consumeSplat(): boolean {
    if (!this.splatPending) return false;
    this.splatPending = false;
    return true;
  }

  /** Lo llama el boton en pantalla del celular. */
  requestSplat(): void {
    this.splatPending = true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (
      e.code === "Space" ||
      e.code === "ArrowUp" ||
      e.code === "ArrowDown" ||
      e.code === "ArrowLeft" ||
      e.code === "ArrowRight"
    ) {
      e.preventDefault();
    }
    if ((e.code === "Space" || e.code === "ShiftLeft") && !this.splatKeyHeld) {
      this.splatKeyHeld = true;
      this.splatPending = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === "Space" || e.code === "ShiftLeft") this.splatKeyHeld = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Los controles en pantalla (boton de salpicon) y el panel de ranking manejan
    // su propio toque: no arrancan un joystick.
    if ((e.target as HTMLElement | null)?.closest(".pt-controls, .leaderboard")) return;
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.curX = e.clientX;
    this.curY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.curX = e.clientX;
    this.curY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
  };
}
