import { SoundEffects } from "../game/SoundEffects";
import { type HackLevel, type LevelContext, mulberry32 } from "./types";

/**
 * Nivel 1 — Clon de huella (inspirado en el "fingerprint clone" de GTA Online).
 *
 * A la derecha esta la huella OBJETIVO. A la izquierda una columna de
 * COMPONENTES: la huella partida en `SLOTS` franjas horizontales. Cada franja
 * arranca mostrando un candidato al azar; el jugador cicla los candidatos
 * (izq/der) hasta encontrar el que coincide con esa franja del objetivo.
 *
 * En esta versión optimizada estilo GTA V, no se verifica franja por franja ni
 * se pulsa Enter. El juego pasa automáticamente de nivel en cuanto las 8 franjas
 * estén alineadas correctamente. Tampoco se dan pistas individuales de acierto/error.
 */

const GRID_W = 60;
const GRID_H = 96;
const SLOTS = 8;
const STRIP_ROWS = GRID_H / SLOTS; // 12
const CANDIDATES = 4; // 1 correcto + 3 senuelos
const CELL = 3; // px por celda en el render
const THRESH = 0.15; // umbral de cresta (más alto = crestas más finas)
const COLOR = "#33ff88";
const ACTIVE_COLOR = "#ffffff"; // franja en foco: blanca pura
const DIM_COLOR = "rgba(51, 255, 136, 0.35)"; // más brillante para mejor legibilidad

type Fingerprint = Uint8Array; // GRID_W * GRID_H, 1 = cresta

/** Genera una huella con crestas fluidas tipo "loop" */
function makeFingerprint(seed: number): Fingerprint {
  const r = mulberry32(seed);
  const cx = GRID_W * (0.4 + 0.2 * r());
  const cy = GRID_H * (0.3 + 0.16 * r()); // nucleo hacia arriba
  const freq = 1.2 + 0.4 * r(); // densidad de crestas
  const stretchX = 0.8 + 0.25 * r();
  const stretchY = 0.44 + 0.18 * r(); // ovalo estirado en vertical
  const twist = (r() - 0.5) * 1.5; // giro tipo whorl
  const warpAmp = 1.8 + 1.1 * r();
  const warpFx = 0.08 + 0.05 * r();
  const warpFy = 0.08 + 0.05 * r();
  const warpPh = r() * Math.PI * 2;
  const warpPh2 = r() * Math.PI * 2;
  const tilt = (r() - 0.5) * 0.35; // deriva global que inclina el patron
  const phase0 = r() * Math.PI * 2;

  const out = new Uint8Array(GRID_W * GRID_H);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const dx = (x - cx) * stretchX;
      const dy = (y - cy) * stretchY;
      const rad = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const warp =
        Math.sin(x * warpFx + y * 0.03 + warpPh) * warpAmp +
        Math.cos(y * warpFy - x * 0.02 + warpPh2) * warpAmp;
      const phase = rad * freq + ang * twist + warp * 0.65 + x * tilt + phase0;
      out[y * GRID_W + x] = Math.sin(phase) > THRESH ? 1 : 0;
    }
  }
  return out;
}

/** Dibuja una franja (o el objetivo entero) de una huella en un canvas. */
function drawBand(
  canvas: HTMLCanvasElement,
  fp: Fingerprint,
  slot: number,
  rows: number,
  color: string
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  const r0 = slot * STRIP_ROWS;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (fp[(r0 + y) * GRID_W + x]) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

/** Dibuja un mini fingerprint en los signal boxes */
function drawMiniFingerprint(canvas: HTMLCanvasElement, color: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  
  for (let r = 4; r < 28; r += 4) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.55, r * 0.85, 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }
}

interface Slot {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  candidates: Fingerprint[];
  correct: number; // indice del candidato correcto
  current: number; // candidato mostrado
  locked: boolean;
}

export class FingerprintLevel implements HackLevel {
  readonly id = "fingerprint";
  readonly title = "CLON DE HUELLA";
  readonly controls = "Flechas para elegir franja y ciclar candidatos. El nivel pasa automáticamente al coincidir todo.";

  private targetCanvas!: HTMLCanvasElement;
  private slotList!: HTMLDivElement;
  private timeoutEl!: HTMLDivElement;
  private scrambleBar!: HTMLDivElement;
  private signalEls: HTMLDivElement[] = [];
  private slots: Slot[] = [];
  private active = 0;
  private target!: Fingerprint;
  private busy = false;
  private readonly ctx: LevelContext;
  private scrambleTimer = 0;

  constructor(ctx: LevelContext) {
    this.ctx = ctx;
  }

