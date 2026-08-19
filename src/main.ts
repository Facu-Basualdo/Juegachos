import "./style.css";
import { games, coverUrl, type GameEntry } from "./games";
import { LeaderboardPanel } from "./shared/LeaderboardPanel";
import { getScoring } from "./shared/scoring";
import { fetchTop } from "./shared/leaderboard";
import { isLeaderboardEnabled } from "./shared/supabase";
import { recordPlay, fetchPlayCounts, cachedPlayCounts } from "./shared/plays";
import { fetchGameLeaders } from "./shared/leaders";
import { getNickname, setNickname, NICKNAME_MAX } from "./shared/nickname";
import { checkGameServer, isGameServerConfigured } from "./shared/server-status";

const app = document.querySelector<HTMLDivElement>("#app")!;
const roomsOn = isLeaderboardEnabled();

// ---------- Barra de navegacion ----------

const nav = document.createElement("nav");
nav.className = "topbar";
nav.innerHTML = `
  <a class="topbar__logo" href="/"><img src="/juegachos.png" alt="JUEGACHOS" /></a>
  <div class="topbar__right">
    ${isGameServerConfigured() ? `<div class="topbar__server is-checking" title="Estado del servidor de los juegos online"><span class="topbar__server-dot"></span><span class="topbar__server-text">Servidor</span><span class="topbar__server-ping" hidden></span></div>` : ""}
    <label class="topbar__name">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4">
        <circle cx="12" cy="8" r="4"></circle>
        <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"></path>
      </svg>
      <input type="text" class="topbar__name-input" placeholder="Tu nombre" autocomplete="off" maxlength="${NICKNAME_MAX}" />
    </label>
    <div class="topbar__links">
      <a href="/" class="is-active">Juegos</a>
      ${roomsOn ? `<a href="/rooms/">Salas</a>` : ""}
    </div>
  </div>
`;

// ---------- Banner de la comunidad de Discord ----------

const discordBanner = document.createElement("a");
discordBanner.className = "discord-banner";
discordBanner.href = "https://discord.gg/pdFQVrKXN";
discordBanner.target = "_blank";
discordBanner.rel = "noopener noreferrer";
discordBanner.innerHTML = `
  <div class="discord-banner__glow"></div>
  <div class="discord-banner__text">
    <span class="discord-banner__kicker">Comunidad</span>
    <h2 class="discord-banner__title">&iexcl;Sumate al Discord!</h2>
    <p class="discord-banner__subtitle">Enter&aacute;te de los juegos nuevos, coordin&aacute; partidas y compart&iacute; tus r&eacute;cords con la comunidad.</p>
  </div>
  <span class="discord-banner__cta">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.2.36-.43.842-.588 1.226a18.27 18.27 0 0 0-5.594 0A12.6 12.6 0 0 0 9.11 3a19.74 19.74 0 0 0-4.435 1.369C1.86 8.59 1.096 12.71 1.478 16.77a19.9 19.9 0 0 0 6.073 3.08c.49-.669.927-1.38 1.302-2.128a12.9 12.9 0 0 1-2.05-.988c.172-.126.34-.257.502-.392a14.2 14.2 0 0 0 12.19 0c.164.14.332.271.502.392-.654.388-1.343.72-2.052.99.375.746.81 1.457 1.3 2.126a19.88 19.88 0 0 0 6.076-3.08c.448-4.706-.766-8.79-3.006-12.401ZM8.02 14.331c-1.183 0-2.157-1.086-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.334-.955 2.42-2.157 2.42Zm7.96 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.334-.946 2.42-2.157 2.42Z"/>
    </svg>
    Unirme <span class="discord-banner__arrow">&rarr;</span>
  </span>
`;

// ---------- Titulo + buscador ----------

const hero = document.createElement("header");
hero.className = "hero";
hero.innerHTML = `
  <h1 class="hero__title">Todos los juegos</h1>
  <div class="hero__tools">
    <label class="hero__search">
      <input type="search" placeholder="Buscar" autocomplete="off" />
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4">
        <circle cx="11" cy="11" r="7"></circle>
        <line x1="16.5" y1="16.5" x2="21" y2="21"></line>
      </svg>
    </label>
  </div>
`;
const searchInput = hero.querySelector<HTMLInputElement>(".hero__search input")!;

