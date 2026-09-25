import {
  BEST_KEY,
  CHAMBERS,
  CLEAN_SENTENCE_RELIEF,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  encodeScore,
  MAX_DT,
  PRESSURE_FLOOR,
  ROUND_PRESSURE,
  SENTENCE_TIERS,
  SURVIVORS_MAX,
  SURVIVORS_MIN,
  TIME_BASE,
  TIME_MIN,
  TIME_PER_CHAR,
  TIMEOUT_BULLETS,
} from "./constants";
import { Hud, type LivePlayer } from "./Hud";
import { SoundEffects } from "./SoundEffects";
import { TypingChannel, type Progress } from "./TypingChannel";
import { initRoomMode, type RoomMode } from "../../../shared/room/roomMode";

type State = "ready" | "countdown" | "playing" | "roulette" | "gameOver";

/** Dramatizacion del gatillo (ms): suspenso, sostener la muerte, sostener el alivio. */
const TRIGGER_SUSPENSE_MS = 1250;
const DEATH_HOLD_MS = 1150;
const SURVIVE_HOLD_MS = 800;

/** Resultado de una condena (partida). */
export interface RunResult {
  /** Frases superadas (el puntaje). */
  frases: number;
  /** Puesto en la sala virtual (1 = ultimo en pie). */
  placement: number;
  startSurvivors: number;
  wpm: number;
  accuracy: number;
  soleSurvivor: boolean;
}

export class Game {
  private readonly hud: Hud;
  /** Modo sala (multijugador): activo solo con ?room= en la URL. */
  private readonly room: RoomMode | null;

  private state: State = "ready";

  // Frase en curso (modelo estricto: se avanza solo con la tecla correcta).
  private target = "";
  private pos = 0;
  private errorsThisSentence = 0;
  private lastSentence = "";

  // Revolver y progreso de la condena.
  private chamber = 0; // balas cargadas (0..CHAMBERS)
  private round = 1; // sentencia actual (1-based)
  private frases = 0; // frases superadas = puntaje

  // Battle royale virtual.
  private survivors = 0; // vivos incluyendome
  private startSurvivors = 0;
  private reachedSole = false;

  // Timer por frase.
  private timeLimit = 0;
  private timeLeft = 0;

  // Stats secundarias (tabla de resultados).
  private correctKeystrokes = 0;
  private totalKeystrokes = 0;
  private timeElapsed = 0;

  // Pendiente entre la frase y la resolucion del gatillo.
  private completedThisSentence = false;

  // Progreso en vivo del resto de la sala (nickname -> progreso).
  private channel: TypingChannel | null = null;
  private readonly others = new Map<string, Progress>();
  private lastBroadcast = 0;

  private bestFrases: number | null = null;

  // Countdown / loop.
  private countdownTime = 0;
  private lastCountdownIndex = -1;
  private lastTime = 0;

