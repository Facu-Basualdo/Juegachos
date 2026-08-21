import "../style.css";
import { games } from "../games";
import { isLeaderboardEnabled } from "../shared/supabase";
import { fetchGameLeaders, cachedGameLeaders, type LeaderRow } from "../shared/leaders";

/**
 * Pagina dedicada del Salon de la fama (/fame/): ranking de quienes lideran el
 * ranking global (#1) de mas juegos de la app. Es un valor derivado en vivo de
 * los rankings de cada juego (ver src/shared/leaders.ts), no de las salas.
 * Reusa el shell (topbar/footer) y el componente `.fame` de la landing. Degrada
 * con gracia: sin credenciales / sin datos muestra un estado vacio.
 */

const app = document.querySelector<HTMLDivElement>("#app")!;
const roomsOn = isLeaderboardEnabled();

// ---------- Barra de navegacion ----------
const nav = document.createElement("nav");
nav.className = "topbar";
nav.innerHTML = `
  <a class="topbar__logo" href="/"><img src="/juegachos.png" alt="JUEGACHOS" /></a>
  <div class="topbar__links">
    <a href="/">Juegos</a>
    ${roomsOn ? `<a href="/rooms/">Salas</a>` : ""}
    <a href="/fame/" class="is-active">Sal&oacute;n</a>
  </div>
`;

// ---------- Contenido ----------
const fame = document.createElement("section");
fame.className = "fame fame--page";

const main = document.createElement("main");
main.className = "page";
main.append(fame);

// ---------- Footer (mismo que la landing) ----------
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

app.append(nav, main, footer);

// ---------- Helpers de render ----------

function initialOf(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

// Corona con base y gemas: legible incluso a 13px (la anterior se veia tosca).
function crownSvg(size: number): string {
  return `<svg class="fame__crown-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">
    <path d="M4.5 16 L6.2 8.4 L9.4 11.8 L12 6.6 L14.6 11.8 L17.8 8.4 L19.5 16 Z" />
    <rect x="5" y="17.2" width="14" height="2.4" rx="1.2" />
    <circle cx="6.2" cy="7.3" r="1.05" />
    <circle cx="12" cy="5.5" r="1.25" />
    <circle cx="17.8" cy="7.3" r="1.05" />
  </svg>`;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function gamesLabel(n: number): string {
  return n === 1 ? "1 juego" : `${n} juegos`;
}

function renderHead(subtitle: string, statsHtml = ""): string {
  return `
    <div class="fame__glow"></div>
    <header class="fame__head">
      <span class="fame__kicker">${crownSvg(15)} Sal&oacute;n de la fama</span>
      <h2 class="fame__title">L&iacute;deres de los juegos</h2>
      <p class="fame__subtitle">${subtitle}</p>
      ${statsHtml}
    </header>`;
}

function renderEmpty(): void {
  fame.innerHTML = `
    ${renderHead("Todav&iacute;a no hay puntajes cargados. Romp&eacute; un r&eacute;cord y met&eacute;te en la lista.")}
    <a class="fame__empty-cta" href="/">Ver los juegos &rarr;</a>
  `;
}

function renderLeaders(ranking: LeaderRow[], totalGames: number): void {
  if (ranking.length === 0) {
    renderEmpty();
    return;
  }

  const stats = `
    <div class="fame__stats">
      <span class="fame__stat"><b>${totalGames}</b> juego${totalGames === 1 ? "" : "s"} con l&iacute;der</span>
      <span class="fame__stat"><b>${ranking.length}</b> l&iacute;der${ranking.length === 1 ? "" : "es"} en total</span>
    </div>`;

  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  // Orden visual del podio: 2.o - 1.o - 3.o (el campeon al centro).
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean) as LeaderRow[];

  const podium = podiumOrder
    .map((row) => {
      const place = ranking.indexOf(row) + 1;
      return `
        <div class="fame__slot fame__slot--p${place}">
          <div class="fame__medal">${place === 1 ? crownSvg(20) : place}</div>
          <div class="fame__avatar">${initialOf(row.player)}</div>
          <div class="fame__name">${escapeHtml(row.player)}</div>
          <div class="fame__wins">${gamesLabel(row.games)}</div>
          <div class="fame__pillar"><span>${place}</span></div>
        </div>`;
    })
    .join("");

  const list = rest.length
    ? `<ol class="fame__list">${rest
        .map((row, i) => {
          return `
            <li class="fame__row">
              <span class="fame__rank">${i + 4}</span>
              <span class="fame__avatar fame__avatar--sm">${initialOf(row.player)}</span>
              <span class="fame__row-name">${escapeHtml(row.player)}</span>
              <span class="fame__row-wins">${row.games}${crownSvg(14)}</span>
            </li>`;
        })
        .join("")}</ol>`
    : "";

  fame.innerHTML = `
    ${renderHead("Los que lideran el ranking global de m&aacute;s juegos.", stats)}
    <div class="fame__podium">${podium}</div>
    ${list}
  `;
}

// Estado inicial: el ultimo podio conocido (cache de localStorage, TTL corto) para
// que navegar landing -> /fame/ no parpadee en el estado vacio. Sin cache, o sin
// credenciales, arranca vacio como antes y se rellena cuando responde Supabase.
const cached = roomsOn ? cachedGameLeaders() : { ranking: [], totalGames: 0 };
if (cached.ranking.length > 0) renderLeaders(cached.ranking, cached.totalGames);
else renderEmpty();

if (roomsOn) {
  void fetchGameLeaders().then(({ ranking, totalGames }) => renderLeaders(ranking, totalGames));
}