// Editor del nombre global: lo que se guarda aca (localStorage) es lo que cada
// juego usa para enviar el puntaje al ranking sin volver a preguntar.
const nameInput = nav.querySelector<HTMLInputElement>(".topbar__name-input")!;
nameInput.value = getNickname() ?? "";
const saveName = () => {
  const saved = setNickname(nameInput.value);
  nameInput.value = saved ?? getNickname() ?? "";
};
nameInput.addEventListener("change", saveName);
nameInput.addEventListener("blur", saveName);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nameInput.blur();
});

// ---------- Filtros por categoria ----------

// La categoria elegida se recuerda entre visitas (igual que el orden). Se valida
// contra las categorias que existen hoy: si la guardada ya no esta (el juego que
// la traia se saco del roster), cae a "Todos".
const categories = ["Todos", ...new Set(games.map((g) => g.category))];
const CATEGORY_KEY = "mg:category";

function readCategory(): string {
  try {
    const v = localStorage.getItem(CATEGORY_KEY);
    if (v && categories.includes(v)) return v;
  } catch {
    // ignore
  }
  return "Todos";
}

let activeCategory = readCategory();

const filters = document.createElement("div");
filters.className = "filters";
for (const cat of categories) {
  const btn = document.createElement("button");
  btn.className = "filters__pill" + (cat === activeCategory ? " is-active" : "");
  btn.type = "button";
  btn.textContent = cat;
  btn.addEventListener("click", () => {
    activeCategory = cat;
    try {
      localStorage.setItem(CATEGORY_KEY, cat);
    } catch {
      // ignore
    }
    filters.querySelectorAll(".filters__pill").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    applyFilters();
  });
  filters.append(btn);
}

// ---------- Favoritos ----------

// Se marcan con el corazon de cada card y viven solo en este navegador
// (localStorage `mg:favorites`), igual que el nombre, la categoria y el orden:
// no hay cuenta ni sincronizacion, asi que no siguen al jugador de un
// dispositivo a otro. El array esta ordenado del mas reciente al mas viejo, que
// es como se muestran: marcar un juego lo pone primero de todo, arriba de los
// favoritos anteriores. No hay tope de cantidad.
const FAVORITES_KEY = "mg:favorites";
let favorites: string[] = readFavorites();

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Se validan contra el roster de hoy: el favorito de un juego que se saco
    // (o que quedo `hidden`) se descarta en vez de arrastrarse para siempre.
    const ids = new Set(games.map((g) => g.id));
    return parsed.filter((id): id is string => typeof id === "string" && ids.has(id));
  } catch {
    return [];
  }
}

function isFavorite(id: string): boolean {
  return favorites.includes(id);
}

/** Marca / desmarca y devuelve el estado nuevo (true = quedo como favorito). */
function toggleFavorite(id: string): boolean {
  const rest = favorites.filter((f) => f !== id);
  const nowFav = rest.length === favorites.length;
  favorites = nowFav ? [id, ...rest] : rest;
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // ignore
  }
  return nowFav;
}

// ---------- Control de orden ----------

// Orden de las cards, elegible desde el control de la barra de filtros:
//   - "recent" (default): ultimos agregados primero, por la fecha `added` de cada meta.ts.
//   - "popular": mas jugados primero (conteo de partidas).
//   - "alpha":   alfabetico por titulo.
// El modo "popular" arranca con el conteo cacheado (sin parpadeo) y se refresca
// desde Supabase al terminar de montar. El sort es estable, asi que los empates
// conservan el orden base de games.ts (por `order`): los juegos que entraron el
// mismo dia quedan en el orden curado.
const cardById = new Map<string, HTMLElement>();
type SortMode = "recent" | "popular" | "alpha";
const SORT_KEY = "mg:sort";
let sortMode: SortMode = readSortMode();
let playCounts = cachedPlayCounts();

