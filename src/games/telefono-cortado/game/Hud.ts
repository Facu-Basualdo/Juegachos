import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  EXPORT_HEIGHT,
  EXPORT_QUALITY,
  EXPORT_WIDTH,
  MAX_GUESS_LEN,
  MAX_PHRASE_LEN,
  PALETTE,
  THICKNESSES,
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

const TOOLS: { id: Tool; title: string }[] = [
  { id: "pencil", title: "Lapiz" },
  { id: "marker", title: "Marcador" },
  { id: "fill", title: "Rellenar" },
  { id: "circle", title: "Circulo" },
  { id: "rect", title: "Rectangulo" },
  { id: "eraser", title: "Goma" },
];

function svg(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon">${paths}</svg>`;
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

  // Lienzo
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private tool: Tool = "pencil";
  private color = "#000000";
  private thickness = 3;
  private startX = 0;
  private startY = 0;
  private savedImage: ImageData | null = null;
  /** Listener global de mouseup: se remueve al desmontar el lienzo (evita el leak). */
  private onWindowMouseUp: (() => void) | null = null;

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
    h.textContent = title;
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

    this.body = document.createElement("div");
    this.body.className = "tc-body";

    this.stage.append(top, this.roster, this.body);
    this.root.appendChild(this.stage);
  }

  // ---------- Render ----------

  render(state: TcState, you: TcYou | null, me: string): void {
    this.showStage();
    this.renderRoster(state, me);
    this.renderClock(state);
    if (this.phaseLabel) this.phaseLabel.textContent = phaseTitle(state.phase);

    const key = this.viewKeyFor(state, you);
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.buildView(state, you);
    } else {
      this.refreshView(you);
    }
  }

  /**
   * Firma de la vista: cambia solo cuando hay que reconstruir (otra fase, otra tarea,
   * o pasar de "editando" a "entregado"). La pista y el reloj NO entran: se refrescan
   * en su lugar sin tocar el resto.
   */
  private viewKeyFor(state: TcState, you: TcYou | null): string {
    const phase = state.phase;
    if (phase === "writing") return `writing:${you?.submitted !== null && you?.submitted !== undefined}`;
    if (phase === "drawing") return `drawing:${you?.phrase ?? ""}:${you?.submitted !== null}`;
    if (phase === "guessing") return `guessing:${(you?.drawing ?? "").length}:${you?.solved ?? false}`;
    return phase;
  }

  private buildView(state: TcState, you: TcYou | null): void {
    if (!this.body) return;
    this.disposeCanvas();
    this.hintEl = null;
    this.guessFeedback = null;
    this.gallery = null;
    this.body.innerHTML = "";

    switch (state.phase) {
      case "waiting":
        this.body.appendChild(note("Esperando a que se conecten los demas..."));
        break;
      case "writing":
        this.buildWriting(you);
        break;
      case "drawing":
        this.buildDrawing(you);
        break;
      case "guessing":
        this.buildGuessing(you);
        break;
      case "reveal":
        this.buildReveal();
        break;
      case "over":
        this.body.appendChild(note("Se acabo. Mira los resultados de la ronda."));
        break;
    }
  }

  /** Refresco barato entre snapshots de la misma vista. */
  private refreshView(you: TcYou | null): void {
    if (this.hintEl && you?.hint) this.hintEl.textContent = spaced(you.hint);
  }

  // ---------- Fase: escribir ----------

  private buildWriting(you: TcYou | null): void {
    if (!this.body) return;
    if (you?.submitted) {
      this.body.append(
        note("Frase enviada. Esperando a los demas..."),
        quote(you.submitted),
      );
      return;
    }

    const title = document.createElement("p");
    title.className = "tc-prompt";
    title.textContent = "Escribi una frase para que otro la dibuje:";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.maxLength = MAX_PHRASE_LEN;
    input.placeholder = "Ejemplo: Un perro en bicicleta";

    const btn = document.createElement("button");
    btn.className = "action-button";
    btn.textContent = "Enviar";

    const send = () => {
      const text = input.value.trim();
      if (text === "") return;
      btn.disabled = true;
      this.phraseCb(text);
    };
    btn.onclick = send;
    // Enter se maneja EN EL INPUT y se corta ahi: si burbujeara hasta window
    // dispararia el countdown global que arranca el juego (bug del PR original).
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      send();
    });

    this.body.append(title, input, btn);
    input.focus();
  }

  // ---------- Fase: dibujar ----------

  private buildDrawing(you: TcYou | null): void {
    if (!this.body) return;
    if (you?.submitted) {
      this.body.appendChild(note("Dibujo enviado. Esperando a los demas..."));
      const img = document.createElement("img");
      img.className = "tc-sent-drawing";
      img.src = you.submitted;
      this.body.appendChild(img);
      return;
    }
    if (!you?.phrase) {
      this.body.appendChild(note("No te toco ninguna frase esta ronda."));
      return;
    }

    const prompt = document.createElement("p");
    prompt.className = "tc-prompt";
    prompt.textContent = `Dibuja: "${you.phrase}"`;

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
      btn.onclick = () => {
        this.color = color;
        // Elegir un color sale de la goma: pintar con la goma "de color" no existe.
        if (this.tool === "eraser") this.selectTool("pencil");
        for (const el of palette.querySelectorAll(".color-btn")) el.classList.remove("active");
        btn.classList.add("active");
      };
      palette.appendChild(btn);
    }

    const submit = document.createElement("button");
    submit.className = "action-button";
    submit.textContent = "Terminar y enviar";
    submit.onclick = () => {
      const image = this.exportDrawing();
      if (!image) return;
      submit.disabled = true;
      this.drawingCb(image);
    };

    this.body.append(prompt, workspace, palette, submit);
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
      const dot = document.createElement("div");
      dot.className = "thickness-circle";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      btn.appendChild(dot);
      btn.onclick = () => {
        this.thickness = size;
        for (const el of toolbox.querySelectorAll(".thickness-btn")) el.classList.remove("active");
        btn.classList.add("active");
      };
      toolbox.appendChild(btn);
    }

    const clear = document.createElement("button");
    clear.className = "tool-btn clear-btn";
    clear.innerHTML = svg(
      `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`,
    );
    clear.title = "Borrar todo";
    clear.onclick = () => this.clearCanvas();
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

    canvas.addEventListener("mousedown", (e) => this.pointerDown(e));
    canvas.addEventListener("mousemove", (e) => this.pointerMove(e));
    canvas.addEventListener("mouseleave", () => this.pointerUp());
    canvas.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        this.pointerDown(e.touches[0]);
      },
      { passive: false },
    );
    canvas.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        this.pointerMove(e.touches[0]);
      },
      { passive: false },
    );
    canvas.addEventListener("touchend", () => this.pointerUp());

    // Soltar el boton fuera del lienzo tambien termina el trazo. Se guarda para
    // removerlo al desmontar: el PR original lo agregaba en cada render y nunca lo
    // sacaba, acumulando un listener por cada fase de dibujo.
    this.onWindowMouseUp = () => this.pointerUp();
    window.addEventListener("mouseup", this.onWindowMouseUp);

    holder.appendChild(canvas);
    return holder;
  }

  private disposeCanvas(): void {
    if (this.onWindowMouseUp) {
      window.removeEventListener("mouseup", this.onWindowMouseUp);
      this.onWindowMouseUp = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.isDrawing = false;
    this.savedImage = null;
  }

  private clearCanvas(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Coordenadas del evento en pixeles del lienzo (que se escala por CSS). */
  private pointAt(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  private pointerDown(e: { clientX: number; clientY: number } | undefined): void {
    if (!e || !this.ctx || !this.canvas) return;
    const p = this.pointAt(e);
    if (!p) return;
    this.startX = p.x;
    this.startY = p.y;

    if (this.tool === "fill") {
      this.isDrawing = false;
      this.floodFill(Math.floor(p.x), Math.floor(p.y), this.color);
      return;
    }

    this.isDrawing = true;
    if (this.tool === "circle" || this.tool === "rect") {
      this.savedImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.ctx.beginPath();
      this.ctx.moveTo(p.x, p.y);
    }
  }

  private pointerMove(e: { clientX: number; clientY: number } | undefined): void {
    if (!e || !this.isDrawing || !this.ctx || !this.canvas) return;
    const p = this.pointAt(e);
    if (!p) return;

    this.ctx.lineWidth = this.thickness;
    this.ctx.strokeStyle = this.tool === "eraser" ? "#ffffff" : this.color;
    this.ctx.globalAlpha = this.tool === "marker" ? 0.3 : 1;

    if (this.tool === "circle" || this.tool === "rect") {
      if (this.savedImage) this.ctx.putImageData(this.savedImage, 0, 0);
      this.ctx.beginPath();
      const w = p.x - this.startX;
      const h = p.y - this.startY;
      if (this.tool === "rect") {
        this.ctx.strokeRect(this.startX, this.startY, w, h);
      } else {
        this.ctx.arc(this.startX, this.startY, Math.hypot(w, h), 0, Math.PI * 2);
        this.ctx.stroke();
      }
    } else {
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
    }
  }

  private pointerUp(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.savedImage = null;
    if (this.ctx) {
      this.ctx.globalAlpha = 1;
      this.ctx.beginPath();
    }
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

  private buildGuessing(you: TcYou | null): void {
    if (!this.body) return;
    if (!you?.drawing) {
      this.body.appendChild(note("No te toco ningun dibujo esta ronda."));
      return;
    }

    const img = document.createElement("img");
    img.className = "tc-guess-image";
    img.src = you.drawing;
    img.alt = "Dibujo a adivinar";

    this.hintEl = document.createElement("div");
    this.hintEl.className = "hangman-hint";
    this.hintEl.textContent = spaced(you.hint ?? "");

    if (you.solved) {
      this.body.append(note("Acertaste. Esperando a los demas..."), img, this.hintEl);
      return;
    }

    const prompt = document.createElement("p");
    prompt.className = "tc-prompt";
    prompt.textContent = "Que dibujaron aca?";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.maxLength = MAX_GUESS_LEN;
    input.placeholder = "Adivina la frase...";

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

    this.body.append(prompt, this.hintEl, img, input, btn, this.guessFeedback);
    input.focus();
  }

  /** Un intento fallido (lo decide el server). */
  showWrongGuess(text: string): void {
    if (!this.guessFeedback) return;
    this.guessFeedback.textContent = `"${text}" no era. Segui intentando.`;
    this.guessFeedback.classList.remove("tc-feedback--shake");
    void this.guessFeedback.offsetWidth; // reinicia la animacion
    this.guessFeedback.classList.add("tc-feedback--shake");
  }

  // ---------- Fase: reveal ----------

  private buildReveal(): void {
    if (!this.body) return;
    const title = document.createElement("p");
    title.className = "tc-prompt";
    title.textContent = "Como quedaron las cadenas:";
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
    const existing = this.gallery.querySelector(`[data-chain="${chain.index}"]`);
    if (existing) existing.replaceWith(chainCard(chain));
    else this.gallery.appendChild(chainCard(chain));
  }

  // ---------- Roster y reloj ----------

  private renderRoster(state: TcState, me: string): void {
    if (!this.roster) return;
    this.roster.innerHTML = "";
    for (const p of state.players) {
      const chip = document.createElement("div");
      chip.className = "tc-player";
      if (!p.connected) chip.classList.add("tc-player--off");
      if (p.done) chip.classList.add("tc-player--done");
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

  private tickClock = (): void => {
    this.clockRaf = null;
    const anchor = this.clockAnchor;
    if (!anchor || !this.timerBar || !this.timerText) return;
    const left = Math.max(0, anchor.ms - (performance.now() - anchor.at));
    const pct = anchor.total > 0 ? (left / anchor.total) * 100 : 0;
    this.timerBar.style.width = `${pct}%`;
    this.timerBar.style.backgroundColor = pct < 25 ? "#ff3333" : "";
    this.timerText.textContent = `${Math.ceil(left / 1000)}s`;
    this.clockRaf = requestAnimationFrame(this.tickClock);
  };

  private stopClock(): void {
    if (this.clockRaf !== null) cancelAnimationFrame(this.clockRaf);
    this.clockRaf = null;
    this.clockAnchor = null;
  }

  /** Libera lo que sobrevive fuera del DOM (listener global, rAF). */
  teardown(): void {
    this.stopClock();
    this.disposeCanvas();
    this.stage = null;
    this.body = null;
    this.roster = null;
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

/** La pista se separa para que se lean los guiones bajos como huecos. */
function spaced(hint: string): string {
  return hint.split("").join(" ");
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

  const phrase = document.createElement("div");
  phrase.className = "tc-chain__phrase";
  phrase.textContent = `"${chain.phrase}"`;

  const author = document.createElement("div");
  author.className = "tc-chain__meta";
  author.textContent = chain.filled ? "Frase automatica" : `Frase de ${chain.author}`;

  card.append(phrase, author);

  if (chain.drawing) {
    const img = document.createElement("img");
    img.className = "tc-chain__img";
    img.src = chain.drawing;
    img.alt = `Dibujo de ${chain.artist ?? "nadie"}`;
    const artist = document.createElement("figcaption");
    artist.className = "tc-chain__meta";
    artist.textContent = `Dibujo de ${chain.artist ?? "nadie"}`;
    card.append(img, artist);
  } else {
    card.appendChild(note("Nadie llego a dibujarla."));
  }

  const outcome = document.createElement("div");
  outcome.className = `tc-chain__outcome${chain.solved ? " tc-chain__outcome--ok" : ""}`;
  if (!chain.guesser) outcome.textContent = "Nadie la adivino";
  else if (chain.solved) outcome.textContent = `${chain.guesser} la acerto`;
  else if (chain.guess) outcome.textContent = `${chain.guesser} dijo "${chain.guess}"`;
  else outcome.textContent = `${chain.guesser} no dijo nada`;
  card.appendChild(outcome);

  return card;
}
