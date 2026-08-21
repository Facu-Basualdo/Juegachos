interface Handlers {
  /** Arranca / reintenta (Enter o un toque en pantalla de menu). */
  onAction: () => void;
  onJump: () => void;
  onDuckStart: () => void;
  onDuckEnd: () => void;
  /** True solo mientras se esta jugando: decide si un toque es accion o gameplay. */
  isPlaying: () => boolean;
}

/**
 * Dos acciones y nada mas: saltar y agacharse.
 *
 * Teclado: flecha arriba / W / espacio saltan, flecha abajo / S agachan mientras
 * se mantengan. Tactil: la mitad de ARRIBA de la pantalla salta, la de ABAJO
 * agacha (mientras el dedo siga apoyado).
 *
 * El listener de puntero cuelga del `container`, NUNCA del canvas: la pantalla
 * de inicio es un overlay que tapa el canvas, asi que un listener sobre el canvas
 * no recibiria jamas el toque de arranque en un celular (ver el CLAUDE.md raiz,
 * "El toque de arranque no puede colgar del canvas"). Como a cambio este handler
 * ve los toques de toda la pantalla, filtra por estado con `isPlaying`.
 */
export class InputController {
  private readonly target: HTMLElement;
  private readonly h: Handlers;
  /** Puntero que mantiene la agachada, para no cortarla con otro dedo. */
  private duckPointer: number | null = null;
  /** Tecla de agachada apretada (para no repetir el duckStart con el autorepeat). */
  private duckKey = false;
  private readonly zoneUp: HTMLDivElement;
  private readonly zoneDown: HTMLDivElement;

  constructor(target: HTMLElement, handlers: Handlers) {
    this.target = target;
    this.h = handlers;

    this.zoneUp = document.createElement("div");
    this.zoneUp.className = "touch-zone touch-zone--up";
    this.zoneUp.innerHTML = '<span class="touch-zone__label">SALTAR</span>';
    this.zoneDown = document.createElement("div");
    this.zoneDown.className = "touch-zone touch-zone--down";
    this.zoneDown.innerHTML = '<span class="touch-zone__label">AGACHARSE</span>';
    target.append(this.zoneUp, this.zoneDown);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  /** Las guias tactiles solo se muestran mientras se juega. */
  showZones(visible: boolean): void {
    this.zoneUp.classList.toggle("is-shown", visible);
    this.zoneDown.classList.toggle("is-shown", visible);
    if (!visible) {
      this.zoneUp.classList.remove("is-active");
      this.zoneDown.classList.remove("is-active");
    }
  }

  /** Suelta todo: al morir o al reiniciar no puede quedar una agachada colgada. */
  clear(): void {
    this.duckPointer = null;
    this.duckKey = false;
    this.zoneUp.classList.remove("is-active");
    this.zoneDown.classList.remove("is-active");
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.zoneUp.remove();
    this.zoneDown.remove();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
      case "Space":
        e.preventDefault();
        if (e.repeat) return;
        if (this.h.isPlaying()) this.h.onJump();
        else this.h.onAction();
        break;
      case "ArrowDown":
      case "KeyS":
        e.preventDefault();
        if (!this.h.isPlaying()) return;
        if (!this.duckKey) {
          this.duckKey = true;
          this.h.onDuckStart();
        }
        break;
      case "Enter":
        e.preventDefault();
        if (!e.repeat && !this.h.isPlaying()) this.h.onAction();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== "ArrowDown" && e.code !== "KeyS") return;
    if (!this.duckKey) return;
    this.duckKey = false;
    this.h.onDuckEnd();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.h.isPlaying()) {
      this.h.onAction();
      return;
    }
    // Mitad de arriba salta, mitad de abajo agacha. Se mide contra la ventana y
    // no contra el canvas: el jugador apunta a la pantalla, no al viewport util.
    const upper = e.clientY < window.innerHeight * 0.5;
    if (upper) {
      this.h.onJump();
      this.flash(this.zoneUp);
      return;
    }
    if (this.duckPointer !== null) return;
    this.duckPointer = e.pointerId;
    this.zoneDown.classList.add("is-active");
    this.h.onDuckStart();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.duckPointer !== e.pointerId) return;
    this.duckPointer = null;
    this.zoneDown.classList.remove("is-active");
    this.h.onDuckEnd();
  };

  private flash(el: HTMLElement): void {
    el.classList.add("is-active");
    setTimeout(() => el.classList.remove("is-active"), 110);
  }
}
