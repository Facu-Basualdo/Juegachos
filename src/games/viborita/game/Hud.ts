import { HowToPanel } from "../../../shared/HowToPanel";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { NICKNAME_MAX } from "../../../shared/nickname";

export interface TopRow {
  name: string;
  mass: number;
  color: string;
  mine: boolean;
}

/**
 * HUD de Viborita (DOM sobre el canvas), con las piezas de la landing: tarjetas crema
 * con borde de tinta y sombra dura, pastillas negras con texto crema, Archivo 900 en
 * los titulos (ver DESIGN.md).
 *
 * La tarjeta central es la pantalla de inicio y la de muerte: el nombre se escribe
 * ahi y "Jugar" (o Enter, o tocar afuera del campo) arranca la cuenta 3/2/1/YA. El
 * toque cuelga del overlay, nunca del canvas que el overlay tapa.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private readonly nameRow: HTMLFormElement;
  private readonly nameInput: HTMLInputElement;
  private readonly hintEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  private readonly topList: HTMLOListElement;
  private readonly topFoot: HTMLDivElement;
  private readonly lengthEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly netEl: HTMLDivElement;

  private playCb: (name: string) => void = () => {};
  /** La tarjeta acepta arrancar (inicio / muerte con reaparicion). */
  private playable = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "vb-hud";

    // ---- Registro (top 10) ----
    const top = document.createElement("div");
    top.className = "vb-top";
    const topTitle = document.createElement("div");
    topTitle.className = "vb-top__title";
    topTitle.textContent = "Las más largas";
    this.topList = document.createElement("ol");
    this.topList.className = "vb-top__list";
    this.topFoot = document.createElement("div");
    this.topFoot.className = "vb-top__foot";
    top.append(topTitle, this.topList, this.topFoot);

    this.lengthEl = document.createElement("div");
    this.lengthEl.className = "vb-length";

    // ---- Tarjeta central ----
    this.overlay = document.createElement("div");
    this.overlay.className = "vb-overlay";
    const card = document.createElement("div");
    card.className = "vb-card";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "vb-card__title";
    this.textEl = document.createElement("div");
    this.textEl.className = "vb-card__text";
    this.statsEl = document.createElement("div");
    this.statsEl.className = "vb-card__stats";

    this.nameRow = document.createElement("form");
    this.nameRow.className = "vb-name";
    this.nameInput = document.createElement("input");
    this.nameInput.className = "vb-name__input";
    this.nameInput.type = "text";
    this.nameInput.maxLength = NICKNAME_MAX;
    this.nameInput.placeholder = "Tu nombre";
    this.nameInput.autocomplete = "off";
    this.nameInput.spellcheck = false;
    const play = document.createElement("button");
    play.className = "vb-name__play";
    play.type = "submit";
    play.textContent = "Jugar";
    this.nameRow.append(this.nameInput, play);
    this.nameRow.addEventListener("submit", (e) => {
      e.preventDefault();
      this.play();
    });

    this.hintEl = document.createElement("div");
    this.hintEl.className = "vb-card__hint";

    card.append(this.titleEl, this.textEl, this.statsEl, this.nameRow, this.hintEl);
    this.leaderboard.mount(card);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("viborita").follow(this.leaderboard).hides(".vb-card__hint");
    this.leaderboard.clear();
    this.overlay.append(card);

    // Tocar la tarjeta (fuera del campo del nombre) arranca, como Enter.
    this.overlay.addEventListener("pointerdown", (e) => {
      if (!this.playable) return;
      if (e.target instanceof Element && e.target.closest(".vb-name")) return;
      this.play();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Enter" || !this.playable || this.overlay.classList.contains("is-hidden")) return;
      if (e.target === this.nameInput) return; // lo resuelve el submit del form
      e.preventDefault();
      this.play();
    });

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "vb-banner";
    this.netEl = document.createElement("div");
    this.netEl.className = "vb-net";

    this.root.append(top, this.lengthEl, this.bannerEl, this.netEl);
    container.append(this.root, this.overlay, this.countdownEl);
  }

  onPlay(cb: (name: string) => void): void {
    this.playCb = cb;
  }

  /** En sala hay una barra arriba (RoomOverlay) y no se elige nombre. */
  setRoom(room: boolean): void {
    this.root.classList.toggle("vb-hud--room", room);
    this.nameRow.style.display = room ? "none" : "";
  }

  private play(): void {
    if (!this.playable) return;
    this.playCb(this.nameInput.value);
  }

  // ---------------------------------------------------------------- tarjeta

  showStart(name: string): void {
    this.titleEl.textContent = "Viborita";
    this.textEl.textContent = "Comé para crecer y hacé que las demás choquen contra tu cuerpo. No toques el de nadie.";
    this.statsEl.style.display = "none";
    this.nameInput.value = name;
    this.hintEl.textContent = "Tocá la pantalla o presioná Enter";
    this.leaderboard.clear();
    this.openCard(true);
  }

  showDead(title: string, stats: string, canRespawn: boolean, name: string): void {
    this.titleEl.textContent = title;
    this.textEl.textContent = canRespawn ? "Volvé a entrar cuando quieras." : "Seguís mirando la ronda.";
    this.statsEl.textContent = stats;
    this.statsEl.style.display = "";
    this.nameInput.value = name;
    this.hintEl.textContent = canRespawn ? "Tocá la pantalla o presioná Enter" : "";
    this.openCard(canRespawn);
  }

  /** Cartel sin accion (conectando, esperando la ronda, no disponible). */
  showMessage(title: string, text: string): void {
    this.titleEl.textContent = title;
    this.textEl.textContent = text;
    this.statsEl.style.display = "none";
    this.hintEl.textContent = "";
    this.leaderboard.clear();
    this.openCard(false);
  }

  /** Ranking global con la marca de esta vida (registra la partida si hay nombre). */
  showRanking(score: number): void {
    void this.leaderboard.render("viborita", { score });
  }

  hideCard(): void {
    this.playable = false;
    this.overlay.classList.add("is-hidden");
    this.nameInput.blur();
  }

  private openCard(playable: boolean): void {
    this.playable = playable;
    this.nameRow.style.visibility = playable ? "" : "hidden";
    this.overlay.classList.remove("is-hidden");
  }

  // ---------------------------------------------------------------- en juego

  showPlaying(on: boolean): void {
    this.root.classList.toggle("vb-hud--playing", on);
  }

  setLength(mass: number, boosting: boolean): void {
    this.lengthEl.textContent = `largo ${Math.round(mass)}`;
    this.lengthEl.classList.toggle("is-boost", boosting);
  }

  setTop(rows: TopRow[], rank: number, alive: number): void {
    this.topList.replaceChildren(
      ...rows.map((row, i) => {
        const li = document.createElement("li");
        li.className = row.mine ? "is-mine" : "";
        const pos = document.createElement("span");
        pos.className = "vb-top__pos";
        pos.textContent = String(i + 1);
        const dot = document.createElement("span");
        dot.className = "vb-top__dot";
        dot.style.background = row.color;
        const name = document.createElement("span");
        name.className = "vb-top__name";
        name.textContent = row.name;
        const mass = document.createElement("span");
        mass.className = "vb-top__mass";
        mass.textContent = String(row.mass);
        li.append(pos, dot, name, mass);
        return li;
      }),
    );
    this.topFoot.textContent = rank > 10 ? `vos: ${rank} de ${alive}` : `${alive} viboritas`;
  }

  showCountdown(text: string | null): void {
    if (text === null) {
      this.countdownEl.classList.remove("is-shown");
      this.countdownEl.textContent = "";
      return;
    }
    if (this.countdownEl.textContent === text) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove("is-shown");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("is-shown");
  }

  /** Panel de red (tecla N). null lo oculta. */
  setNet(lines: string[] | null): void {
    this.netEl.classList.toggle("is-shown", lines !== null);
    if (lines) this.netEl.textContent = lines.join("\n");
  }

  /** Aviso arriba (reconectando, ganador de la sala). null lo oculta. */
  setBanner(text: string | null): void {
    this.bannerEl.textContent = text ?? "";
    this.bannerEl.classList.toggle("is-shown", text !== null);
  }
}
