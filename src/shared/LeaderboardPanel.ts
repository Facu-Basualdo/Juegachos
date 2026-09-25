import { getSupabase } from "./supabase";
import {
  fetchTop,
  formatWins,
  monthLabel,
  qualifies,
  submitScore,
  type RankPeriod,
  type ScoreRow,
} from "./leaderboard";
import { formatScore, getRankingMetric } from "./scoring";
import { getNickname, setNickname, NICKNAME_MAX } from "./nickname";

const TOP_LIMIT = 10;

interface RenderOpts {
  /** Variante del ranking (p.ej. tamano de sliding-puzzle). */
  variant?: string;
  /**
   * Puntaje de la partida recien terminada. Si se pasa, se registra en el
   * historial (sin preguntar si ya hay un nombre guardado; la primera vez pide
   * el nombre, y solo si la marca entra al Top del mes). Omitir en modo
   * solo-lectura (landing).
   */
  score?: number;
}

const STYLE_ID = "mg-leaderboard-styles";

const CSS = `
.mg-lb { width: 100%; max-width: 360px; margin: 0 auto; font-family: inherit; color: #fff; }
.mg-lb__title { font-size: 0.85rem; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.7; text-align: center; margin: 0 0 0.5rem; }
.mg-lb__tabs { display: flex; justify-content: center; gap: 0.3rem; margin: 0 0 0.6rem; }
.mg-lb__tab { padding: 0.25rem 0.7rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.25); background: transparent; color: inherit; font: inherit; font-size: 0.8rem; cursor: pointer; opacity: 0.7; }
.mg-lb__tab:hover { opacity: 1; }
.mg-lb__tab[aria-pressed="true"] { background: #fff; color: #111; border-color: #fff; opacity: 1; font-weight: 700; }
.mg-lb__status { text-align: center; opacity: 0.6; font-size: 0.85rem; padding: 0.4rem 0; }
.mg-lb__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.mg-lb__row { display: grid; grid-template-columns: 1.6rem 1fr auto; align-items: center; gap: 0.5rem; padding: 0.3rem 0.55rem; border-radius: 8px; background: rgba(255,255,255,0.05); font-size: 0.92rem; }
.mg-lb__row--me { background: rgba(255,255,255,0.18); font-weight: 700; box-shadow: 0 0 0 1px rgba(255,255,255,0.35) inset; }
.mg-lb__rank { opacity: 0.6; text-align: right; font-variant-numeric: tabular-nums; }
.mg-lb__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mg-lb__value { font-variant-numeric: tabular-nums; }
.mg-lb__form { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }
.mg-lb__input { flex: 1; min-width: 0; padding: 0.45rem 0.6rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25); background: rgba(0,0,0,0.35); color: #fff; font: inherit; }
.mg-lb__input:focus { outline: none; border-color: rgba(255,255,255,0.6); }
.mg-lb__save { padding: 0.45rem 0.8rem; border-radius: 8px; border: none; background: #fff; color: #111; font: inherit; font-weight: 700; cursor: pointer; }
.mg-lb__save:hover { opacity: 0.85; }
.mg-lb__hint { text-align: center; font-size: 0.78rem; opacity: 0.55; margin-top: 0.4rem; }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/**
 * Componente DOM autocontenido para mostrar el Top N de un juego. Reutilizado
 * por cada juego (pantalla game-over) y por la landing (modal solo-lectura).
 * Inyecta su propio CSS una sola vez y no depende del estilo de cada juego.
 *
 * Dos pestanas: "Este mes" (default: es el tablero que un jugador puede pelear)
 * e "Historico". Una fila por jugador, con su mejor marca o, en los juegos que
 * rankean por victorias de sala, cuantas partidas gano.
 */
export class LeaderboardPanel {
  readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly tabButtons: Record<RankPeriod, HTMLButtonElement>;
  private readonly statusEl: HTMLDivElement;
  private readonly listEl: HTMLUListElement;
  private readonly formEl: HTMLFormElement;
  private readonly inputEl: HTMLInputElement;

  /** Tablero que se esta mostrando (para cambiar de pestana sin re-render). */
  private board: { gameId: string; variant?: string } | null = null;
  private period: RankPeriod = "month";
  /** Descarta respuestas viejas si se cambia de pestana/juego mientras cargaba. */
  private requestId = 0;

  /** Contexto de la partida en curso mientras se pide el nickname. */
  private pending: { gameId: string; score: number; variant?: string } | null = null;

  constructor() {
    ensureStyles();

    this.root = document.createElement("div");
    this.root.className = "mg-lb";
    // Evita que clics/toques dentro del panel (input, boton, filas) lleguen a
    // los listeners de "toca para reiniciar" que varios juegos ponen en su
    // overlay/contenedor.
    const stop = (e: Event) => e.stopPropagation();
    this.root.addEventListener("pointerdown", stop);
    this.root.addEventListener("mousedown", stop);
    this.root.addEventListener("click", stop);
    this.root.addEventListener("touchstart", stop);

    this.titleEl = document.createElement("div");
    this.titleEl.className = "mg-lb__title";
    this.titleEl.textContent = "Ranking global";

    const tabs = document.createElement("div");
    tabs.className = "mg-lb__tabs";
    const makeTab = (period: RankPeriod, label: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mg-lb__tab";
      btn.textContent = label;
      btn.addEventListener("click", () => this.setPeriod(period));
      tabs.append(btn);
      return btn;
    };
    this.tabButtons = {
      month: makeTab("month", "Este mes"),
      all: makeTab("all", "Historico"),
    };
    this.syncTabs();

    this.formEl = document.createElement("form");
    this.formEl.className = "mg-lb__form";
    this.formEl.style.display = "none";

    this.inputEl = document.createElement("input");
    this.inputEl.className = "mg-lb__input";
    this.inputEl.type = "text";
    this.inputEl.maxLength = NICKNAME_MAX;
    this.inputEl.placeholder = "Tu nombre";
    this.inputEl.autocomplete = "off";

    const save = document.createElement("button");
    save.className = "mg-lb__save";
    save.type = "submit";
    save.textContent = "Guardar";

    this.formEl.append(this.inputEl, save);
    this.formEl.addEventListener("submit", this.onSubmitName);
    // Evita que Enter/Espacio mientras se escribe el nombre lleguen a los
    // listeners de teclado del juego (que reiniciarian la partida).
    this.inputEl.addEventListener("keydown", (e) => e.stopPropagation());

    this.statusEl = document.createElement("div");
    this.statusEl.className = "mg-lb__status";

    this.listEl = document.createElement("ul");
    this.listEl.className = "mg-lb__list";

    this.root.append(this.titleEl, tabs, this.formEl, this.statusEl, this.listEl);
  }

  mount(container: HTMLElement): void {
    container.append(this.root);
  }

  unmount(): void {
    this.root.remove();
  }

  /** Vacia y oculta el panel (p.ej. al volver a la pantalla de inicio). */
  clear(): void {
    this.requestId++;
    this.pending = null;
    this.board = null;
    this.formEl.style.display = "none";
    this.listEl.innerHTML = "";
    this.statusEl.textContent = "";
    this.root.style.display = "none";
  }

  /**
   * Renderiza el ranking del juego. Si `opts.score` viene, registra la partida:
   * con un nombre ya guardado se envia sin preguntar (es el historial, entra
   * aunque no llegue al Top); sin nombre, pide uno solo si la marca entra al Top
   * del mes, que es cuando vale la pena interrumpir al jugador.
   */
  async render(gameId: string, opts: RenderOpts = {}): Promise<void> {
    this.root.style.display = "";
    this.pending = null;
    this.formEl.style.display = "none";
    this.board = { gameId, variant: opts.variant };
    this.titleEl.textContent =
      getRankingMetric(gameId) === "wins" ? "Victorias en salas" : "Ranking global";
    this.tabButtons.month.title = monthLabel();

    if (!getSupabase()) {
      this.listEl.innerHTML = "";
      this.statusEl.textContent = "Ranking no disponible";
      return;
    }

    const hasScore = opts.score !== undefined && Number.isFinite(opts.score);
    if (!hasScore) {
      await this.renderList();
      return;
    }

    const score = opts.score!;
    if (getNickname()) {
      this.statusEl.textContent = "Cargando...";
      this.listEl.innerHTML = "";
      await submitScore(gameId, score, { variant: opts.variant });
      await this.renderList();
      return;
    }

    const id = ++this.requestId;
    this.statusEl.textContent = "Cargando...";
    this.listEl.innerHTML = "";
    const monthRows = await fetchTop(gameId, { variant: opts.variant, period: "month" });
    if (id !== this.requestId) return;
    if (qualifies(gameId, score, opts.variant, monthRows, TOP_LIMIT)) {
      this.pending = { gameId, score, variant: opts.variant };
      this.formEl.style.display = "flex";
      this.inputEl.value = "";
      this.inputEl.focus();
    }
    if (this.period === "month") this.renderRows(monthRows);
    else await this.renderList();
  }

  private setPeriod(period: RankPeriod): void {
    if (period === this.period) return;
    this.period = period;
    this.syncTabs();
    if (this.board) void this.renderList();
  }

  private syncTabs(): void {
    for (const [period, btn] of Object.entries(this.tabButtons)) {
      btn.setAttribute("aria-pressed", String(period === this.period));
    }
  }

  private async renderList(): Promise<void> {
    if (!this.board) return;
    const { gameId, variant } = this.board;
    const id = ++this.requestId;
    this.statusEl.textContent = "Cargando...";
    this.listEl.innerHTML = "";
    const rows = await fetchTop(gameId, { variant, period: this.period, limit: TOP_LIMIT });
    if (id !== this.requestId) return;
    this.renderRows(rows);
  }

  private renderRows(rows: ScoreRow[]): void {
    this.listEl.innerHTML = "";
    if (rows.length === 0) {
      const wins = getRankingMetric(this.board!.gameId) === "wins";
      const when = this.period === "month" ? ` en ${monthLabel()}` : "";
      this.statusEl.textContent = wins
        ? `Nadie gano todavia una partida en sala${when}.`
        : this.period === "month"
          ? `Nadie entro todavia en ${monthLabel()}. Se el primero.`
          : "Todavia no hay puntajes. Se el primero.";
      return;
    }
    this.statusEl.textContent = "";

    // Una fila por jugador: la propia se resalta siempre que este en el Top.
    const me = getNickname();
    rows.forEach((row, i) => {
      this.listEl.append(this.buildRow(row, i + 1, me !== null && row.player === me));
    });
  }

  private buildRow(row: ScoreRow, rank: number, isMe: boolean): HTMLLIElement {
    const { gameId, variant } = this.board!;
    const li = document.createElement("li");
    li.className = "mg-lb__row" + (isMe ? " mg-lb__row--me" : "");

    const rankEl = document.createElement("span");
    rankEl.className = "mg-lb__rank";
    rankEl.textContent = String(rank);

    const nameEl = document.createElement("span");
    nameEl.className = "mg-lb__name";
    nameEl.textContent = row.player;

    const valueEl = document.createElement("span");
    valueEl.className = "mg-lb__value";
    valueEl.textContent =
      getRankingMetric(gameId) === "wins"
        ? formatWins(row.score)
        : formatScore(gameId, row.score, variant);

    li.append(rankEl, nameEl, valueEl);
    return li;
  }

  private onSubmitName = (e: Event): void => {
    e.preventDefault();
    if (!this.pending) return;
    const saved = setNickname(this.inputEl.value);
    if (!saved) {
      this.inputEl.focus();
      return;
    }
    const { gameId, score, variant } = this.pending;
    this.pending = null;
    this.formEl.style.display = "none";
    void submitScore(gameId, score, { variant }).then(() => this.renderList());
  };
}
