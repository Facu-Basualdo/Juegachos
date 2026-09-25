import {
  AUTO_SUBMIT_MARGIN_MS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_THICKNESS,
  EXPORT_HEIGHT,
  EXPORT_QUALITY,
  EXPORT_WIDTH,
  MAX_GUESS_LEN,
  MAX_PHRASE_LEN,
  PALETTE,
  THICKNESSES,
  UNDO_LIMIT,
} from "./constants";
import type { TcChainView, TcPhase, TcState, TcYou } from "./TelefonoTransport";

type Tool = "pencil" | "marker" | "eraser" | "circle" | "rect" | "fill";

/** Iconos como SVG inline: el repo no permite emojis. */
const TOOL_ICONS: Record<Tool, string> = {
  pencil: `<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>`,
  marker: `<path d="m18 5-3-3H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2Z"></path><path d="M4 11h16"></path><path d="M12 11v11"></path>`,
  fill: `<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"></path><path d="m5 2 5 5"></path><path d="M2 13h15"></path><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"></path>`,
  circle: `<circle cx="12" cy="12" r="10"></circle>`,
  rect: `<rect width="18" height="18" x="3" y="3" rx="2"></rect>`,
  eraser: `<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"></path><path d="M22 21H7"></path><path d="m5 11 9 9"></path>`,
};
const UNDO_ICON = `<path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>`;
const CLEAR_ICON = `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`;

const TOOLS: { id: Tool; title: string }[] = [
  { id: "pencil", title: "Lapiz" },
  { id: "marker", title: "Marcador" },
  { id: "fill", title: "Rellenar" },
  { id: "circle", title: "Circulo" },
  { id: "rect", title: "Rectangulo" },
  { id: "eraser", title: "Goma" },
];

/** Opacidad del marcador: se aplica al trazo entero, no a cada segmento. */
const MARKER_ALPHA = 0.35;
/** Cada cuanto se mira el reloj para el autoenvio (con setInterval: sigue en 2do plano). */
const AUTO_SUBMIT_POLL_MS = 250;

