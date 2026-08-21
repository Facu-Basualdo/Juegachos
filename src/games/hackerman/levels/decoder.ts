import { SoundEffects } from "../game/SoundEffects";
import { type HackLevel, type LevelContext } from "./types";

/**
 * Nivel 2 — Decodificador (inspirado en el "Connecting to the host" de GTA).
 *
 * Arriba hay un CODIGO de `CODE_LEN` numeros de dos digitos (estilo IP:
 * "48.93.63.06"). Abajo, una grilla de numeros que **se desliza sola cada
 * `SCRAMBLE_SEC` segundos** (como en el original): toda la grilla se corre una
 * celda hacia izquierda/derecha/arriba/abajo (con wrap toroidal), arrastrando el
 * codigo, asi que hay que engancharlo mientras se mueve. El cursor arrastra una
 * "ventana" de `CODE_LEN` celdas y **da la vuelta** (si sale por un borde entra
 * por el opuesto, estilo loop), por lo que la ventana puede atravesar la pared.
 * Cuando la ventana coincide con el codigo, Enter la valida. Errar solo suena
 * (no marca nada). Se descifran `CODES` codigos para completar el nivel.
 */

const ROWS = 8;
const COLS = 10;
const CODE_LEN = 4;
const CODES = 1;
const SCRAMBLE_SEC = 3; // cada cuanto se reorganiza la grilla

function two(n: number): string {
  return n.toString().padStart(2, "0");
}

export class DecoderLevel implements HackLevel {
  readonly id = "decoder";
  readonly title = "DECODIFICADOR";
  readonly controls = "Flechas para mover el cursor. Enter valida la corrida antes de que la grilla se reorganice.";

  private codeEl!: HTMLDivElement;
  private gridEl!: HTMLDivElement;
  private barEl!: HTMLDivElement;
  private timerEl!: HTMLDivElement;
  private cells: HTMLDivElement[] = [];

  private grid: string[][] = [];
  private code: string[] = [];
  private cursorRow = 0;
  private cursorCol = 0;
  private solved = 0;
  private busy = false;
  private wrongTimer: number | null = null;
  private scrambleLeft = SCRAMBLE_SEC;
  private readonly ctx: LevelContext;

  constructor(ctx: LevelContext) {
    this.ctx = ctx;
  }

  mount(host: HTMLElement): void {
    host.innerHTML = "";

    const container = document.createElement("div");
    container.className = "gta-container";

    // Top Blue Bar
    const topBar = document.createElement("div");
    topBar.className = "gta-blue-bar";

    // Header
    const header = document.createElement("div");
    header.className = "gta-header";

    const left = document.createElement("div");
    left.className = "gta-header__left";
    const lockIcon = document.createElement("div");
    lockIcon.className = "gta-lock-icon";
    const texts = document.createElement("div");
    texts.className = "gta-header__texts";
    const title = document.createElement("div");
    title.className = "gta-header__title";
    title.textContent = "CONNECTING TO THE HOST";
    const subtitle = document.createElement("div");
    subtitle.className = "gta-header__subtitle";
    subtitle.textContent = "COMPROMISING GLOBAL SECURITY ONE SLIP AT A TIME";
    texts.append(title, subtitle);
    left.append(lockIcon, texts);

    const right = document.createElement("div");
    right.className = "gta-header__right";
    this.timerEl = document.createElement("div");
    this.timerEl.className = "gta-header__timer";
    this.timerEl.textContent = "00:00:000";
    
    const signal = document.createElement("div");
    signal.className = "gta-signal active";
    for (let i = 0; i < 5; i++) {
      const bar = document.createElement("div");
      bar.className = "gta-signal__bar";
      signal.appendChild(bar);
    }
    right.append(this.timerEl, signal);
    header.append(left, right);

    // Main Body
    const decBody = document.createElement("div");
    decBody.className = "dec-body";

    this.codeEl = document.createElement("div");
    this.codeEl.className = "dec__code";

    // Scramble bar
    const scramble = document.createElement("div");
    scramble.className = "dec__scramble";
    const scrambleLabel = document.createElement("span");
    scrambleLabel.className = "dec__scramble-label";
    scrambleLabel.textContent = "REORGANIZANDO";
    const track = document.createElement("div");
    track.className = "dec__scramble-track";
    this.barEl = document.createElement("div");
    this.barEl.className = "dec__scramble-bar";
    track.appendChild(this.barEl);
    scramble.append(scrambleLabel, track);

    this.gridEl = document.createElement("div");
    this.gridEl.className = "dec__grid";
    this.gridEl.style.setProperty("--cols", String(COLS));

    decBody.append(this.codeEl, scramble, this.gridEl);

    // Bottom Blue Bar
    const bottomBar = document.createElement("div");
    bottomBar.className = "gta-blue-bar";

    container.append(topBar, header, decBody, bottomBar);
    host.appendChild(container);
  }

  begin(): void {
    this.clearWrongTimer();
    this.solved = 0;
    this.busy = false;
    this.newCode();
  }

  private newCode(): void {
    this.code = [];
    for (let i = 0; i < CODE_LEN; i++) this.code.push(two(Math.floor(Math.random() * 100)));

    this.plantGrid();
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrambleLeft = SCRAMBLE_SEC;
    this.renderCode();
    this.buildGrid();
    this.renderCursor();
    this.updateStatus();
  }

