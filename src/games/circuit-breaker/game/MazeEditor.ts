// Editor visual del laberinto (solo dev). Se abre con ?edit=1 en el juego.
// Pintas corredores/paredes, ubicas el inicio (A) y el destino (B), y "Copiar mapa"
// exporta el bitmap listo para pegar en levels.ts (LEVEL_1_MAP).
import { getLevel } from "./levels";
import {
  COLOR_BG,
  COLOR_COPPER,
  COLOR_CHANNEL,
  COLOR_EDGE,
  COLOR_SOURCE,
  COLOR_DEST,
} from "./constants";

type Tool = "corridor" | "wall" | "start" | "end" | "timer";

export class MazeEditor {
  private cols: number;
  private rows: number;
  private wall: boolean[][]; // [y][x] true = pared
  private start = { x: 1, y: 1 };
  private end = { x: 1, y: 1 };
  private timer: { x: number; y: number } | null = null; // ancla del HUD (cronometro)

  private tool: Tool = "corridor";
  private brush = 3;
  private levelNum = 1;
  private painting = false;
  private cellPx = 20;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly statusEl: HTMLDivElement;
  private readonly exportEl: HTMLTextAreaElement;
  private readonly toolBtns = new Map<Tool, HTMLButtonElement>();

  constructor(container: HTMLElement) {
    const lvl = getLevel();
    this.cols = lvl.cols;
    this.rows = lvl.rows;
    this.wall = lvl.grid.map((row) => row.split("").map((c) => c === "#"));
    this.start = { ...lvl.start };
    this.end = { ...lvl.end };
    this.timer = lvl.hud ? { ...lvl.hud } : null;

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      background: COLOR_BG,
      display: "flex",
      flexDirection: "column",
      fontFamily: "monospace",
      color: "#cfe",
      overflow: "hidden",
    } as CSSStyleDeclaration);

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      alignItems: "center",
      padding: "8px 10px",
      background: "#07231a",
      borderBottom: `1px solid ${COLOR_EDGE}`,
      fontSize: "12px",
    } as CSSStyleDeclaration);

    // Herramientas.
    const tools: [Tool, string][] = [
      ["corridor", "Corredor"],
      ["wall", "Pared"],
      ["start", "Inicio A"],
      ["end", "Destino B"],
      ["timer", "Cronometro"],
    ];
    for (const [t, label] of tools) {
      const b = this.mkBtn(label, () => this.setTool(t));
      this.toolBtns.set(t, b);
      bar.append(b);
    }

    // Pincel.
    const brushWrap = document.createElement("label");
    brushWrap.style.marginLeft = "8px";
    brushWrap.textContent = "Pincel ";
    const brushInput = document.createElement("input");
    brushInput.type = "range";
    brushInput.min = "1";
    brushInput.max = "7";
    brushInput.value = String(this.brush);
    brushInput.style.verticalAlign = "middle";
    const brushVal = document.createElement("span");
    brushVal.textContent = ` ${this.brush}`;
    brushInput.addEventListener("input", () => {
      this.brush = Number(brushInput.value);
      brushVal.textContent = ` ${this.brush}`;
    });
    brushWrap.append(brushInput, brushVal);
    bar.append(brushWrap);

    // Tamano de grilla.
    const sizeWrap = document.createElement("span");
    sizeWrap.style.marginLeft = "8px";
    const colsIn = this.mkNum(this.cols);
    const rowsIn = this.mkNum(this.rows);
    const applyBtn = this.mkBtn("Aplicar tamano", () =>
      this.resizeGrid(Number(colsIn.value), Number(rowsIn.value)),
    );
    sizeWrap.append("cols ", colsIn, " filas ", rowsIn, " ", applyBtn);
    bar.append(sizeWrap);

    // Nivel (para cargar/exportar con el numero correcto).
    const levelWrap = document.createElement("span");
    levelWrap.style.marginLeft = "8px";
    const levelIn = this.mkNum(this.levelNum);
    levelIn.min = "1";
    levelIn.max = "9";
    levelIn.style.width = "44px";
    levelIn.addEventListener("input", () => {
      this.levelNum = Math.max(1, Number(levelIn.value) || 1);
    });
    levelWrap.append("Nivel ", levelIn);
    bar.append(levelWrap);

    // Acciones.
    bar.append(
      this.mkBtn("Vaciar (todo pared)", () => this.fillAll(true)),
      this.mkBtn("Rellenar (todo corredor)", () => this.fillAll(false)),
      this.mkBtn("Cargar nivel", () => this.loadCurrent()),
      this.mkBtn("Copiar mapa", () => this.copyMap()),
    );

    this.statusEl = document.createElement("div");
    this.statusEl.style.marginLeft = "8px";
    bar.append(this.statusEl);

    root.append(bar);

    // Canvas.
    const canvasWrap = document.createElement("div");
    Object.assign(canvasWrap.style, {
      flex: "1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "auto",
      padding: "10px",
    } as CSSStyleDeclaration);
    this.canvas = document.createElement("canvas");
    this.canvas.style.touchAction = "none";
    this.canvas.style.cursor = "crosshair";
    canvasWrap.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    root.append(canvasWrap);

    // Export.
    this.exportEl = document.createElement("textarea");
    Object.assign(this.exportEl.style, {
      height: "90px",
      margin: "0 10px 10px",
      background: "#04120c",
      color: "#8fe",
      border: `1px solid ${COLOR_EDGE}`,
      fontFamily: "monospace",
      fontSize: "11px",
      whiteSpace: "pre",
    } as CSSStyleDeclaration);
    this.exportEl.readOnly = true;
    this.exportEl.placeholder = "Aca aparece el mapa exportado (o usa 'Copiar mapa').";
    root.append(this.exportEl);

    container.append(root);

    this.bindCanvas();
    this.setTool("corridor");
    window.addEventListener("resize", () => this.layout());
    this.layout();
  }

  private mkBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      background: "#0d3325",
      color: "#cfe",
      border: `1px solid ${COLOR_EDGE}`,
      borderRadius: "4px",
      padding: "5px 8px",
      cursor: "pointer",
      fontFamily: "monospace",
      fontSize: "12px",
    } as CSSStyleDeclaration);
    b.addEventListener("click", onClick);
    return b;
  }

  private mkNum(value: number): HTMLInputElement {
    const i = document.createElement("input");
    i.type = "number";
    i.min = "5";
    i.max = "120";
    i.value = String(value);
    i.style.width = "56px";
    return i;
  }

  private setTool(t: Tool): void {
    this.tool = t;
    for (const [key, btn] of this.toolBtns) {
      btn.style.background = key === t ? COLOR_EDGE : "#0d3325";
      btn.style.color = key === t ? "#04120c" : "#cfe";
    }
  }

  private resizeGrid(cols: number, rows: number): void {
    cols = Math.max(5, Math.min(120, cols || this.cols));
    rows = Math.max(5, Math.min(120, rows || this.rows));
    const next: boolean[][] = Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => (this.wall[y]?.[x] ?? true)),
    );
    this.cols = cols;
    this.rows = rows;
    this.wall = next;
    this.start.x = Math.min(this.start.x, cols - 1);
    this.start.y = Math.min(this.start.y, rows - 1);
    this.end.x = Math.min(this.end.x, cols - 1);
    this.end.y = Math.min(this.end.y, rows - 1);
    this.layout();
  }

  private fillAll(w: boolean): void {
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) this.wall[y][x] = w;
    if (!w) {
      this.wall[this.start.y][this.start.x] = false;
      this.wall[this.end.y][this.end.x] = false;
    }
    this.render();
  }

  private loadCurrent(): void {
    const lvl = getLevel(this.levelNum);
    this.resizeGrid(lvl.cols, lvl.rows);
    this.wall = lvl.grid.map((row) => row.split("").map((c) => c === "#"));
    this.start = { ...lvl.start };
    this.end = { ...lvl.end };
    this.timer = lvl.hud ? { ...lvl.hud } : null;
    this.render();
  }

  private bindCanvas(): void {
    const paintAt = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / this.cellPx);
      const y = Math.floor((e.clientY - rect.top) / this.cellPx);
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      this.apply(x, y);
      this.render();
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      this.painting = true;
      this.canvas.setPointerCapture(e.pointerId);
      paintAt(e);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.painting) paintAt(e);
    });
    const end = () => {
      this.painting = false;
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
  }

  private apply(cx: number, cy: number): void {
    if (this.tool === "start") {
      this.start = { x: cx, y: cy };
      this.wall[cy][cx] = false;
      return;
    }
    if (this.tool === "end") {
      this.end = { x: cx, y: cy };
      this.wall[cy][cx] = false;
      return;
    }
    if (this.tool === "timer") {
      this.timer = { x: cx, y: cy }; // no cambia pared/corredor (es solo el ancla del HUD)
      return;
    }
    const w = this.tool === "wall";
    const half = Math.floor(this.brush / 2);
    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) {
        const x = cx + i;
        const y = cy + j;
        if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) this.wall[y][x] = w;
      }
    }
  }

  private layout(): void {
    const availW = window.innerWidth - 40;
    const availH = window.innerHeight - 190;
    this.cellPx = Math.max(6, Math.floor(Math.min(availW / this.cols, availH / this.rows)));
    this.canvas.width = this.cols * this.cellPx;
    this.canvas.height = this.rows * this.cellPx;
    this.render();
  }

  private render(): void {
    const { ctx, cellPx } = this;
    ctx.fillStyle = COLOR_COPPER;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Corredores.
    ctx.fillStyle = COLOR_CHANNEL;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!this.wall[y][x]) ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }
    // Grilla.
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= this.cols; x++) {
      ctx.moveTo(x * cellPx, 0);
      ctx.lineTo(x * cellPx, this.canvas.height);
    }
    for (let y = 0; y <= this.rows; y++) {
      ctx.moveTo(0, y * cellPx);
      ctx.lineTo(this.canvas.width, y * cellPx);
    }
    ctx.stroke();
    // Cronometro (ancla del HUD), A y B.
    if (this.timer) this.drawClock(this.timer);
    this.drawMarker(this.start, COLOR_SOURCE, "A");
    this.drawMarker(this.end, COLOR_DEST, "B");
    this.updateStatus();
  }

  /** Marca del cronometro: un reloj sobre la celda ancla del HUD. */
  private drawClock(c: { x: number; y: number }): void {
    const { ctx, cellPx } = this;
    const cx = (c.x + 0.5) * cellPx;
    const cy = (c.y + 0.5) * cellPx;
    const r = cellPx * 0.4;
    ctx.save();
    ctx.strokeStyle = "#ffd27a";
    ctx.fillStyle = "rgba(255, 210, 122, 0.18)";
    ctx.lineWidth = Math.max(1.5, cellPx * 0.09);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Boton superior.
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - r - cellPx * 0.16);
    ctx.stroke();
    // Agujas.
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - r * 0.6);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * 0.5, cy);
    ctx.stroke();
    ctx.restore();
  }

  private drawMarker(c: { x: number; y: number }, color: string, label: string): void {
    const { ctx, cellPx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc((c.x + 0.5) * cellPx, (c.y + 0.5) * cellPx, cellPx * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#04120c";
    ctx.font = `bold ${Math.floor(cellPx * 0.7)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, (c.x + 0.5) * cellPx, (c.y + 0.6) * cellPx);
  }

  /** BFS A->B sobre corredores para avisar si el laberinto es resoluble. */
  private reachable(): boolean {
    if (this.wall[this.start.y][this.start.x] || this.wall[this.end.y][this.end.x]) return false;
    const seen = new Set<number>([this.start.y * this.cols + this.start.x]);
    const q = [this.start];
    while (q.length) {
      const { x, y } = q.shift()!;
      if (x === this.end.x && y === this.end.y) return true;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        if (this.wall[ny][nx]) continue;
        const k = ny * this.cols + nx;
        if (seen.has(k)) continue;
        seen.add(k);
        q.push({ x: nx, y: ny });
      }
    }
    return false;
  }

  private updateStatus(): void {
    const ok = this.reachable();
    this.statusEl.textContent = `${this.cols}x${this.rows}  A->B: ${ok ? "OK" : "BLOQUEADO"}`;
    this.statusEl.style.color = ok ? COLOR_SOURCE : "#ff6b6b";
  }

  private buildMap(): string[] {
    const lines: string[] = [];
    for (let y = 0; y < this.rows; y++) {
      let s = "";
      for (let x = 0; x < this.cols; x++) {
        if (x === this.start.x && y === this.start.y) s += "A";
        else if (x === this.end.x && y === this.end.y) s += "B";
        else if (this.timer && x === this.timer.x && y === this.timer.y)
          s += this.wall[y][x] ? "T" : "t"; // ancla del HUD (T sobre pared, t sobre corredor)
        else s += this.wall[y][x] ? "#" : ".";
      }
      lines.push(s);
    }
    return lines;
  }

  private copyMap(): void {
    const map = this.buildMap();
    const text =
      `const LEVEL_${this.levelNum}_MAP = [\n` + map.map((l) => `  "${l}",`).join("\n") + "\n];";
    this.exportEl.value = text;
    this.exportEl.select();
    void navigator.clipboard?.writeText(text).catch(() => {});
    const ok = this.reachable();
    this.statusEl.textContent = ok ? "Copiado (A->B OK)" : "Copiado - OJO: A->B BLOQUEADO";
    this.statusEl.style.color = ok ? COLOR_SOURCE : "#ff6b6b";
  }
}
