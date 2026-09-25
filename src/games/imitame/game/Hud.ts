import { normalizeContour, type Features, type Frame } from "./analysis";
import { EFFECTS, WHEEL_ORDER } from "./constants";
import type { EffectId, MtState } from "./ImitameTransport";
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

export type FaceMode = "idle" | "listen" | "sing" | "play";

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

const WHEEL_SPIN_MS = 4200;
const WHEEL_TURNS = 5;
const COMPARE_POINTS = 80;

/**
 * Hud de Imitame. Una sola columna: topbar (ronda + reloj), roster, carteles, la
 * "Boca" (el presentador: abre la boca con lo que suena o con tu micro), el trazo
 * de la melodia, la tarjeta de puntaje y la ruleta. Un solo loop de
 * requestAnimationFrame dibuja los tres canvas.
 */
export class Hud {
  private readonly stage: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly roundEl: HTMLElement;
  private readonly clockBar: HTMLElement;
  private readonly rosterEl: HTMLElement;
  private readonly kickerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly audioBtn: HTMLButtonElement;
  private readonly face: HTMLCanvasElement;
  private readonly trace: HTMLCanvasElement;
  private readonly wheel: HTMLCanvasElement;

  private audioUnlockCb: () => void = () => {};

  private faceMode: FaceMode = "idle";
  private levelSource: () => number = () => 0;
  private mouth = 0;
  private blinkAt = 0;

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
        </div>
        <div class="mt__roster"></div>
        <div class="mt__head">
          <div class="mt__kicker"></div>
          <div class="mt__title"></div>
          <div class="mt__sub"></div>
        </div>
        <div class="mt__show">
          <canvas class="mt__face" width="360" height="360"></canvas>
          <canvas class="mt__wheel" width="560" height="560" hidden></canvas>
        </div>
        <canvas class="mt__trace" width="1040" height="240"></canvas>
        <div class="mt__card" hidden></div>
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
    this.rosterEl = q(".mt__roster");
    this.kickerEl = q(".mt__kicker");
    this.titleEl = q(".mt__title");
    this.subEl = q(".mt__sub");
    this.cardEl = q(".mt__card");
    this.audioBtn = q<HTMLButtonElement>(".mt__audio");
    this.face = q<HTMLCanvasElement>(".mt__face");
    this.trace = q<HTMLCanvasElement>(".mt__trace");
    this.wheel = q<HTMLCanvasElement>(".mt__wheel");