const sortControl = document.createElement("div");
sortControl.className = "sort";

const sortLabel = document.createElement("span");
sortLabel.className = "sort__label";
sortLabel.textContent = "Ordenar";

// Dropdown propio (no un <select> nativo, cuya lista la dibuja el SO y no se
// puede tematizar): un boton disparador + un menu con el estilo del sitio.
const SORT_LABELS: Record<SortMode, string> = {
  recent: "Nuevos",
  popular: "Populares",
  alpha: "A-Z",
};
const SORT_ORDER: SortMode[] = ["recent", "popular", "alpha"];

const sortDropdown = document.createElement("div");
sortDropdown.className = "sort__dropdown";

const sortTrigger = document.createElement("button");
sortTrigger.type = "button";
sortTrigger.className = "sort__trigger";
sortTrigger.setAttribute("aria-haspopup", "listbox");
sortTrigger.setAttribute("aria-expanded", "false");
sortTrigger.innerHTML = `
  <span class="sort__current">${SORT_LABELS[sortMode]}</span>
  <svg class="sort__chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
`;
const sortCurrent = sortTrigger.querySelector(".sort__current")!;

const sortMenu = document.createElement("div");
sortMenu.className = "sort__menu";
sortMenu.setAttribute("role", "listbox");
const sortOptions = new Map<SortMode, HTMLButtonElement>();
for (const mode of SORT_ORDER) {
  const opt = document.createElement("button");
  opt.type = "button";
  opt.className = "sort__option" + (mode === sortMode ? " is-active" : "");
  opt.setAttribute("role", "option");
  opt.setAttribute("aria-selected", String(mode === sortMode));
  opt.textContent = SORT_LABELS[mode];
  opt.addEventListener("click", () => {
    selectSort(mode);
    closeSortMenu();
  });
  sortOptions.set(mode, opt);
  sortMenu.append(opt);
}

function openSortMenu(): void {
  sortDropdown.classList.add("is-open");
  sortTrigger.setAttribute("aria-expanded", "true");
  document.addEventListener("click", onDocClickForSort);
  document.addEventListener("keydown", onKeydownForSort);
}
function closeSortMenu(): void {
  sortDropdown.classList.remove("is-open");
  sortTrigger.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", onDocClickForSort);
  document.removeEventListener("keydown", onKeydownForSort);
}
function onDocClickForSort(e: MouseEvent): void {
  if (!sortDropdown.contains(e.target as Node)) closeSortMenu();
}
function onKeydownForSort(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    closeSortMenu();
    sortTrigger.focus();
  }
}
function selectSort(mode: SortMode): void {
  if (mode !== sortMode) {
    sortMode = mode;
    try {
      localStorage.setItem(SORT_KEY, mode);
    } catch {
      // ignore
    }
    applyOrder();
  }
  sortCurrent.textContent = SORT_LABELS[mode];
  for (const [m, el] of sortOptions) {
    const active = m === mode;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", String(active));
  }
}

sortTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  if (sortDropdown.classList.contains("is-open")) closeSortMenu();
  else openSortMenu();
});

sortDropdown.append(sortTrigger, sortMenu);
sortControl.append(sortLabel, sortDropdown);

// Barra que alinea los filtros de categoria (izquierda) con el orden (derecha).
const filtersBar = document.createElement("div");
filtersBar.className = "filters-bar";
filtersBar.append(filters, sortControl);

// ---------- Grilla de juegos ----------

const grid = document.createElement("div");
grid.className = "grid";

function readSortMode(): SortMode {
  try {
    // El modo "featured" (orden manual) fue reemplazado por "recent"; un valor
    // guardado de una version anterior cae al default.
    const v = localStorage.getItem(SORT_KEY);
    if (v === "recent" || v === "popular" || v === "alpha") return v;
  } catch {
    // ignore
  }
  return "recent";
}

