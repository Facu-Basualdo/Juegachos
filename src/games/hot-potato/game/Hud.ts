import { ARROWS, FLIGHT_MS, HEAT_HOT, type Arrow } from "./constants";

export interface HudPlayer {
  nickname: string;
  alive: boolean;
  connected: boolean;
  isMe: boolean;
  isHolder: boolean;
  /** A quien va a ir la papa si la paso yo ahora. */
  isTarget: boolean;
  /** Se le puede apuntar (tocar la tarjeta lo elige). */
  targetable: boolean;
}

export interface PlayView {
  players: HudPlayer[];
  holder: string | null;
  status: { big: string; small: string };
  /** La papa es mia y puedo jugar (estado "al aire" del estudio). */
  mine: boolean;
}

/** Radio del circulo de concursantes (% del lado de la arena). */
const RING_R = 40;
/** La papa se dibuja entre la tarjeta y el centro (fraccion del radio). */
const POTATO_R = 0.66;
/** Colores de camiseta por asiento (ver DESIGN.md: la identidad es el color del atril). */
const SEAT_COLORS = ["#d9442b", "#e9b233", "#2f7f86", "#7b4a8e", "#e07a3a", "#3f6fb0", "#8ea443", "#b8506e"];
/** Bombitas de la marquesina. */
const BULBS = 22;
const BOOM_MS = 900;

const CHEVRON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16 12 8.5 19 16"/></svg>`;

/** La papa: silueta despareja, pintas, cara preocupada y vapor. La capa `--hot` se
 *  enciende con el calor (opacidad = --heat). */
const POTATO_SVG = `
  <svg class="hp__potato-svg" viewBox="0 0 100 100" aria-hidden="true">
    <g class="hp__steam">
      <path d="M36 22C30 14 42 10 36 2"/>
      <path d="M52 20C46 12 58 8 52 0"/>
      <path d="M68 24C62 16 74 12 68 4"/>
    </g>
    <path class="hp__potato-body" d="M22 42C20 30 34 24 50 25 68 25 84 30 85 48 86 64 78 80 58 82 38 84 18 78 16 62 15 54 23 50 22 42Z"/>
    <path class="hp__potato-hot" d="M22 42C20 30 34 24 50 25 68 25 84 30 85 48 86 64 78 80 58 82 38 84 18 78 16 62 15 54 23 50 22 42Z"/>
    <ellipse class="hp__potato-hi" cx="40" cy="36" rx="12" ry="6"/>
    <circle class="hp__potato-spot" cx="70" cy="40" r="2.4"/>
    <circle class="hp__potato-spot" cx="26" cy="62" r="2"/>
    <circle class="hp__potato-spot" cx="64" cy="72" r="1.8"/>
    <path class="hp__potato-ln" d="M36 46 44 49M64 46 56 49"/>
    <circle class="hp__potato-eye" cx="41" cy="54" r="3.6"/>
    <circle class="hp__potato-eye" cx="59" cy="54" r="3.6"/>
    <path class="hp__potato-ln" d="M42 67Q50 62 58 67"/>
  </svg>`;

/**
 * DOM de Papa Caliente (estetica "Estudio de TV", ver DESIGN.md): los concursantes
 * en circulo, cada uno con su atril; en el centro el termometro de la papa, el
 * cartel de estado y la secuencia de flechas del que la tiene. La papa es un unico
 * elemento que vuela de atril en atril con una transicion CSS de `FLIGHT_MS`.
 * Espera / resultados / tablero final los cubre el `RoomOverlay` compartido.
 *
 * Las tarjetas NO se reconstruyen en cada estado: se reusan y solo cambian sus
 * clases, asi un toque no se pierde en un nodo recien reemplazado.
 */
export class Hud {
  private readonly stage: HTMLDivElement;
  private readonly arena: HTMLDivElement;
  private readonly potato: HTMLDivElement;
  private readonly burst: HTMLDivElement;
  private readonly needle: SVGGElement;
  private readonly bigEl: HTMLDivElement;
  private readonly smallEl: HTMLDivElement;
  private readonly seqEl: HTMLDivElement;
  private readonly noteEl: HTMLDivElement;
  private readonly pad: HTMLDivElement;
  private readonly pingEl: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;

  private readonly cards = new Map<string, HTMLDivElement>();
  private layoutKey = "";
  private positions = new Map<string, { x: number; y: number }>();
  private potatoShown = false;
  private seqShown = "";
  private noteTimer = 0;
  private heatShown = -1;