    this.audioBtn.addEventListener("click", () => this.audioUnlockCb());
    requestAnimationFrame((t) => this.frame(t));
  }

  onAudioUnlock(cb: () => void): void {
    this.audioUnlockCb = cb;
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

  // ---------- Cromo: ronda, reloj, roster ----------

  renderChrome(s: MtState, me: string): void {
    this.roundEl.textContent = s.phase === "waiting" ? "" : `Ronda ${Math.min(s.round + 1, s.totalRounds)}/${s.totalRounds}`;
    if (s.clockMs == null || !s.clockTotalMs) {
      this.clockMs = 0;
      this.clockTotal = 0;
    } else {
      this.clockAnchor = performance.now();
      this.clockMs = s.clockMs;
      this.clockTotal = s.clockTotalMs;
    }
    this.stage.dataset.phase = s.phase;

    const playing = s.phase === "playback" ? s.playOrder?.[s.playIndex] : null;
    const collecting = s.phase === "record" || s.phase === "upload";
    this.rosterEl.innerHTML = s.players
      .map((p) => {
        const cls = ["mt__chip"];
        if (!p.connected) cls.push("is-off");
        if (p.nickname === me) cls.push("is-me");
        if (p.nickname === playing) cls.push("is-playing");
        if (collecting && p.submitted) cls.push("is-done");
        const fx = p.effect
          ? `<span class="mt__chip-fx" style="--fx:${EFFECTS[p.effect].color}">${EFFECTS[p.effect].short}</span>`
          : "";
        return `<div class="${cls.join(" ")}"><span class="mt__chip-name">${esc(p.nickname)}</span><span class="mt__chip-pts">${p.total}</span>${fx}</div>`;
      })
      .join("");
  }

  setUploadProgress(s: MtState): void {
    const done = s.players.filter((p) => p.submitted).length;
    this.kickerEl.textContent = `Tomas recibidas ${done}/${s.players.length}`;
  }

  setText(kicker: string, title: string, sub: string): void {
    this.kickerEl.textContent = kicker;
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
  }

  // ---------- La Boca ----------

  setMode(mode: FaceMode, level?: () => number): void {
    this.faceMode = mode;
    this.levelSource = level ?? (() => 0);
    this.hideWheel();
  }

  // ---------- Trazo ----------

  traceClear(): void {
    this.traceMode = { kind: "none" };
  }

  traceListen(ref: Features | null, dur: number): void {
    this.traceMode = ref ? { kind: "listen", ref, startedAt: performance.now(), dur: dur * 1000 } : { kind: "none" };
  }

  traceRecord(durMs: number): void {
    this.traceMode = { kind: "record", startedAt: performance.now(), dur: durMs, live: [] };
  }

  pushLive(frame: Frame): void {
    if (this.traceMode.kind === "record") this.traceMode.live.push(frame);
  }

  traceCompare(ref: Features, take: Features): void {
    this.traceMode = {
      kind: "compare",
      ref: normalizeContour(ref.contour, COMPARE_POINTS),
      take: normalizeContour(take.contour, COMPARE_POINTS),
      startedAt: performance.now(),
    };
  }

  // ---------- Tarjeta ----------

  clearCard(): void {
    this.cardEl.hidden = true;
  }

  showCard(d: CardData): void {
    const bar = (label: string, v: number | null, color: string): string => `
      <div class="mt__bar">
        <span class="mt__bar-label">${label}</span>
        <span class="mt__bar-track"><span class="mt__bar-fill" style="--v:${v == null ? 0 : Math.round(v * 100)}%;--c:${color}"></span></span>
        <span class="mt__bar-val">${v == null ? "--" : Math.round(v * 100)}</span>
      </div>`;
    const tail =
      d.points != null && d.mult != null && d.mult !== 1
        ? `<div class="mt__card-mult">x${d.mult} = <b>${d.points}</b></div>`
        : d.points != null
          ? `<div class="mt__card-mult">suma <b>${d.points}</b></div>`
          : "";
    this.cardEl.innerHTML = d.hasTake
      ? `
      <div class="mt__card-top">
        <span class="mt__card-who">${esc(d.who)}</span>
        <span class="mt__card-raw">${d.raw}</span>
      </div>
      ${bar("Melodia", d.pitched ? d.melody : null, C.cyan)}
      ${bar("Ritmo", d.rhythm, C.yellow)}
      ${bar("Golpes", d.attacks, C.lime)}
      ${tail}`
      : `<div class="mt__card-top"><span class="mt__card-who">${esc(d.who)}</span><span class="mt__card-raw">0</span></div>
         <div class="mt__card-empty">No se escucho nada.</div>`;
    this.cardEl.hidden = false;
    this.cardEl.classList.remove("is-in");
    void this.cardEl.offsetWidth;
    this.cardEl.classList.add("is-in");
  }

  // ---------- Ruleta ----------

  spinWheel(outcome: EffectId, jitter: number, done: () => void): void {
    this.wheelVisible = true;
    this.wheel.hidden = false;
    this.face.hidden = true;
    const n = WHEEL_ORDER.length;
    const slice = (Math.PI * 2) / n;
    const idx = WHEEL_ORDER.indexOf(outcome);
    // La aguja esta arriba (-PI/2). La porcion `idx` ocupa [idx*slice, (idx+1)*slice]
    // antes de girar; se gira hasta que el punto `jitter` de esa porcion quede arriba.
    const inSlice = (0.15 + 0.7 * jitter) * slice;
    const target = -Math.PI / 2 - (idx * slice + inSlice);
    const base = this.wheelAngle - (this.wheelAngle % (Math.PI * 2));
    let to = base + WHEEL_TURNS * Math.PI * 2 + (((target % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
    if (to <= this.wheelAngle) to += Math.PI * 2;
    this.wheelSpin = { from: this.wheelAngle, to, startedAt: performance.now(), done, lastSlice: -1 };
  }

  private hideWheel(): void {
    if (!this.wheelVisible) return;
    this.wheelVisible = false;
    this.wheelSpin = null;
    this.wheel.hidden = true;
    this.face.hidden = false;
  }

  // ---------- Loop ----------

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    if (this.stage.hidden) return;
    this.tickClock(now);
    if (this.wheelVisible) this.drawWheel(now);
    else this.drawFace(now);
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

  private drawFace(now: number): void {
    const ctx = this.face.getContext("2d");
    if (!ctx) return;
    const W = this.face.width;
    const H = this.face.height;
    ctx.clearRect(0, 0, W, H);

    const target = Math.min(1, this.levelSource() * (this.faceMode === "sing" ? 9 : 6));
    this.mouth += (target - this.mouth) * 0.35;
    const color =
      this.faceMode === "listen" ? C.cyan : this.faceMode === "sing" ? C.pink : this.faceMode === "play" ? C.yellow : C.lime;

    const cx = W / 2;
    const bob = Math.sin(now / 420) * 6 + this.mouth * -10;
    const cy = H / 2 + 10 + bob;
    const r = W * 0.36;

    // Sombra dura desplazada (el "sticker" de la estetica).
    ctx.fillStyle = C.line;
    ctx.beginPath();
    ctx.ellipse(cx + 10, cy + 12, r, r * (0.94 + this.mouth * 0.05), 0, 0, Math.PI * 2);
    ctx.fill();
    // Cuerpo.
    ctx.fillStyle = color;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.94 + this.mouth * 0.05), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Ojos: parpadean cada tanto, y cierran fuerte al cantar alto.
    if (now > this.blinkAt + 3200 + Math.random() * 2000) this.blinkAt = now;
    const blinking = now - this.blinkAt < 120;
    const squint = this.faceMode === "sing" && this.mouth > 0.55;
    const eyeY = cy - r * 0.3;
    for (const dx of [-r * 0.33, r * 0.33]) {
      ctx.fillStyle = C.line;
      if (blinking || squint) {
        ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + dx - 16, eyeY + (squint ? -4 : 0));
        ctx.lineTo(cx + dx, eyeY + (squint ? 6 : 0));
        ctx.lineTo(cx + dx + 16, eyeY + (squint ? -4 : 0));
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(cx + dx, eyeY, 13, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.cream;
        ctx.beginPath();
        ctx.arc(cx + dx + 4, eyeY - 6, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Boca: de linea (cerrada) a ovalo grande.
    const mw = r * (0.42 + this.mouth * 0.18);
    const mh = 6 + this.mouth * r * 0.55;
    const my = cy + r * 0.3;
    ctx.fillStyle = "#5a0d2e";
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.ellipse(cx, my, mw, mh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (mh > 24) {
      ctx.fillStyle = C.pink;
      ctx.beginPath();
      ctx.ellipse(cx, my + mh * 0.45, mw * 0.55, mh * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Luz de REC mientras se graba.
    if (this.faceMode === "sing" && Math.floor(now / 450) % 2 === 0) {
      ctx.fillStyle = "#ff2b2b";
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(W - 40, 40, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawTrace(now: number): void {
    const ctx = this.trace.getContext("2d");
    if (!ctx) return;
    const W = this.trace.width;
    const H = this.trace.height;
    ctx.clearRect(0, 0, W, H);
    const pad = 24;

    // Pentagrama de fondo.
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
      // Cursor de tiempo.
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

    // compare: las dos curvas centradas en su mediana, sobre tiempo normalizado.
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
      ctx.font = `900 ${Math.round(W * 0.045)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
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

    // Aguja arriba.
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