/**
 * El orden final de la grilla: los favoritos fijos arriba (en el orden en que
 * se marcaron, el ultimo primero) y abajo el resto segun el modo elegido. El
 * pin gana sobre los tres modos a proposito — un cuarto modo "Favoritos" en el
 * dropdown no lo encontraria nadie.
 */
function orderedGames(): GameEntry[] {
  const sorted = sortedGames();
  if (favorites.length === 0) return sorted;
  const byId = new Map(sorted.map((g) => [g.id, g]));
  const pinned = favorites
    .map((id) => byId.get(id))
    .filter((g): g is GameEntry => g !== undefined);
  const pinnedIds = new Set(pinned.map((g) => g.id));
  return [...pinned, ...sorted.filter((g) => !pinnedIds.has(g.id))];
}

function sortedGames(): GameEntry[] {
  if (sortMode === "alpha") {
    return [...games].sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sortMode === "popular") {
    return [...games].sort((a, b) => (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0));
  }
  // games.ts ya viene ordenado por `order`, y el sort es estable: los juegos
  // agregados el mismo dia conservan ese orden curado.
  return [...games].sort((a, b) => b.added.localeCompare(a.added));
}

/**
 * Chips de plataforma: en que se puede jugar cada juego. Son iconos y no las
 * palabras "PC" / "Móvil" porque al lado del chip de categoria, dos chips de
 * texto se leian como dos categorias. Los SVG van inline — no hay assets
 * sueltos que cargar — y toman el color con `currentColor`, asi que el acento
 * se cambia desde el CSS y en un solo lugar. El `aria-label` va en el span
 * porque el `<svg>` es `aria-hidden`: sin el, el chip seria invisible para un
 * lector de pantalla.
 *
 * El de PC va en **todas** las cards (todo el roster se juega en compu); el del
 * telefono solo en los que declaran `mobile: true` en su `meta.ts`. Por eso el
 * de PC queda en el color base del chip y el del telefono en el cian de acento:
 * el que aporta informacion es el segundo, y el par se lee "ademas en el celu".
 */
const PC_BADGE = `<span class="game-card__tag game-card__tag--icon" role="img" aria-label="Se puede jugar en la computadora" title="Se puede jugar en la computadora"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M12 17v3" /><path d="M8.5 20h7" /></svg></span>`;

const MOBILE_BADGE = `<span class="game-card__tag game-card__tag--icon game-card__tag--mobile" role="img" aria-label="Se puede jugar en el celular" title="Se puede jugar en el celular"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M10.5 18.5h3" /></svg></span>`;

