import "../style.css";
import { games, coverUrl, type GameEntry } from "../games";
import { isLeaderboardEnabled } from "../shared/supabase";
import { FEEDBACK_MAX, isFeedbackEnabled, sendFeedback, type FeedbackKind } from "../shared/feedback";

/**
 * Pagina de feedback (/feedback/): problemas, ideas, pedidos de juegos. Es el lugar
 * para lo general; el "¿Te gustó?" de cada juego vive en su game over (`FeedbackPanel`).
 *
 * El juego se elige en una grilla de portadas con buscador (pedido del programador: con
 * un desplegable de nombres no se reconocia el juego de un vistazo). `?game=<id>`
 * preselecciona uno y `?tipo=bug|idea|game|other` el tipo, para linkear desde afuera.
 *
 * Reusa el shell (barra y pie) de la landing, como `/fame/`.
 */

const app = document.querySelector<HTMLDivElement>("#app")!;
const roomsOn = isLeaderboardEnabled();

const KINDS: { kind: FeedbackKind; label: string; hint: string; placeholder: string; game: "optional" | "none" }[] = [
  { kind: "bug", label: "Un problema", hint: "Algo no anda o se ve mal", placeholder: "¿Qué pasó? Contanos qué estabas haciendo cuando pasó.", game: "optional" },
  { kind: "idea", label: "Una idea", hint: "Algo para mejorar o agregar", placeholder: "¿Qué le agregarías o cambiarías?", game: "optional" },
  { kind: "game", label: "Pedir un juego", hint: "Un juego que te gustaría ver acá", placeholder: "¿Qué juego te gustaría jugar? Contanos cómo es o a cuál se parece.", game: "none" },
  { kind: "other", label: "Otra cosa", hint: "Lo que quieras contarnos", placeholder: "Lo que quieras contarnos.", game: "optional" },
];

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- Barra de navegacion ----------
const nav = document.createElement("nav");
nav.className = "topbar";
nav.innerHTML = `
  <a class="topbar__logo" href="/"><img src="/juegachos.png" alt="JUEGACHOS" /></a>
  <div class="topbar__links">
    <a href="/">Juegos</a>
    ${roomsOn ? `<a href="/rooms/">Salas</a>` : ""}
    <a href="/feedback/" class="is-active">Feedback</a>
  </div>
`;

// ---------- Contenido ----------
const main = document.createElement("main");
main.className = "page fbp";

const sortedGames = [...games].sort((a, b) => a.title.localeCompare(b.title, "es"));

function gameCard(g: GameEntry | null): string {
  if (!g) {
    return `<button type="button" class="fbp-game fbp-game--none" data-game="" aria-pressed="false">
      <span class="fbp-game__cover fbp-game__cover--none"><b>?</b></span>
      <span class="fbp-game__title">General / ninguno</span>
    </button>`;
  }
  return `<button type="button" class="fbp-game" data-game="${g.id}" data-search="${esc(`${g.title} ${g.category}`.toLowerCase())}" aria-pressed="false">
    <span class="fbp-game__cover"><img src="${coverUrl(g.id)}" alt="" loading="lazy" decoding="async" /></span>
    <span class="fbp-game__title">${esc(g.title)}</span>
  </button>`;
}

main.innerHTML = `
  <header class="fbp-head">
    <h1 class="fbp-head__title">Contanos</h1>
    <p class="fbp-head__lead">Un problema, una idea o el juego que te gustaría jugar acá. Lo leemos todo.</p>
  </header>
  <form class="fbp-form" novalidate>
    <section class="fbp-step">
      <h2 class="fbp-step__title"><span class="fbp-step__n">1</span>¿Qué nos querés contar?</h2>
      <div class="fbp-kinds" role="radiogroup" aria-label="Tipo de mensaje">
        ${KINDS.map((k) => `<button type="button" class="fbp-kind" data-kind="${k.kind}" role="radio" aria-checked="false"><b>${k.label}</b><span>${k.hint}</span></button>`).join("")}
      </div>
    </section>
    <section class="fbp-step" data-step="game">
      <h2 class="fbp-step__title"><span class="fbp-step__n">2</span>¿De qué juego? <small>(opcional)</small></h2>
      <div class="fbp-pick">
        <div class="fbp-picked" aria-live="polite"></div>
        <label class="fbp-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
          <input type="search" class="fbp-search__input" placeholder="Buscar un juego" autocomplete="off" aria-label="Buscar un juego" />
        </label>
        <div class="fbp-games">${gameCard(null)}${sortedGames.map(gameCard).join("")}</div>
        <p class="fbp-empty" hidden>No hay ningún juego con ese nombre.</p>
      </div>
    </section>
    <section class="fbp-step">
      <h2 class="fbp-step__title"><span class="fbp-step__n" data-n="msg">3</span>Tu mensaje</h2>
      <textarea class="fbp-text" rows="5" maxlength="${FEEDBACK_MAX}" aria-label="Tu mensaje"></textarea>
      <div class="fbp-count"></div>
    </section>
    <section class="fbp-step">
      <h2 class="fbp-step__title"><span class="fbp-step__n" data-n="contact">4</span>¿Querés que te respondamos? <small>(opcional)</small></h2>
      <input type="text" class="fbp-contact" maxlength="120" autocomplete="off" placeholder="Tu usuario de Discord o tu mail" aria-label="Contacto" />
    </section>
    <div class="fbp-foot">
      <span class="fbp-note" aria-live="polite"></span>
      <button type="submit" class="fbp-send">Enviar</button>
    </div>
  </form>
  <section class="fbp-done" hidden>
    <h2 class="fbp-done__title">¡Gracias!</h2>
    <p class="fbp-done__text">Lo vamos a leer. Si dejaste un contacto, te respondemos por ahí.</p>
    <div class="fbp-done__actions">
      <button type="button" class="fbp-send fbp-again">Contar otra cosa</button>
      <a class="fbp-back" href="/">Volver a los juegos</a>
    </div>
  </section>
  <section class="fbp-off" hidden>
    <h2 class="fbp-done__title">El feedback no está disponible ahora</h2>
    <p class="fbp-done__text">Probá más tarde, o contanos en el <a href="https://discord.gg/pdFQVrKXN" target="_blank" rel="noopener noreferrer">Discord</a>.</p>
  </section>
`;

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

