import { SoundEffects } from "../game/SoundEffects";
import { type HackLevel, type LevelContext } from "./types";

/**
 * Nivel 3 — BruteForce (el minijuego de reels de letras de GTA Online).
 *
 * Cada columna es un carrete de letras que scrollea sin parar. Una banda central
 * marca la fila de captura. En cada carrete hay una letra objetivo resaltada en
 * ROJO; el jugador tiene que DETENER la columna activa (Espacio/Enter/Abajo)
 * justo cuando esa letra roja pasa por la banda. Acierto -> la columna queda
 * fijada (verde) y el foco pasa a la siguiente; fallo -> flash rojo y se resetean
 * todas las columnas para volver a empezar desde cero con el doble de velocidad.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// La clave siempre tiene WORD_LEN letras (= cantidad de columnas), asi el nivel
// no cambia de tamano entre partidas. Todas deben tener exactamente WORD_LEN
// letras y solo A-Z (sin acentos ni ñ).
const WORD_LEN = 6;
const WORDS = [
  "ACCESO",
  "KERNEL",
  "VECTOR",
  "SOCKET",
  "ROUTER",
  "MATRIZ",
  "SERVER",
  "PUERTO",
  "CODIGO",
  "NUCLEO",
  "MODULO",
  "BUFFER",
  "SCRIPT",
  "CIFRAR",
  "PIRATA",
  "CLONAR",
  "HACKER",
];
// Red de seguridad: solo se sortean las de largo correcto (si alguien agrega una
// de otro largo, se descarta en vez de cambiar el tamano del nivel).
const WORD_POOL = WORDS.filter((w) => w.length === WORD_LEN);

const CYCLE = 10; // letras por vuelta del carrete
const ROW_H = 34; // px por fila (5 filas visibles => 170px, fijado en el CSS)
const HALF = 3; // filas a cada lado del centro que se renderizan
const BAND_TOP = 2 * ROW_H; // 68 (fila central, indice 2)
const CATCH_TOL = 0.5; // tolerancia (filas) para considerar la letra en la banda

interface Reel {
  el: HTMLDivElement;
  spans: HTMLSpanElement[]; // pool reposicionado cada frame
  letters: string[]; // ciclo de CYCLE letras
  targetIdx: number; // indice de la letra objetivo (roja) en el ciclo
  offset: number; // posicion de scroll (float, en filas)
  speed: number; // filas por segundo
  locked: boolean;
}

export class BruteForceLevel implements HackLevel {
  readonly id = "bruteforce";
  readonly title = "BRUTEFORCE";
  readonly controls = "Izq/Der elige columna. Espacio/Enter detiene la columna. ¡Errar reinicia todo el progreso!";

  private reelsEl!: HTMLDivElement;
  private bandEl!: HTMLDivElement;
  private timerEl!: HTMLDivElement;
  private reels: Reel[] = [];
  private word = "";
  private active = 0;
  private missTimer: number | null = null;
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
    title.textContent = "BRUTEFORCE";
    
    const subtitle = document.createElement("div");
    subtitle.className = "gta-header__subtitle";
    subtitle.textContent = "Busting through the backdoor since 1998";
    
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
    const bfBody = document.createElement("div");
    bfBody.className = "bf-body";

    // Striped lines title row
    const titleRow = document.createElement("div");
    titleRow.className = "bf-title-row";
    const lineLeft = document.createElement("div");
    lineLeft.className = "bf-title-lines";
    const mainTitle = document.createElement("div");
    mainTitle.className = "bf-main-title";
    mainTitle.textContent = "BRUTEFORCE";
    const lineRight = document.createElement("div");
    lineRight.className = "bf-title-lines";
    titleRow.append(lineLeft, mainTitle, lineRight);

    const banner = document.createElement("div");
    banner.className = "bf__banner";
    banner.textContent = "-BUSTING THROUGH THE BACKDOOR SINCE 1998-";

    const grid = document.createElement("div");
    grid.className = "bf__grid";
    this.bandEl = document.createElement("div");
    this.bandEl.className = "bf__band";
    this.reelsEl = document.createElement("div");
    this.reelsEl.className = "bf__reels";
    grid.append(this.bandEl, this.reelsEl);

    bfBody.append(titleRow, banner, grid);

    // Bottom Blue Bar
    const bottomBar = document.createElement("div");
    bottomBar.className = "gta-blue-bar";

    container.append(topBar, header, bfBody, bottomBar);
    host.appendChild(container);
  }

  begin(): void {
    this.clearMissTimer();
    this.word = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)];
    this.active = 0;
    this.reels = [];
    this.reelsEl.innerHTML = "";

    for (let c = 0; c < this.word.length; c++) {
      const target = this.word[c];
      const letters: string[] = [];
      for (let i = 0; i < CYCLE; i++) {
        letters.push(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
      }
      const targetIdx = Math.floor(Math.random() * CYCLE);
      letters[targetIdx] = target;

      const el = document.createElement("div");
      el.className = "bf__reel";
      const spans: HTMLSpanElement[] = [];
      for (let k = 0; k < 2 * HALF + 1; k++) {
        const span = document.createElement("span");
        span.className = "bf__letter";
        el.appendChild(span);
        spans.push(span);
      }
      this.reelsEl.appendChild(el);

      const idx = c;
      el.addEventListener("click", () => {
        if (this.reels[idx].locked) return;
        if (this.active !== idx) {
          this.setActive(idx);
        } else {
          this.tryCatch();
        }
      });

      this.reels.push({
        el,
        spans,
        letters,
        targetIdx,
        offset: Math.random() * CYCLE,
        speed: 3.84 + Math.random() * 1.92, // 20% mas lento (era 4.8 + rand*2.4)
        locked: false,
      });
    }

    this.renderActive();
    this.reels.forEach((_, i) => this.renderReel(i));
    this.updateStatus();
  }

  update(dt: number): void {
    for (const reel of this.reels) {
      if (reel.locked) continue;
      // Sentido contrario al anterior: el offset decrece (las letras bajan en vez
      // de subir). El wrap contempla negativos para quedar siempre en [0, CYCLE).
      reel.offset = ((reel.offset - reel.speed * dt) % CYCLE + CYCLE) % CYCLE;
    }
    this.reels.forEach((_, i) => this.renderReel(i));
  }

  updateTime(centis: number): void {
    if (this.timerEl) {
      const min = Math.floor(centis / 6000);
      const sec = Math.floor((centis % 6000) / 100);
      const ms = (centis % 100) * 10;
      this.timerEl.textContent = `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}:${ms.toString().padStart(3, "0")}`;
    }
  }

  private renderReel(i: number): void {
    const reel = this.reels[i];
    const base = Math.floor(reel.offset);
    for (let k = 0; k < reel.spans.length; k++) {
      const j = base - HALF + k;
      const cyc = ((j % CYCLE) + CYCLE) % CYCLE;
      const span = reel.spans[k];
      const isTarget = cyc === reel.targetIdx;
      
      if (reel.locked) {
        span.textContent = isTarget ? reel.letters[cyc] : "";
        span.style.top = `${BAND_TOP}px`;
        span.style.opacity = isTarget ? "1" : "0";
        span.classList.toggle("bf__letter--target", isTarget);
      } else {
        span.textContent = reel.letters[cyc];
        const dRows = j - reel.offset;
        span.style.top = `${BAND_TOP + dRows * ROW_H}px`;
        const dist = Math.abs(dRows);
        span.style.opacity = String(Math.max(0.06, 1 - dist * 0.3));
        span.classList.toggle("bf__letter--target", isTarget);
      }
    }
  }

  private renderActive(): void {
    this.reels.forEach((reel, i) => {
      reel.el.classList.toggle("is-active", i === this.active && !reel.locked);
      reel.el.classList.toggle("is-locked", reel.locked);
    });
  }

  private setActive(i: number): void {
    if (this.reels[i]?.locked) return;
    this.active = i;
    this.renderActive();
    SoundEffects.playMove();
  }

  private moveActive(dir: number): void {
    if (this.reels.every((r) => r.locked)) return;
    let i = this.active;
    for (let n = 0; n < this.reels.length; n++) {
      i = (i + dir + this.reels.length) % this.reels.length;
      if (!this.reels[i].locked) break;
    }
    this.setActive(i);
  }

  private tryCatch(): void {
    const reel = this.reels[this.active];
    if (!reel || reel.locked) return;

    const nearest = Math.round(reel.offset);
    const dist = Math.abs(reel.offset - nearest);
    const cyc = ((nearest % CYCLE) + CYCLE) % CYCLE;

    if (cyc === reel.targetIdx && dist <= CATCH_TOL) {
      reel.offset = ((reel.targetIdx % CYCLE) + CYCLE) % CYCLE;
      reel.locked = true;
      this.renderReel(this.active);
      this.renderActive();
      SoundEffects.playLock();
      this.ctx.onProgress();
      this.updateStatus();
      if (this.reels.every((r) => r.locked)) {
        this.ctx.onSolved();
        return;
      }
      this.moveActive(1);
    } else {
      // Fallo: flash rojo y reset completo de la palabra
      SoundEffects.playError();
      this.bandEl.classList.add("is-miss");
      this.clearMissTimer();
      this.missTimer = window.setTimeout(() => {
        this.bandEl.classList.remove("is-miss");
        this.missTimer = null;
      }, 260);

      // Desbloquear todos los carretes y reiniciar offsets al azar
      for (const r of this.reels) {
        r.locked = false;
        r.offset = Math.random() * CYCLE;
      }
      this.active = 0;
      this.renderActive();
      this.reels.forEach((_, idx) => this.renderReel(idx));
      this.updateStatus();
      this.ctx.onProgress(); // guardar reset de progreso en sala/sessionStorage
    }
  }

  private updateStatus(): void {
    const done = this.reels.filter((r) => r.locked).length;
    this.ctx.setStatus(`CLAVE ${done}/${this.reels.length}`);
  }

  handleKey(e: KeyboardEvent): void {
    switch (e.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        this.moveActive(-1);
        break;
      case "ArrowRight":
      case "d":
      case "D":
        this.moveActive(1);
        break;
      case "ArrowDown":
      case "s":
      case "S":
      case " ":
      case "Enter":
        e.preventDefault();
        this.tryCatch();
        break;
    }
  }

  private clearMissTimer(): void {
    if (this.missTimer !== null) {
      clearTimeout(this.missTimer);
      this.missTimer = null;
    }
  }

  destroy(): void {
    this.clearMissTimer();
  }
}
