import { initRoomMode } from "../../../shared/room/roomMode";
import {
  AFTER_TIME,
  BEST_KEY,
  BET_TIME,
  CHIP_VALUES,
  COUNTDOWN_LABELS,
  COUNTDOWN_STEP,
  FIRST_BET,
  FLIGHTS,
  LIVE_KEEPALIVE,
  MAX_DT,
  MIN_BET,
  SOLO_BET_TIME,
  SOLO_LAUNCH_DELAY,
  START_CHIPS,
} from "./constants";
import { devRoom, type RoomLink } from "./devRoom";
import { Flight, hashSeed, multAt } from "./Flight";
import { fmtMult, Hud, type LiveView, type RivalRow } from "./Hud";
import { parseLive, Rivals, type CkLive } from "./Rivals";
import { SoundEffects } from "./SoundEffects";
import { Stage } from "./Stage";

type State = "ready" | "countdown" | "bet" | "flight" | "after" | "over";

/** En pantallas tactiles se dice "toca", no "espacio o clic". */
const TOUCH = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Encendido del motor en la plataforma antes de despegar (s). */
const IGNITE_TIME = 1.2;

/**
 * El Cohete: diez vuelos de crash con fichas de mentira. Cada vuelo esta decidido
 * entero por su semilla (`Flight`), asi en la sala todos ven el mismo cohete. Los
 * relojes de fase son absolutos (`performance.now()`), no acumulados por cuadro: una
 * pestana en segundo plano no se atrasa respecto del resto de la mesa.
 */
export class Game {
  private readonly stage: Stage;
  private readonly hud: Hud;
  private readonly room: RoomLink | null;
  private rivals: Rivals | null = null;

  private state: State = "ready";
  private best: number | null = null;
  private seedBase = "";
  private chips = START_CHIPS;
  private bet = FIRST_BET;
  /** Lo apostado en el vuelo en curso (0 = no apostó). */
  private placed = 0;
  /** Multiplicador al que se bajo en este vuelo (0 = no). */
  private cashed = 0;
  private flightNo = 0;
  private flight!: Flight;
  /** Momento (ms) en que despega / despego el vuelo en curso. */
  private launchAt = 0;
  /** Fin de la fase actual (ms). */
  private phaseEnd = 0;
  /** Momento (ms) en que arranco la cuenta regresiva. */
  private countdownAt = 0;
  private lastCountdownIndex = -1;
  private lastTick = -1;
  private bestJump = 0;
  private resetAt = 0;
  private liveIdle = 0;
  private lastLive = "";
  private lastFrame = performance.now();
  private time = 0;

  constructor(container: HTMLElement) {
    const saved = localStorage.getItem(BEST_KEY);
    if (saved) this.best = Number(saved);

    this.stage = new Stage(container);
    this.hud = new Hud(container);
    this.hud.setBest(this.best);
    this.hud.showStart(this.best);
    this.hud.onChip((v) => this.pickBet(v));
    this.hud.onMain((at) => this.main(at));

    this.room =
      initRoomMode("el-cohete", {
        // Si el reloj de la sala corta durante la apuesta, lo apostado vuelve; en vuelo, esta en juego.
        getScore: () => this.chips + (this.state === "bet" ? this.placed : 0),
        onStart: () => this.beginCountdown(),
      }) ?? devRoom(() => this.beginCountdown());
    this.room?.onLive((player, data) => {
      const m = parseLive(data, this.room?.round() ?? 0);
      if (!m || !this.rivals) return;
      const r = this.rivals.apply(player, m);
      if (r && this.state === "flight" && m.f === this.flightNo) {
        this.stage.jump(r.seat, `${r.name} ${fmtMult(m.c / 100)}`);
        SoundEffects.rivalJump();
        this.hud.toast(`${r.name} cobró en ${fmtMult(m.c / 100)}`, "info");
      }
    });

    this.paintTable();
    window.addEventListener("resize", () => this.stage.resize());
    window.addEventListener("keydown", this.onKeyDown);
    // Sobre el container, no sobre el canvas: la tabla de inicio lo tapa.
    container.addEventListener("pointerdown", this.onPointerDown);
    requestAnimationFrame(this.tick);
  }

  // ---------- Input ----------