const HEART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>`;

/**
 * Estado del corazon. Es un <button> con `aria-pressed` (no un icono decorativo)
 * para que un lector de pantalla lo lea como lo que es: un interruptor.
 */
function setFavState(btn: HTMLButtonElement, fav: boolean): void {
  btn.classList.toggle("is-active", fav);
  btn.setAttribute("aria-pressed", String(fav));
  const label = fav ? "Quitar de favoritos" : "Agregar a favoritos";
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

orderedGames().forEach((game, i) => {
  const card = document.createElement("a");
  card.className = "game-card";
  card.href = game.path;
  card.style.setProperty("--i", String(i));
  if (game.accent) card.style.setProperty("--accent", game.accent);
  card.dataset.category = game.category;
  card.dataset.search = `${game.title} ${game.description}`.toLowerCase();

  // Suma una partida al contador de popularidad al abrir el juego. Se ignora el
  // clic-medio / nueva pestana y el boton de ranking (que frena la propagacion).
  card.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    recordPlay(game.id);
  });

  // El recuadro es solo la portada (con categoria y ranking como chips
  // superpuestos); el nombre del juego va debajo, fuera del recuadro.
  card.innerHTML = `
    <div class="game-card__cover">
      <div class="game-card__fallback"></div>
      <div class="game-card__tags">
        <span class="game-card__tag">${game.category}</span>
        ${PC_BADGE}${game.mobile ? MOBILE_BADGE : ""}
      </div>
    </div>
    <div class="game-card__head">
      <h2 class="game-card__name">${game.title}</h2>
      <span class="game-card__champ" hidden></span>
    </div>
  `;

  // Portada generada por IA; si el archivo no existe queda el fallback.
  const img = document.createElement("img");
  img.className = "game-card__img";
  img.src = coverUrl(game.id);
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => img.remove());
  card.querySelector(".game-card__cover")!.append(img);

  // Corazon de favorito: arriba a la izquierda de la portada (el lugar que
  // antes ocupaban los chips, que bajaron al pie). La card es un <a>, asi que
  // el clic tiene que cortarse aca — si navegara, marcar un favorito abriria el
  // juego y ademas le sumaria una partida al contador de populares.
  const favBtn = document.createElement("button");
  favBtn.className = "game-card__fav";
  favBtn.type = "button";
  favBtn.innerHTML = HEART_ICON;
  setFavState(favBtn, isFavorite(game.id));
  favBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFavState(favBtn, toggleFavorite(game.id));
    applyOrder();
  });
  card.querySelector(".game-card__cover")!.append(favBtn);

  if (roomsOn) {
    const rankBtn = document.createElement("button");
    rankBtn.className = "game-card__ranking";
    rankBtn.type = "button";
    rankBtn.textContent = "Ranking";
    rankBtn.addEventListener("click", (e) => {
      // El card es un <a>; evitar que el clic navegue al juego.
      e.preventDefault();
      e.stopPropagation();
      openRankingModal(game);
    });
    card.querySelector(".game-card__cover")!.append(rankBtn);

    const champEl = card.querySelector<HTMLElement>(".game-card__champ")!;
    void loadChampion(game, champEl);
  }

  grid.append(card);
  cardById.set(game.id, card);
});

// Muestra al lider (Top 1) del ranking global junto al nombre del juego.
async function loadChampion(game: GameEntry, el: HTMLElement): Promise<void> {
  const scoring = getScoring(game.id);
  const variant = scoring.variants?.[0];
  const [top] = await fetchTop(game.id, { variant, limit: 1 });
  if (!top) return;

  el.innerHTML = `
    <svg class="game-card__crown" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M3 7l4 3 5-6 5 6 4-3-2 12H5L3 7zm2 14h14v2H5v-2z" />
    </svg>
  `;
  const name = document.createElement("span");
  name.className = "game-card__champ-name";
  name.textContent = top.player;
  el.append(name);
  el.hidden = false;
}

// Banner destacado de salas multijugador, entre los filtros y la grilla.
const roomsBanner = document.createElement("a");
if (roomsOn) {
  roomsBanner.className = "rooms-banner";
  roomsBanner.href = "/rooms/";
  roomsBanner.innerHTML = `
    <div class="rooms-banner__glow"></div>
    <div class="rooms-banner__text">
      <span class="rooms-banner__kicker">Modo salas</span>
      <h2 class="rooms-banner__title">&iexcl;Jug&aacute; con amigos!</h2>
      <p class="rooms-banner__subtitle">Cre&aacute; una sala, compart&iacute; el c&oacute;digo y compitan ronda a ronda por el mejor puntaje.</p>
    </div>
    <span class="rooms-banner__cta">Salas <span class="rooms-banner__arrow">&rarr;</span></span>
  `;

  // Fondo ilustrado del banner; si el archivo no existe queda el glow solo.
  const bg = document.createElement("img");
  bg.className = "rooms-banner__bg";
  bg.src = "/covers/rooms-banner.jpg";
  bg.alt = "";
  bg.loading = "lazy";
  const scrim = document.createElement("div");
  scrim.className = "rooms-banner__scrim";
  bg.addEventListener("error", () => {
    bg.remove();
    scrim.remove();
  });
  roomsBanner.querySelector(".rooms-banner__glow")!.after(bg, scrim);
}

const empty = document.createElement("p");
empty.className = "grid__empty";
empty.textContent = "Ningún juego coincide con la búsqueda.";
empty.style.display = "none";

function applyFilters(): void {
  const term = searchInput.value.trim().toLowerCase();
  let visible = 0;
  grid.querySelectorAll<HTMLAnchorElement>(".game-card").forEach((card) => {
    const matchesCategory =
      activeCategory === "Todos" ||
      card.dataset.category === activeCategory ||
      card.dataset.category === "*";
    const matchesTerm = !term || (card.dataset.search ?? "").includes(term);
    const show = matchesCategory && matchesTerm;
    card.style.display = show ? "" : "none";
    if (show) visible++;
  });
  empty.style.display = visible === 0 ? "" : "none";
}

searchInput.addEventListener("input", applyFilters);

// Las cards se montan todas visibles; si la categoria viene guardada de una
// visita anterior hay que ocultar las que no entran.
applyFilters();

// ---------- Footer ----------

const footer = document.createElement("footer");
footer.className = "site-footer";
footer.innerHTML = `
  <div class="site-footer__strip"></div>
  <div class="site-footer__ghost" aria-hidden="true">JUEGACHOS</div>
  <div class="site-footer__main">
    <div class="site-footer__left">
      <img class="site-footer__logo" src="/juegachos.png" alt="JUEGACHOS" />
      <p class="site-footer__blurb">
        Minijuegos arcade para el navegador: jugá solo por el récord
        o armá una sala y competí con amigos.
      </p>
      <div class="site-footer__meta">
        <div class="site-footer__coin"><span class="site-footer__coin-dot"></span>HECHO PARA JUGAR</div>
        <a href="https://github.com/Facu-Basualdo/MiniGames" target="_blank" rel="noopener noreferrer" class="site-footer__git" aria-label="GitHub Repository">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
          <span>GITHUB</span>
        </a>
      </div>
    </div>
    <nav class="site-footer__links" aria-label="Navegación del pie">
      <span class="site-footer__links-title">Navegar</span>
      <a href="/">Juegos<span class="site-footer__arrow">&rarr;</span></a>
      ${roomsOn ? `<a href="/rooms/">Salas<span class="site-footer__arrow">&rarr;</span></a>` : ""}
      <a href="https://discord.gg/pdFQVrKXN" target="_blank" rel="noopener noreferrer">Discord<span class="site-footer__arrow">&rarr;</span></a>
    </nav>
  </div>
  <div class="site-footer__bottom">
    <span>© ${new Date().getFullYear()} JUEGACHOS</span>
    <span class="site-footer__score">${games.length} JUEGOS Y CONTANDO</span>
  </div>
