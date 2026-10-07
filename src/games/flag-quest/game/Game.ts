import {
  ANSWER_MS,
  BEST_KEY,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  FEEDBACK_MS,
  ROOM_TIERS,
  SOLO_LIVES,
  VARIANT_ROOM,
  VARIANT_SOLO,
  buildQuestion,
  buildRoomQuiz,
  pointsFor,
  soloLevel,
  type Question,
} from "./constants";
import { preloadFlag } from "./flags";
import { Hud } from "./Hud";
import type { FriarMood } from "./Friar";
import { SoundEffects } from "./SoundEffects";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { clearRoomRun, loadRoomRun, saveRoomRun } from "../../../shared/room/roomRun";

const GAME_ID = "flag-quest";

type State = "ready" | "countdown" | "question" | "feedback" | "gameOver";

/** Cuantas banderas se bajan por adelantado en solitario. */
const SOLO_PRELOAD = 3;
/**
 * El reloj tambien avanza con un timer, no solo con requestAnimationFrame: el
 * navegador pausa el rAF en una pestana oculta, y en sala la partida tiene que
 * terminar y reportarse aunque el jugador no vuelva.
 */
const BACKGROUND_TICK_MS = 250;

/**
 * Partida de sala guardada para sobrevivir un F5 (ver roomRun.ts). Las banderas
 * no se guardan: salen de la semilla. Lo que se guarda es por donde iba y desde
 * cuando (epoch), asi recargar no reinicia la ronda —que con banderas repetidas
 * seria jugarla de nuevo sabiendo las respuestas— ni pausa el reloj.
 */
interface SavedRun {
  index: number;
  score: number;
  hits: number;
  phase: "question" | "feedback";
  phaseStart: number;
  picked: string | null;
}

export class Game {
  private readonly hud: Hud;
  private readonly room: RoomMode | null;
  private readonly container: HTMLElement;

  private state: State = "ready";
  private best: number | null = null;

  // Partida
  private questions: Question[] = [];
  private used = new Set<string>();
  private index = 0;
  private score = 0;
  private hits = 0;
  private lives = SOLO_LIVES;
  private picked: string | null = null;

  // Para el fraile: aciertos seguidos (festeja desde el tercero) y tiempos
  // vencidos seguidos (con dos se queda dormido hasta que respondas).
  private streak = 0;
  private timeoutsInRow = 0;

  /**
   * Epoch (Date.now) en que arranco la fase actual. Todo el tiempo del juego se
   * mide contra el reloj de pared y no acumulando dt: irse a otra pestana no lo
   * frena, y al volver se cobran de una todas las banderas que vencieron.
   */
  private phaseStart = 0;
  private lastCountdownIndex = -1;

  constructor(container: HTMLElement) {
    this.container = container;
    const saved = localStorage.getItem(BEST_KEY);
    if (saved) this.best = parseFloat(saved);

    this.room = initRoomMode(GAME_ID, {
      getScore: () => this.score,
      onStart: () => this.beginCountdown(),
    });

    this.hud = new Hud(container, {
      onPick: (code) => this.pick(code),
      isRoom: !!this.room,
    });
    this.hud.showStart(this.best);

    container.addEventListener("pointerdown", this.handlePointer);
    window.addEventListener("keydown", this.handleKeyDown);
    window.setInterval(() => this.advance(Date.now()), BACKGROUND_TICK_MS);
    requestAnimationFrame(this.frame);
  }

  // ---------- Input ----------