  constructor(container: HTMLElement) {
    const savedBest = localStorage.getItem(BEST_KEY);
    if (savedBest) this.bestFrases = parseInt(savedBest, 10);

    this.hud = new Hud(container);
    this.hud.showStart(this.bestFrases);

    // Parcial por timeout de sala: frases superadas + ppm hasta el momento.
    this.room = initRoomMode("typing-race", {
      getScore: () => encodeScore(this.frases, this.liveWpm()),
      onStart: () => this.beginCountdown(),
    });

    // En sala: canal para ver el progreso del resto en vivo.
    if (this.room) {
      this.channel = new TypingChannel(this.room.code);
      this.channel.onProgress((pr) => this.onOthers(pr));
      this.hud.enableLivePanel();
    }

    window.addEventListener("keydown", this.handleKeyDown);

    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  // ---------- Input ----------

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.state === "playing") {
      this.handleTypingKey(e);
      return;
    }
    if (e.key !== "Enter") return;
    if (this.state === "ready") {
      this.beginCountdown();
    } else if (this.state === "gameOver") {
      if (this.room) return; // una sola condena por ronda en sala
      this.beginCountdown();
    }
  };

  private handleTypingKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return; // solo caracteres imprimibles; sin backspace

    e.preventDefault();
    const expected = this.target[this.pos];
    this.totalKeystrokes++;

    if (e.key === expected) {
      this.pos++;
      this.correctKeystrokes++;
      SoundEffects.playKey();
      if (this.pos >= this.target.length) {
        this.completeSentence(false);
        return;
      }
      this.hud.renderSentence(this.target, this.pos);
    } else {
      // Cada tecla equivocada carga una bala en el tambor, al instante.
      this.errorsThisSentence++;
      this.chamber = Math.min(CHAMBERS, this.chamber + 1);
      SoundEffects.playError();
      this.hud.flashError();
      this.hud.setChamber(this.chamber);
    }
  }

  // ---------- Frase / ronda ----------

  private pickSentence(): string {
    const r = this.round;
    const tier = r >= 13 ? 3 : r >= 8 ? 2 : r >= 4 ? 1 : 0;
    const pool = SENTENCE_TIERS[tier];
    let s = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) {
      while (s === this.lastSentence) s = pool[Math.floor(Math.random() * pool.length)];
    }
    this.lastSentence = s;
    return s;
  }

  private loadSentence(): void {
    this.target = this.pickSentence();
    this.pos = 0;
    this.errorsThisSentence = 0;

    const raw = TIME_BASE + this.target.length * TIME_PER_CHAR;
    const pressure = Math.max(PRESSURE_FLOOR, 1 - this.round * ROUND_PRESSURE);
    this.timeLimit = Math.max(TIME_MIN, raw * pressure);
    this.timeLeft = this.timeLimit;

    this.hud.setRound(this.round);
    this.hud.setChamber(this.chamber);
    this.hud.setFrases(this.frases);
    this.hud.setSurvivors(this.survivors, this.startSurvivors);
    this.hud.setTimer(this.timeLeft, this.timeLimit);
    this.hud.renderSentence(this.target, this.pos);
  }

  private beginCountdown(): void {
    this.state = "countdown";

    this.chamber = 0;
    this.round = 1;
    this.frases = 0;
    this.correctKeystrokes = 0;
    this.totalKeystrokes = 0;
    this.timeElapsed = 0;
    this.reachedSole = false;
    this.lastSentence = "";
    this.survivors = randInt(SURVIVORS_MIN, SURVIVORS_MAX);
    this.startSurvivors = this.survivors;

    this.loadSentence();

    this.countdownTime = 0;
    this.lastCountdownIndex = -1;

    this.hud.hideOverlay();
    this.hud.showChrome();
    this.hud.showCountdown(COUNTDOWN_LABELS[0]);
  }

  private startPlaying(): void {
    this.state = "playing";
    this.hud.showPlay();
    this.hud.renderSentence(this.target, this.pos);
    this.hud.setPpm(this.liveWpm());
    this.broadcastProgress();
  }

  private liveWpm(): number {
    const minutes = this.timeElapsed / 60;
    return minutes > 0 ? Math.round(this.correctKeystrokes / 5 / minutes) : 0;
  }

  // ---------- Progreso en vivo de la sala ----------

  private onOthers(pr: Progress): void {
    this.others.set(pr.p, pr);
    if (this.room) this.hud.setLivePlayers(this.buildLive());
  }

  private buildLive(): LivePlayer[] {
    const me = this.room!.me;
    const dead = this.state === "gameOver";
    const list: LivePlayer[] = this.room!.players().map((name) => {
      if (name === me) return { name, frases: this.frases, dead, me: true };
      const pr = this.others.get(name);
      return { name, frases: pr?.f ?? 0, dead: pr?.d ?? false, me: false };
    });
    list.sort((a, b) => b.frases - a.frases || (a.name < b.name ? -1 : 1));
    return list;
  }

  private broadcastProgress(): void {
    if (!this.room || !this.channel) return;
    this.lastBroadcast = performance.now();
    this.channel.send({
      p: this.room.me,
      f: this.frases,
      c: this.chamber,
      d: this.state === "gameOver",
    });
    this.hud.setLivePlayers(this.buildLive());
  }

  // ---------- Gatillo (ruleta) ----------

  private completeSentence(timedOut: boolean): void {
    this.state = "roulette";
    this.completedThisSentence = !timedOut;

    if (timedOut) {
      this.chamber = Math.min(CHAMBERS, this.chamber + TIMEOUT_BULLETS);
    } else if (this.errorsThisSentence === 0) {
      // Frase perfecta: sacas una bala ANTES de jalar el gatillo (baja el riesgo
      // de esta misma ruleta). Simetrico a "cada error carga una bala".
      this.chamber = Math.max(0, this.chamber - CLEAN_SENTENCE_RELIEF);
    }

    this.hud.setChamber(this.chamber);
    this.hud.startTriggerPull(this.chamber, timedOut);
    SoundEffects.playSpin();
    window.setTimeout(() => this.resolveTrigger(), TRIGGER_SUSPENSE_MS);
  }

  private resolveTrigger(): void {
    if (this.state !== "roulette") return;
    const dead = Math.random() < this.chamber / CHAMBERS;

    if (dead) {
      SoundEffects.playGunshot();
      this.hud.showDeath();
      window.setTimeout(() => this.endGame(), DEATH_HOLD_MS);
      return;
    }

    SoundEffects.playClick();
    if (this.completedThisSentence) this.frases++;
    this.updateSurvivors();
    this.round++;
    this.hud.showClickRelief(this.chamber, this.frases);
    this.broadcastProgress();
    window.setTimeout(() => this.nextSentence(), SURVIVE_HOLD_MS);
  }

  private nextSentence(): void {
    if (this.state !== "roulette") return;
    this.state = "playing";
    this.loadSentence();
    this.hud.showPlay();
  }

  /** Elimina a otros presos (ambiente battle royale). Nunca baja de 1 (vos). */
  private updateSurvivors(): void {
    if (this.survivors <= 1) return;
    const elim = Math.min(this.survivors - 1, Math.ceil(this.survivors * 0.11) + randInt(0, 2));
    if (elim <= 0) return;
    this.survivors -= elim;
    SoundEffects.playDistantShots(elim);
    this.hud.setSurvivors(this.survivors, this.startSurvivors);
    if (this.survivors <= 1 && !this.reachedSole) {
      this.reachedSole = true;
      this.hud.showSoleSurvivor();
    }
  }

  // ---------- Fin ----------

  private endGame(): void {
    this.state = "gameOver";

    const score = this.frases;
    let isNewBest = false;
    if (this.bestFrases === null || score > this.bestFrases) {
      this.bestFrases = score;
      localStorage.setItem(BEST_KEY, String(score));
      isNewBest = true;
    }

    const wpm = this.liveWpm();
    const accuracy =
      this.totalKeystrokes > 0
        ? Math.round((this.correctKeystrokes / this.totalKeystrokes) * 100)
        : 100;
    const placement = this.reachedSole ? 1 : this.survivors;

    const result: RunResult = {
      frases: score,
      placement,
      startSurvivors: this.startSurvivors,
      wpm,
      accuracy,
      soleSurvivor: this.reachedSole,
    };

    this.hud.showGameOver(result, isNewBest, this.bestFrases ?? 0);

    // Ranking (global y sala): frases primero, ppm como desempate (score codificado).
    const ranked = encodeScore(score, wpm);
    if (this.room) {
      this.room.reportScore(ranked, { variant: "final" });
      this.broadcastProgress(); // avisa a la sala que cai (dead=true)
    } else {
      this.hud.showRanking("typing-race", ranked, "final");
    }
  }

  // ---------- Loop ----------

  private tick = (now: number): void => {
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;
    this.update(dt);
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    if (this.state === "countdown") {
      this.countdownTime += dt;
      const index = Math.floor(this.countdownTime / COUNTDOWN_STEP);
      if (index >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.startPlaying();
      } else if (index !== this.lastCountdownIndex) {
        this.lastCountdownIndex = index;
        SoundEffects.playCountdownTick();
        this.hud.showCountdown(COUNTDOWN_LABELS[index]);
      }
    } else if (this.state === "playing") {
      this.timeElapsed += dt;
      this.timeLeft -= dt;
      this.hud.setPpm(this.liveWpm());
      if (this.room && performance.now() - this.lastBroadcast > 2000) this.broadcastProgress();
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.hud.setTimer(0, this.timeLimit);
        this.completeSentence(true);
      } else {
        this.hud.setTimer(this.timeLeft, this.timeLimit);
      }
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}

/** Entero aleatorio en [min, max]. */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