`;

// Fila de banners: Discord a la izquierda y (si aplica) Modo Salas a la derecha.
const bannersRow = document.createElement("div");
bannersRow.className = "banners-row";
bannersRow.append(discordBanner);
if (roomsOn) bannersRow.append(roomsBanner);

// Banner del Salon de la fama: recuadro compacto (estilo el de Salas) que lleva
// a la pagina dedicada /fame/. Muestra un mini-preview con los 3 primeros.
const fameBanner = document.createElement("a");
if (roomsOn) {
  fameBanner.className = "fame-banner";
  fameBanner.href = "/fame/";
  fameBanner.innerHTML = `
    <div class="fame-banner__glow"></div>
    <div class="fame-banner__text">
      <span class="fame-banner__kicker">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M4.5 16 L6.2 8.4 L9.4 11.8 L12 6.6 L14.6 11.8 L17.8 8.4 L19.5 16 Z" />
          <rect x="5" y="17.2" width="14" height="2.4" rx="1.2" />
          <circle cx="6.2" cy="7.3" r="1.05" />
          <circle cx="12" cy="5.5" r="1.25" />
          <circle cx="17.8" cy="7.3" r="1.05" />
        </svg>
        Sal&oacute;n de la fama
      </span>
      <h2 class="fame-banner__title">L&iacute;deres de los juegos</h2>
      <p class="fame-banner__subtitle">Mir&aacute; qui&eacute;nes lideran el ranking de m&aacute;s juegos.</p>
    </div>
    <div class="fame-banner__podium" aria-hidden="true"></div>
    <span class="fame-banner__cta">Ver ranking <span class="fame-banner__arrow">&rarr;</span></span>
  `;
}

const main = document.createElement("main");
main.className = "page";
main.append(bannersRow);
if (roomsOn) main.append(fameBanner);
main.append(hero, filtersBar);
main.append(grid, empty);

app.append(nav, main, footer);

// ---------- Estado del game server ----------

// Indicador en la barra de navegacion: dice si el server de los juegos online
// (Bomba Palabra, Cadena de Palabras, Basta, Impostor, PONG en sala) esta vivo.
// Se pinta solo cuando hay VITE_GAME_SERVER_URL y se re-chequea cada minuto, asi
// el que ve "no disponible" adentro de un juego sabe desde la landing si es el
// server.
const SERVER_PING_MS = 60_000;
const serverChip = nav.querySelector<HTMLElement>(".topbar__server");
if (serverChip) {
  const textEl = serverChip.querySelector<HTMLElement>(".topbar__server-text")!;
  const pingEl = serverChip.querySelector<HTMLElement>(".topbar__server-ping")!;
  const refreshServerChip = async (): Promise<void> => {
    const { status, url, pingMs, fallback } = await checkGameServer();
    const online = status === "online";
    serverChip.classList.remove("is-checking");
    serverChip.classList.toggle("is-online", online);
    serverChip.classList.toggle("is-offline", !online);
    serverChip.classList.toggle("is-fallback", online && fallback);
    textEl.textContent = online ? (fallback ? "Servidor de respaldo" : "Servidor") : "Servidor caído";
    // El ping es el round-trip del /health con la conexion ya caliente (el modulo
    // descarta la primera medicion), asi que se parece a lo que paga el socket del
    // juego y no al costo de abrir la conexion.
    pingEl.textContent = online ? `${pingMs} ms` : "";
    pingEl.hidden = !online;
    serverChip.title = online
      ? `${fallback ? "Respondiendo el servidor de respaldo (el principal está caído)" : "El servidor de los juegos online está funcionando"}\n${url}\nPing: ${pingMs} ms`
      : "El servidor de los juegos online no responde: Bomba Palabra, Cadena de Palabras, Basta e Impostor no se pueden jugar";
  };
  void refreshServerChip();
  setInterval(() => void refreshServerChip(), SERVER_PING_MS);
}

// ---------- Banner del salon de la fama: preview del podio ----------

// Rellena el mini-podio del banner con los 3 lideres top (el mismo podio de
// /fame/ pero en chico: 2.o - 1.o - 3.o, campeon dorado y elevado). Para ver la
// lista completa se entra a /fame/. No-op sin credenciales / sin datos.
if (roomsOn) {
  void fetchGameLeaders().then(({ ranking }) => {
    if (ranking.length === 0) return;
    const podium = fameBanner.querySelector<HTMLElement>(".fame-banner__podium");
    if (!podium) return;
    const crown = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M4.5 16 L6.2 8.4 L9.4 11.8 L12 6.6 L14.6 11.8 L17.8 8.4 L19.5 16 Z" />
      <rect x="5" y="17.2" width="14" height="2.4" rx="1.2" />
      <circle cx="6.2" cy="7.3" r="1.05" /><circle cx="12" cy="5.5" r="1.25" /><circle cx="17.8" cy="7.3" r="1.05" />
    </svg>`;
    const esc = (s: string) => {
      const d = document.createElement("div");
      d.textContent = s;
      return d.innerHTML;
    };
    const initialOf = (name: string) => {
      const ch = name.trim().charAt(0);
      return ch ? ch.toUpperCase() : "?";
    };
    const top3 = ranking.slice(0, 3);
    // Orden visual del podio: 2.o - 1.o - 3.o (campeon al centro).
    const order = [
      { row: top3[1], place: 2 },
      { row: top3[0], place: 1 },
      { row: top3[2], place: 3 },
    ].filter((o) => o.row);
    podium.innerHTML = order
      .map(
        ({ row, place }) => `
        <div class="fbp__slot fbp__slot--p${place}">
          ${place === 1 ? `<span class="fbp__crown">${crown}</span>` : ""}
          <span class="fbp__av">${initialOf(row.player)}</span>
          <span class="fbp__name">${esc(row.player)}</span>
          <span class="fbp__count">${row.games} <em>juegos</em></span>
          <span class="fbp__base">${place}</span>
        </div>`,
      )
      .join("");
  });
}