function svg(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon">${paths}</svg>`;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Todo el DOM del juego. `Game.ts` no toca nodos: le pasa el `TcState` / `TcYou` que
 * llega del server y engancha callbacks.
 *
 * Gotcha central: la vista de una fase **no** se reconstruye en cada snapshot (perderia
 * el foco del input, lo tipeado y el dibujo a medio hacer). Se rebuildea solo cuando
 * cambia la "firma" de la tarea (`viewKey`); los snapshots siguientes solo refrescan el
 * reloj, el roster y la pista.
 */
export class Hud {
  private readonly root: HTMLElement;

  private stage: HTMLElement | null = null;
  private phaseLabel: HTMLElement | null = null;
  private timerBar: HTMLElement | null = null;
  private timerText: HTMLElement | null = null;
  private roster: HTMLElement | null = null;
  private banner: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;

  /** Firma de la vista montada; si no cambia, no se reconstruye. */
  private viewKey = "";
  private hintEl: HTMLElement | null = null;
  private guessFeedback: HTMLElement | null = null;
  private gallery: HTMLElement | null = null;
  private readonly chains = new Map<number, TcChainView>();

  // Reloj anclado a performance.now() (sin drift entre snapshots).
  private clockAnchor: { at: number; ms: number; total: number } | null = null;
  private clockRaf: number | null = null;

  /**
   * Envio automatico de lo que haya en pantalla cuando se esta por cerrar la fase. Lo
   * arma la vista de escribir / dibujar y se dispara una sola vez.
   */
  private autoSubmit: (() => void) | null = null;
  private autoSubmitTimer: number | null = null;

  // Lienzo
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private pointerId: number | null = null;
  private tool: Tool = "pencil";
  private color = "#000000";
  private thickness = DEFAULT_THICKNESS;
  private start: Point = { x: 0, y: 0 };
  private last: Point = { x: 0, y: 0 };
  /** Trazo en curso del marcador (se redibuja entero para no acumular opacidad). */
  private strokePoints: Point[] = [];
  /** Lienzo antes del trazo en curso (preview de figuras y del marcador). */
  private strokeBase: ImageData | null = null;
  private undoStack: ImageData[] = [];
  /** Hay algo dibujado (no se manda un lienzo en blanco). */
  private dirty = false;
  private onUndoKey: ((e: KeyboardEvent) => void) | null = null;

  private phraseCb: (text: string) => void = () => {};
  private drawingCb: (image: string) => void = () => {};
  private guessCb: (text: string) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
  }

  onPhrase(cb: (text: string) => void): void {
    this.phraseCb = cb;
  }
  onDrawing(cb: (image: string) => void): void {
    this.drawingCb = cb;
  }
  onGuess(cb: (text: string) => void): void {
    this.guessCb = cb;
  }

  // ---------- Carteles y countdown ----------

  showMessage(title: string, body: string, action?: { label: string; onClick: () => void }): void {
    this.teardown();
    this.root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "phase-container tc-message";
    const h = document.createElement("h2");
    h.innerHTML = title;
    const p = document.createElement("p");
    p.innerHTML = body;
    box.append(h, p);
    if (action) {
      const btn = document.createElement("button");
      btn.className = "action-button";
      btn.textContent = action.label;
      btn.onclick = action.onClick;
      box.appendChild(btn);
    }
    this.root.appendChild(box);
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl?.remove();
      this.countdownEl = null;
      return;
    }
    this.teardown();
    if (!this.countdownEl) {
      this.root.innerHTML = "";
      this.countdownEl = document.createElement("div");
      this.countdownEl.className = "countdown";
      this.root.appendChild(this.countdownEl);
    }
    this.countdownEl.textContent = text;
    // Reinicia la animacion de entrada en cada numero.
    this.countdownEl.classList.remove("countdown--pop");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("countdown--pop");
  }

  /** Monta el armazon fijo (topbar + cuerpo) una sola vez. */
  showStage(): void {
    this.showCountdown(null);
    if (this.stage) return;
    this.root.innerHTML = "";

    this.stage = document.createElement("div");
    this.stage.className = "phase-container tc-stage";

    const top = document.createElement("div");
    top.className = "top-bar";

    this.phaseLabel = document.createElement("h2");
    this.phaseLabel.textContent = "Telefono Cortado";

    const timer = document.createElement("div");
    timer.className = "timer-container";
    this.timerBar = document.createElement("div");
    this.timerBar.className = "timer-bar";
    this.timerText = document.createElement("div");
    this.timerText.className = "timer-text";
    timer.append(this.timerBar, this.timerText);

    top.append(this.phaseLabel, timer);

    this.roster = document.createElement("div");
    this.roster.className = "tc-roster";

    this.banner = document.createElement("div");
    this.banner.className = "tc-banner";
    this.banner.textContent = "Se corto la conexion con el servidor. Reconectando...";
    this.banner.hidden = true;

    this.body = document.createElement("div");
    this.body.className = "tc-body";

    this.stage.append(top, this.roster, this.banner, this.body);
    this.root.appendChild(this.stage);

    this.autoSubmitTimer = window.setInterval(() => this.checkAutoSubmit(), AUTO_SUBMIT_POLL_MS);
  }

  /** Aviso de conexion caida (socket.io reconecta solo; esto solo lo hace visible). */
  setConnection(up: boolean): void {
    if (this.banner) this.banner.hidden = up;
  }

  // ---------- Render ----------

  render(state: TcState, you: TcYou | null, me: string): void {
    this.showStage();
    this.renderRoster(state, me);
    this.renderClock(state);
    if (this.phaseLabel) this.phaseLabel.textContent = phaseTitle(state.phase);

    const seated = state.players.some((p) => p.nickname === me);
    const key = this.viewKeyFor(state, you, seated);
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.buildView(state, you, seated);
    } else {
      this.refreshView(you);
    }
  }

  /**
   * Firma de la vista: cambia solo cuando hay que reconstruir (otra fase, otra tarea,
   * o pasar de "editando" a "entregado"). La pista y el reloj NO entran: se refrescan
   * en su lugar sin tocar el resto. `you` llega en null mientras no llego la tarea de
   * ESTA fase (Game descarta la de la fase anterior), y eso es "cargando".
   */
  private viewKeyFor(state: TcState, you: TcYou | null, seated: boolean): string {
    const phase = state.phase;
    // La galeria sigue montada en "over": reconstruirla borraria las cadenas justo
    // cuando la gente las esta mirando.
    if (phase === "reveal" || phase === "over") return "gallery";
    if (phase === "waiting") return "waiting";
    if (!seated) return `spectator:${phase}`;
    if (!you) return `${phase}:loading`;
    if (phase === "writing") return `writing:${you.submitted !== null}`;
    if (phase === "drawing") return `drawing:${you.phrase ?? ""}:${you.submitted !== null}`;
    if (phase === "guessing") return `guessing:${(you.drawing ?? "").length}:${you.solved}`;
    return phase;
  }

  private buildView(state: TcState, you: TcYou | null, seated: boolean): void {
    if (!this.body) return;
    this.disposeCanvas();
    this.autoSubmit = null;
    this.hintEl = null;
    this.guessFeedback = null;
    this.gallery = null;
    this.body.innerHTML = "";

    if (state.phase === "reveal" || state.phase === "over") {
      this.buildReveal();
      return;
    }
    if (state.phase === "waiting") {
      this.body.appendChild(note("Esperando a que se conecten los demas..."));
      return;
    }
    if (!seated) {
      this.body.appendChild(
        note("La partida ya habia arrancado cuando entraste. Mira como termina: al final se ven todas las cadenas."),
      );
      return;
    }
    if (!you) {
      this.body.appendChild(note("Cargando..."));
      return;
    }

    switch (state.phase) {
      case "writing":
        this.buildWriting(you);
        break;
      case "drawing":
        this.buildDrawing(you);
        break;
      case "guessing":
        this.buildGuessing(you);
        break;
    }
  }

  /** Refresco barato entre snapshots de la misma vista. */
  private refreshView(you: TcYou | null): void {
    if (this.hintEl && you?.hint) renderHint(this.hintEl, you.hint);
  }

  // ---------- Fase: escribir ----------

  private buildWriting(you: TcYou): void {
    if (!this.body) return;
    if (you.submitted) {
      this.body.append(note("Frase enviada. Esperando a los demas..."), quote(you.submitted));
      return;
    }

    const title = document.createElement("p");
    title.className = "tc-prompt";
    title.textContent = "Escribi una frase para que otro la dibuje:";

    const tip = note("Algo que se pueda dibujar: una escena, un personaje haciendo algo raro.");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.maxLength = MAX_PHRASE_LEN;
    input.placeholder = "Ejemplo: Un perro en bicicleta";
    input.autocomplete = "off";

    const btn = document.createElement("button");
    btn.className = "action-button";
    btn.textContent = "Enviar";

    let sent = false;
    const send = (): boolean => {
      const text = input.value.trim();
      if (sent || !/[\p{L}\p{N}]/u.test(text)) return false;
      sent = true;
      btn.disabled = true;
      input.disabled = true;
      this.autoSubmit = null;
      this.phraseCb(text);
      return true;
    };
    btn.onclick = () => {
      if (!send()) input.focus();
    };
    // Enter se maneja EN EL INPUT y se corta ahi: si burbujeara hasta window
    // dispararia el countdown global que arranca el juego (bug del PR original).
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      send();
    });
    // Se acaba el tiempo con la frase tipeada y sin enviar: se manda igual. Si no
    // hay nada, el server le pone una del banco.
    this.autoSubmit = () => void send();

    this.body.append(title, tip, input, btn);
    input.focus();
  }

  // ---------- Fase: dibujar ----------

  private buildDrawing(you: TcYou): void {
    if (!this.body) return;
    if (you.submitted) {
      this.body.appendChild(note("Dibujo enviado. Esperando a los demas..."));
      const img = document.createElement("img");
      img.className = "tc-sent-drawing";
      img.src = you.submitted;
      img.alt = "Tu dibujo";
      this.body.appendChild(img);
      return;
    }
    if (!you.phrase) {
      this.body.appendChild(note("Esta vez no te toco ninguna frase para dibujar."));
      return;
    }

    const prompt = document.createElement("p");
    prompt.className = "tc-prompt";
    prompt.append("Dibuja: ");
    const phrase = document.createElement("span");
    phrase.className = "tc-prompt__phrase";
    phrase.textContent = `"${you.phrase}"`;
    prompt.appendChild(phrase);

    const tip = note("Sin letras ni numeros: que lo adivinen por el dibujo.");

    const workspace = document.createElement("div");
    workspace.className = "workspace";
    workspace.append(this.buildToolbox(), this.buildCanvas());

    const palette = document.createElement("div");
    palette.className = "palette";
    for (const color of PALETTE) {
      const btn = document.createElement("button");
      btn.className = `color-btn${this.color === color ? " active" : ""}`;
      btn.style.backgroundColor = color;
      btn.title = color;
      btn.setAttribute("aria-label", `Color ${color}`);
      btn.onclick = () => {
        this.color = color;
        // Elegir un color sale de la goma: pintar con la goma "de color" no existe.
        if (this.tool === "eraser") this.selectTool("pencil");
        for (const el of palette.querySelectorAll(".color-btn")) el.classList.remove("active");
        btn.classList.add("active");
      };
      palette.appendChild(btn);
    }

    const feedback = document.createElement("div");
    feedback.className = "tc-feedback";

    const submit = document.createElement("button");
    submit.className = "action-button";
    submit.textContent = "Terminar y enviar";

    let sent = false;
    const send = (auto: boolean): void => {
      if (sent) return;
      if (!this.dirty) {
        // Un lienzo en blanco no se puede adivinar: al cierre no se manda nada.
        if (!auto) feedback.textContent = "Dibuja algo antes de enviar.";
        return;
      }
      const image = this.exportDrawing();
      if (!image) return;
      sent = true;
      submit.disabled = true;
      this.autoSubmit = null;
      this.drawingCb(image);
    };
    submit.onclick = () => send(false);
    // Se acaba el tiempo: se manda lo que haya, aunque este a medio hacer.
    this.autoSubmit = () => send(true);

    this.body.append(prompt, tip, workspace, palette, feedback, submit);
  }

  private buildToolbox(): HTMLElement {
    const toolbox = document.createElement("div");
    toolbox.className = "toolbox";

    for (const t of TOOLS) {
      const btn = document.createElement("button");
      btn.className = `tool-btn${this.tool === t.id ? " active" : ""}`;
      btn.dataset.tool = t.id;
      btn.innerHTML = svg(TOOL_ICONS[t.id]);
      btn.title = t.title;
      btn.setAttribute("aria-label", t.title);
      btn.onclick = () => this.selectTool(t.id);
      toolbox.appendChild(btn);
    }

    const divider = document.createElement("div");
    divider.className = "toolbox-divider";
    toolbox.appendChild(divider);

    for (const size of THICKNESSES) {
      const btn = document.createElement("button");
      btn.className = `tool-btn thickness-btn${this.thickness === size ? " active" : ""}`;
      btn.title = "Grosor de linea";
      btn.setAttribute("aria-label", `Grosor ${size}`);
      const dot = document.createElement("div");
      dot.className = "thickness-circle";
      // El lienzo se muestra a la mitad o menos: el punto se dibuja a escala de pantalla.
      const px = Math.max(3, Math.round(size * 0.75));
      dot.style.width = `${px}px`;
      dot.style.height = `${px}px`;
      btn.appendChild(dot);
      btn.onclick = () => {
        this.thickness = size;
        for (const el of toolbox.querySelectorAll(".thickness-btn")) el.classList.remove("active");
        btn.classList.add("active");
      };
      toolbox.appendChild(btn);
    }

    const divider2 = document.createElement("div");
    divider2.className = "toolbox-divider";
    toolbox.appendChild(divider2);

    const undo = document.createElement("button");
    undo.className = "tool-btn";
    undo.innerHTML = svg(UNDO_ICON);
    undo.title = "Deshacer (Ctrl+Z)";
    undo.setAttribute("aria-label", "Deshacer");
    undo.onclick = () => this.undo();
    toolbox.appendChild(undo);

    const clear = document.createElement("button");
    clear.className = "tool-btn clear-btn";
    clear.innerHTML = svg(CLEAR_ICON);
    clear.title = "Borrar todo";
    clear.setAttribute("aria-label", "Borrar todo");
    clear.onclick = () => {
      if (!this.dirty) return;
      this.pushUndo();
      this.clearCanvas();
      this.dirty = false;
    };
    toolbox.appendChild(clear);

    return toolbox;
  }

  private selectTool(tool: Tool): void {
    this.tool = tool;
    for (const el of this.root.querySelectorAll<HTMLElement>(".tool-btn[data-tool]")) {
      el.classList.toggle("active", el.dataset.tool === tool);
    }
  }

  private buildCanvas(): HTMLElement {
    const holder = document.createElement("div");
    holder.className = "canvas-container";

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.className = "drawing-canvas";
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (this.ctx) {
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
    }
    this.clearCanvas();
    this.undoStack = [];
    this.dirty = false;

    // Pointer events con captura: un solo camino para mouse, dedo y lapiz, y el trazo
    // sigue aunque el puntero salga del lienzo (antes `mouseleave` lo cortaba y un
    // `mouseup` en window, que habia que acordarse de remover, lo terminaba).
    canvas.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary || e.button > 0 || this.isDrawing) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.pointerId = e.pointerId;
      this.pointerDown(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.pointerId) return;
      // Los eventos coalescidos dan las curvas rapidas con todos sus puntos.
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const ev of events.length > 0 ? events : [e]) this.pointerMove(ev);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.pointerUp();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    this.onUndoKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey)) return;
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.undo();
    };
    window.addEventListener("keydown", this.onUndoKey);

    holder.appendChild(canvas);
    return holder;
  }

  private disposeCanvas(): void {
    if (this.onUndoKey) {
      window.removeEventListener("keydown", this.onUndoKey);
      this.onUndoKey = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.isDrawing = false;
    this.pointerId = null;
    this.strokeBase = null;
    this.strokePoints = [];
    this.undoStack = [];
  }

  private clearCanvas(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private snapshot(): ImageData | null {
    if (!this.ctx || !this.canvas) return null;
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  private pushUndo(): void {
    const snap = this.snapshot();
    if (!snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  private undo(): void {
    if (!this.ctx || this.isDrawing) return;
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.ctx.putImageData(snap, 0, 0);
    if (this.undoStack.length === 0) this.dirty = false;
  }

  /** Coordenadas del evento en pixeles del lienzo (que se escala por CSS). */
  private pointAt(e: { clientX: number; clientY: number }): Point | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  private applyStrokeStyle(): void {
    if (!this.ctx) return;
    this.ctx.lineWidth = this.thickness;
    this.ctx.strokeStyle = this.tool === "eraser" ? "#ffffff" : this.color;
    this.ctx.globalAlpha = this.tool === "marker" ? MARKER_ALPHA : 1;
  }

  private pointerDown(e: { clientX: number; clientY: number }): void {
    if (!this.ctx || !this.canvas) return;
    const p = this.pointAt(e);
    if (!p) return;
    this.pushUndo();
    this.start = p;
    this.last = p;

    if (this.tool === "fill") {
      this.floodFill(Math.floor(p.x), Math.floor(p.y), this.color);
      this.dirty = true;
      return;
    }

    this.isDrawing = true;
    if (this.tool === "circle" || this.tool === "rect" || this.tool === "marker") {
      this.strokeBase = this.snapshot();
      this.strokePoints = [p];
    }
    if (this.tool !== "circle" && this.tool !== "rect") {
      // Un toque sin arrastrar tambien deja un punto (antes no dibujaba nada).
      this.drawSegment(p, p);
    }
  }

  private pointerMove(e: { clientX: number; clientY: number }): void {
    if (!this.isDrawing || !this.ctx) return;
    const p = this.pointAt(e);
    if (!p) return;

    if (this.tool === "circle" || this.tool === "rect") {
      if (this.strokeBase) this.ctx.putImageData(this.strokeBase, 0, 0);
      this.applyStrokeStyle();
      this.ctx.beginPath();
      const w = p.x - this.start.x;
      const h = p.y - this.start.y;
      if (this.tool === "rect") {
        this.ctx.strokeRect(this.start.x, this.start.y, w, h);
      } else {
        this.ctx.arc(this.start.x, this.start.y, Math.hypot(w, h), 0, Math.PI * 2);
        this.ctx.stroke();
      }
      this.dirty = true;
      return;
    }

    this.drawSegment(this.last, p);
    this.last = p;
  }

  /**
   * Trazo a mano alzada. Lapiz y goma son opacos y se pintan de a segmento. El
   * marcador es translucido: pintado de a segmento, cada superposicion suma opacidad
   * y el trazo sale manchado y casi opaco, asi que se repone el lienzo de antes y se
   * redibuja el trazo entero de una.
   */
  private drawSegment(from: Point, to: Point): void {
    if (!this.ctx) return;
    this.applyStrokeStyle();
    if (this.tool === "marker") {
      this.strokePoints.push(to);
      if (this.strokeBase) this.ctx.putImageData(this.strokeBase, 0, 0);
      this.ctx.beginPath();
      const [first, ...rest] = this.strokePoints;
      this.ctx.moveTo(first.x, first.y);
      if (rest.length === 0) this.ctx.lineTo(first.x + 0.01, first.y);
      for (const q of rest) this.ctx.lineTo(q.x, q.y);
      this.ctx.stroke();
    } else {
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      // Un segmento de largo cero con punta redonda es un punto.
      this.ctx.lineTo(to.x === from.x && to.y === from.y ? to.x + 0.01 : to.x, to.y);
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1;
    this.dirty = true;
  }

  private pointerUp(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.strokeBase = null;
    this.strokePoints = [];
    if (this.ctx) this.ctx.globalAlpha = 1;
  }

  /** Relleno por scanline vertical con tolerancia (el antialias del trazo no lo frena). */
  private floodFill(startX: number, startY: number, fillColor: string): void {
    if (!this.ctx || !this.canvas) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (startX < 0 || startY < 0 || startX >= width || startY >= height) return;

    const rFill = parseInt(fillColor.slice(1, 3), 16);
    const gFill = parseInt(fillColor.slice(3, 5), 16);
    const bFill = parseInt(fillColor.slice(5, 7), 16);

    const imgData = this.ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const startPos = (startY * width + startX) * 4;
    const startR = data[startPos];
    const startG = data[startPos + 1];
    const startB = data[startPos + 2];
    if (rFill === startR && gFill === startG && bFill === startB) return;

    const toleranceSq = 10000;
    const matches = (pos: number): boolean => {
      const dr = data[pos] - startR;
      const dg = data[pos + 1] - startG;
      const db = data[pos + 2] - startB;
      return dr * dr + dg * dg + db * db <= toleranceSq;
    };

    const stack: [number, number][] = [[startX, startY]];
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      let pos = (y * width + x) * 4;
      let cy = y;

      while (cy >= 0 && matches(pos)) {
        cy--;
        pos -= width * 4;
      }
      pos += width * 4;
      cy++;

      let reachLeft = false;
      let reachRight = false;
      while (cy < height && matches(pos)) {
        data[pos] = rFill;
        data[pos + 1] = gFill;
        data[pos + 2] = bFill;
        data[pos + 3] = 255;

        if (x > 0) {
          if (matches(pos - 4)) {
            if (!reachLeft) {
              stack.push([x - 1, cy]);
              reachLeft = true;
            }
          } else {
            reachLeft = false;
          }
        }
        if (x < width - 1) {
          if (matches(pos + 4)) {
            if (!reachRight) {
              stack.push([x + 1, cy]);
              reachRight = true;
            }
          } else {
            reachRight = false;
          }
        }
        cy++;
        pos += width * 4;
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
  }

  /** Exporta el lienzo reducido a JPEG (ver `constants.ts` para el porque). */
  private exportDrawing(): string | null {
    if (!this.canvas) return null;
    const off = document.createElement("canvas");
    off.width = EXPORT_WIDTH;
    off.height = EXPORT_HEIGHT;
    const octx = off.getContext("2d");
    if (!octx) return null;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, off.width, off.height);
    octx.drawImage(this.canvas, 0, 0, off.width, off.height);
    return off.toDataURL("image/jpeg", EXPORT_QUALITY);
  }

  // ---------- Fase: adivinar ----------

  private buildGuessing(you: TcYou): void {
    if (!this.body) return;
    if (!you.drawing) {
      this.body.appendChild(
        note("Esta vez no te toca adivinar ningun dibujo. Al final se ven todas las cadenas."),
      );
      return;
    }

    const img = document.createElement("img");
    img.className = "tc-guess-image";
    img.src = you.drawing;
    img.alt = "Dibujo a adivinar";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "hangman-hint";
    renderHint(this.hintEl, you.hint ?? "");

    if (you.solved) {
      this.body.append(note("Acertaste. Esperando a los demas..."), img, this.hintEl);
      return;
    }

    const prompt = document.createElement("p");
    prompt.className = "tc-prompt";
    prompt.textContent = "Que frase dibujaron?";

    const tip = note("No hace falta acertar los articulos ni los acentos. Cada tanto se destapa una letra.");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.maxLength = MAX_GUESS_LEN;
    input.placeholder = "Escribi la frase...";
    input.autocomplete = "off";

    const btn = document.createElement("button");
    btn.className = "action-button";
    btn.textContent = "Adivinar";

    this.guessFeedback = document.createElement("div");
    this.guessFeedback.className = "tc-feedback";

    const send = () => {
      const text = input.value.trim();
      if (text === "") return;
      // La comparacion la hace el SERVER: la frase correcta nunca llega al cliente
      // hasta el reveal, asi que no se puede espiar desde las devtools.
      this.guessCb(text);
      input.value = "";
      input.focus();
    };
    btn.onclick = send;
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      send();
    });

    this.body.append(img, this.hintEl, prompt, tip, input, btn, this.guessFeedback);
    input.focus();
  }

  /** Un intento fallido (lo decide el server). */
  showWrongGuess(text: string, close: boolean): void {
    if (!this.guessFeedback) return;
    this.guessFeedback.textContent = close
      ? `"${text}" esta muy cerca. Revisa como se escribe.`
      : `"${text}" no era. Segui intentando.`;
    this.guessFeedback.classList.toggle("tc-feedback--close", close);
    this.guessFeedback.classList.remove("tc-feedback--shake");
    void this.guessFeedback.offsetWidth; // reinicia la animacion
    this.guessFeedback.classList.add("tc-feedback--shake");
  }

  // ---------- Fase: reveal ----------

  private buildReveal(): void {
    if (!this.body) return;
    const title = document.createElement("p");
    title.className = "tc-prompt";
    title.textContent = "Asi llegaron las frases al final del telefono:";
    this.gallery = document.createElement("div");
    this.gallery.className = "tc-gallery";
    this.body.append(title, this.gallery);
    for (const chain of [...this.chains.values()].sort((a, b) => a.index - b.index)) {
      this.gallery.appendChild(chainCard(chain));
    }
    if (this.chains.size === 0) this.gallery.appendChild(note("Cargando las cadenas..."));
  }

  /** Las cadenas llegan de a una; se apilan aunque todavia no este montada la galeria. */
  addChain(chain: TcChainView): void {
    this.chains.set(chain.index, chain);
    if (!this.gallery) return;
    const placeholder = this.gallery.querySelector(".tc-note");
    placeholder?.remove();
    const card = chainCard(chain);
    const existing = this.gallery.querySelector(`[data-chain="${chain.index}"]`);
    if (existing) {
      existing.replaceWith(card);
      return;
    }
    // En orden de indice aunque lleguen desordenadas.
    const next = [...this.gallery.querySelectorAll<HTMLElement>("[data-chain]")].find(
      (el) => Number(el.dataset.chain) > chain.index,
    );
    this.gallery.insertBefore(card, next ?? null);
  }

  // ---------- Roster y reloj ----------

  private renderRoster(state: TcState, me: string): void {
    if (!this.roster) return;
    this.roster.innerHTML = "";
    const active = state.phase === "writing" || state.phase === "drawing" || state.phase === "guessing";
    for (const p of state.players) {
      const chip = document.createElement("div");
      chip.className = "tc-player";
      if (!p.connected) chip.classList.add("tc-player--off");
      if (active && p.done) chip.classList.add("tc-player--done");
      if (p.nickname === me) chip.classList.add("tc-player--me");
      const name = document.createElement("span");
      name.className = "tc-player__name";
      name.textContent = p.nickname;
      const pts = document.createElement("span");
      pts.className = "tc-player__pts";
      pts.textContent = String(p.total);
      chip.append(name, pts);
      this.roster.appendChild(chip);
    }
  }

  /**
   * Ancla el reloj del server a `performance.now()` y lo anima local: entre snapshots
   * la barra sigue bajando sola, y cada snapshot solo corrige el ancla (sin drift).
   */
  private renderClock(state: TcState): void {
    if (state.clockMs === null || state.clockTotalMs === null) {
      this.stopClock();
      if (this.timerText) this.timerText.textContent = "";
      if (this.timerBar) this.timerBar.style.width = "0%";
      return;
    }
    this.clockAnchor = { at: performance.now(), ms: state.clockMs, total: state.clockTotalMs };
    if (this.clockRaf === null) this.tickClock();
  }

  private clockLeft(): number | null {
    const anchor = this.clockAnchor;
    if (!anchor) return null;
    return Math.max(0, anchor.ms - (performance.now() - anchor.at));
  }

  private tickClock = (): void => {
    this.clockRaf = null;
    const anchor = this.clockAnchor;
    const left = this.clockLeft();
    if (!anchor || left === null || !this.timerBar || !this.timerText) return;
    const pct = anchor.total > 0 ? (left / anchor.total) * 100 : 0;
    this.timerBar.style.width = `${pct}%`;
    this.timerBar.classList.toggle("timer-bar--low", pct < 25);
    this.timerText.textContent = `${Math.ceil(left / 1000)}s`;
    this.clockRaf = requestAnimationFrame(this.tickClock);
  };

  /** Se llama con setInterval, no desde el rAF: el rAF se pausa en segundo plano. */
  private checkAutoSubmit(): void {
    if (!this.autoSubmit) return;
    const left = this.clockLeft();
    if (left === null || left > AUTO_SUBMIT_MARGIN_MS) return;
    const fire = this.autoSubmit;
    this.autoSubmit = null;
    fire();
  }

  private stopClock(): void {
    if (this.clockRaf !== null) cancelAnimationFrame(this.clockRaf);
    this.clockRaf = null;
    this.clockAnchor = null;
  }

  /** Libera lo que sobrevive fuera del DOM (listener global, rAF, intervalo). */
  teardown(): void {
    this.stopClock();
    this.disposeCanvas();
    if (this.autoSubmitTimer !== null) window.clearInterval(this.autoSubmitTimer);
    this.autoSubmitTimer = null;
    this.autoSubmit = null;
    this.stage = null;
    this.body = null;
    this.roster = null;
    this.banner = null;
    this.phaseLabel = null;
    this.timerBar = null;
    this.timerText = null;
    this.hintEl = null;
    this.guessFeedback = null;
    this.gallery = null;
    this.viewKey = "";
  }
}

// ---------- Helpers de DOM ----------

function phaseTitle(phase: TcPhase): string {
  switch (phase) {
    case "writing":
      return "Escribi tu frase";
    case "drawing":
      return "Dibujala";
    case "guessing":
      return "Adivina el dibujo";
    case "reveal":
      return "Las cadenas";
    case "over":
      return "Fin";
    default:
      return "Telefono Cortado";
  }
}

/**
 * Pista tipo ahorcado por palabras: cada letra es una casilla (las tapadas, un hueco
 * subrayado) y las palabras se separan y pueden bajar de renglon. Antes era el texto
 * con espacios intercalados, donde no se distinguia donde terminaba cada palabra.
 */
function renderHint(el: HTMLElement, hint: string): void {
  el.innerHTML = "";
  for (const word of hint.split(" ")) {
    if (word === "") continue;
    const w = document.createElement("span");
    w.className = "hint-word";
    for (const ch of word) {
      const c = document.createElement("span");
      c.className = ch === "_" ? "hint-char hint-char--blank" : "hint-char";
      c.textContent = ch === "_" ? "" : ch;
      w.appendChild(c);
    }
    el.appendChild(w);
  }
}

function note(text: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "tc-note";
  el.textContent = text;
  return el;
}

function quote(text: string): HTMLElement {
  const el = document.createElement("blockquote");
  el.className = "tc-quote";
  el.textContent = `"${text}"`;
  return el;
}

function chainCard(chain: TcChainView): HTMLElement {
  const card = document.createElement("figure");
  card.className = "tc-chain";
  card.dataset.chain = String(chain.index);
  card.style.setProperty("--i", String(chain.index));

  const author = document.createElement("div");
  author.className = "tc-chain__meta";
  author.textContent = chain.filled ? "Frase sorteada" : `${chain.author} escribio`;

  const phrase = document.createElement("div");
  phrase.className = "tc-chain__phrase";
  phrase.textContent = `"${chain.phrase}"`;

  card.append(author, phrase);

  if (chain.drawing) {
    const artist = document.createElement("figcaption");
    artist.className = "tc-chain__meta";
    artist.textContent = `${chain.artist ?? "Alguien"} lo dibujo asi`;
    const img = document.createElement("img");
    img.className = "tc-chain__img";
    img.src = chain.drawing;
    img.alt = `Dibujo de ${chain.artist ?? "nadie"}`;
    card.append(artist, img);
  } else {
    card.appendChild(note("Nadie llego a dibujarla."));
  }

  const outcome = document.createElement("div");
  outcome.className = `tc-chain__outcome${chain.solved ? " tc-chain__outcome--ok" : ""}`;
  if (!chain.drawing) outcome.textContent = "";
  else if (!chain.guesser) outcome.textContent = "A nadie le toco adivinarla";
  else if (chain.solved) outcome.textContent = `${chain.guesser} la acerto`;
  else if (chain.guess) outcome.textContent = `${chain.guesser} entendio "${chain.guess}"`;
  else outcome.textContent = `${chain.guesser} no arriesgo nada`;
  if (outcome.textContent !== "") card.appendChild(outcome);

  return card;
}
