import {
  CELL,
  SIGNAL_RADIUS,
  COLLISION_RADIUS,
  SPEED,
  MAX_DT,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  CRASH_FREEZE,
  LEVEL_FLASH,
  BEST_KEY,
  COLOR_BG,
  COLOR_COPPER,
  COLOR_COPPER_HI,
  COLOR_CHANNEL,
  COLOR_EDGE,
  COLOR_SILK,
  COLOR_CABLE,
  COLOR_CABLE_GLOW,
  COLOR_SOURCE,
  COLOR_DEST,
} from "./constants";
import { getLevel, LEVEL_COUNT, type Level } from "./levels";
// La senal avanza sola en `dir`; WASD/flechas solo cambian la direccion (4 dir).
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { encodeTimeMoves, formatClock } from "../../../shared/scoring-core";
import { submitScoreIfTop } from "../../../shared/leaderboard";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import {
  clearRoomRun,
  elapsedSince,
  loadRoomRun,
  saveRoomRun,
} from "../../../shared/room/roomRun";

type State = "ready" | "countdown" | "playing" | "crash" | "clear" | "won";

/**
 * Corrida en curso persistida en sala, para sobrevivir un F5 (ver roomRun.ts).
 * No se guarda la posicion exacta de la senal: al retomar se la ubica en el
 * origen del nivel, que es exactamente lo que hace un choque. Lo que no puede
 * perderse es el reloj (el ranking es "lower"), los choques y el nivel alcanzado.
 */
interface SavedRun {
  levelIndex: number;
  elapsed: number;
  crashes: number;
  levelScores: number[];
  levelStartElapsed: number;
  levelStartCrashes: number;
  /** Epoch ms del snapshot: el tiempo del reload tambien cuenta. */
  savedAt: number;
}

/** Cada cuanto (segundos de juego) se persiste la corrida mientras se juega. */
const SAVE_INTERVAL = 0.5;

interface Deco {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "ic" | "res" | "cap";
  rot: boolean;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly room: RoomMode | null;

  private state: State = "ready";
  private best = Number(localStorage.getItem(BEST_KEY)) || 0; // codificado (0 = sin marca)
  private lastTime = 0;
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private crashTime = 0;
  private clearTime = 0;
  private wonFor = 0;
  private pulse = 0;

  // Nivel actual (se recarga con loadLevel al pasar de nivel).
  private levelIndex = 1;
  private level!: Level;
  private viewW = 0;
  private viewH = 0;
  private startCenter = { x: 0, y: 0 };
  private endCenter = { x: 0, y: 0 };
  // Hacia donde "apunta" el cuerpo del USB (el borde al que se pega); la abertura
  // mira al lado opuesto (hacia adentro del tablero).
  private endFacing = { x: 1, y: 0 };
  private deco: Deco[] = [];
  // Direccion inicial segura del nivel (calculada desde el corredor que sale de A).
  private startDir = { x: 1, y: 0 };

  // Corrida (acumula a lo largo de todos los niveles).
  private elapsed = 0;
  private crashes = 0;
  /** Acumulador del guardado periodico de la corrida (solo en sala). */
  private saveAcc = 0;
  // Para el ranking por nivel: tiempo/choques acumulados al empezar el nivel actual,
  // y el puntaje codificado de cada nivel ya completado (index = nivel - 1).
  private levelStartElapsed = 0;
  private levelStartCrashes = 0;
  private levelScores: number[] = [];