// Reordena las cards segun el modo actual: mueve los nodos existentes al nuevo
// orden (no los recrea) y refresca el stagger `--i`.
function applyOrder(): void {
  // Reordenar es re-insertar los nodos, y eso vuelve a disparar la animacion de
  // entrada de cada card (con su retraso escalonado, o sea varios segundos de
  // grilla desvaneciendose). El "rise" es para la carga de la pagina y nada mas,
  // asi que en el primer reordenamiento la grilla queda "asentada" y de ahi en
  // mas los cambios de orden son instantaneos — que importa sobre todo con los
  // favoritos, donde se reordena a cada clic.
  grid.classList.add("is-settled");
  orderedGames().forEach((game, i) => {
    const card = cardById.get(game.id);
    if (!card) return;
    card.style.setProperty("--i", String(i));
    grid.append(card); // re-inserta el nodo existente en la nueva posicion
  });
}

// Trae los conteos reales de Supabase; si el orden activo es por popularidad,
// reordena con los datos frescos. No-op sin credenciales.
void fetchPlayCounts().then((counts) => {
  playCounts = counts;
  if (sortMode === "popular") applyOrder();
});

// ---------- Ranking modal (solo lectura) ----------

const modalPanel = new LeaderboardPanel();
let modalEl: HTMLDivElement | null = null;

