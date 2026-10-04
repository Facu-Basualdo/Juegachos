/**
 * Input de Minotauro.
 *
 * - Compu: flechas / WASD para caminar (se puede mantener), SHIFT para correr.
 * - Celu: un dedo en la losa es un joystick flotante (aparece donde se apoya) y el
 *   boton CORRER se mantiene con el otro pulgar.
 *
 * Devuelve las direcciones apretadas con la ULTIMA primero: en un cruce el jugador
 * dobla con la tecla nueva aunque todavia tenga apretada la vieja.
 *
 * Los listeners de puntero van sobre el `container` (no el canvas): la pantalla de
 * inicio es un overlay que lo tapa (ver el CLAUDE.md raiz).
 */

/** Indices de DIRS en Maze.ts: 0 N, 1 E, 2 S, 3 W. */
const KEY_DIR: Record<string, number> = {
  ArrowUp: 0,
  KeyW: 0,
  ArrowRight: 1,
  KeyD: 1,
  ArrowDown: 2,
  KeyS: 2,
  ArrowLeft: 3,
  KeyA: 3,
};

const STICK_DEAD = 14;

export class Input {
  private readonly held: number[] = [];
  /** Teclas apretadas (flechas y WASD pueden estar las dos en la misma direccion). */
  private readonly keys = new Set<string>();
  private shift = false;
  private runButton = false;
  private stickId: number | null = null;
  private ox = 0;
  private oy = 0;
  private sx = 0;
  private sy = 0;
  constructor(target: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.reset);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  /** Direcciones pedidas, la ultima apretada primero. */
  get dirs(): number[] {
    if (this.stickId !== null) {
      const dx = this.sx - this.ox;
      const dy = this.sy - this.oy;
      if (Math.hypot(dx, dy) < STICK_DEAD) return [];
      // La dominante primero y la otra despues: en diagonal dobla en el primer cruce.
      const h = dx > 0 ? 1 : 3;
      const v = dy > 0 ? 2 : 0;
      const main = Math.abs(dx) > Math.abs(dy) ? [h, v] : [v, h];
      return Math.min(Math.abs(dx), Math.abs(dy)) > STICK_DEAD ? main : [main[0]];
    }
    return [...this.held].reverse();
  }

  get running(): boolean {
    return this.shift || this.runButton;
  }

  /** Para el Hud: el joystick dibujado. */
  get stick(): { ox: number; oy: number; x: number; y: number } | null {
    return this.stickId === null ? null : { ox: this.ox, oy: this.oy, x: this.sx, y: this.sy };
  }

  setRunButton(on: boolean): void {
    this.runButton = on;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shift = true;
    const d = KEY_DIR[e.code];
    if (d === undefined) return;
    e.preventDefault();
    const i = this.held.indexOf(d);
    if (i >= 0) this.held.splice(i, 1);
    this.held.push(d);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shift = false;
    const d = KEY_DIR[e.code];
    if (d === undefined) return;
    const twin = Object.entries(KEY_DIR).some(([k, v]) => v === d && k !== e.code && this.keys.has(k));
    if (!twin) {
      const i = this.held.indexOf(d);
      if (i >= 0) this.held.splice(i, 1);
    }
  };

  private reset = (): void => {
    this.held.length = 0;
    this.keys.clear();
    this.shift = false;
    this.runButton = false;
    this.stickId = null;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" || this.stickId !== null) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest("button, .mg-lb, .mn-overlay")) return;
    this.stickId = e.pointerId;
    this.ox = this.sx = e.clientX;
    this.oy = this.sy = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    this.sx = e.clientX;
    this.sy = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) this.stickId = null;
  };

}
