/**
 * Input de la Isla, en primera persona (salio del de Marea de Lava, copiado por la
 * regla de decoupling).
 *
 * - Compu: WASD / flechas caminan relativo a donde se mira, ESPACIO salta, 1-4
 *   reacciones, y el MOUSE mira: un clic en la escena lo captura (pointer lock; ESC
 *   lo suelta para usar el panel). Sin captura tambien se mira arrastrando.
 * - Celu: un dedo en la mitad izquierda es un joystick flotante y uno en la mitad
 *   derecha mira. SALTAR y las reacciones son botones del HUD.
 *
 * Los listeners de puntero cuelgan del container y se ignoran los toques sobre el
 * HUD (paneles, botones), que tiene que seguir siendo clickeable.
 */

const JOYSTICK_RANGE = 52;
const JOYSTICK_DEAD = 8;
/** Radianes de giro por pixel de mouse (capturado o arrastrando). */
const MOUSE_LOOK = 0.0026;
/** Radianes de giro por pixel de dedo (la pantalla es chica: gira mas). */
const TOUCH_LOOK = 0.006;
/** Fraccion del ancho de pantalla que ocupa la zona del joystick en el celu. */
const JOYSTICK_ZONE = 0.5;
/** Lo que no es "escena": tocar ahi no mira ni mueve. */
const HUD_SELECTOR = ".isl-panel, .isl-top, .isl-controls, .isl-emotes, button, input, a";

export interface JoystickView {
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class InputController {
  private readonly keys = new Set<string>();
  private jumpPending = false;
  private emoteCb: (i: number) => void = () => {};
  private clickCb: () => void = () => {};
  private yawDelta = 0;
  private pitchDelta = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;

  private stickId: number | null = null;
  private originX = 0;
  private originY = 0;
  private curX = 0;
  private curY = 0;

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
    document.addEventListener("mousemove", this.onMouseMove);
  }

  onEmote(cb: (i: number) => void): void {
    this.emoteCb = cb;
  }

  /** Clic con el mouse ya capturado: apuntar y tocar (votar, marcar listo). */
  onAimClick(cb: () => void): void {
    this.clickCb = cb;
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /**
   * Pedido relativo a la mirada, de largo <= 1: `side` a la derecha, `forward`
   * hacia adelante. El Hub lo pasa al mundo con el yaw de la camara.
   */
  get move(): { side: number; forward: number } {
    if (this.stickId !== null) {
      const dx = this.curX - this.originX;
      const dy = this.curY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len < JOYSTICK_DEAD) return { side: 0, forward: 0 };
      const scale = Math.min(len, JOYSTICK_RANGE) / len;
      return { side: (dx * scale) / JOYSTICK_RANGE, forward: (-dy * scale) / JOYSTICK_RANGE };
    }
    let side = 0;
    let forward = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) side -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) side += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) forward -= 1;
    const len = Math.hypot(side, forward);
    return len > 1 ? { side: side / len, forward: forward / len } : { side, forward };
  }

  get joystick(): JoystickView | null {
    if (this.stickId === null) return null;
    return { originX: this.originX, originY: this.originY, x: this.curX, y: this.curY };
  }

  /** Giro acumulado (mouse / dedo) desde la ultima lectura, en radianes. */
  consumeLook(): { yaw: number; pitch: number } {
    const look = { yaw: this.yawDelta, pitch: this.pitchDelta };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    return look;
  }

  consumeJump(): boolean {
    if (!this.jumpPending) return false;
    this.jumpPending = false;
    return true;
  }

  requestJump(): void {
    this.jumpPending = true;
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTyping(e)) return;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.code === "Space" && !this.keys.has("Space")) this.jumpPending = true;
    const digit = /^Digit([1-5])$/.exec(e.code);
    if (digit && !e.repeat) this.emoteCb(Number(digit[1]) - 1);
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  /** Al perder el foco no llegan los keyup: sin esto el muñeco sigue caminando solo. */
  private onBlur = (): void => {
    this.keys.clear();
    this.stickId = null;
    this.lookId = null;
  };

  /** Con el mouse capturado, cada movimiento mira. */
  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.yawDelta -= e.movementX * MOUSE_LOOK;
    this.pitchDelta -= e.movementY * MOUSE_LOOK;
  };

  private onPointerDown = (e: PointerEvent): void => {
    const el = e.target as HTMLElement | null;
    if (el?.closest(HUD_SELECTOR)) return;

    if (e.pointerType === "mouse") {
      if (this.locked) {
        this.clickCb();
        return;
      }
      // Un clic captura el mouse; mientras tanto (o si el navegador no deja) se arrastra.
      this.target.requestPointerLock?.();
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      return;
    }
    if (this.stickId === null && e.clientX < window.innerWidth * JOYSTICK_ZONE) {
      this.stickId = e.pointerId;
      this.originX = this.curX = e.clientX;
      this.originY = this.curY = e.clientY;
      return;
    }
    if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.curX = e.clientX;
      this.curY = e.clientY;
      return;
    }
    if (e.pointerId !== this.lookId) return;
    // Con el mouse capturado ya mira `onMouseMove`: no sumar dos veces.
    if (e.pointerType === "mouse" && this.locked) return;
    const k = e.pointerType === "mouse" ? MOUSE_LOOK : TOUCH_LOOK;
    this.yawDelta -= (e.clientX - this.lookX) * k;
    this.pitchDelta -= (e.clientY - this.lookY) * k;
    this.lookX = e.clientX;
    this.lookY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) this.stickId = null;
    if (e.pointerId === this.lookId) this.lookId = null;
  };
}