  private plantGrid(): void {
    this.grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row: string[] = [];
      for (let c = 0; c < COLS; c++) row.push(two(Math.floor(Math.random() * 100)));
      this.grid.push(row);
    }
    const plantRow = Math.floor(Math.random() * ROWS);
    const plantCol = Math.floor(Math.random() * (COLS - CODE_LEN + 1));
    for (let i = 0; i < CODE_LEN; i++) this.grid[plantRow][plantCol + i] = this.code[i];
  }

  private static readonly SHIFTS: [number, number, string][] = [
    [0, -1, "left"],
    [0, 1, "right"],
    [-1, 0, "up"],
    [1, 0, "down"],
  ];

  private scramble(): void {
    const [dRow, dCol, cls] = DecoderLevel.SHIFTS[Math.floor(Math.random() * 4)];
    const next: string[][] = [];
    for (let r = 0; r < ROWS; r++) {
      const row: string[] = [];
      for (let c = 0; c < COLS; c++) {
        const sr = (r - dRow + ROWS) % ROWS;
        const sc = (c - dCol + COLS) % COLS;
        row.push(this.grid[sr][sc]);
      }
      next.push(row);
    }
    this.grid = next;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) this.cells[r * COLS + c].textContent = this.grid[r][c];
    }
    this.renderCursor();
    this.gridEl.classList.remove("shift-left", "shift-right", "shift-up", "shift-down");
    void this.gridEl.offsetWidth;
    this.gridEl.classList.add(`shift-${cls}`);
    SoundEffects.playCycle();
  }

  update(dt: number): void {
    if (this.busy) return;
    this.scrambleLeft -= dt;
    if (this.scrambleLeft <= 0) {
      this.scrambleLeft = SCRAMBLE_SEC;
      this.scramble();
    }
    this.barEl.style.width = `${Math.max(0, (this.scrambleLeft / SCRAMBLE_SEC) * 100)}%`;
  }

  updateTime(centis: number): void {
    if (this.timerEl) {
      const min = Math.floor(centis / 6000);
      const sec = Math.floor((centis % 6000) / 100);
      const ms = (centis % 100) * 10;
      this.timerEl.textContent = `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}:${ms.toString().padStart(3, "0")}`;
    }
  }

  private renderCode(): void {
    this.codeEl.innerHTML = "";
    this.code.forEach((n, i) => {
      if (i > 0) {
        const dot = document.createElement("span");
        dot.className = "dec__dot";
        dot.textContent = ".";
        this.codeEl.appendChild(dot);
      }
      const span = document.createElement("span");
      span.className = "dec__code-num";
      span.textContent = n;
      this.codeEl.appendChild(span);
    });
  }

  private buildGrid(): void {
    this.gridEl.innerHTML = "";
    this.cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("div");
        cell.className = "dec__cell";
        cell.textContent = this.grid[r][c];
        const rr = r;
        const cc = c;
        cell.addEventListener("click", () => {
          this.cursorRow = rr;
          this.cursorCol = cc;
          this.renderCursor();
          this.confirm();
        });
        this.cells.push(cell);
        this.gridEl.appendChild(cell);
      }
    }
  }

  private renderCursor(): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = this.cells[r * COLS + c];
        const fwd = (c - this.cursorCol + COLS) % COLS;
        const inWindow = r === this.cursorRow && fwd < CODE_LEN;
        cell.classList.toggle("is-window", inWindow);
        cell.classList.toggle("is-cursor", r === this.cursorRow && c === this.cursorCol);
      }
    }
  }

  private moveCursor(dr: number, dc: number): void {
    this.cursorRow = (this.cursorRow + dr + ROWS) % ROWS;
    this.cursorCol = (this.cursorCol + dc + COLS) % COLS;
    this.renderCursor();
    SoundEffects.playMove();
  }

  private confirm(): void {
    if (this.busy) return;
    let match = true;
    for (let i = 0; i < CODE_LEN; i++) {
      if (this.grid[this.cursorRow][(this.cursorCol + i) % COLS] !== this.code[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      SoundEffects.playLock();
      for (let i = 0; i < CODE_LEN; i++) {
        const idx = this.cursorRow * COLS + ((this.cursorCol + i) % COLS);
        this.cells[idx].classList.add("is-hit");
      }
      this.solved++;
      this.ctx.onProgress();
      this.updateStatus();
      if (this.solved >= CODES) {
        this.ctx.onSolved();
        return;
      }
      this.busy = true;
      this.wrongTimer = window.setTimeout(() => {
        this.busy = false;
        this.wrongTimer = null;
        this.newCode();
      }, 400);
    } else {
      // Miss: solo feedback sonoro. No se marca ninguna celda en rojo ni se
      // bloquea el input (podes reintentar al toque mientras la grilla se mueve).
      SoundEffects.playError();
    }
  }

  private updateStatus(): void {
    this.ctx.setStatus(
      CODES > 1 ? `CODIGO ${Math.min(this.solved + 1, CODES)}/${CODES}` : "SECUENCIA REQUERIDA"
    );
  }

  handleKey(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        this.moveCursor(-1, 0);
        break;
      case "ArrowDown":
      case "s":
      case "S":
        this.moveCursor(1, 0);
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        this.moveCursor(0, -1);
        break;
      case "ArrowRight":
      case "d":
      case "D":
        this.moveCursor(0, 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        this.confirm();
        break;
    }
  }

  private clearWrongTimer(): void {
    if (this.wrongTimer !== null) {
      clearTimeout(this.wrongTimer);
      this.wrongTimer = null;
    }
  }

  destroy(): void {
    this.clearWrongTimer();
  }
}
