import { EMOTES, EMOTE_COOLDOWN_MS, EMOTE_MS, type EmoteId } from "./constants";

export interface HudPlayer {
  nickname: string;
  alive: boolean;
  connected: boolean;
  isTurn: boolean;
  isMe: boolean;
  /** Eslabones que forjo (palabras aceptadas). */
  links: number;
  /** Ultima palabra aceptada por este jugador (se muestra bajo su avatar). */
  lastWord: string;
}

export interface PlayView {
  players: HudPlayer[];
  /** Letra con la que tiene que empezar la palabra del turno. */
  letter: string | null;
  myTurn: boolean;
  chainLength: number;
}

/** Silueta de la bocha, compartida por el avatar y las cabecitas del dock. */
const BODY_PATH = "M32 5C47 5 55 19 55 39 55 62 45 73 32 73 19 73 9 62 9 39 9 19 17 5 32 5Z";

/**
 * Caras de reaccion, una por `EmoteId`. Son la version "emoji" de este juego: en vez
 * de un glifo Unicode (el repo prohibe emojis) el jugador le presta su cara al mensaje.
 * Cada grupo es un juego completo de rasgos — se muestra en lugar de `.wc__base-face`,
 * no encima — asi que no compite en especificidad con las caras automaticas (turno /
 * panico / feliz / muerto): basta con ocultar el `<g>` padre. Ver `showEmote`.
 *
 * Los rasgos que se **animan** llevan ademas un gancho `wc__a-*` (boca, lengua, cejas,
 * pupilas, cada lagrima por separado). Existen para que el CSS los apunte por nombre en
 * vez de por `nth-of-type`, que se rompe apenas se agrega o reordena un path. Las
 * animaciones viven en `style.css` ("Caras vivas").
 */
const EMOTE_FACES: Record<EmoteId, string> = {
  risa: `
    <circle class="wc__frog-skin" cx="20" cy="22" r="10"/>
    <circle class="wc__frog-skin" cx="44" cy="22" r="10"/>
    <circle class="wc__white" cx="20" cy="22" r="7"/>
    <circle class="wc__white" cx="44" cy="22" r="7"/>
    <circle class="wc__pupil wc__a-pupil" cx="20" cy="22" r="3.5"/>
    <circle class="wc__pupil wc__a-pupil" cx="44" cy="22" r="3.5"/>
    <path class="wc__fl wc__a-mouth" d="M12 44Q32 68 52 44Z"/>
    <path class="wc__tongue wc__a-tongue" d="M20 52Q32 68 44 52Q32 48 20 52Z"/>`,
  sorpresa: `
    <path class="wc__ln" d="M17 21Q24 17 30 21"/>
    <path class="wc__ln" d="M34 21Q40 17 47 21"/>
    <ellipse class="wc__white" cx="24" cy="34" rx="8" ry="9"/>
    <ellipse class="wc__white" cx="41" cy="34" rx="8" ry="9"/>
    <circle class="wc__pupil wc__a-pupil" cx="24" cy="34" r="3"/>
    <circle class="wc__pupil wc__a-pupil" cx="41" cy="34" r="3"/>
    <ellipse class="wc__fl wc__a-mouth" cx="32" cy="55" rx="5.5" ry="7"/>`,
  enojo: `
    <path class="wc__ln wc__a-brow--l" d="M17 25 30 32"/>
    <path class="wc__ln wc__a-brow--r" d="M47 25 34 32"/>
    <ellipse class="wc__white" cx="24" cy="37" rx="6.5" ry="4.6"/>
    <ellipse class="wc__white" cx="41" cy="37" rx="6.5" ry="4.6"/>
    <circle class="wc__pupil" cx="24" cy="37" r="3"/>
    <circle class="wc__pupil" cx="41" cy="37" r="3"/>
    <path class="wc__ln wc__a-mouth" d="M25 55Q32 48 39 55"/>`,
  burla: `
    <ellipse class="wc__white wc__a-eye" cx="24" cy="34" rx="6.5" ry="7.5"/>
    <circle class="wc__pupil wc__a-eye" cx="24" cy="35" r="3.2"/>
    <path class="wc__ln" d="M35 35Q40.5 30 46 35"/>
    <path class="wc__ln" d="M24 49Q32 55 40 49"/>
    <path class="wc__tongue wc__a-tongue" d="M29 52Q31 63 36 54 33 51 29 52Z"/>`,
  llanto: `
    <path class="wc__ln" d="M17 29Q23 25 30 26"/>
    <path class="wc__ln" d="M47 29Q41 25 34 26"/>
    <path class="wc__ln" d="M18 33Q24 39 30 33"/>
    <path class="wc__ln" d="M34 33Q40 39 46 33"/>
    <path class="wc__tear wc__a-tear--l" d="M22 37C22 37 17 47 20.5 50.5 24 53 26 45 22 37Z"/>
    <path class="wc__tear wc__a-tear--r" d="M42 37C42 37 47 47 43.5 50.5 40 53 38 45 42 37Z"/>
    <path class="wc__ln wc__a-mouth" d="M26 57Q32 50 38 57"/>`,
};

