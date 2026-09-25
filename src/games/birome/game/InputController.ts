/**
 * Un solo control: APRETAR (sube) / SOLTAR (baja). Teclado (espacio, flecha
 * arriba, W), mouse o dedo en cualquier lado de la pantalla. `onAction` (Enter,
 * espacio o un toque) arranca desde las pantallas de menu; el juego filtra por
 * estado.
 *
 * El `pointerdown` cuelga del CONTAINER, nunca del canvas: la pantalla de inicio
 * es un overlay que lo tapa y en el celular el toque moria ahi (ver el CLAUDE.md
 * raiz, "El toque de arranque no puede colgar del canvas").
 */
export class InputController {
  private readonly target: HTMLElement;
  private readonly onAction: () => void;
  private readonly onHoldChange: (held: boolean) => void;
  private readonly keys = new Set<string>();
  private readonly pointers = new Set<number>();
  private held = false;

  constructor(
    target: HTMLElement,
    handlers: { onAction: () => void; onHoldChange: (held: boolean) => void },
  ) {
    this.target = target;
    this.onAction = handlers.onAction;
    this.onHoldChange = handlers.onHoldChange;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    target.addEventListener("contextmenu", this.onContextMenu);
  }

  get isHeld(): boolean {
    return this.held;
  }

  /** Suelta todo (al largar o al morir, para no arrastrar un apretado viejo). */
  clear = (): void => {
    this.keys.clear();
    this.pointers.clear();
    this.sync();
  };

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
  }

  private sync(): void {
    const next = this.keys.size > 0 || this.pointers.size > 0;
    if (next === this.held) return;
    this.held = next;
    this.onHoldChange(next);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "Enter":
      case "NumpadEnter":
        e.preventDefault();
        if (!e.repeat) this.onAction();
        break;
      case "Space":
      case "ArrowUp":
      case "KeyW":
        e.preventDefault();
        if (e.repeat) return;
        if (e.code === "Space") this.onAction();
        this.keys.add(e.code);
        this.sync();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.keys.delete(e.code)) return;
    this.sync();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.onAction();
    this.pointers.add(e.pointerId);
    this.sync();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    this.sync();
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
}
