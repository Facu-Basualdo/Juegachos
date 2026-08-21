import { EMOTES, EMOTE_COOLDOWN_MS, EMOTE_MS, type EmoteId } from "./constants";

export interface HudPlayer {
  nickname: string;
  lives: number;
  alive: boolean;
  connected: boolean;
  isTurn: boolean;
  isMe: boolean;
  /** Ultima palabra aceptada por este jugador (se muestra bajo su avatar). */
  lastWord: string;
}

export interface PlayView {
  players: HudPlayer[];
  fragment: string | null;
  myTurn: boolean;
  usedCount: number;
}

/** Silueta de la bocha, compartida por el avatar y las cabecitas del dock. */
const BODY_PATH = "M32 5C47 5 55 19 55 39 55 62 45 73 32 73 19 73 9 62 9 39 9 19 17 5 32 5Z";

/**
 * Caras de reaccion, una por `EmoteId`. Son la version "emoji" de este juego: en vez
 * de un glifo Unicode (el repo prohibe emojis) el jugador le presta su cara al mensaje.
 * Cada grupo es un juego completo de rasgos — se muestra en lugar de `.wb__base-face`,
 * no encima — asi que no compite en especificidad con las caras automaticas (turno /
 * panico / feliz / muerto): basta con ocultar el `<g>` padre. Ver `showEmote`.
 */
const EMOTE_FACES: Record<EmoteId, string> = {
  risa: `
    <circle class="wb__frog-skin" cx="20" cy="22" r="10"/>
    <circle class="wb__frog-skin" cx="44" cy="22" r="10"/>
    <circle class="wb__white" cx="20" cy="22" r="7"/>
    <circle class="wb__white" cx="44" cy="22" r="7"/>
    <circle class="wb__pupil wb__a-pupil" cx="20" cy="22" r="3.5"/>
    <circle class="wb__pupil wb__a-pupil" cx="44" cy="22" r="3.5"/>
    <path class="wb__fl wb__a-mouth" d="M12 44Q32 68 52 44Z"/>
    <path class="wb__tongue wb__a-tongue" d="M20 52Q32 68 44 52Q32 48 20 52Z"/>`,
  sorpresa: `
    <path class="wb__ln" d="M17 21Q24 17 30 21"/>
    <path class="wb__ln" d="M34 21Q40 17 47 21"/>
    <ellipse class="wb__white" cx="24" cy="34" rx="8" ry="9"/>
    <ellipse class="wb__white" cx="41" cy="34" rx="8" ry="9"/>
    <circle class="wb__pupil wb__a-pupil" cx="24" cy="34" r="3"/>
    <circle class="wb__pupil wb__a-pupil" cx="41" cy="34" r="3"/>
    <ellipse class="wb__fl wb__a-mouth" cx="32" cy="55" rx="5.5" ry="7"/>`,
  enojo: `
    <path class="wb__ln wb__a-brow--l" d="M17 25 30 32"/>
    <path class="wb__ln wb__a-brow--r" d="M47 25 34 32"/>
    <ellipse class="wb__white" cx="24" cy="37" rx="6.5" ry="4.6"/>
    <ellipse class="wb__white" cx="41" cy="37" rx="6.5" ry="4.6"/>
    <circle class="wb__pupil" cx="24" cy="37" r="3"/>
    <circle class="wb__pupil" cx="41" cy="37" r="3"/>
    <path class="wb__ln wb__a-mouth" d="M25 55Q32 48 39 55"/>`,
  burla: `
    <ellipse class="wb__white wb__a-eye" cx="24" cy="34" rx="6.5" ry="7.5"/>
    <circle class="wb__pupil wb__a-eye" cx="24" cy="35" r="3.2"/>
    <path class="wb__ln" d="M35 35Q40.5 30 46 35"/>
    <path class="wb__ln" d="M24 49Q32 55 40 49"/>
    <path class="wb__tongue wb__a-tongue" d="M29 52Q31 63 36 54 33 51 29 52Z"/>`,
  llanto: `
    <path class="wb__ln" d="M17 29Q23 25 30 26"/>
    <path class="wb__ln" d="M47 29Q41 25 34 26"/>
    <path class="wb__ln" d="M18 33Q24 39 30 33"/>
    <path class="wb__ln" d="M34 33Q40 39 46 33"/>
    <path class="wb__tear wb__a-tear--l" d="M22 37C22 37 17 47 20.5 50.5 24 53 26 45 22 37Z"/>
    <path class="wb__tear wb__a-tear--r" d="M42 37C42 37 47 47 43.5 50.5 40 53 38 45 42 37Z"/>
    <path class="wb__ln wb__a-mouth" d="M26 57Q32 50 38 57"/>`,
};