  private onKeyDown = (e: KeyboardEvent): void => {
    SoundEffects.unlock();
    if (this.state === "ready" || this.state === "over") {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        this.onStartInput();
      }
      return;
    }
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (!e.repeat) this.main(e.timeStamp);
      return;
    }
    if (e.repeat) return;
    // Teclas 1-4: las fichas del paño; 5: todo.
    if (/^Digit[1-5]$/.test(e.code)) {
      const k = Number(e.code.slice(5));
      this.pickBet(k === 5 ? Infinity : CHIP_VALUES[k - 1]);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    SoundEffects.unlock();
    if (this.state === "ready" || this.state === "over") this.onStartInput();
    // En vuelo con fichas arriba no hay paño: se cobra tocando cualquier parte.
    else if (this.state === "flight" && this.placed > 0 && !this.cashed) this.main(e.timeStamp);
  };

  private onStartInput(): void {
    // En sala se juega una sola partida por ronda.
    if (this.state === "over" && this.room) return;
    this.beginCountdown();
  }

  // ---------- Apuesta ----------

  private canEditBet(): boolean {
    return this.state === "bet" && this.placed === 0;
  }

  /** Tocar una ficha FIJA la apuesta en ese valor (`Infinity` = todo). */
  private pickBet(v: number): void {
    if (!this.canEditBet() || this.chips < MIN_BET) return;
    this.bet = Math.min(this.chips, v);
    SoundEffects.chip();
    this.paintTable();
  }

  /** El boton grande: apostar / cancelar en la plataforma, bajarse en vuelo. */
  private main(at: number): void {
    if (this.state === "bet") {
      // Apostado queda apostado: el paño se va y no hay como retirarla.
      if (this.placed > 0) return;
      {
        const amount = Math.min(this.chips, Math.max(MIN_BET, this.bet));
        if (this.chips < MIN_BET || amount < MIN_BET) return;
        this.bet = amount;
        this.placed = amount;
        this.chips -= amount;
        SoundEffects.betPlaced();
        // Solo: apostar despega (con un instante de encendido).
        if (!this.room) {
          const now = performance.now();
          this.phaseEnd = Math.min(this.phaseEnd, now + SOLO_LAUNCH_DELAY * 1000);
        }
      }
      this.sendLive(true);
      this.paintTable();
      return;
    }
    if (this.state === "flight" && this.placed > 0 && !this.cashed) {
      const t = (at - this.launchAt) / 1000;
      if (t >= this.flight.crashT) return;
      this.cashOut(multAt(t));
    }
  }

  private cashOut(m: number): void {
    const shown = Math.floor(m * 100) / 100;
    this.cashed = shown;
    const win = Math.floor(this.placed * shown);
    this.chips += win;
    this.bestJump = Math.max(this.bestJump, shown);
    SoundEffects.cashOut(shown >= 3);
    this.stage.jump(this.mySeat(), `${this.room ? this.room.me : "Vos"} ${fmtMult(shown)}`);
    // Sin aviso aparte: el numero gigante ya dice "¡Cobraste +N!".
    this.sendLive(true);
    this.paintTable();
  }

  private mySeat(): number {
    return this.room ? Math.max(0, this.room.players().indexOf(this.room.me)) : 0;
  }

  // ---------- Flujo ----------

  private beginCountdown(): void {
    if (this.state !== "ready" && this.state !== "over") return;
    this.state = "countdown";
    this.countdownAt = performance.now();
    this.lastCountdownIndex = -1;
    this.chips = START_CHIPS;
    this.bet = FIRST_BET;
    this.placed = 0;
    this.cashed = 0;
    this.flightNo = 0;
    this.bestJump = 0;
    this.seedBase = this.room ? `${this.room.code}:${this.room.round()}` : String((Math.random() * 2 ** 31) >>> 0);
    if (this.room && !this.rivals) {
      const all = this.room.players();
      const others = all.filter((p) => p !== this.room?.me);
      this.rivals = new Rivals(others, others.map((p) => all.indexOf(p)), START_CHIPS);
    }
    this.hud.clearHistory();
    this.hud.hideOverlay();
    this.hud.setPlaying(true);
    this.stage.resetPad();
    this.paintTable();
  }

  private openBet(now: number): void {
    this.flightNo++;
    this.flight = new Flight(hashSeed(`${this.seedBase}:${this.flightNo}`));
    this.state = "bet";
    this.placed = 0;
    this.cashed = 0;
    this.lastTick = -1;
    this.phaseEnd = now + (this.room ? BET_TIME : SOLO_BET_TIME) * 1000;
    if (this.flightNo > 1) {
      // Fundido a negro y cohete nuevo en la plataforma a mitad del fundido.
      this.hud.fade();
      this.resetAt = now + 260;
    }
    // Sin fichas para la minima: solo se termina; en sala se sigue mirando.
    if (this.chips < MIN_BET && !this.room) {
      this.finish(true);
      return;
    }
    this.bet = Math.min(this.chips, Math.max(MIN_BET, this.bet));
    this.sendLive(true);
    this.paintTable();
  }

  private launch(now: number): void {
    this.state = "flight";
    this.launchAt = now;
    this.stage.launch();
    SoundEffects.launch();
    SoundEffects.startEngine();
    this.paintTable();
  }

  private boom(): void {
    this.state = "after";
    this.phaseEnd = performance.now() + AFTER_TIME * 1000;
    this.stage.explode();
    this.hud.flash();
    SoundEffects.stopEngine(true);
    SoundEffects.boom();
    this.hud.pushHistory(this.flight.crash);
    if (this.placed > 0 && !this.cashed) {
      this.hud.toast(`−${this.placed.toLocaleString("es-AR")}`, "danger");
    }
    this.sendLive(true);
    this.paintTable();
  }

  private finish(broke = false): void {
    this.state = "over";
    SoundEffects.stopEngine();
    const isBest = this.chips > 0 && (this.best === null || this.chips > this.best);
    if (isBest) {
      this.best = this.chips;
      localStorage.setItem(BEST_KEY, String(this.chips));
    }
    this.hud.setBest(this.best);
    this.hud.setPlaying(false);
    SoundEffects.jackpot(this.chips > START_CHIPS);
    this.hud.showGameOver({ chips: this.chips, start: START_CHIPS, best: this.best, isBest, bestFlight: this.bestJump, room: this.room !== null, broke });
    this.sendLive(true);
    if (this.room) this.room.reportScore(this.chips);
    else this.hud.showRanking(this.chips);
  }

  // ---------- Bucle ----------

  private tick = (now: number): void => {
    const dt = Math.min(MAX_DT, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    this.update(dt, performance.now());
    requestAnimationFrame(this.tick);
  };

  private update(dt: number, now: number): void {
    let mult = 1;
    let ignite = 0;
    let phase: "pad" | "flight" | "boom" = "pad";

    if (this.state === "countdown") {
      // Reloj de pared: en la sala todos largan a la vez aunque una pestana vaya lenta.
      const idx = Math.floor((now - this.countdownAt) / 1000 / COUNTDOWN_STEP);
      if (idx !== this.lastCountdownIndex && idx < COUNTDOWN_LABELS.length) {
        this.lastCountdownIndex = idx;
        SoundEffects.playCountdownTick();
      }
      if (idx >= COUNTDOWN_LABELS.length) {
        this.hud.showCountdown(null);
        this.openBet(now);
      } else this.hud.showCountdown(COUNTDOWN_LABELS[idx]);
    }

    if (this.state === "bet") {
      if (this.resetAt && now >= this.resetAt) {
        this.resetAt = 0;
        this.stage.resetPad();
      }
      const left = (this.phaseEnd - now) / 1000;
      ignite = Math.max(0, Math.min(1, 1 - left / IGNITE_TIME));
      const sec = Math.ceil(left);
      if (left <= 3 && sec !== this.lastTick && sec > 0) {
        this.lastTick = sec;
        SoundEffects.betTick();
      }
      if (left <= 0) this.launch(this.phaseEnd);
    }

    if (this.state === "flight") {
      const t = (now - this.launchAt) / 1000;
      if (t >= this.flight.crashT) {
        mult = this.flight.crash;
        this.boom();
      } else {
        mult = multAt(t);
        phase = "flight";
        SoundEffects.setEngine(mult, 1);
      }
    }

    if (this.state === "after") {
      phase = "boom";
      mult = this.flight.crash;
      if (now >= this.phaseEnd) {
        if (this.flightNo >= FLIGHTS) this.finish();
        else this.openBet(now);
      }
    }

    this.stage.update(dt, this.time, { phase, mult, ignite });
    this.paintFrame(mult, now);
    this.updateLive(dt);
  }

  // ---------- HUD ----------

  /** Lo que cambia cada cuadro: multiplicador, textos de fase y el boton. */
  private paintFrame(mult: number, now: number): void {
    const h = this.hud;
    const n = (v: number) => Math.floor(v).toLocaleString("es-AR");
    const hint = TOUCH ? "tocá la pantalla para cobrar" : "espacio o clic para cobrar";
    let live: LiveView | null = null;
    if (this.state === "bet") {
      // Antes del despegue el cartel grande es la cuenta regresiva, no un "x1.00" que
      // no se entiende: lo primero que hay que saber es cuanto falta para apostar.
      const left = Math.max(0, Math.ceil((this.phaseEnd - now) / 1000));
      h.setMult(String(left), "pad");
      if (this.placed) {
        live = { big: this.room ? String(left) : "¡YA!", sub: `apostaste ${n(this.placed)}`, hint: this.room ? "segundos para despegar" : "despegando", tone: "wait" };
      } else if (this.chips < MIN_BET) {
        h.setPhase("segundos para despegar");
        h.setSteps("off", "off", "Te quedaste sin fichas");
        h.setMain("off", "Sin fichas", "mirá el vuelo");
      } else {
        h.setPhase("segundos para apostar");
        h.setSteps("active", "active", "Tocá para apostar");
        h.setMain("bet", "Apostar", n(Math.min(this.chips, this.bet)));
      }
    } else if (this.state === "flight") {
      h.setMult(mult, this.cashed ? "cashed" : "flight");
      if (this.placed && !this.cashed) {
        live = { big: fmtMult(mult), sub: `+${n(this.placed * Math.floor(mult * 100) / 100)} si cobrás ahora`, hint, tone: "cash" };
      } else if (this.cashed) {
        live = { big: fmtMult(this.cashed), sub: `¡Cobraste +${n(this.placed * this.cashed)}!`, hint: "mirá hasta dónde llega", tone: "won" };
      } else {
        h.setPhase("esta vez no apostaste");
        h.setSteps("off", "off", "Mirá y apostá en el próximo");
        h.setMain("off", "Sin apuesta", "próximo vuelo");
      }
    } else if (this.state === "after") {
      h.setMult(this.flight.crash <= 1 ? "¡BOOM!" : fmtMult(this.flight.crash), "boom");
      h.setPhase(this.flight.crash <= 1 ? "explotó en el despegue" : "explotó");
      const lost = this.placed && !this.cashed;
      h.setSteps("off", "off", this.cashed ? "¡Cobraste a tiempo!" : lost ? "Explotó antes de que cobres" : "Explotó", this.placed ? `Apostaste ${n(this.placed)}` : undefined);
      h.setMain("off", this.cashed ? "Ganaste" : lost ? "Perdiste" : "Explotó", this.cashed ? `+${n(this.placed * this.cashed)}` : lost ? `−${n(this.placed)}` : "");
    } else if (this.state === "countdown" || this.state === "ready" || this.state === "over") {
      h.setMult("¡A JUGAR!", "pad");
      h.setPhase("abre la mesa");
    }
    h.setLive(live);
    if (this.rivals && this.room) this.paintRivals();
  }

  /** Lo que cambia por evento: fichas, apuesta y vuelo. */
  private paintTable(): void {
    this.hud.setBank(this.chips);
    this.hud.setBet(this.placed || Math.min(this.bet, this.chips), this.chips + this.placed, this.canEditBet());
    this.hud.setFlight(Math.max(1, this.flightNo), FLIGHTS);
  }

  private paintRivals(): void {
    const rows: RivalRow[] = this.rivals!.list.filter((r) => this.rivals!.fresh(r)).map((r) => ({
      name: r.name,
      seat: r.seat,
      chips: r.chips,
      status: r.flight !== this.flightNo || !r.bet ? "" : r.cash > 0 ? fmtMult(r.cash / 100) : r.cash < 0 ? "boom" : this.state === "bet" ? "apostó" : "arriba",
    }));
    const myStatus = !this.placed ? "" : this.cashed ? fmtMult(this.cashed) : this.state === "after" ? "boom" : this.state === "bet" ? "apostó" : "arriba";
    this.hud.setRivals(rows, { name: this.room!.me, seat: this.mySeat(), chips: this.chips, status: myStatus });
  }

  // ---------- Sala en vivo ----------

  private updateLive(dt: number): void {
    if (!this.room || this.state === "ready") return;
    this.liveIdle += dt;
    if (this.liveIdle >= LIVE_KEEPALIVE) this.sendLive(false);
  }

  private sendLive(force: boolean): void {
    if (!this.room) return;
    const lost = (this.state === "after" || this.state === "over") && this.placed > 0 && !this.cashed;
    const msg: CkLive = {
      g: "ck",
      r: this.room.round(),
      f: this.flightNo,
      b: this.placed,
      c: this.cashed ? Math.round(this.cashed * 100) : lost ? -1 : 0,
      k: this.chips,
    };
    const sig = JSON.stringify(msg);
    if (!force && sig === this.lastLive && this.liveIdle < LIVE_KEEPALIVE) return;
    this.lastLive = sig;
    this.liveIdle = 0;
    this.room.broadcastLive(msg);
  }
}
