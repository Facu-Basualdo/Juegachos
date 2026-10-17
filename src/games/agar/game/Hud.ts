import { HowToPanel } from "../../../shared/HowToPanel";
import { LeaderboardPanel } from "../../../shared/LeaderboardPanel";
import { NICKNAME_MAX } from "../../../shared/nickname";

export interface TopRow {
  name: string;
  mass: number;
  stain: string;
  mine: boolean;
}

/**
 * HUD de Agar (DOM sobre el canvas). Etiquetas de laboratorio: papel crema, borde de
 * tinta, numeros en monoespaciada (ver DESIGN.md).
 *
 * La tarjeta central es la pantalla de inicio y la de muerte: el nombre se escribe
 * ahi y "Jugar" (o Enter, o tocar afuera del campo) arranca la cuenta 3/2/1/YA. El
 * toque cuelga del overlay, nunca del canvas que el overlay tapa (ver "El toque de
 * arranque no puede colgar del canvas" en el CLAUDE.md raiz).
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private readonly nameRow: HTMLFormElement;
  private readonly nameInput: HTMLInputElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly hintEl: HTMLDivElement;
  private readonly leaderboard = new LeaderboardPanel();

  private readonly topEl: HTMLDivElement;
  private readonly topList: HTMLOListElement;
  private readonly topFoot: HTMLDivElement;
  private readonly massEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;

  private playCb: (name: string) => void = () => {};
  /** La tarjeta acepta arrancar (inicio / muerte con reaparicion). */
  private playable = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "ag-hud";

    // ---- Registro (top 10) ----
    this.topEl = document.createElement("div");
    this.topEl.className = "ag-top";
    const topTitle = document.createElement("div");
    topTitle.className = "ag-top__title";
    topTitle.textContent = "Registro";
    this.topList = document.createElement("ol");
    this.topList.className = "ag-top__list";
    this.topFoot = document.createElement("div");
    this.topFoot.className = "ag-top__foot";
    this.topEl.append(topTitle, this.topList, this.topFoot);

    this.massEl = document.createElement("div");
    this.massEl.className = "ag-mass";

    // ---- Tarjeta central ----
    this.overlay = document.createElement("div");
    this.overlay.className = "ag-overlay";
    this.card = document.createElement("div");
    this.card.className = "ag-card";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "ag-card__title";
    this.textEl = document.createElement("div");
    this.textEl.className = "ag-card__text";
    this.statsEl = document.createElement("div");
    this.statsEl.className = "ag-card__stats";

    this.nameRow = document.createElement("form");
    this.nameRow.className = "ag-name";
    this.nameInput = document.createElement("input");
    this.nameInput.className = "ag-name__input";
    this.nameInput.type = "text";
    this.nameInput.maxLength = NICKNAME_MAX;
    this.nameInput.placeholder = "Tu nombre";
    this.nameInput.autocomplete = "off";
    this.nameInput.spellcheck = false;
    this.playBtn = document.createElement("button");
    this.playBtn.className = "ag-name__play";
    this.playBtn.type = "submit";
    this.playBtn.textContent = "Jugar";
    this.nameRow.append(this.nameInput, this.playBtn);
    this.nameRow.addEventListener("submit", (e) => {
      e.preventDefault();
      this.play();
    });

    this.hintEl = document.createElement("div");
    this.hintEl.className = "ag-card__hint";

    this.card.append(this.titleEl, this.textEl, this.statsEl, this.nameRow, this.hintEl);
    this.leaderboard.mount(this.card);
    // Como se juega con iconos (el howTo del meta.ts): solo en la pantalla de inicio.
    new HowToPanel("agar").follow(this.leaderboard).hides(".ag-card__hint");
    this.leaderboard.clear();
    this.overlay.append(this.card);

    // Tocar la tarjeta (fuera del campo del nombre) arranca, como Enter.
    this.overlay.addEventListener("pointerdown", (e) => {
      if (!this.playable) return;
      if (e.target instanceof Element && e.target.closest(".ag-name")) return;
      this.play();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Enter" || !this.playable || this.overlay.classList.contains("is-hidden")) return;
      // Dentro del campo lo resuelve el submit del form.
      if (e.target === this.nameInput) return;
      e.preventDefault();
      this.play();
    });

    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "countdown";
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "ag-banner";

    this.root.append(this.topEl, this.massEl, this.bannerEl);
    container.append(this.root, this.overlay, this.countdownEl);
  }

  onPlay(cb: (name: string) => void): void {
    this.playCb = cb;
  }

  /** En sala hay una barra arriba (RoomOverlay) y no se elige nombre. */
  setRoom(room: boolean): void {
    this.root.classList.toggle("ag-hud--room", room);
    this.nameRow.style.display = room ? "none" : "";
  }

  private play(): void {
    if (!this.playable) return;
    this.playCb(this.nameInput.value);
  }

  // ---------------------------------------------------------------- tarjeta

  showStart(name: string): void {
    this.titleEl.textContent = "Agar";
    this.textEl.textContent = "Comete la comida y a las celulas mas chicas. Escapale a las grandes.";
    this.statsEl.textContent = "";
    this.statsEl.style.display = "none";
    this.nameInput.value = name;
    this.hintEl.textContent = "toca la pantalla o presiona ENTER";
    this.leaderboard.clear();
    this.openCard(true);
  }

  showDead(title: string, stats: string, canRespawn: boolean, name: string): void {
    this.titleEl.textContent = title;
    this.textEl.textContent = canRespawn ? "Volve a entrar cuando quieras." : "Seguis mirando la ronda.";
    this.statsEl.textContent = stats;
    this.statsEl.style.display = "";
    this.nameInput.value = name;
    this.hintEl.textContent = canRespawn ? "toca la pantalla o presiona ENTER" : "";
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
    this.nameRow.style.visibility = "hidden";
  }

  /** Ranking global con la marca de esta vida (registra la partida si hay nombre). */
  showRanking(score: number): void {
    void this.leaderboard.render("agar", { score });
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
    this.root.classList.toggle("ag-hud--playing", on);
  }

  setMass(mass: number): void {
    this.massEl.textContent = `masa ${Math.round(mass)}`;
  }

  setTop(rows: TopRow[], rank: number, alive: number): void {
    this.topList.replaceChildren(
      ...rows.map((row, i) => {
        const li = document.createElement("li");
        li.className = row.mine ? "is-mine" : "";
        const pos = document.createElement("span");
        pos.className = "ag-top__pos";
        pos.textContent = String(i + 1);
        const dot = document.createElement("span");
        dot.className = "ag-top__dot";
        dot.style.background = row.stain;
        const name = document.createElement("span");
        name.className = "ag-top__name";
        name.textContent = row.name;
        const mass = document.createElement("span");
        mass.className = "ag-top__mass";
        mass.textContent = String(row.mass);
        li.append(pos, dot, name, mass);
        return li;
      }),
    );
    this.topFoot.textContent = rank > 10 ? `vos: ${rank} de ${alive}` : `${alive} celulas`;
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

  /** Aviso arriba (reconectando, ganador de la sala). null lo oculta. */
  setBanner(text: string | null): void {
    this.bannerEl.textContent = text ?? "";
    this.bannerEl.classList.toggle("is-shown", text !== null);
  }
}