/** Los cinco grupos de reaccion, ocultos hasta que la tarjeta lleve `is-emote--<id>`. */
const EMOTE_FACES_SVG = EMOTES.map(
  (e) => `<g class="wc__emo wc__emo--${e.id}">${EMOTE_FACES[e.id]}</g>`,
).join("");

/**
 * Personaje generico compartido por todos: una bocha de acero azulado con cara que
 * reacciona al estado (ver DESIGN.md "Cadena forjada"). Todas las variantes de ojos/
 * cejas/boca/sudor viven en el SVG y el CSS muestra la que corresponde segun las
 * clases de la tarjeta (`is-turn`, `is-out`, `is-happy`) y el `is-critical` del stage.
 * La identidad la da el nombre, no una imagen propia.
 *
 * Los rasgos automaticos van dentro de `.wc__base-face` y las reacciones dentro de
 * `.wc__emote-face`: son excluyentes, y al reaccionar se apaga el grupo entero en vez
 * de pisar rasgo por rasgo.
 */
const CHARACTER_SVG = `
  <svg class="wc__face" viewBox="0 0 64 76" aria-hidden="true">
    <path class="wc__face-body" d="${BODY_PATH}"/>
    <ellipse class="wc__face-hi" cx="24" cy="24" rx="9" ry="11"/>
    <g class="wc__base-face">
      <g class="wc__eyes">
        <ellipse cx="24" cy="34" rx="6.5" ry="7.5" fill="#fff"/>
        <ellipse cx="40" cy="34" rx="6.5" ry="7.5" fill="#fff"/>
        <circle cx="25" cy="35" r="3.2" fill="#10202c"/>
        <circle cx="41" cy="35" r="3.2" fill="#10202c"/>
      </g>
      <g class="wc__brows"><path d="M18 26 30 30"/><path d="M46 26 34 30"/></g>
      <g class="wc__eyes-dead"><path d="M20 30 28 38M28 30 20 38"/><path d="M36 30 44 38M44 30 36 38"/></g>
      <path class="wc__sweat" d="M50 29C50 29 45 38 49 42 53 45 55 38 50 29Z"/>
      <path class="wc__mouth wc__mouth--neutral" d="M26 50Q32 54 38 50"/>
      <path class="wc__mouth wc__mouth--focus" d="M27 51 37 51"/>
      <ellipse class="wc__mouth wc__mouth--panic" cx="32" cy="52" rx="5" ry="6"/>
      <path class="wc__mouth wc__mouth--happy" d="M25 48Q32 59 39 48Z"/>
      <path class="wc__mouth wc__mouth--dead" d="M26 54Q29 51 32 54 35 57 38 54"/>
    </g>
    <g class="wc__emote-face">${EMOTE_FACES_SVG}</g>
  </svg>`;

/**
 * Eslabon entero: la unica vida del jugador. Reemplaza a los corazones de Bomba
 * Palabra — aca no hay tres vidas, hay una cadena que se corta. Dibujado, no emoji.
 */