function buildModal(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "rank-modal";

  const box = document.createElement("div");
  box.className = "rank-modal__box";

  const head = document.createElement("div");
  head.className = "rank-modal__head";

  const titleEl = document.createElement("h3");
  titleEl.className = "rank-modal__title";

  const closeBtn = document.createElement("button");
  closeBtn.className = "rank-modal__close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", closeRankingModal);

  head.append(titleEl, closeBtn);

  const variantBar = document.createElement("div");
  variantBar.className = "rank-modal__variants";

  box.append(head, variantBar);
  modalPanel.mount(box);
  overlay.append(box);

  // Cerrar al hacer clic fuera de la caja.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeRankingModal();
  });

  document.body.append(overlay);
  return overlay;
}

function openRankingModal(game: GameEntry): void {
  if (!modalEl) modalEl = buildModal();

  const titleEl = modalEl.querySelector<HTMLElement>(".rank-modal__title")!;
  const variantBar = modalEl.querySelector<HTMLElement>(".rank-modal__variants")!;
  titleEl.textContent = game.title;

  const scoring = getScoring(game.id);
  variantBar.innerHTML = "";

  if (scoring.variants && scoring.variants.length > 1) {
    variantBar.style.display = "flex";
    scoring.variants.forEach((variant, idx) => {
      const btn = document.createElement("button");
      btn.className = "rank-modal__variant" + (idx === 0 ? " is-active" : "");
      btn.type = "button";
      btn.textContent = scoring.variantLabel ? scoring.variantLabel(variant) : variant;
      btn.addEventListener("click", () => {
        variantBar.querySelectorAll(".rank-modal__variant").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        void modalPanel.render(game.id, { variant });
      });
      variantBar.append(btn);
    });
    void modalPanel.render(game.id, { variant: scoring.variants[0] });
  } else {
    // Sin variantes, o una sola (p.ej. memory-match "solo"): sin barra de tabs.
    variantBar.style.display = "none";
    void modalPanel.render(game.id, { variant: scoring.variants?.[0] });
  }

  modalEl.classList.add("is-open");
  document.addEventListener("keydown", onModalKeydown);
}

function closeRankingModal(): void {
  if (!modalEl) return;
  modalEl.classList.remove("is-open");
  document.removeEventListener("keydown", onModalKeydown);
}

function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeRankingModal();
}
