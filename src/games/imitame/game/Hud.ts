import { normalizeContour, type Features, type Frame } from "./analysis";
import { EFFECTS, WHEEL_ORDER } from "./constants";
import type { EffectId, MtPlayerView, MtResult } from "./ImitameTransport";
import { SoundEffects } from "./SoundEffects";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);

/** Colores del DESIGN.md ("Garganta de Feria"), repetidos aca para los canvas. */
const C = {
  night: "#1b1033",
  stage: "#2b1a52",
  line: "#120a24",
  cream: "#fff4e0",
  pink: "#ff4f9a",
  yellow: "#ffd23f",
  cyan: "#35d6e8",
  lime: "#8be04e",
};

/** Un color de caramelo por jugador, en orden de asiento. */
const PLAYER_COLORS = ["#35d6e8", "#ff4f9a", "#ffd23f", "#8be04e", "#b388ff", "#ff8a3d", "#5ce1b6", "#ff7ab8"];

const FONT = `"Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;

export interface CardData {
  who: string;
  raw: number;
  mult: number | null;
  points: number | null;
  attacks: number;
  rhythm: number;
  melody: number;
  pitched: boolean;
  hasTake: boolean;
}

type TraceMode =
  | { kind: "none" }
  | { kind: "listen"; ref: Features; startedAt: number; dur: number }
  | { kind: "record"; startedAt: number; dur: number; live: Frame[] }
  | { kind: "compare"; ref: (number | null)[]; take: (number | null)[]; startedAt: number };

interface Avatar {
  nick: string;
  color: string;
  isMe: boolean;
  connected: boolean;
  effect: EffectId | null;
  /** Total que manda el server. */
  total: number;
  /** Puntos ya revelados en pantalla que el server todavia no sumo al total. */
  pending: number;
  /** Lo que se dibuja: persigue a `total + pending` (cuenta para arriba). */
  shown: number;
  mouth: number;
  x: number;
  y: number;
  r: number;
  pop: { text: string; color: string; t0: number } | null;
}

const WHEEL_SPIN_MS = 4200;
const WHEEL_TURNS = 5;
const COMPARE_POINTS = 80;
const POP_MS = 2600;
/** Cuanto tarda el micro en volar de una cara a otra. */
const MIC_FLY_MS = 700;

/**
 * Hud de Imitame. Arriba la ronda, el reloj y el boton del chat de voz; despues el
 * escenario con TODOS los jugadores (una bola de color cada uno, con su nombre y su
 * total), el trazo de la melodia y la tarjeta del jurado. El microfono se dibuja en la
 * cara de quien le toca: de todos mientras se graba, del que suena en la reproduccion
 * (vuela de uno a otro). Un solo loop de rAF dibuja los canvas.
 */
export class Hud {
  private readonly stage: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly roundEl: HTMLElement;
  private readonly clockBar: HTMLElement;
  private readonly kickerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly audioBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly scene: HTMLCanvasElement;
  private readonly trace: HTMLCanvasElement;
  private readonly wheel: HTMLCanvasElement;

  private audioUnlockCb: () => void = () => {};
  private muteCb: () => void = () => {};

  private avatars: Avatar[] = [];
  private mouthLevel: (nick: string) => number = () => 0;
  private talkLevel: (nick: string) => number = () => 0;
  private focus: string | null = null;
  private micAll = false;
  private micHolder: string | null = null;
  private micFrom: { x: number; y: number } | null = null;
  private micSince = 0;
  private recording = false;

  private traceMode: TraceMode = { kind: "none" };

  private wheelVisible = false;
  private wheelAngle = 0;
  private wheelSpin: { from: number; to: number; startedAt: number; done: () => void; lastSlice: number } | null =
    null;

  private clockAnchor = 0;
  private clockMs = 0;
  private clockTotal = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "mt";
    wrap.innerHTML = `
      <div class="mt__stage" hidden>
        <div class="mt__top">
          <div class="mt__round"></div>
          <div class="mt__clock"><div class="mt__clock-bar"></div></div>
          <button class="mt__mute" type="button" hidden aria-pressed="false" title="Chat de voz">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path class="mt__mute-mic" d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M8 21h8"/>
              <path class="mt__mute-x" d="M4 4l16 16"/>
            </svg>
            <span class="mt__mute-label">Voz</span>
          </button>
        </div>
        <div class="mt__head">
          <div class="mt__kicker"></div>
          <div class="mt__title"></div>
          <div class="mt__sub"></div>
        </div>
        <div class="mt__show">
          <canvas class="mt__scene" width="1040" height="460"></canvas>
          <canvas class="mt__wheel" width="560" height="560" hidden></canvas>
        </div>
        <canvas class="mt__trace" width="1040" height="220" hidden></canvas>
        <div class="mt__card" hidden></div>
        <div class="mt__summary" hidden></div>
        <button class="mt__audio" type="button" hidden>Toca para activar el sonido</button>
      </div>
      <div class="mt__overlay" hidden></div>
      <div class="mt__countdown" hidden></div>
    `;
    root.appendChild(wrap);

    const q = <T extends HTMLElement>(sel: string): T => wrap.querySelector<T>(sel)!;
    this.stage = q(".mt__stage");
    this.overlay = q(".mt__overlay");
    this.countdownEl = q(".mt__countdown");
    this.roundEl = q(".mt__round");
    this.clockBar = q(".mt__clock-bar");
    this.kickerEl = q(".mt__kicker");
    this.titleEl = q(".mt__title");
    this.subEl = q(".mt__sub");
    this.cardEl = q(".mt__card");
    this.summaryEl = q(".mt__summary");
    this.audioBtn = q<HTMLButtonElement>(".mt__audio");
    this.muteBtn = q<HTMLButtonElement>(".mt__mute");
    this.scene = q<HTMLCanvasElement>(".mt__scene");
    this.trace = q<HTMLCanvasElement>(".mt__trace");
    this.wheel = q<HTMLCanvasElement>(".mt__wheel");

    this.audioBtn.addEventListener("click", () => this.audioUnlockCb());
    this.muteBtn.addEventListener("click", () => this.muteCb());
    requestAnimationFrame((t) => this.frame(t));
  }

  onAudioUnlock(cb: () => void): void {
    this.audioUnlockCb = cb;
  }

  onMuteToggle(cb: () => void): void {
    this.muteCb = cb;
  }

  // ---------- Mensajes / countdown ----------

  showMessage(title: string, bodyHtml: string, action?: { label: string; onClick: () => void }): void {
    this.stage.hidden = true;
    this.overlay.hidden = false;
    this.overlay.innerHTML = `
      <div class="mt__msg">
        <h1 class="mt__msg-title">${title}</h1>
        <div class="mt__msg-body">${bodyHtml}</div>
        ${action ? `<button class="mt__msg-btn" type="button">${action.label}</button>` : ""}
      </div>`;
    if (action) this.overlay.querySelector<HTMLButtonElement>(".mt__msg-btn")!.addEventListener("click", action.onClick);
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.hidden = true;
      return;
    }
    this.countdownEl.hidden = false;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-pop");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-pop");
  }

  showStage(): void {
    this.overlay.hidden = true;
    this.stage.hidden = false;
  }

  setAudioBlocked(blocked: boolean): void {
    this.audioBtn.hidden = !blocked;
  }

  /** Boton del chat de voz: `available` = hay chat; `muted` = el jugador se silencio. */
  setVoice(available: boolean, muted: boolean, open: boolean): void {
    this.muteBtn.hidden = !available;
    this.muteBtn.setAttribute("aria-pressed", String(muted));
    this.muteBtn.classList.toggle("is-muted", muted);
    this.muteBtn.classList.toggle("is-closed", !open);
    this.muteBtn.title = muted ? "Tu micro esta apagado" : open ? "Chat de voz abierto" : "Mesa en silencio";
  }

  // ---------- Cromo ----------

  setRound(text: string): void {
    this.roundEl.textContent = text;
  }

  setClock(clockMs: number | null, totalMs: number | null): void {
    if (clockMs == null || !totalMs) {
      this.clockMs = 0;
      this.clockTotal = 0;
      return;
    }
    this.clockAnchor = performance.now();
    this.clockMs = clockMs;
    this.clockTotal = totalMs;
  }

  setPhase(phase: string): void {
    this.stage.dataset.phase = phase;
  }

  setText(kicker: string, title: string, sub: string): void {
    this.kickerEl.textContent = kicker;
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
  }

  // ---------- Escenario: los jugadores ----------

  setPlayers(players: MtPlayerView[], me: string): void {
    const next: Avatar[] = players.map((p, i) => {
      const prev = this.avatars.find((a) => a.nick === p.nickname);
      // Si el total del server cambio, ya incluye lo que estaba pendiente.
      const pending = prev && prev.total === p.total ? prev.pending : 0;
      return {
        nick: p.nickname,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        isMe: p.nickname === me,
        connected: p.connected,
        effect: p.effect,
        total: p.total,
        pending,
        shown: prev?.shown ?? p.total,
        mouth: prev?.mouth ?? 0,
        x: prev?.x ?? 0,
        y: prev?.y ?? 0,
        r: prev?.r ?? 0,
        pop: prev?.pop ?? null,
      };
    });
    this.avatars = next;
    this.layout();
  }

  /** De donde sale el nivel de la boca de cada jugador (lo que suena / su micro). */
  setMouthLevel(fn: (nick: string) => number): void {
    this.mouthLevel = fn;
  }

  /** Nivel de voz del chat: dibuja el anillo de "esta hablando". */
  setTalkLevel(fn: (nick: string) => number): void {
    this.talkLevel = fn;
  }

  setFocus(nick: string | null): void {
    this.focus = nick;
  }

  /** Microfono: `"all"` = todos graban; un nick = vuela a esa cara; null = nadie. */
  setMic(holder: "all" | string | null, recording = false): void {
    this.recording = recording;
    if (holder === "all") {
      this.micAll = true;
      this.micHolder = null;
      this.micFrom = null;
      return;
    }
    this.micAll = false;
    if (holder === this.micHolder) return;
    const from = this.avatars.find((a) => a.nick === this.micHolder);
    this.micFrom = from ? this.micPoint(from) : null;
    this.micHolder = holder;
    this.micSince = performance.now();
  }

  /** Suma puntos en pantalla: "+N" que salta sobre la cabeza y el total que cuenta. */
  popPoints(nick: string, points: number, mult: number | null): void {
    const a = this.avatars.find((x) => x.nick === nick);
    if (!a) return;
    a.pending += points;
    const text = mult != null && mult !== 1 ? `+${points} (x${mult})` : `+${points}`;
    a.pop = { text, color: points > 0 ? C.lime : C.pink, t0: performance.now() };
  }

  /**
   * Hasta 3 por fila (4 con 7-8 jugadores) y el alto del canvas crece con las filas, asi
   * en el celular las caras y los nombres se leen. Cada celda deja lugar arriba para el
   * cartel del efecto y el "+N", y abajo para el nombre y el total.
   */
  private layout(): void {
    const n = this.avatars.length;
    if (n === 0) return;
    const W = this.scene.width;
    const perRow = n <= 3 ? Math.max(n, 2) : n <= 6 ? 3 : 4;
    const rows = Math.ceil(n / perRow);
    const cellW = W / perRow;
    const r = Math.min(cellW * 0.27, 120);
    const cellH = r * 4.1;
    const height = Math.round(cellH * rows);
    if (this.scene.height !== height) this.scene.height = height;
    this.avatars.forEach((a, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const col = i - row * perRow;
      const offset = (W - inRow * cellW) / 2;
      a.x = offset + cellW * (col + 0.5);
      a.y = cellH * row + r * 1.75;
      a.r = r;
    });
  }

  // ---------- Trazo ----------

  traceClear(): void {
    this.traceMode = { kind: "none" };
    this.trace.hidden = true;
  }

  traceListen(ref: Features | null, dur: number): void {
    this.trace.hidden = false;
    this.traceMode = ref ? { kind: "listen", ref, startedAt: performance.now(), dur: dur * 1000 } : { kind: "none" };
    this.trace.hidden = !ref;
  }

  traceRecord(durMs: number): void {
    this.trace.hidden = false;
    this.traceMode = { kind: "record", startedAt: performance.now(), dur: durMs, live: [] };
  }

  pushLive(frame: Frame): void {
    if (this.traceMode.kind === "record") this.traceMode.live.push(frame);
  }

  traceCompare(ref: Features, take: Features): void {
    this.trace.hidden = false;
    this.traceMode = {
      kind: "compare",
      ref: normalizeContour(ref.contour, COMPARE_POINTS),
      take: normalizeContour(take.contour, COMPARE_POINTS),
      startedAt: performance.now(),
    };
  }

  // ---------- Tarjeta del jurado ----------

  clearCard(): void {
    this.cardEl.hidden = true;
  }

  /**
   * La tarjeta se arma de a poco (las demoras viven en el CSS): melodia, ritmo y golpes se
   * llenan uno detras del otro, despues aparece el puntaje, el multiplicador y lo que suma.
   * `quick` la muestra de una (tu propia toma, apenas termina de grabar).
   */
  showCard(d: CardData, quick = false): void {
    const bar = (label: string, v: number | null, color: string, i: number): string => `
      <div class="mt__bar" style="--i:${i}">
        <span class="mt__bar-label">${label}</span>
        <span class="mt__bar-track"><span class="mt__bar-fill" style="--v:${v == null ? 0 : Math.round(v * 100)}%;--c:${color}"></span></span>
        <span class="mt__bar-val">${v == null ? "--" : Math.round(v * 100)}</span>
      </div>`;
    let tail = "";
    if (d.points != null) {
      const mult = d.mult != null && d.mult !== 1 ? `<span class="mt__card-x">x${d.mult}</span>` : "";
      tail = `<div class="mt__card-sum">${mult}<span class="mt__card-plus">+${d.points}</span></div>`;
    }
    this.cardEl.innerHTML = d.hasTake
      ? `
      <div class="mt__card-top">
        <span class="mt__card-who">${esc(d.who)}</span>
        <span class="mt__card-raw">${d.raw}</span>
      </div>
      ${bar("Melodia", d.pitched ? d.melody : null, C.cyan, 0)}
      ${bar("Ritmo", d.rhythm, C.yellow, 1)}
      ${bar("Golpes", d.attacks, C.lime, 2)}
      ${tail}`
      : `<div class="mt__card-top"><span class="mt__card-who">${esc(d.who)}</span><span class="mt__card-raw">0</span></div>
         <div class="mt__card-empty">No se escucho nada.</div>`;
    this.cardEl.hidden = false;
    this.cardEl.classList.toggle("is-quick", quick);
    this.cardEl.classList.remove("is-in");
    void this.cardEl.offsetWidth;
    this.cardEl.classList.add("is-in");
  }

  // ---------- Resumen de la ronda ----------

  showSummary(results: MtResult[], players: MtPlayerView[], me: string): void {
    const rows = [...players]
      .sort((a, b) => b.total - a.total)
      .map((p, i) => {
        const res = results.find((r) => r.nickname === p.nickname);
        const pts = res?.points ?? 0;
        return `
          <div class="mt__sum-row${p.nickname === me ? " is-me" : ""}" style="--i:${i}">
            <span class="mt__sum-place">${i + 1}</span>
            <span class="mt__sum-name">${esc(p.nickname)}</span>
            <span class="mt__sum-plus${pts > 0 ? "" : " is-zero"}">+${pts}</span>
            <span class="mt__sum-total">${p.total}</span>
          </div>`;
      })
      .join("");
    this.summaryEl.innerHTML = `<div class="mt__sum-head"><span>Ronda</span><span>Total</span></div>${rows}`;
    this.summaryEl.hidden = false;
  }

  clearSummary(): void {
    this.summaryEl.hidden = true;
  }

  // ---------- Ruleta ----------

  spinWheel(outcome: EffectId, jitter: number, done: () => void): void {
    this.wheelVisible = true;
    this.wheel.hidden = false;
    this.scene.hidden = true;
    const n = WHEEL_ORDER.length;
    const slice = (Math.PI * 2) / n;
    const idx = WHEEL_ORDER.indexOf(outcome);
    // La aguja esta arriba (-PI/2). Se gira hasta que el punto `jitter` de la porcion
    // `idx` quede bajo la aguja.
    const inSlice = (0.15 + 0.7 * jitter) * slice;
    const target = -Math.PI / 2 - (idx * slice + inSlice);
    const base = this.wheelAngle - (this.wheelAngle % (Math.PI * 2));
    let to = base + WHEEL_TURNS * Math.PI * 2 + (((target % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
    if (to <= this.wheelAngle) to += Math.PI * 2;
    this.wheelSpin = { from: this.wheelAngle, to, startedAt: performance.now(), done, lastSlice: -1 };
  }

  hideWheel(): void {
    if (!this.wheelVisible) return;
    this.wheelVisible = false;
    this.wheelSpin = null;
    this.wheel.hidden = true;
    this.scene.hidden = false;
  }

  // ---------- Loop ----------

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    if (this.stage.hidden) return;
    this.tickClock(now);
    if (this.wheelVisible) this.drawWheel(now);
    else this.drawScene(now);
    this.drawTrace(now);
  }

  private tickClock(now: number): void {
    if (this.clockTotal <= 0) {
      this.clockBar.style.transform = "scaleX(0)";
      return;
    }
    const remaining = Math.max(0, this.clockMs - (now - this.clockAnchor));
    const frac = remaining / this.clockTotal;
    this.clockBar.style.transform = `scaleX(${frac})`;
    this.clockBar.classList.toggle("is-low", frac < 0.25);
  }

  private micPoint(a: Avatar): { x: number; y: number } {
    return { x: a.x + a.r * 0.62, y: a.y + a.r * 0.58 };
  }

  private drawScene(now: number): void {
    const ctx = this.scene.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.scene.width, this.scene.height);

    for (const a of this.avatars) {
      const target = Math.min(1, Math.max(this.mouthLevel(a.nick) * 6, this.talkLevel(a.nick) * 10));
      a.mouth += (target - a.mouth) * 0.35;
      const goal = a.total + a.pending;
      a.shown += (goal - a.shown) * 0.08;
      if (Math.abs(goal - a.shown) < 0.5) a.shown = goal;
      this.drawAvatar(ctx, a, now);
    }

    // Microfonos: el de todos (grabando) o el que vuela a la cara del que suena.
    if (this.micAll) {
      for (const a of this.avatars) this.drawMic(ctx, this.micPoint(a), a.r, this.recording && a.isMe);
    } else if (this.micHolder) {
      const a = this.avatars.find((x) => x.nick === this.micHolder);
      if (a) {
        const to = this.micPoint(a);
        const p = Math.min(1, (now - this.micSince) / MIC_FLY_MS);
        const e = 1 - Math.pow(1 - p, 3);
        const from = this.micFrom ?? { x: to.x, y: -60 };
        const x = from.x + (to.x - from.x) * e;
        // Arco: sube en el medio del vuelo.
        const y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * e) * 90;
        this.drawMic(ctx, { x, y }, a.r * (this.focus === a.nick ? 1.2 : 1), false);
      }
    }

    // "+N" que salta sobre la cabeza.
    for (const a of this.avatars) {
      if (!a.pop) continue;
      const t = (now - a.pop.t0) / POP_MS;
      if (t >= 1) {
        a.pop = null;
        continue;
      }
      const rise = Math.min(1, t * 3);
      const y = a.y - a.r * 1.15 - rise * a.r * 0.35;
      const scale = t < 0.12 ? 0.6 + (t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (t - 0.12) * 0.5);
      ctx.save();
      ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      ctx.translate(a.x, y);
      ctx.scale(scale, scale);
      ctx.font = `900 ${Math.round(a.r * 0.62)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 12;
      ctx.strokeStyle = C.line;
      ctx.strokeText(a.pop.text, 0, 0);
      ctx.fillStyle = a.pop.color;
      ctx.fillText(a.pop.text, 0, 0);
      ctx.restore();
    }
  }

  private drawAvatar(ctx: CanvasRenderingContext2D, a: Avatar, now: number): void {
    const focused = this.focus === a.nick;
    const dim = this.focus !== null && !focused;
    const r = a.r * (focused ? 1.2 : 1);
    const bob = Math.sin(now / 420 + a.x) * 4 - a.mouth * 8;
    const cx = a.x;
    const cy = a.y + bob;

    ctx.save();
    ctx.globalAlpha = !a.connected ? 0.35 : dim ? 0.55 : 1;

    // Anillo de "esta hablando" (chat de voz).
    const talk = this.talkLevel(a.nick);
    if (talk > 0.015) {
      ctx.strokeStyle = C.lime;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 12 + Math.min(10, talk * 120), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = C.line;
    ctx.beginPath();
    ctx.ellipse(cx + 7, cy + 9, r, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = a.color;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Ojos: cerrados fuerte cuando canta alto.
    const squint = a.mouth > 0.55;
    const eyeY = cy - r * 0.28;
    for (const dx of [-r * 0.33, r * 0.33]) {
      ctx.fillStyle = C.line;
      if (squint) {
        ctx.lineWidth = Math.max(4, r * 0.08);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + dx - r * 0.13, eyeY - 3);
        ctx.lineTo(cx + dx, eyeY + 5);
        ctx.lineTo(cx + dx + r * 0.13, eyeY - 3);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(cx + dx, eyeY, r * 0.1, r * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.arc(cx + dx + r * 0.03, eyeY - r * 0.05, r * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const mw = r * (0.36 + a.mouth * 0.16);
    const mh = 4 + a.mouth * r * 0.5;
    const my = cy + r * 0.3;
    ctx.fillStyle = "#5a0d2e";
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(cx, my, mw, mh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Efecto de la ruleta que carga esta ronda.
    if (a.effect) {
      const fx = EFFECTS[a.effect];
      ctx.font = `900 ${Math.round(a.r * 0.3)}px ${FONT}`;
      const w = ctx.measureText(fx.short).width + a.r * 0.25;
      const ty = cy - r - a.r * 0.32;
      ctx.fillStyle = fx.color;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, ty - a.r * 0.2, w, a.r * 0.4, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.line;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fx.short, cx, ty + 1);
    }

    // Nombre y total.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `900 ${Math.round(a.r * 0.44)}px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = C.line;
    const nameY = a.y + a.r * 1.15;
    const name = a.isMe ? `${a.nick} (vos)` : a.nick;
    ctx.strokeText(name, cx, nameY);
    ctx.fillStyle = a.isMe ? C.yellow : C.cream;
    ctx.fillText(name, cx, nameY);
    ctx.font = `900 ${Math.round(a.r * 0.42)}px ${FONT}`;
    const tot = String(Math.round(a.shown));
    const totY = nameY + a.r * 0.52;
    ctx.strokeText(tot, cx, totY);
    ctx.fillStyle = a.pending > 0 && Math.round(a.shown) < a.total + a.pending ? C.lime : "rgba(255,244,224,0.8)";
    ctx.fillText(tot, cx, totY);
    ctx.restore();
  }

  private drawMic(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, r: number, rec: boolean): void {
    const s = r / 80;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.45);
    ctx.scale(s, s);
    // Mango.
    ctx.fillStyle = "#3a3346";
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(-9, 8, 18, 62, 7);
    ctx.fill();
    ctx.stroke();
    // Cabeza con rejilla.
    ctx.fillStyle = "#d9d4e2";
    ctx.beginPath();
    ctx.arc(0, -8, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(18,10,36,0.45)";
    ctx.lineWidth = 3;
    for (const dy of [-18, -8, 2]) {
      ctx.beginPath();
      ctx.moveTo(-18, dy);
      ctx.lineTo(18, dy);
      ctx.stroke();
    }
    if (rec && Math.floor(performance.now() / 450) % 2 === 0) {
      ctx.fillStyle = "#ff2b2b";
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 40, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTrace(now: number): void {
    const ctx = this.trace.getContext("2d");
    if (!ctx) return;
    const W = this.trace.width;
    const H = this.trace.height;
    ctx.clearRect(0, 0, W, H);
    const pad = 24;

    ctx.strokeStyle = "rgba(255,244,224,0.12)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      const y = (H * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
    }

    const m = this.traceMode;
    if (m.kind === "none") return;

    const plot = (
      values: (number | null)[],
      color: string,
      width: number,
      range: [number, number],
      upTo = 1,
    ): void => {
      const n = values.length;
      if (n < 2) return;
      const [lo, hi] = range;
      const y = (v: number): number => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      let drawing = false;
      ctx.beginPath();
      const last = Math.floor((n - 1) * upTo);
      for (let i = 0; i <= last; i++) {
        const v = values[i];
        const x = pad + (i / (n - 1)) * (W - pad * 2);
        if (v == null) {
          drawing = false;
          continue;
        }
        if (!drawing) ctx.moveTo(x, y(v));
        else ctx.lineTo(x, y(v));
        drawing = true;
      }
      ctx.stroke();
    };

    if (m.kind === "listen") {
      const voiced = m.ref.contour.filter((v): v is number => v != null);
      const lo = voiced.length ? Math.min(...voiced) - 4 : 50;
      const hi = voiced.length ? Math.max(...voiced) + 4 : 80;
      const prog = Math.min(1, (now - m.startedAt) / Math.max(1, m.dur));
      if (voiced.length) plot(m.ref.contour, C.cyan, 14, [lo, hi], prog);
      else this.drawBeats(ctx, m.ref, prog, W, H, pad);
      return;
    }

    if (m.kind === "record") {
      const prog = Math.min(1, (now - m.startedAt) / m.dur);
      const x = pad + prog * (W - pad * 2);
      ctx.strokeStyle = "rgba(255,79,154,0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, pad / 2);
      ctx.lineTo(x, H - pad / 2);
      ctx.stroke();
      const lo = 40;
      const hi = 84;
      ctx.fillStyle = C.pink;
      for (const f of m.live) {
        if (f.midi == null) continue;
        const fx = pad + Math.min(1, (f.t * 1000) / m.dur) * (W - pad * 2);
        const fy = H - pad - ((Math.max(lo, Math.min(hi, f.midi)) - lo) / (hi - lo)) * (H - pad * 2);
        ctx.beginPath();
        ctx.arc(fx, fy, 6 + Math.min(8, f.rms * 60), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    const prog = Math.min(1, (now - m.startedAt) / 900);
    plot(m.ref, "rgba(53,214,232,0.55)", 16, [-10, 10]);
    plot(m.take, C.pink, 8, [-10, 10], prog);
  }

  /** Sonidos sin altura (palmas): se dibujan los golpes como barras. */
  private drawBeats(ctx: CanvasRenderingContext2D, ref: Features, prog: number, W: number, H: number, pad: number): void {
    ctx.fillStyle = C.cyan;
    for (const t of ref.onsets) {
      const f = t / Math.max(0.01, ref.end);
      if (f > prog) continue;
      const x = pad + f * (W - pad * 2);
      ctx.fillRect(x - 8, pad, 16, H - pad * 2);
    }
  }

  private drawWheel(now: number): void {
    const ctx = this.wheel.getContext("2d");
    if (!ctx) return;
    const W = this.wheel.width;
    const H = this.wheel.height;
    ctx.clearRect(0, 0, W, H);
    const n = WHEEL_ORDER.length;
    const slice = (Math.PI * 2) / n;

    const spin = this.wheelSpin;
    if (spin) {
      const p = Math.min(1, (now - spin.startedAt) / WHEEL_SPIN_MS);
      const eased = 1 - Math.pow(1 - p, 4);
      this.wheelAngle = spin.from + (spin.to - spin.from) * eased;
      const under = Math.floor((((-Math.PI / 2 - this.wheelAngle) % (Math.PI * 2)) + Math.PI * 2) / slice) % n;
      if (under !== spin.lastSlice) {
        if (spin.lastSlice !== -1) SoundEffects.playWheelTick();
        spin.lastSlice = under;
      }
      if (p >= 1) {
        this.wheelSpin = null;
        spin.done();
      }
    }

    const cx = W / 2;
    const cy = H / 2 + 14;
    const r = W * 0.42;
    ctx.fillStyle = C.line;
    ctx.beginPath();
    ctx.arc(cx + 10, cy + 12, r, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < n; i++) {
      const fx = EFFECTS[WHEEL_ORDER[i]];
      const a0 = this.wheelAngle + i * slice;
      ctx.fillStyle = fx.color;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a0 + slice);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a0 + slice / 2);
      ctx.fillStyle = C.line;
      ctx.font = `900 ${Math.round(W * 0.045)}px ${FONT}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(fx.short, r - 18, 0);
      ctx.restore();
    }
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.cream;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = C.pink;
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy - r - 30);
    ctx.lineTo(cx + 22, cy - r - 30);
    ctx.lineTo(cx, cy - r + 18);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.stroke();
  }
}