/** Los cinco grupos de reaccion, ocultos hasta que la tarjeta lleve `is-emote--<id>`. */
const EMOTE_FACES_SVG = EMOTES.map(
  (e) => `<g class="wb__emo wb__emo--${e.id}">${EMOTE_FACES[e.id]}</g>`,
).join("");

/**
 * Personaje generico compartido por todos: una bocha violeta con cara que reacciona
 * al estado (ver DESIGN.md "Fiesta de la bomba"). Todas las variantes de ojos/cejas/
 * boca/sudor viven en el SVG y el CSS muestra la que corresponde segun las clases de
 * la tarjeta (`is-turn`, `is-out`, `is-happy`) y el `is-critical` del stage. La
 * identidad la da el nombre, no una imagen propia.
 *
 * Los rasgos automaticos van dentro de `.wb__base-face` y las reacciones dentro de
 * `.wb__emote-face`: son excluyentes, y al reaccionar se apaga el grupo entero en vez
 * de pisar rasgo por rasgo.
 */
const CHARACTER_SVG = `
  <svg class="wb__face" viewBox="0 0 64 76" aria-hidden="true">
    <path class="wb__face-body" d="${BODY_PATH}"/>
    <ellipse class="wb__face-hi" cx="24" cy="24" rx="9" ry="11"/>
    <g class="wb__base-face">
      <g class="wb__eyes">
        <ellipse cx="24" cy="34" rx="6.5" ry="7.5" fill="#fff"/>
        <ellipse cx="40" cy="34" rx="6.5" ry="7.5" fill="#fff"/>
        <circle cx="25" cy="35" r="3.2" fill="#241033"/>
        <circle cx="41" cy="35" r="3.2" fill="#241033"/>
      </g>
      <g class="wb__brows"><path d="M18 26 30 30"/><path d="M46 26 34 30"/></g>
      <g class="wb__eyes-dead"><path d="M20 30 28 38M28 30 20 38"/><path d="M36 30 44 38M44 30 36 38"/></g>
      <path class="wb__sweat" d="M50 29C50 29 45 38 49 42 53 45 55 38 50 29Z"/>
      <path class="wb__mouth wb__mouth--neutral" d="M26 50Q32 54 38 50"/>
      <path class="wb__mouth wb__mouth--focus" d="M27 51 37 51"/>
      <ellipse class="wb__mouth wb__mouth--panic" cx="32" cy="52" rx="5" ry="6"/>
      <path class="wb__mouth wb__mouth--happy" d="M25 48Q32 59 39 48Z"/>
      <path class="wb__mouth wb__mouth--dead" d="M26 54Q29 51 32 54 35 57 38 54"/>
    </g>
    <g class="wb__emote-face">${EMOTE_FACES_SVG}</g>
  </svg>`;

/** Corazon (vida) dibujado — nada de emojis (regla del repo). */
const HEART_SVG = `
  <svg class="wb__heart" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 21C12 21 3 14.4 3 8.5 3 5.5 5.4 3.5 8 3.5 9.9 3.5 11.4 4.7 12 6 12.6 4.7 14.1 3.5 16 3.5 18.6 3.5 21 5.5 21 8.5 21 14.4 12 21 12 21Z"/>
  </svg>`;