  mount(host: HTMLElement): void {
    host.innerHTML = "";

    const container = document.createElement("div");
    container.className = "fp-layout-container";

    // --- Header Grid ---
    const headerGrid = document.createElement("div");
    headerGrid.className = "fp-header-grid";

    // Panel Timeout
    const panelTimeout = document.createElement("div");
    panelTimeout.className = "fp-panel fp-panel--timeout";
    const timeoutHead = document.createElement("div");
    timeoutHead.className = "fp__head";
    timeoutHead.textContent = "CONNECTION TIMEOUT";
    this.timeoutEl = document.createElement("div");
    this.timeoutEl.className = "fp-timeout-val";
    this.timeoutEl.textContent = "04:00:00";
    
    const scrambleHead = document.createElement("div");
    scrambleHead.className = "fp__head";
    scrambleHead.textContent = "SCRAMBLE COUNTDOWN";
    const scrambleCountdown = document.createElement("div");
    scrambleCountdown.className = "fp-scramble-countdown";
    this.scrambleBar = document.createElement("div");
    this.scrambleBar.className = "fp-scramble-bar";
    scrambleCountdown.appendChild(this.scrambleBar);
    
    panelTimeout.append(timeoutHead, this.timeoutEl, scrambleHead, scrambleCountdown);

    // Panel Signals
    const panelSignals = document.createElement("div");
    panelSignals.className = "fp-panel fp-panel--signals";
    const signalsHead = document.createElement("div");
    signalsHead.className = "fp__head";
    signalsHead.textContent = "DECYPHERED SIGNALS";
    const signals = document.createElement("div");
    signals.className = "fp__signals";
    
    this.signalEls = [];
    for (let i = 0; i < 4; i++) {
      const sigBox = document.createElement("div");
      sigBox.className = "fp__signal";
      const canvas = document.createElement("canvas");
      canvas.width = 44;
      canvas.height = 60;
      sigBox.appendChild(canvas);
      signals.appendChild(sigBox);
      this.signalEls.push(sigBox);
      
      if (i < 3) {
        sigBox.classList.add("is-on");
        drawMiniFingerprint(canvas, "#33ff88");
      } else {
        sigBox.classList.add("fp__signal--active-slot");
        drawMiniFingerprint(canvas, "rgba(255, 255, 255, 0.4)");
      }
    }
    panelSignals.append(signalsHead, signals);
    headerGrid.append(panelTimeout, panelSignals);

    // --- Body Grid ---
    const bodyGrid = document.createElement("div");
    bodyGrid.className = "fp-body-grid";

    // Panel Components
    const panelComponents = document.createElement("div");
    panelComponents.className = "fp-panel fp-panel--components";
    const compHead = document.createElement("div");
    compHead.className = "fp__head";
    compHead.textContent = "COMPONENTS";
    this.slotList = document.createElement("div");
    this.slotList.className = "fp__slots";
    panelComponents.append(compHead, this.slotList);

    // Panel Target
    const panelTarget = document.createElement("div");
    panelTarget.className = "fp-panel fp-panel--target";
    const targetHead = document.createElement("div");
    targetHead.className = "fp__head";
    targetHead.textContent = "CLONE TARGET";
    
    const targetCanvasContainer = document.createElement("div");
    targetCanvasContainer.className = "fp__target-canvas-container";
    
    this.targetCanvas = document.createElement("canvas");
    this.targetCanvas.width = GRID_W * CELL;
    this.targetCanvas.height = GRID_H * CELL;
    this.targetCanvas.className = "fp__target-canvas";
    targetCanvasContainer.appendChild(this.targetCanvas);
    panelTarget.append(targetHead, targetCanvasContainer);

    bodyGrid.append(panelComponents, panelTarget);

    container.append(headerGrid, bodyGrid);
    host.appendChild(container);
  }