  private arrowCb: (a: Arrow) => void = () => {};
  private pickCb: (nick: string) => void = () => {};

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "hp";
    wrap.style.setProperty("--flight", `${FLIGHT_MS}ms`);
    wrap.innerHTML = `
      <div class="hp__bulbs hp__bulbs--top" aria-hidden="true"></div>
      <div class="hp__stage" hidden>
        <div class="hp__arena">
          <div class="hp__center">
            <svg class="hp__meter" viewBox="0 0 120 70" aria-hidden="true">
              <path class="hp__meter-band hp__meter-band--cool" d="M12 62A48 48 0 0 1 36 20.4"/>
              <path class="hp__meter-band hp__meter-band--warm" d="M36 20.4A48 48 0 0 1 84 20.4"/>
              <path class="hp__meter-band hp__meter-band--hot" d="M84 20.4A48 48 0 0 1 108 62"/>
              <g class="hp__needle"><path d="M60 62 60 20"/><circle cx="60" cy="62" r="5"/></g>
            </svg>
            <div class="hp__big"></div>
            <div class="hp__small"></div>
            <div class="hp__seq" aria-live="polite"></div>
            <div class="hp__note"></div>
          </div>
          <div class="hp__potato is-hidden">${POTATO_SVG}</div>
          <div class="hp__burst" aria-hidden="true"><span>BOOM</span></div>
        </div>
        <div class="hp__pad" role="group" aria-label="flechas">
          <button type="button" class="hp__key hp__key--U" data-arrow="U" aria-label="arriba">${CHEVRON}</button>
          <button type="button" class="hp__key hp__key--L" data-arrow="L" aria-label="izquierda">${CHEVRON}</button>
          <button type="button" class="hp__key hp__key--D" data-arrow="D" aria-label="abajo">${CHEVRON}</button>
          <button type="button" class="hp__key hp__key--R" data-arrow="R" aria-label="derecha">${CHEVRON}</button>
        </div>
        <div class="hp__ping" title="ida y vuelta al server"></div>
      </div>
      <div class="hp__bulbs hp__bulbs--bottom" aria-hidden="true"></div>
      <div class="hp__overlay"></div>
      <div class="hp__countdown" hidden></div>
    `;
    root.appendChild(wrap);

    this.stage = wrap.querySelector(".hp__stage")!;
    this.arena = wrap.querySelector(".hp__arena")!;
    this.potato = wrap.querySelector(".hp__potato")!;
    this.burst = wrap.querySelector(".hp__burst")!;
    this.needle = wrap.querySelector(".hp__needle")!;
    this.bigEl = wrap.querySelector(".hp__big")!;
    this.smallEl = wrap.querySelector(".hp__small")!;
    this.seqEl = wrap.querySelector(".hp__seq")!;
    this.noteEl = wrap.querySelector(".hp__note")!;
    this.pad = wrap.querySelector(".hp__pad")!;
    this.pingEl = wrap.querySelector(".hp__ping")!;
    this.overlay = wrap.querySelector(".hp__overlay")!;
    this.countdownEl = wrap.querySelector(".hp__countdown")!;

    for (const el of wrap.querySelectorAll<HTMLDivElement>(".hp__bulbs")) {
      el.innerHTML = Array.from({ length: BULBS }, (_, i) => `<i style="--i:${i}"></i>`).join("");
    }