/** Calavera (eliminado) dibujada. */
const SKULL_SVG = `
  <svg class="wb__skull" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2C6.9 2 3.5 5.6 3.5 10.4 3.5 13 4.9 15.1 6.7 16.3L6.7 19 9 19 9 17 11 17 11 19 13 19 13 17 15 17 15 19 17.3 19 17.3 16.3C19.1 15.1 20.5 13 20.5 10.4 20.5 5.6 17.1 2 12 2Z" fill="#d8d2c8"/>
    <circle cx="8.6" cy="11" r="2.1" fill="#241033"/>
    <circle cx="15.4" cy="11" r="2.1" fill="#241033"/>
    <path d="M12 13.4 10.6 16 13.4 16Z" fill="#241033"/>
  </svg>`;

/** Radio del circulo de jugadores, como fraccion del semilado de la arena. */
const RING_RADIUS = 0.37;

/** Cantidad de brasas de ambiente (ver DESIGN.md). */
const EMBER_COUNT = 16;
/** Esquirlas que salen disparadas en la explosion. */
const BOOM_SHARDS = 12;
/** Duracion total de la explosion (limpieza del DOM). */
const BOOM_MS = 700;
/** Salto del avatar al reaccionar (debe coincidir con `wb-emote-pop` del CSS). */
const EMOTE_POP_MS = 380;

/** Aleatorio en [a, b). */
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Circunferencia del anillo de mecha (r=46 en el viewBox 100x100 del SVG). */
const FUSE_CIRC = 2 * Math.PI * 46;
/** El anillo es un arco de 300deg (deja un hueco de 60deg arriba, por donde sale la
 *  mecha, para que el aro nunca cruce el pabilo). El .wb__fuse va rotado -60deg y el
 *  track dibuja este arco por CSS; la barra usa esta longitud como maximo. */
const FUSE_ARC = FUSE_CIRC * (300 / 360);
/** Alto de la mecha a full (% del alto de la bomba); se acorta con el tiempo hasta 0
 *  (la chispa baja quemando el pabilo). Debe coincidir con el `height` de `.wb__wick`. */
const WICK_FULL_PCT = 40;
/** La mecha se quema con `frac^WICK_EXP` (no lineal): como es corta y la chispa es un
 *  blob, en lineal "parece quemada" antes de que el anillo termine. Con exp < 1
 *  retiene mas largo a fraccion baja, asi su quemado coincide con el vaciado del aro. */
const WICK_EXP = 0.6;
/** Debajo de esta fraccion la mecha entra en "critico" (pulso + rojo). */
const FUSE_CRITICAL = 0.25;

/**
 * Color del contador por fraccion restante: de chispa amarilla (lleno) a rojo
 * peligro (por agotarse), interpolado en RGB. Mismos tonos que --spark / --danger.
 */