  begin(): void {
    this.busy = false;
    this.active = 0;
    this.slots = [];
    this.scrambleTimer = 0;
    this.slotList.innerHTML = "";

    const baseSeed = (Math.random() * 1e9) >>> 0;
    this.target = makeFingerprint(baseSeed);
    
    const decoys: Fingerprint[] = [];
    for (let i = 0; i < CANDIDATES - 1; i++) {
      decoys.push(makeFingerprint(baseSeed + 101 + i * 977));
    }

    for (let s = 0; s < SLOTS; s++) {
      const pool = [this.target, ...decoys];
      const order = pool.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const candidates = order.map((i) => pool[i]);
      const correct = order.indexOf(0);

      const el = document.createElement("div");
      el.className = "fp__slot";
      const prev = document.createElement("button");
      prev.className = "fp__arrow";
      prev.textContent = "‹";
      const canvas = document.createElement("canvas");
      canvas.width = GRID_W * CELL;
      canvas.height = STRIP_ROWS * CELL;
      canvas.className = "fp__slot-canvas";
      const next = document.createElement("button");
      next.className = "fp__arrow";
      next.textContent = "›";
      el.append(prev, canvas, next);
      this.slotList.appendChild(el);

      const slot: Slot = {
        el,
        canvas,
        candidates,
        correct,
        current: Math.floor(Math.random() * CANDIDATES),
        locked: false,
      };
      this.slots.push(slot);

      const idx = s;
      prev.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setActive(idx);
        this.cycle(-1);
      });
      next.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setActive(idx);
        this.cycle(1);
      });
      canvas.addEventListener("click", () => {
        this.setActive(idx);
      });
    }

    drawBand(this.targetCanvas, this.target, 0, GRID_H, COLOR);

    // Reiniciar los signal boxes
    this.signalEls.forEach((box, i) => {
      const canv = box.querySelector("canvas");
      if (canv) {
        if (i < 3) {
          box.className = "fp__signal is-on";
          drawMiniFingerprint(canv, "#33ff88");
        } else {
          box.className = "fp__signal fp__signal--active-slot";
          drawMiniFingerprint(canv, "rgba(255, 255, 255, 0.4)");
        }
      }
    });

    this.slots.forEach((_, i) => this.renderSlot(i));
    this.setActive(0);
    this.updateStatus();
  }

  update(dt: number): void {
    // SCRAMBLE COUNTDOWN bar drains every 8 seconds just for a retro visual effect
    this.scrambleTimer = (this.scrambleTimer + dt) % 8;
    if (this.scrambleBar) {
      const pct = 100 - (this.scrambleTimer / 8) * 100;
      this.scrambleBar.style.width = `${pct}%`;
    }
  }

  updateTime(centis: number): void {
    if (this.timeoutEl) {
      // 4 minutes limit (24000 centiseconds)
      const limit = 24000;
      const remaining = Math.max(0, limit - centis);
      const min = Math.floor(remaining / 6000);
      const sec = Math.floor((remaining % 6000) / 100);
      const cs = remaining % 100;
      this.timeoutEl.textContent = `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}:${cs.toString().padStart(2, "0")}`;
    }
  }

  private renderSlot(i: number): void {
    const slot = this.slots[i];
    const color = slot.locked ? COLOR : i === this.active ? ACTIVE_COLOR : DIM_COLOR;
    drawBand(slot.canvas, slot.candidates[slot.current], i, STRIP_ROWS, color);
    slot.el.classList.toggle("is-locked", slot.locked);
    slot.el.classList.toggle("is-active", i === this.active && !slot.locked);
  }

  private setActive(i: number): void {
    if (this.busy) return;
    const prev = this.active;
    this.active = i;
    if (prev !== i) this.renderSlot(prev);
    this.renderSlot(i);
    this.updateStatus();
  }

  private moveActive(dir: number): void {
    let i = (this.active + dir + SLOTS) % SLOTS;
    this.setActive(i);
    SoundEffects.playMove();
  }

  private cycle(dir: number): void {
    if (this.busy) return;
    const slot = this.slots[this.active];
    if (!slot) return;
    slot.current = (slot.current + dir + CANDIDATES) % CANDIDATES;
    this.renderSlot(this.active);
    SoundEffects.playCycle();
    this.checkSolved();
  }

  private checkSolved(): void {
    const isAllCorrect = this.slots.every((s) => s.current === s.correct);
    if (isAllCorrect) {
      this.busy = true; // bloquear clicks/teclas
      
      // Bloquear visualmente en verde para dar la respuesta final correcta
      this.slots.forEach((s, i) => {
        s.locked = true;
        this.renderSlot(i);
      });
      
      SoundEffects.playLock();
      this.ctx.onProgress();
      
      // Enciende el 4º signal
      const lastBox = this.signalEls[3];
      if (lastBox) {
        lastBox.className = "fp__signal is-on";
        const canv = lastBox.querySelector("canvas");
        if (canv) drawMiniFingerprint(canv, "#33ff88");
      }
      
      window.setTimeout(() => {
        this.ctx.onSolved();
      }, 600);
    }
  }

  private updateStatus(): void {
    this.ctx.setStatus(`FRANJA ACTIVA ${this.active + 1}/${SLOTS}`);
  }

  handleKey(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        this.moveActive(-1);
        break;
      case "ArrowDown":
      case "s":
      case "S":
        this.moveActive(1);
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        this.cycle(-1);
        break;
      case "ArrowRight":
      case "d":
      case "D":
        this.cycle(1);
        break;
    }
  }

  destroy(): void {}
}
