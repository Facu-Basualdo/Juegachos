import { MAX_OFFSET } from "./constants";

/**
 * Entrada de Poolnight. Tres formas de tirar, todas sobre el mismo estado (angulo, potencia,
 * efecto):
 *  - Mouse: la mira sigue al cursor sobre la mesa; se mantiene el clic y se ARRASTRA HACIA
 *    ATRAS (al reves de la mira) para cargar la potencia, y al soltar se tira.
 *  - Teclado: A / D giran la mira (Shift = fino), W / S cargan la potencia, ESPACIO tira.
 *  - Tactil: arrastrar el dedo por la mesa apunta; la potencia es la barra lateral y TIRAR es
 *    un boton (los controles en pantalla los pone el Hud).
 * Con la blanca en mano ("place") el cursor mueve la blanca y el clic la apoya.
 *
 * El listener va sobre el `container`, nunca sobre el canvas (ver "El toque de arranque no
 * puede colgar del canvas" en el CLAUDE.md raiz); los controles del Hud frenan su
 * `pointerdown` para no cargar un tiro.
 */

export type InputMode = "aim" | "place";

/** Metros de arrastre sobre el paño para llegar a la potencia maxima. */
const PULL_RANGE = 0.55;
const MIN_POWER = 0.04;
const TURN_RATE = 0.9;
/** Con la camara baja (mira relativa): radianes por pixel de mouse, y pixeles de arrastre hacia abajo para la potencia maxima. */
const RELATIVE_SENS = 0.0018;
const RELATIVE_PULL_PX = 260;

export class InputController {
  enabled = false;
  mode: InputMode = "aim";
  /** atan2(z, x) hacia donde se apunta. */
  angle = 0;
  /** 0 a 1. */
  power = 0;
  /** Punto de golpe en la blanca, -MAX_OFFSET a MAX_OFFSET (x: derecha, y: arriba). */
  ox = 0;
  oy = 0;
  charging = false;
  /**
   * Mira relativa: el mouse GIRA la mira en vez de señalar un punto de la mesa. Se usa con la
   * camara baja, que orbita con la mira: apuntar a "un punto" cuando la camara se mueve con el
   * propio cursor es un lazo realimentado (el punto se corre debajo del mouse) y se sentia raro.
   */
  relative = false;
  /** Posicion de la blanca (la pone Game cada cuadro) y candidato mientras se acomoda. */
  cueX = 0;
  cueZ = 0;
  placeX = 0;
  placeZ = 0;

  onShoot: (angle: number, power: number, ox: number, oy: number) => void = () => {};
  onPlace: (x: number, z: number) => void = () => {};
  onToggleCamera: () => void = () => {};

  private readonly container: HTMLElement;
  private readonly pointToTable: (cx: number, cy: number) => { x: number; z: number } | null;
  private readonly keys = new Set<string>();
  private pullFrom: { x: number; z: number } | null = null;
  private pullDir = { x: 1, z: 0 };
  private pullY0 = 0;

