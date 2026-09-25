/**
 * Entrada de un solo boton: un toque = un paso.
 *
 * Se probo que el tiempo de pulsacion decidiera el largo del paso y se saco:
 * el juego original tiene una sola variable, el RITMO, y agregar una segunda
 * invisible (cuanto sostuviste) lo volvio imposible de aprender. Ver el
 * CLAUDE.md del juego.
 *
 * El listener de apretar va sobre el CONTAINER, nunca sobre el canvas: la
 * pantalla de inicio y la de game over son un overlay que tapa el canvas, y un
 * toque registrado ahi abajo no llega nunca (ver "El toque de arranque no puede
 * colgar del canvas" en el CLAUDE.md raiz). Se usa `pointerdown` porque el
 * `LeaderboardPanel` compartido corta ese evento en su raiz, asi que tocar el
 * campo del nombre no dispara un paso.
 *
 * El de soltar va sobre WINDOW, no sobre el container: si el dedo o el mouse se
 * van del elemento antes de soltar, el `pointerup` no llega y el paso queda
 * cargando para siempre.
 */
export class InputController {
  private readonly container: HTMLElement;
  private readonly onTap: () => void;
  private pressedAt: number | null = null;

  constructor(container: HTMLElement, onTap: () => void) {
    this.container = container;
    this.onTap = onTap;
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handleRelease);
    window.addEventListener("pointercancel", this.handleRelease);
    window.addEventListener("blur", this.handleRelease);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  /** Segundos que lleva apretado el boton ahora mismo. 0 si esta suelto. */
  heldFor(nowMs: number): number {
    return this.pressedAt === null ? 0 : Math.max(0, (nowMs - this.pressedAt) / 1000);
  }

  isHeld(): boolean {
    return this.pressedAt !== null;
  }

  /** Se llama al morir / reiniciar para no arrastrar una pulsacion vieja. */
  reset(): void {
    this.pressedAt = null;
  }

  private readonly handlePointerDown = (): void => {
    this.pressedAt = performance.now();
    this.onTap();
  };

  private readonly handleRelease = (): void => {
    this.pressedAt = null;
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    // `repeat` es el autorepeat del sistema: no es un toque nuevo, pero
    // tampoco hay que soltar por eso.
    if (e.repeat) return;
    if (!isStepKey(e.code)) return;
    // El espacio scrollea la pagina si no se lo frena.
    e.preventDefault();
    this.pressedAt = performance.now();
    this.onTap();
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    if (!isStepKey(e.code)) return;
    this.pressedAt = null;
  };

  dispose(): void {
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointerup", this.handleRelease);
    window.removeEventListener("pointercancel", this.handleRelease);
    window.removeEventListener("blur", this.handleRelease);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }
}

function isStepKey(code: string): boolean {
  return code === "Space" || code === "Enter" || code === "NumpadEnter";
}