  // Senal (posicion continua en px de mundo). Avanza sola en `dir`; el jugador
  // solo cambia la direccion (4 direcciones).
  private pos = { x: 0, y: 0 };
  private dir = { x: 1, y: 0 };
  // Cable permanente: el recorrido de la senal en el nivel actual (se reinicia al
  // empezar el nivel y tras cada choque). Al ganar, conecta el pad A con el conector B.
  private path: { x: number; y: number }[] = [];
  // Chispas electricas que desprende la senal mientras avanza.
  private particles: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    len: number;
  }[] = [];
  private particleAcc = 0;

  // Entrada tactil: swipe para girar.
  private pointerActive = false;
  private pointerX = 0;
  private pointerY = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.hud = new Hud(container);
    this.loadLevel(1);
    this.pos = { ...this.startCenter };
    this.hud.showHud(false);
    this.hud.showStart(this.best ? this.formatScore(this.best) : null);

    this.room = initRoomMode("circuit-breaker", {
      getScore: () => encodeTimeMoves(this.elapsed, this.crashes),
      onStart: () => this.beginCountdown(),
    });

    this.bindInputs(container);
    this.resize();
    window.addEventListener("resize", this.resize);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private formatScore(encoded: number): string {
    const base = 100000;
    return `${formatClock(Math.floor(encoded / base))} - ${encoded % base} choques`;
  }

  /** Carga la geometria del nivel `index` y ubica la senal en su pad de origen. */
  private loadLevel(index: number): void {
    this.levelIndex = index;
    this.level = getLevel(index);
    this.viewW = this.level.cols * CELL;
    this.viewH = this.level.rows * CELL;
    this.startCenter = { x: (this.level.start.x + 0.5) * CELL, y: (this.level.start.y + 0.5) * CELL };
    this.endCenter = { x: (this.level.end.x + 0.5) * CELL, y: (this.level.end.y + 0.5) * CELL };
    this.startDir = this.computeStartDir();
    this.endFacing = this.computeEndFacing();
    // Marca de inicio del nivel para medir su tiempo/choques propios.
    this.levelStartElapsed = this.elapsed;
    this.levelStartCrashes = this.crashes;
    this.deco = this.buildDeco();
    this.pos = { ...this.startCenter };
    this.dir = { ...this.startDir };
    this.path = [{ ...this.startCenter }];
    this.particles = [];
    this.particleAcc = 0;
    this.hud.setLevel(index, LEVEL_COUNT);
    this.resize();
  }

  /** Direccion inicial segura: el primer vecino de A que sea corredor. */
  private computeStartDir(): { x: number; y: number } {
    const s = this.level.start;
    const dirs = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
    ];
    for (const d of dirs) if (!this.isWall(s.x + d.x, s.y + d.y)) return d;
    return { x: 1, y: 0 };
  }

  /** Orientacion del USB: el cuerpo se pega a la pared y la abertura mira al
   *  corredor por donde llega el cable. Devuelve la direccion del cuerpo. */
  private computeEndFacing(): { x: number; y: number } {
    const e = this.level.end;
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    // Ideal: de un lado hay pared (cuerpo) y del opuesto corredor (abertura/cable).
    for (const d of dirs) {
      if (this.isWall(e.x + d.x, e.y + d.y) && !this.isWall(e.x - d.x, e.y - d.y)) return d;
    }
    // Si no, hacia cualquier pared vecina.
    for (const d of dirs) if (this.isWall(e.x + d.x, e.y + d.y)) return d;
    // Fallback: borde mas cercano del tablero.
    const dLeft = e.x;
    const dRight = this.level.cols - 1 - e.x;
    const dTop = e.y;
    const dBottom = this.level.rows - 1 - e.y;
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    if (min === dRight) return { x: 1, y: 0 };
    if (min === dLeft) return { x: -1, y: 0 };
    if (min === dBottom) return { x: 0, y: 1 };
    return { x: 0, y: -1 };
  }

  private bindInputs(container: HTMLElement): void {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      switch (k) {
        case "arrowup":
        case "w":
          e.preventDefault();
          this.setDir(0, -1);
          break;
        case "arrowdown":
        case "s":
          e.preventDefault();
          this.setDir(0, 1);
          break;
        case "arrowleft":
        case "a":
          e.preventDefault();
          this.setDir(-1, 0);
          break;
        case "arrowright":
        case "d":
          e.preventDefault();
          this.setDir(1, 0);
          break;
        case "enter":
          this.onAction();
          break;
      }
    });

    // Tactil: tocar la pantalla arranca/reintenta; el swipe gira la senal.
    // Van sobre el container y no sobre el canvas: las pantallas de inicio y de
    // fin son un overlay que lo tapa, asi que en movil (donde no hay Enter) el
    // toque sobre el cartel moria ahi. El panel de ranking corta la propagacion
    // de sus propios pointerdown.
    container.addEventListener("pointerdown", (e) => {
      this.pointerActive = true;
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      if (this.state === "ready" || this.state === "won") this.onAction();
    });
    container.addEventListener("pointermove", (e) => {
      if (!this.pointerActive) return;
      const dx = e.clientX - this.pointerX;
      const dy = e.clientY - this.pointerY;
      const threshold = 22;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      if (Math.abs(dx) > Math.abs(dy)) this.setDir(Math.sign(dx), 0);
      else this.setDir(0, Math.sign(dy));
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
    });
    const endPointer = () => {
      this.pointerActive = false;
    };
    container.addEventListener("pointerup", endPointer);
    container.addEventListener("pointercancel", endPointer);
    this.canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  /** Fija la direccion de avance (4 direcciones). Solo mientras se juega. */
  private setDir(x: number, y: number): void {
    if (this.state !== "playing") return;
    this.dir = { x, y };
  }

  private onAction(): void {
    if (this.state === "ready") this.beginCountdown();
    else if (this.state === "won") {
      if (this.room) return;
      if (this.wonFor > 0.5) this.beginCountdown();
    }
  }

  private beginCountdown(): void {
    // En sala, un F5 vuelve a pasar por aca (la ronda sigue en "playing" y
    // RoomMode redispara onStart): si hay corrida guardada se retoma en el nivel
    // alcanzado, con su reloj y sus choques, en vez de empezar de cero.
    if (this.room && this.resumeSavedRun()) return;

    this.state = "countdown";
    this.countdownTime = 0;
    this.lastCountdownIndex = -1;
    this.resetRun();
    this.hud.showHud(false);
    this.hud.hide();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  /**
   * Retoma la corrida guardada de esta ronda tras un reload. La senal reaparece en
   * el origen del nivel alcanzado (igual que tras un choque) pero el reloj sigue
   * corriendo: `savedAt` hace que el tiempo del reload tambien se pague, asi
   * recargar no es una forma gratis de volver al inicio del nivel.
   */
  private resumeSavedRun(): boolean {
    const s = loadRoomRun<SavedRun>(this.room!, "circuit-breaker");
    if (!s || !Array.isArray(s.levelScores)) return false;
    if (!Number.isFinite(s.elapsed) || !Number.isFinite(s.crashes)) return false;
    if (!Number.isFinite(s.savedAt) || !Number.isFinite(s.levelIndex)) return false;
    if (s.levelIndex < 1 || s.levelIndex > LEVEL_COUNT) return false;

    this.elapsed = s.elapsed + elapsedSince(s.savedAt);
    this.crashes = s.crashes;
    this.levelScores = [...s.levelScores];

    this.loadLevel(s.levelIndex);
    // loadLevel remarca el inicio del nivel contra el `elapsed` actual: se pisa con
    // el guardado para que el puntaje propio del nivel no se falsee.
    this.levelStartElapsed = s.levelStartElapsed;
    this.levelStartCrashes = s.levelStartCrashes;

    this.state = "playing";
    this.hud.setTimer(this.elapsed);
    this.hud.setCrashes(this.crashes);
    this.hud.showHud(true);
    this.hud.hide();
    this.hud.showCountdown(null);
    return true;
  }

  /**
   * Snapshot de la corrida para sobrevivir un F5. No hace nada fuera de sala.
   * `level` / `startElapsed` / `startCrashes` se pasan explicitos al pasar de nivel,
   * donde hay que guardar el nivel SIGUIENTE (si no, un reload durante el cartel
   * "NIVEL N" haria repetir un nivel ya puntuado).
   */
  private saveRun(
    level = this.levelIndex,
    startElapsed = this.levelStartElapsed,
    startCrashes = this.levelStartCrashes,
  ): void {
    if (!this.room) return;
    const data: SavedRun = {
      levelIndex: level,
      elapsed: this.elapsed,
      crashes: this.crashes,
      levelScores: this.levelScores,
      levelStartElapsed: startElapsed,
      levelStartCrashes: startCrashes,
      savedAt: Date.now(),
    };
    saveRoomRun(this.room, "circuit-breaker", data);
  }

  private resetRun(): void {
    this.elapsed = 0;
    this.crashes = 0;
    this.levelScores = [];
    this.loadLevel(1); // ubica la senal en el origen del nivel 1
    this.hud.setTimer(0);
    this.hud.setCrashes(0);
  }

  private start(): void {
    this.state = "playing";
    this.hud.showHud(true);
    this.hud.hide();
    this.hud.showCountdown(null);
    this.saveAcc = 0;
    this.saveRun();
  }

  // --- Bucle principal ---

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.pulse += dt;

    this.update(dt);
    this.render();

    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "playing") this.updatePlaying(dt);
    else if (this.state === "countdown") this.updateCountdown(dt);
    else if (this.state === "crash") this.updateCrash(dt);
    else if (this.state === "clear") this.updateClear(dt);
    else if (this.state === "won") this.wonFor += dt;

    this.updateParticles(dt);
  }

  private updateClear(dt: number): void {
    // Cartel "NIVEL N" entre niveles; el timer NO corre (no es culpa del jugador).
    this.clearTime += dt;
    if (this.clearTime >= LEVEL_FLASH) {
      this.loadLevel(this.levelIndex + 1);
      this.state = "playing";
    }
  }

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (index >= COUNTDOWN_LABELS.length) this.start();
    else if (index !== this.lastCountdownIndex) {
      this.lastCountdownIndex = index;
      SoundEffects.playCountdownTick();
      this.hud.showCountdown(COUNTDOWN_LABELS[index]);
    }
  }

  private updateCrash(dt: number): void {
    this.crashTime += dt;
    this.elapsed += dt; // el tiempo de choque cuenta (penaliza chocar)
    this.hud.setTimer(this.elapsed);
    if (this.crashTime >= CRASH_FREEZE) {
      this.pos = { ...this.startCenter };
      this.dir = { ...this.startDir };
      this.path = [{ ...this.startCenter }];
      this.state = "playing";
    }
  }

  private updatePlaying(dt: number): void {
    this.elapsed += dt;
    this.hud.setTimer(this.elapsed);

    // Persistencia periodica: un F5 no puede costar mas de SAVE_INTERVAL de avance.
    this.saveAcc += dt;
    if (this.saveAcc >= SAVE_INTERVAL) {
      this.saveAcc = 0;
      this.saveRun();
    }

    // La senal avanza sola en la direccion actual.
    const dist = SPEED * dt;
    // Substeps para no atravesar paredes finas si el frame es largo.
    const steps = Math.max(1, Math.ceil(dist / (CELL * 0.4)));
    const sx = (this.dir.x * dist) / steps;
    const sy = (this.dir.y * dist) / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.x += sx;
      this.pos.y += sy;
      // Llegar a B tiene prioridad sobre chocar: entrar por un borde del conector
      // (pegado a la pared) cuenta como nivel superado, no como choque.
      if (this.reachedEnd()) {
        this.reachEnd();
        return;
      }
      if (this.hitsWall(this.pos.x, this.pos.y)) {
        this.crash();
        return;
      }
    }
    const last = this.path[this.path.length - 1];
    if (!last || Math.hypot(last.x - this.pos.x, last.y - this.pos.y) > 3) {
      this.path.push({ x: this.pos.x, y: this.pos.y });
    }

    this.spawnParticles(dt);
  }

  /** Emite chispas electricas desde la punta, disparadas hacia los costados. */
  private spawnParticles(dt: number): void {
    this.particleAcc += dt;
    const interval = 0.022;
    const perp = { x: -this.dir.y, y: this.dir.x };
    while (this.particleAcc >= interval) {
      this.particleAcc -= interval;
      const dirSign = Math.random() < 0.5 ? -1 : 1; // sale hacia un costado
      const side = (0.3 + Math.random() * 0.9) * SIGNAL_RADIUS;
      const speed = 20 + Math.random() * 45; // las chispas salen mas rapido
      const max = 0.14 + Math.random() * 0.16; // vida corta = parpadeo electrico
      this.particles.push({
        x: this.pos.x + perp.x * side * dirSign * 0.4,
        y: this.pos.y + perp.y * side * dirSign * 0.4,
        vx: (perp.x * dirSign) * speed - this.dir.x * speed * 0.3,
        vy: (perp.y * dirSign) * speed - this.dir.y * speed * 0.3,
        life: max,
        max,
        len: 3 + Math.random() * 6,
      });
    }
    if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    if (this.particles.length) this.particles = this.particles.filter((p) => p.life > 0);
  }

  /** true si la senal esta dentro del conector B. Su hitbox cubre las 3 celdas de
   *  largo (eje perpendicular a `endFacing`, a lo largo de la pared) y ~1 celda de
   *  fondo (eje `endFacing`), de modo que llegar por cualquier borde cuenta. */
  private reachedEnd(): boolean {
    // Eje largo del conector = perpendicular a la pared a la que se pega.
    const ax = -this.endFacing.y;
    const ay = this.endFacing.x;
    const rx = this.pos.x - this.endCenter.x;
    const ry = this.pos.y - this.endCenter.y;
    const along = rx * ax + ry * ay; // a lo largo de las 3 celdas
    const depth = rx * this.endFacing.x + ry * this.endFacing.y; // hacia/desde la pared
    return Math.abs(along) < CELL * 1.5 && Math.abs(depth) < CELL * 0.7;
  }

  private reachEnd(): void {
    // Registra el puntaje propio del nivel recien completado (tiempo + choques).
    const lvlTime = this.elapsed - this.levelStartElapsed;
    const lvlCrashes = this.crashes - this.levelStartCrashes;
    const lvlScore = encodeTimeMoves(lvlTime, lvlCrashes);
    this.levelScores[this.levelIndex - 1] = lvlScore;
    // Guarda la marca del nivel al pasarlo (si entra al top), no al final: asi queda
    // registrada aunque la corrida no llegue hasta el final.
    if (!this.room) {
      void submitScoreIfTop("circuit-breaker", lvlScore, { variant: `nivel-${this.levelIndex}` });
    }

    if (this.levelIndex < LEVEL_COUNT) {
      // Pasa al siguiente nivel: cartel + pausa; el tiempo/choques se mantienen.
      // Se guarda ya apuntando al nivel siguiente: un reload durante el cartel no
      // debe hacer repetir este nivel, que ya quedo puntuado en levelScores.
      this.saveRun(this.levelIndex + 1, this.elapsed, this.crashes);
      SoundEffects.playWin();
      this.hud.showBanner(`NIVEL ${this.levelIndex + 1}`, "#33e39a");
      this.state = "clear";
      this.clearTime = 0;
    } else {
      this.win();
    }
  }

  /** true si el cable (radio COLLISION_RADIUS) toca alguna pared (o sale del tablero). */
  private hitsWall(x: number, y: number): boolean {
    const r = COLLISION_RADIUS;
    const c0 = Math.floor((x - r) / CELL);
    const c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((y - r) / CELL);
    const r1 = Math.floor((y + r) / CELL);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (!this.isWall(cx, cy)) continue;
        // circulo vs AABB de la celda.
        const nearX = Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL));
        const nearY = Math.max(cy * CELL, Math.min(y, (cy + 1) * CELL));
        const ddx = x - nearX;
        const ddy = y - nearY;
        if (ddx * ddx + ddy * ddy < r * r) return true;
      }
    }
    return false;
  }

  private isWall(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.level.cols || cy >= this.level.rows) return true;
    return this.level.grid[cy][cx] === "#";
  }

  private crash(): void {
    this.state = "crash";
    this.crashTime = 0;
    this.crashes += 1;
    this.hud.setCrashes(this.crashes);
    this.hud.showBanner("CHOQUE");
    SoundEffects.playCrash();
    this.saveRun();
  }

  private win(): void {
    if (this.state === "won") return; // una sola vez por corrida
    this.state = "won";
    this.wonFor = 0;
    // La corrida de la ronda termino: un reload ya no debe retomarla.
    if (this.room) clearRoomRun(this.room, "circuit-breaker");
    SoundEffects.playWin();
    this.hud.showHud(false);

    const encoded = encodeTimeMoves(this.elapsed, this.crashes);
    const isNewBest = this.best === 0 || encoded < this.best; // menor es mejor
    if (isNewBest) {
      this.best = encoded;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.hud.showWin(this.elapsed, this.crashes, this.formatScore(this.best), isNewBest);

    if (this.room) {
      this.room.reportScore(encoded);
      return;
    }

    // Ranking con selector: uno general (los 3 niveles juntos) y uno por nivel. Los
    // niveles ya se enviaron al pasarlos (submitScoreIfTop en reachEnd), asi que aca
    // solo el general se envia; las pestanas de nivel se muestran de solo lectura.
    const scores: Record<string, number> = { general: encoded };
    this.levelScores.forEach((s, i) => {
      scores[`nivel-${i + 1}`] = s;
    });
    this.hud.showRankings("circuit-breaker", scores, ["general"]);
  }

  // --- Render ---

  private render(): void {
    const { ctx } = this;
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);

    // Sacudida al chocar.
    if (this.state === "crash") {
      const s = (1 - this.crashTime / CRASH_FREEZE) * 6;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this.drawBoard();
    this.drawDeco();
    this.drawChannels();
    this.drawPads();
    if (this.state !== "ready" && this.state !== "countdown") this.drawSignal();

    ctx.restore();

    // Flash rojo de choque (sobre todo, en coordenadas de pantalla).
    if (this.state === "crash") {
      const a = (1 - this.crashTime / CRASH_FREEZE) * 0.35;
      ctx.fillStyle = `rgba(255, 59, 59, ${a})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private drawBoard(): void {
    const { ctx } = this;
    // Toda la placa es cobre (pared); los corredores se cavan encima.
    ctx.fillStyle = COLOR_COPPER;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  private drawDeco(): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = COLOR_SILK;
    ctx.fillStyle = "rgba(206, 228, 216, 0.05)";
    ctx.lineWidth = 1.2;
    for (const d of this.deco) {
      ctx.save();
      ctx.translate(d.x, d.y);
      if (d.rot) ctx.rotate(Math.PI / 2);
      ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h);
      ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      if (d.kind === "ic") {
        const pins = Math.max(2, Math.floor(d.w / 7));
        for (let i = 0; i < pins; i++) {
          const px = -d.w / 2 + ((i + 0.5) * d.w) / pins;
          ctx.beginPath();
          ctx.moveTo(px, -d.h / 2);
          ctx.lineTo(px, -d.h / 2 - 3);
          ctx.moveTo(px, d.h / 2);
          ctx.lineTo(px, d.h / 2 + 3);
          ctx.stroke();
        }
      } else if (d.kind === "res") {
        ctx.beginPath();
        ctx.moveTo(-d.w / 2, 0);
        ctx.lineTo(-d.w / 2 - 4, 0);
        ctx.moveTo(d.w / 2, 0);
        ctx.lineTo(d.w / 2 + 4, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /** Corredores (canales oscuros) + su contorno luminoso (las "paredes" a evitar). */
  private drawChannels(): void {
    const { ctx } = this;
    // Relleno oscuro de cada celda de corredor.
    ctx.fillStyle = COLOR_CHANNEL;
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        if (this.isWall(x, y)) continue;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    // Contorno del corredor: linea en cada borde que da contra una pared.
    ctx.save();
    ctx.strokeStyle = COLOR_EDGE;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = COLOR_EDGE;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        if (this.isWall(x, y)) continue;
        const px = x * CELL;
        const py = y * CELL;
        if (this.isWall(x, y - 1)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + CELL, py);
        }
        if (this.isWall(x, y + 1)) {
          ctx.moveTo(px, py + CELL);
          ctx.lineTo(px + CELL, py + CELL);
        }
        if (this.isWall(x - 1, y)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + CELL);
        }
        if (this.isWall(x + 1, y)) {
          ctx.moveTo(px + CELL, py);
          ctx.lineTo(px + CELL, py + CELL);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
    void COLOR_COPPER_HI;
  }

  private drawPads(): void {
    const { ctx } = this;
    // Pad de origen (A).
    ctx.save();
    ctx.fillStyle = COLOR_SOURCE;
    ctx.shadowColor = COLOR_SOURCE;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(this.startCenter.x, this.startCenter.y, CELL * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Conector destino (B): un USB-A de ~3 celdas, con la abertura hacia la
    // izquierda (por donde llega la senal). Pulsa el resplandor.
    this.drawUsbConnector();
  }

  /** Dibuja el puerto USB-A (destino B), 3x1 celdas, montado contra la pared con la
   *  boca hacia el corredor. Base local: x = a lo largo de la pared (3U), +y = hacia
   *  el corredor (abertura), -y = contra la pared. Se rota con endFacing. */
  private drawUsbConnector(): void {
    const { ctx } = this;
    const p = 0.5 + 0.5 * Math.sin(this.pulse * 5);
    const U = CELL;
    const dark = "#062018";
    const gold = "#ffd27a";

    ctx.save();
    ctx.translate(this.endCenter.x, this.endCenter.y);
    // Alinea el eje largo (x) a lo largo de la pared: rota para que -y (fondo) mire
    // hacia endFacing (la pared) y +y (la boca) hacia el corredor.
    ctx.rotate(Math.atan2(this.endFacing.x, -this.endFacing.y));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Panel/carcasa del puerto (3U de largo x 1U de fondo), pegado a la pared.
    ctx.shadowColor = COLOR_DEST;
    ctx.shadowBlur = 8 + p * 16;
    ctx.strokeStyle = COLOR_DEST;
    ctx.lineWidth = 3;
    ctx.fillStyle = "rgba(125, 252, 255, 0.14)";
    this.roundRectPath(-1.45 * U, -0.5 * U, 2.9 * U, 1.0 * U, 5);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Cavidad (la boca del puerto, mira al corredor).
    ctx.fillStyle = dark;
    this.roundRectPath(-1.28 * U, -0.36 * U, 2.56 * U, 0.74 * U, 3);
    ctx.fill();

    // Lengueta pegada al fondo (lado pared), deja la ranura hacia el corredor.
    ctx.fillStyle = "rgba(125, 252, 255, 0.85)";
    this.roundRectPath(-1.16 * U, -0.34 * U, 2.32 * U, 0.4 * U, 2);
    ctx.fill();

    // 4 contactos dorados en fila a lo largo de la pared.
    ctx.fillStyle = gold;
    const cw = 0.34 * U;
    const ch = 0.26 * U;
    for (const xc of [-0.99, -0.33, 0.33, 0.99]) {
      this.roundRectPath(xc * U - cw / 2, -0.3 * U, cw, ch, 1);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Traza (sin pintar) un rectangulo redondeado en el contexto actual. */
  private roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private drawSignal(): void {
    const { ctx } = this;

    // Cable permanente: todo el recorrido de la corrida, como un cable azul fino
    // que conecta el pad de origen con la senal (y con el destino al ganar).
    if (this.path.length >= 2) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Nucleo del cable con halo.
      ctx.shadowColor = COLOR_CABLE_GLOW;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = COLOR_CABLE_GLOW;
      ctx.lineWidth = SIGNAL_RADIUS * 0.3;
      ctx.beginPath();
      ctx.moveTo(this.path[0].x, this.path[0].y);
      for (let i = 1; i < this.path.length; i++) ctx.lineTo(this.path[i].x, this.path[i].y);
      ctx.stroke();
      // Filamento interno mas claro.
      ctx.shadowBlur = 0;
      ctx.strokeStyle = COLOR_CABLE;
      ctx.lineWidth = SIGNAL_RADIUS * 0.11;
      ctx.stroke();
      ctx.restore();
    }

    // El extremo de la senal es la punta del cable; las chispas lo marcan.
    this.drawParticles();
  }

  /** Chispas electricas azules (zigzag tipo rayo, con parpadeo) desde la punta. */
  private drawParticles(): void {
    if (!this.particles.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const p of this.particles) {
      const t = Math.max(0, p.life / p.max);
      const flicker = 0.45 + Math.random() * 0.55; // titileo electrico
      const alpha = t * flicker;
      if (alpha <= 0.03) continue;

      // Direccion del chispazo (segun su velocidad) y su perpendicular.
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const dx = p.vx / sp;
      const dy = p.vy / sp;
      const nx = -dy;
      const ny = dx;
      const len = p.len * (0.5 + 0.5 * t);

      // Rayo quebrado de 3 tramos con desvio perpendicular aleatorio.
      const segs = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      for (let s = 1; s <= segs; s++) {
        const f = s / segs;
        const kink = s < segs ? (Math.random() - 0.5) * len * 0.7 : 0;
        ctx.lineTo(p.x + dx * len * f + nx * kink, p.y + dy * len * f + ny * kink);
      }

      // Halo azul.
      ctx.shadowColor = COLOR_CABLE_GLOW;
      ctx.shadowBlur = 8;
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = COLOR_CABLE_GLOW;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // Nucleo blanco-azulado brillante.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#dcefff";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Serigrafia de componentes sobre bloques de cobre (deco, sembrada). */
  private buildDeco(): Deco[] {
    const deco: Deco[] = [];
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let y = 1; y < this.level.rows - 2; y++) {
      for (let x = 1; x < this.level.cols - 2; x++) {
        if (rnd() > 0.12) continue;
        let solid = true;
        for (let j = 0; j < 3 && solid; j++)
          for (let i = 0; i < 3; i++) if (!this.isWall(x + i, y + j)) solid = false;
        if (!solid) continue;
        const cxp = (x + 1.5) * CELL;
        const cyp = (y + 1.5) * CELL;
        const roll = rnd();
        const kind: Deco["kind"] = roll < 0.34 ? "ic" : roll < 0.7 ? "res" : "cap";
        const w = kind === "ic" ? CELL * 1.6 : CELL * 1.1;
        const h = kind === "ic" ? CELL * 1.0 : CELL * 0.4;
        deco.push({ x: cxp, y: cyp, w, h, kind, rot: rnd() < 0.5 });
      }
    }
    return deco;
  }

  // --- Ajuste de pantalla (letterbox) ---

  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    const pad = 0.94;
    const fit = Math.min((w / this.viewW) * pad, (h / this.viewH) * pad);
    this.scale = fit * dpr;
    this.offsetX = (w / fit - this.viewW) / 2;
    this.offsetY = (h / fit - this.viewH) / 2;
    this.updateHudPosition();
  };

  /** Ancla el HUD sobre la celda `level.hud` (si el nivel la define); si no, lo deja
   *  arriba-centro. Convierte la celda de mundo a pixeles CSS de pantalla. */
  private updateHudPosition(): void {
    const cell = this.level?.hud;
    if (!cell) {
      this.hud.setReadoutPosition(null);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const fit = this.scale / dpr; // px CSS por unidad de mundo
    const wx = (cell.x + 0.5) * CELL;
    const wy = (cell.y + 0.5) * CELL;
    this.hud.setReadoutPosition(fit * (wx + this.offsetX), fit * (wy + this.offsetY));
  }
}