  constructor(container: HTMLElement, pointToTable: (cx: number, cy: number) => { x: number; z: number } | null) {
    this.container = container;
    this.pointToTable = pointToTable;
    container.addEventListener("pointerdown", this.onDown);
    container.addEventListener("pointermove", this.onMove);
    container.addEventListener("pointerup", this.onUp);
    container.addEventListener("pointercancel", this.onCancel);
    container.addEventListener("contextmenu", this.onContext);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  setEnabled(on: boolean, mode: InputMode = "aim"): void {
    this.enabled = on;
    this.mode = mode;
    this.charging = false;
    this.pullFrom = null;
    if (!on) this.power = 0;
  }

  setMode(mode: InputMode): void {
    this.mode = mode;
    this.charging = false;
    this.pullFrom = null;
  }

  setSpin(ox: number, oy: number): void {
    const len = Math.hypot(ox, oy);
    const k = len > MAX_OFFSET ? MAX_OFFSET / len : 1;
    this.ox = ox * k;
    this.oy = oy * k;
  }

  setPower(p: number): void {
    this.power = Math.max(0, Math.min(1, p));
  }

  /** El boton TIRAR (tactil) o la tecla ESPACIO. */
  requestShoot(): void {
    if (!this.enabled) return;
    if (this.mode === "place") {
      this.onPlace(this.placeX, this.placeZ);
      return;
    }
    if (this.power < MIN_POWER) return;
    this.fire();
  }

  /** Teclado continuo: gira la mira y carga la potencia. */
  update(dt: number): void {
    if (!this.enabled || this.mode !== "aim") return;
    const fine = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 0.25 : 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.angle -= TURN_RATE * fine * dt;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.angle += TURN_RATE * fine * dt;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.power = Math.min(1, this.power + 0.55 * dt);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.power = Math.max(0, this.power - 0.55 * dt);
  }

  dispose(): void {
    this.container.removeEventListener("pointerdown", this.onDown);
    this.container.removeEventListener("pointermove", this.onMove);
    this.container.removeEventListener("pointerup", this.onUp);
    this.container.removeEventListener("pointercancel", this.onCancel);
    this.container.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  // ------------------------------------------------------------ interno

  private fire(): void {
    const p = this.power;
    this.power = 0;
    this.charging = false;
    this.pullFrom = null;
    this.onShoot(this.angle, p, this.ox, this.oy);
  }

  private aimToward(p: { x: number; z: number }): void {
    const dx = p.x - this.cueX;
    const dz = p.z - this.cueZ;
    if (Math.hypot(dx, dz) > 0.04) this.angle = Math.atan2(dz, dx);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled || e.button !== 0) return;
    if (this.mode === "aim" && this.relative) {
      if (e.pointerType === "mouse") {
        // Cargar: arrastrar hacia abajo (hacia uno), como tirar del taco hacia atras.
        this.pullY0 = e.clientY;
        this.charging = true;
        this.power = 0;
        try {
          this.container.setPointerCapture(e.pointerId);
        } catch {
          /* sin captura igual anda */
        }
      }
      return;
    }
    const p = this.pointToTable(e.clientX, e.clientY);
    if (!p) return;
    if (this.mode === "place") {
      this.placeX = p.x;
      this.placeZ = p.z;
      this.onPlace(p.x, p.z);
      return;
    }
    if (e.pointerType === "mouse") {
      // Cargar: se fija la mira y se arrastra hacia atras.
      this.aimToward(p);
      this.pullFrom = p;
      this.pullDir = { x: Math.cos(this.angle), z: Math.sin(this.angle) };
      this.charging = true;
      this.power = 0;
      try {
        this.container.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura igual anda */
      }
    } else {
      this.aimToward(p);
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.mode === "aim" && this.relative) {
      if (this.charging) {
        this.power = Math.max(0, Math.min(1, (e.clientY - this.pullY0) / RELATIVE_PULL_PX));
      } else if (e.pointerType === "mouse" || e.buttons > 0) {
        const fine = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 0.25 : 1;
        this.angle += e.movementX * RELATIVE_SENS * fine;
      }
      return;
    }
    const p = this.pointToTable(e.clientX, e.clientY);
    if (!p) return;
    if (this.mode === "place") {
      this.placeX = p.x;
      this.placeZ = p.z;
      return;
    }
    if (this.charging && this.pullFrom) {
      const back = -((p.x - this.pullFrom.x) * this.pullDir.x + (p.z - this.pullFrom.z) * this.pullDir.z);
      this.power = Math.max(0, Math.min(1, back / PULL_RANGE));
    } else if (e.pointerType === "mouse" || e.buttons > 0) {
      this.aimToward(p);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.enabled || !this.charging) return;
    try {
      this.container.releasePointerCapture(e.pointerId);
    } catch {
      /* nada */
    }
    if (this.power >= MIN_POWER) this.fire();
    else {
      this.power = 0;
      this.charging = false;
      this.pullFrom = null;
    }
  };

  private readonly onCancel = (): void => {
    this.charging = false;
    this.pullFrom = null;
    this.power = 0;
  };

  private readonly onContext = (e: Event): void => {
    // El clic derecho cancela la carga (y no abre el menu del navegador sobre la mesa).
    e.preventDefault();
    this.onCancel();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === "KeyC" && !e.repeat) {
      this.onToggleCamera();
      return;
    }
    if (!this.enabled || e.repeat) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      this.requestShoot();
    } else if (e.code === "Escape") {
      this.onCancel();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
}