const LINK_SVG = `
  <svg class="wc__link-badge" viewBox="0 0 28 18" aria-hidden="true">
    <rect x="2" y="2" width="24" height="14" rx="7" fill="none" stroke-width="3.4"/>
  </svg>`;

/** Eslabon partido: el jugador quedo afuera (se le corto la cadena). */
const BROKEN_SVG = `
  <svg class="wc__broken" viewBox="0 0 28 18" aria-hidden="true">
    <path d="M13 2H9A7 7 0 0 0 9 16h4" fill="none" stroke-width="3.4"/>
    <path d="M16 16h3a7 7 0 0 0 3.5-13" fill="none" stroke-width="3.4"/>
  </svg>`;

/** Radio del circulo de jugadores, como fraccion del semilado de la arena. */
const RING_RADIUS = 0.37;

/** Cantidad de chispas de forja de ambiente (ver DESIGN.md). */
const SPARK_COUNT = 16;
/** Esquirlas que salen disparadas cuando el eslabon se parte. */
const SNAP_SHARDS = 12;
/** Duracion total del quiebre (limpieza del DOM). */
const SNAP_MS = 700;
/** Salto del avatar al reaccionar (debe coincidir con `wc-emote-pop` del CSS). */
const EMOTE_POP_MS = 380;
/** Pulso del eslabon al forjarse una palabra nueva. */
const FORGE_MS = 500;

/** Aleatorio en [a, b). */
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * Circunferencia del anillo del reloj (r=46 en el viewBox 100x100). A diferencia de
 * Bomba Palabra el anillo es COMPLETO: no hay mecha saliendo por arriba que esquivar,
 * asi que el arco no necesita hueco. El SVG va rotado -90deg para empezar arriba.
 */
const TIMER_CIRC = 2 * Math.PI * 46;
/** Debajo de esta fraccion el reloj entra en "critico" (pulso + rojo). */
const TIMER_CRITICAL = 0.25;

/**
 * Color del contador por fraccion restante: de metal caliente (lleno) a rojo peligro
 * (por enfriarse/cortarse), interpolado en RGB. Mismos tonos que --hot / --danger.
 */
