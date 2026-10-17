/**
 * Input de Agar: la celula sigue al mouse en la compu y a un joystick virtual en el
 * celular (con el dedo encima de la celula no se veria nada de lo que importa).
 *
 * Lo que sale de aca es la posicion del mouse en pantalla o el vector del joystick:
 * `Game` lo convierte en el vector de movimiento (modulo <= 1) que va al server. El
 * server nunca recibe una posicion.
 *
 * El listener cuelga del `container`, nunca del canvas: las pantallas de inicio y de
 * muerte son un overlay que lo tapa (ver "El toque de arranque no puede colgar del
 * canvas" en el CLAUDE.md raiz).
 */

/** Radio (px CSS) desde el origen del arrastre en el que el joystick satura. */
const JOYSTICK_RANGE = 60;
const JOYSTICK_DEAD = 6;

export interface JoystickView {
  originX: number;
  originY: number;
  x: number;
  y: number;
}

/** Bits de acciones (espejo de `AgInput.act`). Reservadas para dividir / expulsar. */
export const ACT_SPLIT = 1;
export const ACT_EJECT = 2;

export class InputController {
  private readonly target: HTMLElement;

  /** Ultima posicion del mouse (px CSS), o null si nunca se movio. */
  mouse: { x: number; y: number } | null = null;

  private touchId: number | null = null;
  private originX = 0;
  private originY = 0;
  private curX = 0;
  private curY = 0;

  /** Acciones pedidas desde el ultimo envio (se consumen una vez). */
  private pendingAct = 0;
  /** Solo se escuchan las acciones mientras se juega (no mientras se escribe el nombre). */
  enabled = false;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerUp);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("pointercancel", this.onPointerUp);
  }

  /** Vector del joystick (modulo <= 1), o null si no se esta tocando. */
  get stick(): { x: number; y: number } | null {
    if (this.touchId === null) return null;
    const dx = this.curX - this.originX;
    const dy = this.curY - this.originY;
    const len = Math.hypot(dx, dy);
    if (len < JOYSTICK_DEAD) return { x: 0, y: 0 };
    const k = Math.min(len, JOYSTICK_RANGE) / JOYSTICK_RANGE / len;
    return { x: dx * k, y: dy * k };
  }

  get joystick(): JoystickView | null {
    if (this.touchId === null) return null;
    return { originX: this.originX, originY: this.originY, x: this.curX, y: this.curY };
  }

  get joystickRange(): number {
    return JOYSTICK_RANGE;
  }

  consumeActions(): number {
    const act = this.pendingAct;
    this.pendingAct = 0;
    return act;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.repeat) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") {
      this.pendingAct |= ACT_SPLIT;
      e.preventDefault();
    } else if (e.code === "KeyW") {
      this.pendingAct |= ACT_EJECT;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") {
      this.mouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerId !== this.touchId) return;
    this.curX = e.clientX;
    this.curY = e.clientY;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") {
      this.mouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.touchId !== null) return;
    this.touchId = e.pointerId;
    this.originX = this.curX = e.clientX;
    this.originY = this.curY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.touchId) this.touchId = null;
  };
}
