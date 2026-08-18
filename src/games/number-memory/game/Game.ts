import {
  VANISH_MS,
  CORRECT_HOLD_MS,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP_MS,
  ANSWER_TIME_MS,
  ANSWER_TICK_MS,
  bestKey,
  startDigits,
  showMsFor,
  type Mode,
} from "./constants";
import { Hud } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "showing" | "input" | "correct" | "wrong" | "gameOver";

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";
  /** Modo elegido de la partida en curso. En sala se fija en "aleatorio". */
  private mode: Mode = "aleatorio";
  /** Ultimo modo jugado (para el Enter de reinicio). */
  private lastMode: Mode = "aleatorio";
  /** Cantidad de digitos del numero actual (= nivel). */
  private digits = 0;
  /** Mayor cantidad de digitos recordada de corrido en esta partida (= puntaje). */
  private score = 0;
  /** Record por modo (rankings separados). */
  private bests: Record<Mode, number | null> = { aleatorio: null, escalera: null };
  private improvedThisRun = false;

  private target = "";
  private typed = "";
  private lastCountdownIndex = -1;

  private countdownTimer: number | null = null;
  private showTimer: number | null = null;
  private vanishTimer: number | null = null;
  private correctTimer: number | null = null;
  private overTimer: number | null = null;
  /** Refresco del reloj de respuesta (fase "input"). */
  private inputTimer: number | null = null;
  /** Fin del tope para responder (performance.now()), valido en estado "input". */
  private inputDeadline = 0;

  constructor(container: HTMLElement) {
    this.bests.aleatorio = readBest("aleatorio");
    this.bests.escalera = readBest("escalera");

    this.hud = new Hud(container, {
      onDigit: (d) => this.inputDigit(d),
      onBackspace: () => this.inputBackspace(),
      onSubmit: () => this.submit(),
      onPickMode: (m) => this.pickMode(m),
    });
    this.hud.showStart(this.bests);

    // En movil no hay Enter: el toque tiene que poder arrancar desde cualquier
    // parte de la pantalla, no solo desde los botones de modo. Se ignoran los <button>, que
    // ya tienen su propio handler (y son los que eligen la opcion), para no
    // arrancar dos veces ni pisar la eleccion.
    container.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.pickMode(this.lastMode);
    });

    // Parcial por timeout en salas: los digitos recordados hasta ahora. En sala
    // el modo es siempre "aleatorio" (no hay eleccion por jugador).
    this.room = initRoomMode("number-memory", {
      getScore: () => this.score,
      onStart: () => this.beginCountdown("aleatorio"),
    });

    window.addEventListener("keydown", this.handleKeyDown);
  }

  // ---------- Input ----------

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      if (this.state === "ready" || this.state === "gameOver") {
        this.pickMode(this.lastMode);
      } else if (this.state === "input") {
        this.submit();
      }
      return;
    }
    if (this.state !== "input") return;

    if (e.key === "Backspace") {
      e.preventDefault();
      this.inputBackspace();
    } else if (/^[0-9]$/.test(e.key)) {
      this.inputDigit(e.key);
    }
  };

  private pickMode(mode: Mode): void {
    // En sala no hay eleccion ni reinicio manual: lo dispara RoomMode (onStart).
    if (this.room) return;
    if (this.state !== "ready" && this.state !== "gameOver") return;
    this.beginCountdown(mode);
  }

  private inputDigit(d: string): void {
    if (this.state !== "input") return;
    if (this.typed.length >= this.digits) return;
    this.typed += d;
    this.hud.renderEntry(this.typed, this.digits);
    SoundEffects.playKey();
  }

  private inputBackspace(): void {
    if (this.state !== "input") return;
    if (this.typed.length === 0) return;
    this.typed = this.typed.slice(0, -1);
    this.hud.renderEntry(this.typed, this.digits);
  }

  private submit(): void {
    if (this.state !== "input") return;
    if (this.typed.length !== this.digits) return; // hay que completar todos los slots
    if (this.typed === this.target) this.onCorrect();
    else this.onWrong();
  }

  // ---------- Flujo de juego ----------

  private beginCountdown(mode: Mode): void {
    this.clearTimers();
    this.mode = mode;
    this.lastMode = mode;
    this.state = "countdown";
    this.digits = startDigits(mode);
    this.score = 0;
    this.target = "";
    this.improvedThisRun = false;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.hud.startPlayUi(mode, this.digits, this.bests[mode]);
    this.runCountdown();
  }

  private runCountdown(): void {
    this.lastCountdownIndex = 0;
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
    SoundEffects.playCountdownTick();

    this.countdownTimer = window.setInterval(() => {
      this.lastCountdownIndex++;
      if (this.lastCountdownIndex >= COUNTDOWN_LABELS.length) {
        this.clearTimer("countdownTimer");
        this.hud.showCountdown(null);
        this.startShowing();
        return;
      }
      this.hud.showCountdown(COUNTDOWN_LABELS[this.lastCountdownIndex]);
      SoundEffects.playCountdownTick();
    }, COUNTDOWN_STEP_MS);
  }

  private startShowing(): void {
    this.state = "showing";
    this.typed = "";

    if (this.mode === "escalera") {
      // El mismo numero que crece: se le agrega un digito al final cada ronda.
      this.target += this.target === "" ? randNonZero() : randDigit();
      this.digits = this.target.length;
    } else {
      // Numero nuevo al azar de la longitud actual.
      this.target = this.makeNumber(this.digits);
    }

    this.hud.setLevel(this.digits);
    this.hud.showNumber(this.target);
    SoundEffects.playReveal();

    this.showTimer = window.setTimeout(() => {
      this.hud.vanishNumber();
      this.vanishTimer = window.setTimeout(() => this.openInput(), VANISH_MS);
    }, showMsFor(this.digits));
  }

  private openInput(): void {
    this.state = "input";
    this.typed = "";
    this.hud.showEntry(this.digits);

    this.inputDeadline = performance.now() + ANSWER_TIME_MS;
    this.hud.setAnswerTime(ANSWER_TIME_MS, ANSWER_TIME_MS);
    this.inputTimer = window.setInterval(() => this.tickInput(), ANSWER_TICK_MS);
  }

  /** Reloj de la respuesta. Al vencer, se acabo: cuenta como error. */
  private tickInput(): void {
    if (this.state !== "input") {
      this.clearTimer("inputTimer");
      return;
    }
    const left = this.inputDeadline - performance.now();
    this.hud.setAnswerTime(Math.max(0, left), ANSWER_TIME_MS);
    if (left <= 0) this.onWrong();
  }

  private onCorrect(): void {
    this.clearTimer("inputTimer");
    this.state = "correct";
    this.score = this.digits;
    if (this.bests[this.mode] === null || this.score > (this.bests[this.mode] as number)) {
      this.bests[this.mode] = this.score;
      this.improvedThisRun = true;
      localStorage.setItem(bestKey(this.mode), String(this.score));
      this.hud.setBest(this.score);
    }
    this.hud.showCorrect(this.target);
    SoundEffects.playCorrect();

    this.correctTimer = window.setTimeout(() => {
      // En aleatorio sube la longitud; en escalera el numero crece solo al mostrarse.
      if (this.mode === "aleatorio") this.digits++;
      this.startShowing();
    }, CORRECT_HOLD_MS);
  }

  private onWrong(): void {
    this.clearTimer("inputTimer");
    this.state = "wrong";
    this.hud.showWrong(this.target, this.typed);
    SoundEffects.playWrong();
    this.overTimer = window.setTimeout(() => this.endGame(), 1500);
  }

  private endGame(): void {
    this.state = "gameOver";
    SoundEffects.playFinish();
    this.hud.showGameOver(this.mode, this.score, this.bests, this.improvedThisRun);
    if (this.room) this.room.reportScore(this.score);
    else this.hud.showRanking("number-memory", this.score, this.mode);
  }

  // ---------- Utilidades ----------

  /** Numero de `n` digitos sin cero inicial (asi la cantidad no es ambigua). */
  private makeNumber(n: number): string {
    let s = randNonZero();
    for (let i = 1; i < n; i++) s += randDigit();
    return s;
  }

  private clearTimer(
    name: "countdownTimer" | "showTimer" | "vanishTimer" | "correctTimer" | "overTimer" | "inputTimer",
  ): void {
    const id = this[name];
    if (id !== null) {
      // countdownTimer e inputTimer son intervalos; el resto, timeouts.
      if (name === "countdownTimer" || name === "inputTimer") window.clearInterval(id);
      else window.clearTimeout(id);
      this[name] = null;
    }
  }

  private clearTimers(): void {
    this.clearTimer("countdownTimer");
    this.clearTimer("showTimer");
    this.clearTimer("vanishTimer");
    this.clearTimer("correctTimer");
    this.clearTimer("overTimer");
    this.clearTimer("inputTimer");
  }

  dispose(): void {
    this.clearTimers();
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}

function randDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

function randNonZero(): string {
  return String(1 + Math.floor(Math.random() * 9));
}

function readBest(mode: Mode): number | null {
  const raw = localStorage.getItem(bestKey(mode));
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