  private handlePointer = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.state === "ready" || this.state === "gameOver") this.startFromMenu();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.state === "question") {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 4) {
        e.preventDefault();
        const option = this.questions[this.index].options[n - 1];
        if (option) this.pick(option.code);
      }
      return;
    }
    if (e.key === "Enter" && (this.state === "ready" || this.state === "gameOver")) {
      e.preventDefault();
      this.startFromMenu();
    }
  };

  private startFromMenu(): void {
    if (this.room) return; // en sala arranca onStart, y es una sola partida por ronda
    this.beginCountdown();
  }

  // ---------- Flujo ----------

  private beginCountdown(): void {
    if (this.room && this.resumeSavedRun()) return;

    this.used = new Set();
    this.questions = this.room ? buildRoomQuiz(`${this.room.code}:${this.room.round()}`) : [];
    this.index = 0;
    this.score = 0;
    this.hits = 0;
    this.lives = SOLO_LIVES;
    this.picked = null;
    this.streak = 0;
    this.timeoutsInRow = 0;
    this.state = "countdown";
    this.phaseStart = Date.now();
    this.lastCountdownIndex = -1;

    // Las primeras banderas bajan durante la cuenta, para que no le coman segundos a nadie.
    this.ensureQuestion(0);
    this.preloadAhead();

    this.hud.hideOverlay();
    this.hud.showTopBar(this.progressLabel(), this.score, this.room ? null : this.lives);
    this.hud.clearQuestion();
  }

  /** Arma (solitario) la pregunta `i` si todavia no existe. */
  private ensureQuestion(i: number): void {
    while (this.questions.length <= i) {
      this.questions.push(buildQuestion(soloLevel(this.questions.length), this.used, Math.random));
    }
  }

  private preloadAhead(): void {
    const ahead = this.room ? ROOM_TIERS.length : this.index + SOLO_PRELOAD;
    for (let i = this.index; i <= ahead; i++) {
      if (this.room && i >= this.questions.length) break;
      this.ensureQuestion(i);
      preloadFlag(this.questions[i].answer.code);
    }
  }

  private progressLabel(): string {
    if (this.room) return `Lámina ${Math.min(this.index + 1, ROOM_TIERS.length)} / ${ROOM_TIERS.length}`;
    return `Lámina ${this.index + 1}`;
  }

  private showQuestion(start: number): void {
    this.state = "question";
    this.phaseStart = start;
    this.picked = null;
    this.ensureQuestion(this.index);
    this.preloadAhead();
    this.hud.showTopBar(this.progressLabel(), this.score, this.room ? null : this.lives);
    this.hud.showQuestion(this.questions[this.index]);
    this.hud.setFriar(this.timeoutsInRow >= 2 ? "sleep" : "idle");
    this.saveRun();
  }

  private pick(code: string): void {
    if (this.state !== "question") return;
    const now = Date.now();
    if (now >= this.phaseStart + ANSWER_MS) return; // vencio: lo cobra advance()
    this.resolve(code, now);
  }

  /** Cierra la bandera actual: con lo elegido, o con null si vencio el tiempo. */
  private resolve(code: string | null, at: number): void {
    const q = this.questions[this.index];
    const correct = code === q.answer.code;
    // Al volver de otra pestana se cobran varias de golpe: que no suene una rafaga.
    const live = Date.now() - at < 300;
    let gained = 0;
    if (correct) {
      gained = pointsFor(this.phaseStart + ANSWER_MS - at);
      this.score += gained;
      this.hits += 1;
      if (live) SoundEffects.playCorrect();
    } else {
      if (!this.room) this.lives -= 1;
      if (live) SoundEffects.playWrong();
    }
    this.picked = code;
    this.state = "feedback";
    this.phaseStart = at;
    this.hud.showTopBar(this.progressLabel(), this.score, this.room ? null : this.lives);
    this.hud.showFeedback(q, code, gained);
    this.hud.setFriar(this.friarMood(code, correct));
    this.saveRun();
  }

  private friarMood(code: string | null, correct: boolean): FriarMood {
    if (correct) {
      this.streak += 1;
      this.timeoutsInRow = 0;
      return this.streak >= 3 ? "cheer" : "correct";
    }
    this.streak = 0;
    if (code === null) {
      this.timeoutsInRow += 1;
      return "timeout";
    }
    this.timeoutsInRow = 0;
    return "wrong";
  }

  private afterFeedback(at: number): void {
    const finished = this.room ? this.index >= ROOM_TIERS.length - 1 : this.lives <= 0;
    if (finished) {
      this.endGame();
      return;
    }
    this.index += 1;
    this.showQuestion(at);
  }

  private endGame(): void {
    this.state = "gameOver";
    const total = this.room ? ROOM_TIERS.length : this.index + 1;

    if (this.room) {
      clearRoomRun(this.room, GAME_ID);
      this.hud.showRoomResult(this.score, this.hits, total);
      this.room.reportScore(this.score, { variant: VARIANT_ROOM });
      return;
    }

    let isNewBest = false;
    if (this.best === null || this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.score));
      isNewBest = this.score > 0;
    }
    this.hud.showGameOver(this.score, this.hits, total, isNewBest, this.best);
    this.hud.showRanking(GAME_ID, this.score, VARIANT_SOLO);
  }

  // ---------- Reloj ----------

  private frame = (): void => {
    this.advance(Date.now());
    requestAnimationFrame(this.frame);
  };

  /**
   * Hace avanzar la partida hasta `now`. Es un bucle a proposito: si la pestana
   * estuvo oculta, cada fase vencida arranca la siguiente en el instante en que
   * vencio (no al volver), asi el que se fue 20 segundos pierde las banderas que
   * pasaron en esos 20 segundos.
   */
  private advance(now: number): void {
    for (let guard = 0; guard < 100; guard++) {
      if (this.state === "countdown") {
        const stepMs = COUNTDOWN_STEP * 1000;
        const idx = Math.floor((now - this.phaseStart) / stepMs);
        if (idx >= COUNTDOWN_LABELS.length) {
          this.hud.showCountdown(null);
          SoundEffects.playStart();
          this.showQuestion(this.phaseStart + COUNTDOWN_LABELS.length * stepMs);
          continue;
        }
        if (idx !== this.lastCountdownIndex) {
          this.lastCountdownIndex = idx;
          SoundEffects.playCountdownTick();
          this.hud.showCountdown(COUNTDOWN_LABELS[idx]);
        }
        return;
      }
      if (this.state === "question") {
        const deadline = this.phaseStart + ANSWER_MS;
        if (now >= deadline) {
          this.resolve(null, deadline);
          continue;
        }
        this.hud.setTime(deadline - now, ANSWER_MS);
        return;
      }
      if (this.state === "feedback") {
        const end = this.phaseStart + FEEDBACK_MS;
        if (now >= end) {
          this.afterFeedback(end);
          continue;
        }
        return;
      }
      return;
    }
  }

  // ---------- F5 en sala ----------

  private saveRun(): void {
    if (!this.room) return;
    if (this.state !== "question" && this.state !== "feedback") return;
    const data: SavedRun = {
      index: this.index,
      score: this.score,
      hits: this.hits,
      phase: this.state,
      phaseStart: this.phaseStart,
      picked: this.picked,
    };
    saveRoomRun(this.room, GAME_ID, data);
  }

  /** Retoma la partida de esta ronda tras un F5. Devuelve false si no habia. */
  private resumeSavedRun(): boolean {
    const s = loadRoomRun<SavedRun>(this.room!, GAME_ID);
    if (!s || typeof s.index !== "number" || typeof s.phaseStart !== "number") return false;

    this.questions = buildRoomQuiz(`${this.room!.code}:${this.room!.round()}`);
    if (s.index < 0 || s.index >= this.questions.length) return false;
    this.index = s.index;
    this.score = s.score;
    this.hits = s.hits;
    this.picked = s.picked;
    this.phaseStart = s.phaseStart;
    this.state = s.phase;

    this.preloadAhead();
    this.hud.hideOverlay();
    this.hud.showCountdown(null);
    this.hud.showTopBar(this.progressLabel(), this.score, null);
    const q = this.questions[this.index];
    if (s.phase === "question") this.hud.showQuestion(q);
    else this.hud.showFeedback(q, s.picked, 0);
    // Cobra lo que vencio mientras la pagina recargaba.
    this.advance(Date.now());
    return true;
  }

  dispose(): void {
    this.container.removeEventListener("pointerdown", this.handlePointer);
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}