    // pointerdown (no click): responde en el toque, sin los ~100 ms de espera del
    // click en movil ni el doble disparo de touchstart + mousedown.
    this.pad.addEventListener("pointerdown", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".hp__key");
      if (!btn) return;
      e.preventDefault();
      this.arrowCb(btn.dataset.arrow as Arrow);
    });
    this.arena.addEventListener("pointerdown", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLDivElement>(".hp__player");
      if (card?.dataset.nick) this.pickCb(card.dataset.nick);
    });
  }

  onArrow(cb: (a: Arrow) => void): void {
    this.arrowCb = cb;
  }
  onPick(cb: (nick: string) => void): void {
    this.pickCb = cb;
  }

  // ---------- Mensajes / countdown ----------

  showMessage(title: string, bodyHtml: string, action?: { label: string; onClick: () => void }): void {
    this.stage.hidden = true;
    this.overlay.hidden = false;
    this.overlay.innerHTML = `
      <div class="hp__card">
        <div class="hp__card-kicker">en vivo</div>
        <h1 class="hp__title">${title}</h1>
        <div class="hp__body">${bodyHtml}</div>
        ${action ? `<button class="hp__btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlay.querySelector<HTMLButtonElement>(".hp__btn")!.addEventListener("click", action.onClick);
    }
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
    this.overlay.innerHTML = "";
    this.stage.hidden = false;
  }

  // ---------- Escena ----------

  render(view: PlayView): void {
    this.layout(view.players);

    for (const p of view.players) {
      const card = this.cards.get(p.nickname);
      if (!card) continue;
      card.classList.toggle("is-me", p.isMe);
      card.classList.toggle("is-out", !p.alive);
      card.classList.toggle("is-off", !p.connected);
      card.classList.toggle("is-holder", p.isHolder);
      card.classList.toggle("is-target", p.isTarget);
      card.classList.toggle("is-targetable", p.targetable);
    }

    this.stage.classList.toggle("is-mine", view.mine);
    this.bigEl.textContent = view.status.big;
    this.smallEl.textContent = view.status.small;
    this.placePotato(view.holder);
  }

  /** Posiciones fijas por asiento; solo se recalculan si cambia la lista. */
  private layout(players: HudPlayer[]): void {
    const key = players.map((p) => p.nickname).join("\n");
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    for (const el of this.cards.values()) el.remove();
    this.cards.clear();
    this.positions.clear();

    const n = players.length;
    players.forEach((p, i) => {
      const rad = (n > 0 ? (i * 2 * Math.PI) / n : 0);
      const x = 50 + RING_R * Math.sin(rad);
      const y = 50 - RING_R * Math.cos(rad);
      this.positions.set(p.nickname, { x, y });

      const card = document.createElement("div");
      card.className = "hp__player";
      card.dataset.nick = p.nickname;
      card.style.left = `${x}%`;
      card.style.top = `${y}%`;
      card.style.setProperty("--seat", SEAT_COLORS[i % SEAT_COLORS.length]);
      card.innerHTML = `
        <div class="hp__head" aria-hidden="true">
          <svg viewBox="0 0 40 40"><circle class="hp__head-skin" cx="20" cy="20" r="16"/>
            <circle cx="14.5" cy="18" r="2.2"/><circle cx="25.5" cy="18" r="2.2"/>
            <path class="hp__mouth hp__mouth--ok" d="M14 25Q20 30 26 25"/>
            <ellipse class="hp__mouth hp__mouth--panic" cx="20" cy="27" rx="3.4" ry="4"/>
          </svg>
        </div>
        <div class="hp__plate">${escapeHtml(p.nickname)}</div>
        <div class="hp__aim" aria-hidden="true">para</div>
        <div class="hp__stamp" aria-hidden="true">afuera</div>
      `;
      this.arena.appendChild(card);
      this.cards.set(p.nickname, card);
    });
    // La papa y la explosion van por encima de las tarjetas.
    this.arena.appendChild(this.potato);
    this.arena.appendChild(this.burst);
  }

  private placePotato(holder: string | null): void {
    const pos = holder ? this.positions.get(holder) : undefined;
    if (!pos) {
      this.potato.classList.add("is-hidden");
      this.potatoShown = false;
      return;
    }
    const x = 50 + (pos.x - 50) * POTATO_R;
    const y = 50 + (pos.y - 50) * POTATO_R;
    if (!this.potatoShown) {
      // Aparece donde cae, sin volar desde la posicion vieja.
      this.potato.classList.add("no-flight");
      this.potato.style.left = `${x}%`;
      this.potato.style.top = `${y}%`;
      void this.potato.offsetWidth;
      this.potato.classList.remove("no-flight", "is-hidden");
      this.potatoShown = true;
      return;
    }
    this.potato.style.left = `${x}%`;
    this.potato.style.top = `${y}%`;
  }

  setSeq(seq: string, progress: number): void {
    if (seq !== this.seqShown) {
      this.seqShown = seq;
      this.seqEl.innerHTML = [...seq]
        .map(
          (a) =>
            `<span class="hp__tile" style="--rot:${ARROWS[a as Arrow].rot}deg" aria-label="${ARROWS[a as Arrow].label}">${CHEVRON}</span>`,
        )
        .join("");
    }
    this.seqEl.querySelectorAll<HTMLSpanElement>(".hp__tile").forEach((t, i) => {
      t.classList.toggle("is-done", i < progress);
      t.classList.toggle("is-next", i === progress);
    });
  }

  setPadEnabled(on: boolean): void {
    this.pad.classList.toggle("is-live", on);
  }

  pressPad(a: Arrow): void {
    const btn = this.pad.querySelector<HTMLButtonElement>(`.hp__key--${a}`);
    if (!btn) return;
    btn.classList.remove("is-pressed");
    void btn.offsetWidth;
    btn.classList.add("is-pressed");
  }

  wrong(): void {
    this.seqEl.classList.remove("is-wrong");
    void this.seqEl.offsetWidth;
    this.seqEl.classList.add("is-wrong");
  }

  flashNote(text: string): void {
    this.noteEl.textContent = text;
    this.noteEl.classList.add("is-on");
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => this.noteEl.classList.remove("is-on"), 1400);
  }

  /** Calor 0..1: aguja del termometro, color de la papa y temblor. */
  setHeat(heat: number): void {
    const h = Math.round(heat * 200) / 200;
    if (h === this.heatShown) return;
    this.heatShown = h;
    this.needle.style.transform = `rotate(${-90 + 180 * h}deg)`;
    this.potato.style.setProperty("--heat", String(h));
    this.stage.classList.toggle("is-hot", h >= HEAT_HOT);
  }

  boom(player: string): void {
    const pos = this.positions.get(player);
    const card = this.cards.get(player);
    this.potato.classList.add("is-hidden");
    this.potatoShown = false;
    if (pos) {
      this.burst.style.left = `${pos.x}%`;
      this.burst.style.top = `${pos.y}%`;
    }
    for (const el of [this.burst, this.stage, card]) {
      if (!el) continue;
      el.classList.remove("is-boom");
      void el.offsetWidth;
      el.classList.add("is-boom");
    }
    window.setTimeout(() => {
      this.burst.classList.remove("is-boom");
      this.stage.classList.remove("is-boom");
      card?.classList.remove("is-boom");
    }, BOOM_MS);
  }

  setPing(ms: number): void {
    this.pingEl.textContent = `${ms} ms`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