// ---------- Comportamiento ----------

const q = <T extends Element>(sel: string) => main.querySelector<T>(sel)!;
const form = q<HTMLFormElement>(".fbp-form");
const gameStep = q<HTMLElement>('[data-step="game"]');
const pickedEl = q<HTMLElement>(".fbp-picked");
const searchEl = q<HTMLInputElement>(".fbp-search__input");
const gamesEl = q<HTMLElement>(".fbp-games");
const emptyEl = q<HTMLElement>(".fbp-empty");
const textEl = q<HTMLTextAreaElement>(".fbp-text");
const countEl = q<HTMLElement>(".fbp-count");
const contactEl = q<HTMLInputElement>(".fbp-contact");
const noteEl = q<HTMLElement>(".fbp-note");
const sendBtn = q<HTMLButtonElement>(".fbp-form .fbp-send");
const doneEl = q<HTMLElement>(".fbp-done");

let kind: FeedbackKind = "bug";
let gameId = "";
let sending = false;

function setKind(k: FeedbackKind): void {
  kind = k;
  const def = KINDS.find((x) => x.kind === k)!;
  for (const b of main.querySelectorAll<HTMLButtonElement>("[data-kind]")) b.setAttribute("aria-checked", String(b.dataset.kind === k));
  // Pedir un juego: no hay "de que juego" (es uno que todavia no existe).
  gameStep.hidden = def.game === "none";
  q<HTMLElement>('[data-n="msg"]').textContent = gameStep.hidden ? "2" : "3";
  q<HTMLElement>('[data-n="contact"]').textContent = gameStep.hidden ? "3" : "4";
  textEl.placeholder = def.placeholder;
}

function setGame(id: string): void {
  gameId = id;
  for (const b of gamesEl.querySelectorAll<HTMLButtonElement>("[data-game]")) b.setAttribute("aria-pressed", String(b.dataset.game === id));
  const g = games.find((x) => x.id === id);
  pickedEl.innerHTML = g
    ? `<img src="${coverUrl(g.id)}" alt="" /><span><small>Elegiste</small><b>${esc(g.title)}</b></span><button type="button" class="fbp-picked__clear">Cambiar</button>`
    : "";
  pickedEl.hidden = !g;
  pickedEl.querySelector(".fbp-picked__clear")?.addEventListener("click", () => {
    setGame("");
    searchEl.focus();
  });
}

function filterGames(): void {
  const term = searchEl.value.trim().toLowerCase();
  let shown = 0;
  for (const b of gamesEl.querySelectorAll<HTMLButtonElement>("[data-game]")) {
    const visible = !term || (b.dataset.search ?? "").includes(term);
    b.hidden = !visible;
    if (visible) shown++;
  }
  emptyEl.hidden = shown > 0;
}

function sync(): void {
  const n = textEl.value.trim().length;
  sendBtn.disabled = sending || n < 3;
  countEl.textContent = n > FEEDBACK_MAX * 0.8 ? `${n}/${FEEDBACK_MAX}` : "";
}

for (const b of main.querySelectorAll<HTMLButtonElement>("[data-kind]")) b.addEventListener("click", () => setKind(b.dataset.kind as FeedbackKind));
gamesEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-game]");
  if (b) setGame(b.dataset.game ?? "");
});
searchEl.addEventListener("input", filterGames);
textEl.addEventListener("input", sync);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = textEl.value.trim();
  if (sending || message.length < 3) return;
  sending = true;
  sync();
  noteEl.textContent = "Enviando...";
  const def = KINDS.find((x) => x.kind === kind)!;
  const res = await sendFeedback({ kind, source: "landing", gameId: def.game === "none" ? null : gameId || null, message, contact: contactEl.value });
  sending = false;
  noteEl.textContent = "";
  if (res === "ok") {
    form.hidden = true;
    doneEl.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    noteEl.textContent = res === "limit" ? "Mandaste mucho seguido. Probá en un rato." : "No se pudo enviar. Probá de nuevo.";
  }
  sync();
});

q<HTMLButtonElement>(".fbp-again").addEventListener("click", () => {
  textEl.value = "";
  doneEl.hidden = true;
  form.hidden = false;
  sync();
  textEl.focus();
});

// Estado inicial (con `?game=` / `?tipo=` desde un link).
const params = new URLSearchParams(location.search);
const startKind = params.get("tipo") as FeedbackKind | null;
setKind(KINDS.some((k) => k.kind === startKind) ? startKind! : "bug");
const startGame = params.get("game") ?? "";
setGame(games.some((g) => g.id === startGame) ? startGame : "");
sync();

if (!isFeedbackEnabled()) {
  form.hidden = true;
  q<HTMLElement>(".fbp-off").hidden = false;
}