function fuseColor(frac: number): string {
  const t = Math.max(0, Math.min(1, frac));
  const r = Math.round(226 + (245 - 226) * t);
  const g = Math.round(59 + (197 - 59) * t);
  const b = Math.round(59 + (24 - 59) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * DOM de Bomba Palabra (estetica "mesa de bomba", ver DESIGN.md): los jugadores
 * forman un circulo alrededor de la bomba central; cada uno es nombre arriba,
 * avatar generico, y debajo lo que escribe. La bomba muestra el fragmento y una
 * flecha apunta al jugador de turno. NO hay caja de texto: un input invisible
 * captura el tecleo (y summonea el teclado en movil) y el texto se ve bajo el
 * avatar propio. Los estados de espera / resultados / tablero final los cubre el
 * `RoomOverlay` compartido por encima.
 */
export class Hud {
  private readonly stage: HTMLDivElement;
  private readonly arena: HTMLDivElement;
  private readonly bombFragEl: HTMLDivElement;
  private readonly bombTimeEl: HTMLDivElement;
  private readonly fuseEl: SVGSVGElement;
  private readonly fuseBar: SVGCircleElement;
  private readonly wickEl: HTMLDivElement;
  private readonly bombEl: HTMLDivElement;
  private readonly boomEl: HTMLDivElement;
  private readonly pointer: HTMLDivElement;
  private boomTimer = 0;
  private readonly input: HTMLInputElement;
  private readonly emoteDock: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;

  /** Reaccion vigente por jugador. Se guarda porque `render()` reconstruye las
   *  tarjetas en cada `wb:state` y la cara se perderia a mitad de camino. */
  private readonly emoteState = new Map<string, { id: EmoteId; timer: number }>();
  private emotesEnabled = false;
  /** Cooldown local del dock (el server tiene el suyo, que es el que manda). */
  private emoteReadyAt = 0;

  /** Mecha visible: anclaje al reloj monotono local para animar sin drift. */
  private fuseEnd = 0;
  private fuseTotalMs = 0;
  private fuseRaf: number | null = null;

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
    wrap.className = "wb";
    wrap.innerHTML = `
      <div class="wb__stage" hidden>
        <div class="wb__embers" aria-hidden="true"></div>
        <div class="wb__arena">
          <div class="wb__socket" aria-hidden="true"></div>
          <svg class="wb__fuse" viewBox="0 0 100 100" hidden aria-hidden="true">
            <circle class="wb__fuse-track" cx="50" cy="50" r="46"></circle>
            <circle class="wb__fuse-bar" cx="50" cy="50" r="46"></circle>
          </svg>
          <div class="wb__bomb">
            <div class="wb__wick" aria-hidden="true"><span class="wb__spark"></span></div>
            <div class="wb__collar" aria-hidden="true"></div>
            <div class="wb__bomb-frag"></div>
            <div class="wb__bomb-time"></div>
          </div>
          <div class="wb__pointer" hidden></div>
          <div class="wb__boom" aria-hidden="true"></div>
        </div>
        <input class="wb__input" type="text" inputmode="text" autocapitalize="off"
               autocomplete="off" autocorrect="off" spellcheck="false" maxlength="32"
               aria-label="escribi una palabra" />
        <div class="wb__emotes" role="group" aria-label="reacciones" hidden></div>
      </div>
      <div class="wb__overlay"></div>
      <div class="wb__countdown" hidden></div>
    `;
    root.appendChild(wrap);

    this.stage = wrap.querySelector(".wb__stage")!;
    this.arena = wrap.querySelector(".wb__arena")!;
    this.bombFragEl = wrap.querySelector(".wb__bomb-frag")!;
    this.bombTimeEl = wrap.querySelector(".wb__bomb-time")!;
    this.fuseEl = wrap.querySelector(".wb__fuse")!;
    this.fuseBar = wrap.querySelector(".wb__fuse-bar")!;
    this.wickEl = wrap.querySelector(".wb__wick")!;
    this.bombEl = wrap.querySelector(".wb__bomb")!;
    this.boomEl = wrap.querySelector(".wb__boom")!;
    this.pointer = wrap.querySelector(".wb__pointer")!;
    this.input = wrap.querySelector(".wb__input")!;
    this.emoteDock = wrap.querySelector(".wb__emotes")!;
    this.overlay = wrap.querySelector(".wb__overlay")!;
    this.countdownEl = wrap.querySelector(".wb__countdown")!;

    // Brasas de ambiente (ver DESIGN.md): suben lento de fondo, por detras de todo.
    this.buildEmbers(wrap.querySelector(".wb__embers")!);
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
      <div class="wb__card">
        <h1 class="wb__title">${title}</h1>
        <div class="wb__body">${bodyHtml}</div>
        ${action ? `<button class="wb__btn" type="button">${action.label}</button>` : ""}
      </div>
    `;
    if (action) {
      this.overlay.querySelector<HTMLButtonElement>(".wb__btn")!.addEventListener(
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

    // Reconstruye el circulo. Se limpian solo las tarjetas (bomba/pointer quedan).
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
      card.className = "wb__player";
      if (p.isTurn) card.classList.add("is-turn");
      if (p.isMe) card.classList.add("is-me");
      if (!p.alive) card.classList.add("is-out");
      if (!p.connected) card.classList.add("is-off");
      card.style.left = `${x}%`;
      card.style.top = `${y}%`;

      const badge = p.alive
        ? `<span class="wb__hearts">${HEART_SVG.repeat(Math.max(0, p.lives))}</span>`
        : `<span class="wb__skull-badge">${SKULL_SVG}</span>`;

      // La palabra bajo el avatar: el que tiene el turno arranca vacio (se llena
      // con el tipeo en vivo); el resto muestra su ultima palabra aceptada.
      const word = p.isTurn ? "" : p.lastWord;

      card.innerHTML = `
        <div class="wb__bubble" aria-hidden="true">&iexcl;R&Aacute;PIDO!</div>
        <div class="wb__pname">${escapeHtml(p.nickname)}</div>
        <div class="wb__badge">${badge}</div>
        <div class="wb__avatar">${CHARACTER_SVG}</div>
        <div class="wb__word">${escapeHtml(word)}</div>
      `;
      // La tarjeta es nueva: si el jugador esta reaccionando, se le repone la cara
      // (sin el "pop", que ya sono cuando llego la reaccion).
      const emote = this.emoteState.get(p.nickname);
      if (emote) applyEmoteClasses(card, emote.id);

      this.arena.appendChild(card);
      this.cardEls.set(p.nickname, card);
      this.wordEls.set(p.nickname, card.querySelector<HTMLDivElement>(".wb__word")!);
    });

    // Bomba: fragmento + flecha girando hacia el jugador de turno.
    this.bombFragEl.textContent = view.fragment ? view.fragment.toUpperCase() : "";
    if (turnAngle !== null) {
      this.pointer.hidden = false;
      // La distancia escala y queda por fuera del anillo Y de la punta de la mecha
      // (que vive fija arriba de la bomba), asi la flecha no se encima con ellos.
      this.pointer.style.transform =
        `translate(-50%, -50%) rotate(${turnAngle}deg) translateY(calc(-1 * clamp(96px, 20vmin, 150px)))`;
    } else {
      this.pointer.hidden = true;
    }

    this.setInputEnabled(view.myTurn);
    if (view.myTurn) this.setWord(this.me, this.input.value);
  }

  /**
   * Explosion de la bomba: flash + onda expansiva + esquirlas + sacudida. Un golpe
   * seco y calido (ver DESIGN.md). Se dispara cuando un jugador pierde una vida (la
   * mecha llego a 0), desde `Game.playDiffSounds`.
   */
  flashExplosion(): void {
    let html = `<div class="wb__boom-flash"></div><div class="wb__boom-ring"></div>`;
    for (let i = 0; i < BOOM_SHARDS; i++) {
      const angle = (360 / BOOM_SHARDS) * i + rnd(-12, 12);
      html += `<span class="wb__boom-shard" style="--a:${angle.toFixed(1)}deg;--d:${rnd(56, 120).toFixed(0)}px"></span>`;
    }
    this.boomEl.innerHTML = html;
    // Reinicia las animaciones (reflow) por si ya habia una en curso.
    this.boomEl.classList.remove("is-on");
    this.bombEl.classList.remove("is-boom");
    void this.boomEl.offsetWidth;
    this.boomEl.classList.add("is-on");
    this.bombEl.classList.add("is-boom");
    window.clearTimeout(this.boomTimer);
    this.boomTimer = window.setTimeout(() => {
      this.boomEl.classList.remove("is-on");
      this.bombEl.classList.remove("is-boom");
      this.boomEl.innerHTML = "";
    }, BOOM_MS);
  }

  /** Siembra las brasas de ambiente con posicion/tamano/tiempos aleatorios. */
  private buildEmbers(host: HTMLDivElement): void {
    for (let i = 0; i < EMBER_COUNT; i++) {
      const e = document.createElement("span");
      e.className = "wb__ember";
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
      btn.className = "wb__emote";
      btn.title = `${e.label} (${e.key})`;
      btn.setAttribute("aria-label", e.label);
      btn.innerHTML = `
        <svg class="wb__emo-head" viewBox="0 0 64 76" aria-hidden="true">
          <path class="wb__face-body" d="${BODY_PATH}"/>
          <g class="wb__emo">${EMOTE_FACES[e.id]}</g>
        </svg>
        <span class="wb__emote-key">${e.key}</span>`;
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

  // ---------- Mecha visible (anillo + segundos) ----------

  /**
   * Arranca/actualiza el anillo de la mecha. `remainingMs` y `totalMs` vienen del
   * server; se anclan al reloj monotono local (`performance.now()`) para animar
   * sin depender del epoch del server (cero drift de reloj). Idempotente: llamarla
   * en cada snapshot solo re-ancla; el loop rAF ya en curso toma los nuevos valores.
   */
  setFuse(remainingMs: number, totalMs: number): void {
    // Guarda contra valores no finitos (p.ej. un server viejo que manda undefined).
    if (!Number.isFinite(remainingMs) || !Number.isFinite(totalMs) || totalMs <= 0) {
      this.clearFuse();
      return;
    }
    this.fuseEnd = performance.now() + remainingMs;
    this.fuseTotalMs = totalMs;
    this.fuseEl.removeAttribute("hidden"); // SVGSVGElement no tipa `hidden` como prop
    if (this.fuseRaf === null) this.tickFuse();
  }

  /** Oculta y detiene la mecha (fuera de "playing", game over). */
  clearFuse(): void {
    if (this.fuseRaf !== null) {
      cancelAnimationFrame(this.fuseRaf);
      this.fuseRaf = null;
    }
    this.fuseEl.setAttribute("hidden", "");
    this.fuseEl.classList.remove("is-critical");
    this.stage.classList.remove("is-critical");
    this.bombTimeEl.textContent = "";
    this.wickEl.style.removeProperty("height"); // vuelve al alto full del CSS
  }

  private readonly tickFuse = (): void => {
    const remaining = Math.max(0, this.fuseEnd - performance.now());
    const frac = this.fuseTotalMs > 0 ? Math.min(1, remaining / this.fuseTotalMs) : 0;
    // La barra es un sub-arco del track (arco de 300deg): largo = frac * arco, desde
    // el inicio del arco. Nunca entra en el hueco de arriba (max = FUSE_ARC).
    this.fuseBar.style.strokeDasharray = `${FUSE_ARC * frac} ${FUSE_CIRC}`;
    // La mecha se quema con el tiempo: se acorta y la chispa (su punta) baja hacia la
    // bomba. Curva `frac^WICK_EXP` para que su quemado coincida con el vaciado del aro
    // (ver WICK_EXP). Se resetea sola al pasar de turno (setFuse re-ancla con frac ~1).
    this.wickEl.style.height = `${(WICK_FULL_PCT * Math.pow(frac, WICK_EXP)).toFixed(1)}%`;
    const color = fuseColor(frac);
    this.fuseBar.style.stroke = color;
    this.bombTimeEl.style.color = color;
    this.bombTimeEl.textContent = remaining > 0 ? String(Math.ceil(remaining / 1000)) : "";
    const critical = remaining > 0 && frac <= FUSE_CRITICAL;
    this.fuseEl.classList.toggle("is-critical", critical);
    // El stage marca "critico": el jugador de turno entra en panico (cara + gota +
    // globo "RAPIDO!") via CSS. Lo hace la tickFuse porque el panico depende del
    // tiempo, no de un cambio de estado del server.
    this.stage.classList.toggle("is-critical", critical);
    // Al llegar a 0 se detiene y queda vacio: el server difundira la explosion /
    // el nuevo turno, que re-ancla la mecha via setFuse.
    this.fuseRaf = remaining > 0 ? requestAnimationFrame(this.tickFuse) : null;
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

  /** Sello de palabra aceptada bajo el avatar + carita feliz breve de quien acerto. */
  flashAccept(player: string, word: string): void {
    const card = this.cardEls.get(player);
    if (card) {
      card.classList.add("is-happy");
      window.setTimeout(() => card.classList.remove("is-happy"), 800);
    }
    const el = this.wordEls.get(player);
    if (!el) return;
    el.textContent = word;
    el.classList.remove("is-reject");
    el.classList.add("is-accept");
    window.setTimeout(() => el.classList.remove("is-accept"), 700);
  }
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
