/**
 * Input de Viborita.
 *
 * - Compu: la cabeza apunta al mouse; el turbo es MANTENER apretado el click o el
 *   Espacio (soltar lo corta).
 * - Celu: un joystick que aparece donde se apoya el dedo marca hacia donde ir (el
 *   dedo encima de la viborita taparia lo que importa) y un boton TURBO abajo a la
 *   derecha, que tambien se mantiene.
 *
 * Lo que sale de aca es la posicion del mouse o el vector del joystick y si el turbo
 * esta apretado: `Game` lo convierte en el angulo que va al server. El server nunca
 * recibe una posicion.
 *
 * Los listeners cuelgan del `container`, nunca del canvas: las pantallas de inicio y
 * de muerte son un overlay que lo tapa (ver "El toque de arranque no puede colgar del
 * canvas" en el CLAUDE.md raiz).
 */

/** Radio (px CSS) desde el origen del arrastre en el que el joystick satura. */
const JOYSTICK_RANGE = 60;
/** Debajo de esto (px) el joystick no cambia el rumbo. */
const JOYSTICK_DEAD = 8;

export interface JoystickView {
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class InputController {
  private readonly boostBtn: HTMLButtonElement;

  /** Ultima posicion del mouse (px CSS), o null si nunca se movio. */
  mouse: { x: number; y: number } | null = null;
  /** Solo se escucha mientras se juega (no mientras se escribe el nombre). */
  enabled = false;

  private mouseBoost = false;
  private keyBoost = false;
  private buttonBoost = false;

  private stickId: number | null = null;
  private buttonId: number | null = null;
  private originX = 0;
  private originY = 0;
  private curX = 0;
  private curY = 0;

  constructor(target: HTMLElement) {
    this.boostBtn = document.createElement("button");
    this.boostBtn.type = "button";
    this.boostBtn.className = "vb-turbo";
    this.boostBtn.textContent = "TURBO";
    this.boostBtn.setAttribute("aria-label", "Turbo (mantener)");
    target.append(this.boostBtn);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.releaseAll);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerUp);
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Hay una pantalla tactil: se muestra el boton de turbo. */
  setTouchUi(visible: boolean): void {
    this.boostBtn.classList.toggle("is-shown", visible);
  }

  get boost(): boolean {
    return this.enabled && (this.mouseBoost || this.keyBoost || this.buttonBoost);
  }

  /** Vector del joystick, o null si no se esta tocando (o esta en la zona muerta). */
  get stick(): { x: number; y: number } | null {
    if (this.stickId === null) return null;
    const dx = this.curX - this.originX;
    const dy = this.curY - this.originY;
    if (Math.hypot(dx, dy) < JOYSTICK_DEAD) return null;
    return { x: dx, y: dy };
  }

  get joystick(): JoystickView | null {
    if (this.stickId === null) return null;
    return { originX: this.originX, originY: this.originY, x: this.curX, y: this.curY };
  }

  get joystickRange(): number {
    return JOYSTICK_RANGE;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
    if (this.enabled) e.preventDefault();
    this.keyBoost = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") this.keyBoost = false;
  };

  private releaseAll = (): void => {
    this.mouseBoost = this.keyBoost = this.buttonBoost = false;
    this.stickId = this.buttonId = null;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") {
      this.mouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerId !== this.stickId) return;
    this.curX = e.clientX;
    this.curY = e.clientY;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 0 && this.enabled) this.mouseBoost = true;
      return;
    }
    if (e.target === this.boostBtn) {
      this.buttonId = e.pointerId;
      this.buttonBoost = true;
      this.boostBtn.classList.add("is-on");
      return;
    }
    if (this.stickId !== null) return;
    this.stickId = e.pointerId;
    this.originX = this.curX = e.clientX;
    this.originY = this.curY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") {
      if (e.button === 0) this.mouseBoost = false;
      return;
    }
    if (e.pointerId === this.buttonId) {
      this.buttonId = null;
      this.buttonBoost = false;
      this.boostBtn.classList.remove("is-on");
    }
    if (e.pointerId === this.stickId) this.stickId = null;
  };
}