function timerColor(frac: number): string {
  const t = Math.max(0, Math.min(1, frac));
  const r = Math.round(226 + (255 - 226) * t);
  const g = Math.round(69 + (179 - 69) * t);
  const b = Math.round(47 + (71 - 47) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * DOM de Cadena de Palabras (estetica "Cadena forjada", ver DESIGN.md): los jugadores
 * forman un circulo alrededor del yunque; en el centro, un eslabon incandescente con
 * la LETRA grabada y el anillo del reloj alrededor. Cada jugador es nombre arriba,
 * avatar generico, y debajo lo que escribe. Una flecha apunta al jugador de turno. NO
 * hay caja de texto: un input invisible captura el tecleo (y summonea el teclado en
 * movil) y el texto se ve bajo el avatar propio. Los estados de espera / resultados /
 * tablero final los cubre el `RoomOverlay` compartido por encima.
 */
export class Hud {
  private readonly stage: HTMLDivElement;
  private readonly arena: HTMLDivElement;
  private readonly letterEl: HTMLDivElement;
  private readonly timeEl: HTMLDivElement;
  private readonly timerEl: SVGSVGElement;
  private readonly timerBar: SVGCircleElement;
  private readonly linkEl: HTMLDivElement;
  private readonly snapEl: HTMLDivElement;
  private readonly countEl: HTMLDivElement;
  private readonly pointer: HTMLDivElement;
  private snapTimer = 0;
  private forgeTimer = 0;
  private readonly input: HTMLInputElement;
  private readonly emoteDock: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;

  /** Reaccion vigente por jugador. Se guarda porque `render()` reconstruye las
   *  tarjetas en cada `wc:state` y la cara se perderia a mitad de camino. */
  private readonly emoteState = new Map<string, { id: EmoteId; timer: number }>();
  private emotesEnabled = false;
  /** Cooldown local del dock (el server tiene el suyo, que es el que manda). */
  private emoteReadyAt = 0;

  /** Reloj visible: anclaje al reloj monotono local para animar sin drift. */
  private clockEnd = 0;
  private clockTotalMs = 0;
  private clockRaf: number | null = null;

  /** Celda de palabra por jugador (para actualizar el tipeo sin re-render). */
  private wordEls = new Map<string, HTMLDivElement>();
  /** Tarjeta por jugador (para sacudir en el rechazo). */
  private cardEls = new Map<string, HTMLDivElement>();
  private me = "";

  private submitCb: (word: string) => void = () => {};
  private typeCb: (text: string) => void = () => {};
  private emoteCb: (id: EmoteId) => void = () => {};

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "wc";
    wrap.innerHTML = `
      <div class="wc__stage" hidden>
        <div class="wc__sparks" aria-hidden="true"></div>
        <div class="wc__count" aria-live="off"></div>
        <div class="wc__arena">
          <div class="wc__forge" aria-hidden="true"></div>
          <svg class="wc__timer" viewBox="0 0 100 100" hidden aria-hidden="true">
            <circle class="wc__timer-track" cx="50" cy="50" r="46"></circle>
            <circle class="wc__timer-bar" cx="50" cy="50" r="46"></circle>
          </svg>
          <div class="wc__link">
            <div class="wc__link-side wc__link-side--l" aria-hidden="true"></div>
            <div class="wc__link-side wc__link-side--r" aria-hidden="true"></div>
            <div class="wc__link-body">
              <div class="wc__letter"></div>
              <div class="wc__time"></div>
            </div>
          </div>
          <div class="wc__pointer" hidden></div>
          <div class="wc__snap" aria-hidden="true"></div>
        </div>
        <input class="wc__input" type="text" inputmode="text" autocapitalize="off"
               autocomplete="off" autocorrect="off" spellcheck="false" maxlength="32"
               aria-label="escribi una palabra" />
        <div class="wc__emotes" role="group" aria-label="reacciones" hidden></div>
      </div>
      <div class="wc__overlay"></div>
      <div class="wc__countdown" hidden></div>
    `;
    root.appendChild(wrap);

    this.stage = wrap.querySelector(".wc__stage")!;
    this.arena = wrap.querySelector(".wc__arena")!;
    this.letterEl = wrap.querySelector(".wc__letter")!;
    this.timeEl = wrap.querySelector(".wc__time")!;
    this.timerEl = wrap.querySelector(".wc__timer")!;
    this.timerBar = wrap.querySelector(".wc__timer-bar")!;
    this.linkEl = wrap.querySelector(".wc__link")!;
    this.snapEl = wrap.querySelector(".wc__snap")!;
    this.countEl = wrap.querySelector(".wc__count")!;
    this.pointer = wrap.querySelector(".wc__pointer")!;
    this.input = wrap.querySelector(".wc__input")!;
    this.emoteDock = wrap.querySelector(".wc__emotes")!;
    this.overlay = wrap.querySelector(".wc__overlay")!;
    this.countdownEl = wrap.querySelector(".wc__countdown")!;

    // Chispas de forja (ver DESIGN.md): suben lento de fondo, por detras de todo.
    this.buildSparks(wrap.querySelector(".wc__sparks")!);
    this.buildEmoteDock();

    // Enter envia; el texto tipeado se refleja bajo el avatar propio en vivo.
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const word = this.input.value.trim();
        if (word) this.submitCb(word);
      }
    });
    this.input.addEventListener("input", () => {
      this.typeCb(this.input.value);
      this.setWord(this.me, this.input.value);
    });
    // Tocar la arena enfoca el input (summonea el teclado en movil sin caja visible).
    this.arena.addEventListener("pointerdown", () => {
      if (!this.input.disabled) this.input.focus();
    });

    // Atajos 1-5 para reaccionar. Van en `window` (no en el input) porque el que NO
    // tiene el turno lo tiene deshabilitado y sin foco. El de turno si lo tiene: por
    // eso se hace `preventDefault`, que cancela la insercion del digito en el input
    // — y no se pierde nada, las palabras son solo `[a-zñ]`.
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const emote = EMOTES.find((x) => x.key === e.key);
      if (!emote) return;
      e.preventDefault();
      this.sendEmote(emote.id);
    });
  }

  onSubmit(cb: (word: string) => void): void {
    this.submitCb = cb;
  }
  onType(cb: (text: string) => void): void {
    this.typeCb = cb;
  }
  onEmote(cb: (id: EmoteId) => void): void {
    this.emoteCb = cb;
  }

  // ---------- Mensajes / countdown ----------

  /** Cartel a pantalla (start, requiere sala, no disponible). `bodyHtml` es HTML. */
  showMessage(title: string, bodyHtml: string, action?: { label: string; onClick: () => void }): void {
    this.stage.hidden = true;
    this.overlay.hidden = false;
    this.overlay.innerHTML = `
      <div class="wc__card">
        <h1 class="wc__title">${title}</h1>
        <div class="wc__body">${bodyHtml}</div>
        ${action ? `<button class="wc__btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlay.querySelector<HTMLButtonElement>(".wc__btn")!.addEventListener(
        "click",
        action.onClick,
      );
    }
  }

  hideMessage(): void {
    this.overlay.hidden = true;
    this.overlay.innerHTML = "";
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.hidden = true;
      return;
    }
    this.countdownEl.hidden = false;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-pop");
    void this.countdownEl.offsetWidth; // reflow para reiniciar la animacion
    this.countdownEl.classList.add("is-pop");
  }

  // ---------- Escena en-juego ----------

  showStage(): void {
    this.hideMessage();
    this.stage.hidden = false;
  }

  render(view: PlayView): void {
    this.me = view.players.find((p) => p.isMe)?.nickname ?? this.me;

    // Reconstruye el circulo. Se limpian solo las tarjetas (eslabon/pointer quedan).
    for (const el of this.cardEls.values()) el.remove();
    this.cardEls.clear();
    this.wordEls.clear();

    const n = view.players.length;
    let turnAngle: number | null = null;

    view.players.forEach((p, i) => {
      const angle = n > 0 ? (i * 360) / n : 0; // 0 = arriba, girando en sentido horario
      const rad = (angle * Math.PI) / 180;
      const x = 50 + RING_RADIUS * 100 * Math.sin(rad);
      const y = 50 - RING_RADIUS * 100 * Math.cos(rad);
      if (p.isTurn) turnAngle = angle;

      const card = document.createElement("div");
      card.className = "wc__player";
      if (p.isTurn) card.classList.add("is-turn");
      if (p.isMe) card.classList.add("is-me");
      if (!p.alive) card.classList.add("is-out");
      if (!p.connected) card.classList.add("is-off");
      card.style.left = `${x}%`;
      card.style.top = `${y}%`;

      // Una sola vida: un eslabon entero mientras esta en pie, partido al caer. Al
      // lado, cuantos eslabones aporto a la cadena (su racha en la partida).
      const badge = p.alive
        ? `${LINK_SVG}${p.links > 0 ? `<span class="wc__links">${p.links}</span>` : ""}`
        : BROKEN_SVG;

      // La palabra bajo el avatar: el que tiene el turno arranca vacio (se llena
      // con el tipeo en vivo); el resto muestra su ultima palabra aceptada, con la
      // cola encendida (esa letra es el eslabon que le paso al siguiente).
      const word = p.isTurn ? "" : p.lastWord;

      card.innerHTML = `
        <div class="wc__bubble" aria-hidden="true">&iexcl;R&Aacute;PIDO!</div>
        <div class="wc__pname">${escapeHtml(p.nickname)}</div>
        <div class="wc__badge">${badge}</div>
        <div class="wc__avatar">${CHARACTER_SVG}</div>
        <div class="wc__word">${wordHtml(word)}</div>
      `;
      // La tarjeta es nueva: si el jugador esta reaccionando, se le repone la cara
      // (sin el "pop", que ya sono cuando llego la reaccion).
      const emote = this.emoteState.get(p.nickname);
      if (emote) applyEmoteClasses(card, emote.id);

      this.arena.appendChild(card);
      this.cardEls.set(p.nickname, card);
      this.wordEls.set(p.nickname, card.querySelector<HTMLDivElement>(".wc__word")!);
    });

    // Eslabon central: la letra + flecha girando hacia el jugador de turno.
    this.letterEl.textContent = view.letter ? view.letter.toUpperCase() : "";
    this.countEl.textContent = view.chainLength > 0 ? `CADENA ${view.chainLength}` : "";
    if (turnAngle !== null) {
      this.pointer.hidden = false;
      // La distancia escala y queda en la banda libre entre el anillo del reloj (radio
      // ~20vmin) y el circulo de jugadores (radio ~34vmin), asi no se encima con ninguno.
      this.pointer.style.transform =
        `translate(-50%, -50%) rotate(${turnAngle}deg) translateY(calc(-1 * clamp(100px, 24vmin, 176px)))`;
    } else {
      this.pointer.hidden = true;
    }

    this.setInputEnabled(view.myTurn);
    if (view.myTurn) this.setWord(this.me, this.input.value);
  }

  /**
   * El eslabon se parte: flash + onda + esquirlas + sacudida (ver DESIGN.md). Se
   * dispara cuando a un jugador se le acaba el reloj — y con una sola vida, eso
   * significa que quedo afuera. Es el equivalente de la explosion de Bomba Palabra,
   * pero frio y metalico: hierro que cede, no polvora.
   */
  flashSnap(): void {
    let html = `<div class="wc__snap-flash"></div><div class="wc__snap-ring"></div>`;
    for (let i = 0; i < SNAP_SHARDS; i++) {
      const angle = (360 / SNAP_SHARDS) * i + rnd(-12, 12);
      html += `<span class="wc__snap-shard" style="--a:${angle.toFixed(1)}deg;--d:${rnd(56, 120).toFixed(0)}px"></span>`;
    }
    this.snapEl.innerHTML = html;
    // Reinicia las animaciones (reflow) por si ya habia una en curso.
    this.snapEl.classList.remove("is-on");
    this.linkEl.classList.remove("is-snap");
    void this.snapEl.offsetWidth;
    this.snapEl.classList.add("is-on");
    this.linkEl.classList.add("is-snap");
    window.clearTimeout(this.snapTimer);
    this.snapTimer = window.setTimeout(() => {
      this.snapEl.classList.remove("is-on");
      this.linkEl.classList.remove("is-snap");
      this.snapEl.innerHTML = "";
    }, SNAP_MS);
  }

  /** Siembra las chispas de la forja con posicion/tamano/tiempos aleatorios. */
  private buildSparks(host: HTMLDivElement): void {
    for (let i = 0; i < SPARK_COUNT; i++) {
      const e = document.createElement("span");
      e.className = "wc__spark";
      const size = rnd(3, 7);
      e.style.left = `${rnd(2, 98)}%`;
      e.style.width = `${size}px`;
      e.style.height = `${size}px`;
      e.style.animationDuration = `${rnd(6, 13)}s`;
      e.style.animationDelay = `${-rnd(0, 13)}s`; // desfasadas desde el arranque
      host.appendChild(e);
    }
  }

  // ---------- Reacciones (la cara del propio personaje) ----------

  /** Dock de reacciones: una cabecita por cara, con su atajo. */
  private buildEmoteDock(): void {
    for (const e of EMOTES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wc__emote";
      btn.title = `${e.label} (${e.key})`;
      btn.setAttribute("aria-label", e.label);
      btn.innerHTML = `
        <svg class="wc__emo-head" viewBox="0 0 64 76" aria-hidden="true">
          <path class="wc__face-body" d="${BODY_PATH}"/>
          <g class="wc__emo">${EMOTE_FACES[e.id]}</g>
        </svg>
        <span class="wc__emote-key">${e.key}</span>`;
      // Sin `preventDefault` el click le roba el foco al input invisible y el jugador
      // de turno deja de poder escribir a mitad de palabra.
      btn.addEventListener("pointerdown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => this.sendEmote(e.id));
      this.emoteDock.appendChild(btn);
    }
  }

  /** Reacciona solo durante la partida (el dock queda oculto y los atajos inertes). */
  setEmotesEnabled(on: boolean): void {
    this.emotesEnabled = on;
    this.emoteDock.hidden = !on;
  }

  /**
   * Manda una reaccion. No se pinta la cara propia aca: se espera el eco del server,
   * asi lo que ve uno es exactamente lo que ven los demas (y el cooldown del server
   * es el que manda). El cooldown local solo apaga el dock para no invitar al spam.
   */
  private sendEmote(id: EmoteId): void {
    if (!this.emotesEnabled) return;
    const now = performance.now();
    if (now < this.emoteReadyAt) return;
    this.emoteReadyAt = now + EMOTE_COOLDOWN_MS;
    this.emoteDock.classList.add("is-cooling");
    window.setTimeout(() => this.emoteDock.classList.remove("is-cooling"), EMOTE_COOLDOWN_MS);
    this.emoteCb(id);
  }

  /** Le pone la cara de reaccion a un jugador por `EMOTE_MS` (llega del server). */
  showEmote(player: string, id: EmoteId): void {
    const prev = this.emoteState.get(player);
    if (prev) window.clearTimeout(prev.timer);
    const timer = window.setTimeout(() => {
      this.emoteState.delete(player);
      const el = this.cardEls.get(player);
      if (el) clearEmoteClasses(el);
    }, EMOTE_MS);
    this.emoteState.set(player, { id, timer });

    const card = this.cardEls.get(player);
    if (!card) return;
    applyEmoteClasses(card, id);
    // Reinicia el "pop" aunque ya estuviera reaccionando.
    card.classList.remove("is-emote-pop");
    void card.offsetWidth;
    card.classList.add("is-emote-pop");
    window.setTimeout(() => card.classList.remove("is-emote-pop"), EMOTE_POP_MS);
  }

  // ---------- Reloj visible (anillo + segundos) ----------

  /**
   * Arranca/actualiza el anillo del reloj. `remainingMs` y `totalMs` vienen del
   * server; se anclan al reloj monotono local (`performance.now()`) para animar sin
   * depender del epoch del server (cero drift de reloj). Idempotente: llamarla en
   * cada snapshot solo re-ancla; el loop rAF ya en curso toma los nuevos valores.
   */
  setClock(remainingMs: number, totalMs: number): void {
    // Guarda contra valores no finitos (p.ej. un server viejo que manda undefined).
    if (!Number.isFinite(remainingMs) || !Number.isFinite(totalMs) || totalMs <= 0) {
      this.clearClock();
      return;
    }
    this.clockEnd = performance.now() + remainingMs;
    this.clockTotalMs = totalMs;
    this.timerEl.removeAttribute("hidden"); // SVGSVGElement no tipa `hidden` como prop
    if (this.clockRaf === null) this.tickClock();
  }

  /** Oculta y detiene el reloj (fuera de "playing", game over). */
  clearClock(): void {
    if (this.clockRaf !== null) {
      cancelAnimationFrame(this.clockRaf);
      this.clockRaf = null;
    }
    this.timerEl.setAttribute("hidden", "");
    this.timerEl.classList.remove("is-critical");
    this.stage.classList.remove("is-critical");
    this.timeEl.textContent = "";
  }

  private readonly tickClock = (): void => {
    const remaining = Math.max(0, this.clockEnd - performance.now());
    const frac = this.clockTotalMs > 0 ? Math.min(1, remaining / this.clockTotalMs) : 0;
    // El anillo es completo (360deg): no hay mecha que esquivar como en Bomba Palabra.
    this.timerBar.style.strokeDasharray = `${TIMER_CIRC * frac} ${TIMER_CIRC}`;
    const color = timerColor(frac);
    this.timerBar.style.stroke = color;
    this.timeEl.style.color = color;
    this.timeEl.textContent = remaining > 0 ? String(Math.ceil(remaining / 1000)) : "";
    const critical = remaining > 0 && frac <= TIMER_CRITICAL;
    this.timerEl.classList.toggle("is-critical", critical);
    // El stage marca "critico": el jugador de turno entra en panico (cara + gota +
    // globo "RAPIDO!") via CSS, y el eslabon se enfria a rojo. Lo hace la tickClock
    // porque el panico depende del tiempo, no de un cambio de estado del server.
    this.stage.classList.toggle("is-critical", critical);
    // Al llegar a 0 se detiene y queda vacio: el server difundira el quiebre / el
    // nuevo turno, que re-ancla el reloj via setClock.
    this.clockRaf = remaining > 0 ? requestAnimationFrame(this.tickClock) : null;
  };

  /** Actualiza la palabra bajo el avatar de un jugador (tipeo en vivo o aceptada). */
  private setWord(nickname: string, text: string): void {
    const el = this.wordEls.get(nickname);
    if (el) el.textContent = text;
  }

  setInputEnabled(on: boolean): void {
    this.input.disabled = !on;
    if (on) {
      this.input.focus();
    } else {
      this.input.value = "";
      this.input.blur();
    }
  }

  clearInput(): void {
    this.input.value = "";
    this.setWord(this.me, "");
  }

  focusInput(): void {
    if (!this.input.disabled) this.input.focus();
  }

  /** Muestra lo que el jugador de turno (otro) esta tecleando, bajo su avatar. */
  showTyping(player: string, text: string): void {
    this.setWord(player, text);
  }

  /** Rechazo: sacude el avatar propio y muestra el motivo bajo el. */
  flashReject(message: string): void {
    const card = this.cardEls.get(this.me);
    if (card) {
      card.classList.remove("is-reject");
      void card.offsetWidth;
      card.classList.add("is-reject");
      window.setTimeout(() => card.classList.remove("is-reject"), 500);
    }
    const el = this.wordEls.get(this.me);
    if (el) {
      el.textContent = message;
      el.classList.add("is-reject");
      window.setTimeout(() => el.classList.remove("is-reject"), 900);
    }
  }

  /**
   * Eslabon forjado: sella la palabra bajo el avatar de quien acerto, con su ULTIMA
   * letra encendida — es la que hereda el siguiente jugador, y verla resaltada es lo
   * que hace legible la regla de la cadena. Ademas el eslabon central pulsa.
   *
   * Se llama DESPUES de `render()` (ver `Game.applyState`): render reconstruye las
   * tarjetas en cada snapshot, asi que sellar antes seria pintar sobre nodos que se
   * estan por descartar y la animacion no se veria nunca.
   */
  flashAccept(player: string, word: string): void {
    const card = this.cardEls.get(player);
    if (card) {
      card.classList.add("is-happy");
      window.setTimeout(() => card.classList.remove("is-happy"), 800);
    }

    this.linkEl.classList.remove("is-forged");
    void this.linkEl.offsetWidth;
    this.linkEl.classList.add("is-forged");
    window.clearTimeout(this.forgeTimer);
    this.forgeTimer = window.setTimeout(() => this.linkEl.classList.remove("is-forged"), FORGE_MS);

    const el = this.wordEls.get(player);
    if (!el) return;
    el.innerHTML = wordHtml(word);
    el.classList.remove("is-reject");
    el.classList.add("is-accept");
    window.setTimeout(() => el.classList.remove("is-accept"), 700);
  }
}

/**
 * Una palabra aceptada con su ULTIMA letra encendida: esa letra es el reto que hereda
 * el siguiente jugador. Es la regla del juego hecha visible, asi que se pinta igual en
 * el sello del momento (`flashAccept`) y en el re-render de cada snapshot.
 */
function wordHtml(word: string): string {
  if (!word) return "";
  const head = escapeHtml(word.slice(0, -1));
  const tail = escapeHtml(word.slice(-1));
  return `${head}<span class="wc__tail">${tail}</span>`;
}

function applyEmoteClasses(card: HTMLDivElement, id: EmoteId): void {
  clearEmoteClasses(card);
  card.classList.add("is-emote", `is-emote--${id}`);
}

function clearEmoteClasses(card: HTMLDivElement): void {
  card.classList.remove("is-emote", "is-emote-pop");
  for (const e of EMOTES) card.classList.remove(`is-emote--${e.id}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
