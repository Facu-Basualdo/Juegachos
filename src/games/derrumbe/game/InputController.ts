/**
 * Input de Derrumbe.
 *
 * - Compu: WASD / flechas para correr (relativo a la camara), ESPACIO para saltar,
 *   Q / E o arrastrar con el mouse para girar la camara.
 * - Celu: el primer dedo en la mitad izquierda es un joystick flotante (aparece
 *   donde apoyas), un dedo en la mitad derecha gira la camara, y el boton SALTAR va
 *   abajo a la derecha (lo maneja el Hud y llama a `requestJump`).
 *
 * Los listeners de puntero cuelgan del `container`, nunca del canvas: los carteles
 * del juego son overlays que lo tapan (el bug documentado en el CLAUDE.md raiz).
 */

const JOYSTICK_RANGE = 52;
const JOYSTICK_DEAD = 8;
/** Radianes de giro de camara por pixel arrastrado. */
const DRAG_YAW = 0.0065;
/** Fraccion del ancho de pantalla que ocupa la zona del joystick en el celu. */
const JOYSTICK_ZONE = 0.55;

export interface JoystickView {
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class InputController {
  private readonly keys = new Set<string>();
  private jumpPending = false;
  private yawDelta = 0;

  private stickId: number | null = null;
  private originX = 0;
  private originY = 0;
  private curX = 0;
  private curY = 0;

  private dragId: number | null = null;
  private dragX = 0;

  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerUp);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("pointercancel", this.onPointerUp);
  }

  /**
   * Direccion pedida en pantalla, de largo <= 1: x a la derecha, y hacia abajo
   * (o sea -y es "adelante", hacia donde mira la camara).
   */
  get direction(): { x: number; y: number } {
    if (this.stickId !== null) {
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
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  get joystick(): JoystickView | null {
    if (this.stickId === null) return null;
    return { originX: this.originX, originY: this.originY, x: this.curX, y: this.curY };
  }

  /** Giro continuo de las teclas Q / E (-1, 0 o 1). */
  get keyYaw(): number {
    return (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
  }

  /** Giro acumulado por arrastre desde la ultima llamada (rad). */
  consumeYawDelta(): number {
    const d = this.yawDelta;
    this.yawDelta = 0;
    return d;
  }

  consumeJump(): boolean {
    if (!this.jumpPending) return false;
    this.jumpPending = false;
    return true;
  }

  requestJump(): void {
    this.jumpPending = true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.code === "Space" && !this.keys.has("Space")) this.jumpPending = true;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  /** Al perder el foco no llegan los keyup: sin esto el jugador sigue corriendo solo. */
  private onBlur = (): void => {
    this.keys.clear();
    this.stickId = null;
    this.dragId = null;
  };

  private onPointerDown = (e: PointerEvent): void => {
    const el = e.target as HTMLElement | null;
    if (el?.closest(".dr-controls, .dr__card, .leaderboard")) return;

    if (e.pointerType === "mouse") {
      if (e.button !== 0 && e.button !== 2) return;
      this.dragId = e.pointerId;
      this.dragX = e.clientX;
      return;
    }

    if (this.stickId === null && e.clientX < window.innerWidth * JOYSTICK_ZONE) {
      this.stickId = e.pointerId;
      this.originX = this.curX = e.clientX;
      this.originY = this.curY = e.clientY;
      return;
    }
    if (this.dragId === null) {
      this.dragId = e.pointerId;
      this.dragX = e.clientX;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.curX = e.clientX;
      this.curY = e.clientY;
    } else if (e.pointerId === this.dragId) {
      this.yawDelta -= (e.clientX - this.dragX) * DRAG_YAW;
      this.dragX = e.clientX;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) this.stickId = null;
    if (e.pointerId === this.dragId) this.dragId = null;
  };
}
