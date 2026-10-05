// SEO y GEO generados en el build (ver SEO_GEO.md). Todo sale de los `meta.ts`:
// agregar un juego no requiere tocar nada de aca.
//
// - `<head>` de cada juego: title, description, canonical, Open Graph / Twitter y
//   JSON-LD `VideoGame`. Los HTML de `games/<id>/` NO llevan estos tags en el
//   fuente: se inyectan al servirlos (dev) y al construirlos (build).
// - Texto real para los bots que no ejecutan JavaScript (`#seo-static`): en la
//   landing, la lista de juegos con links; en cada juego, su descripcion, el "como
//   se juega" en texto y links a otros de la misma categoria. Un script inline lo
//   saca antes del primer pintado: la persona (y Google, que renderiza) ve las
//   tarjetas de la landing y el `HowToPanel` de cada juego, que dicen lo mismo.
// - `sitemap.xml`, `robots.txt` y `llms.txt` en la raiz de `dist/` (y servidos en dev).
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { runnerImport, type Plugin } from "vite";
import type { GameEntry } from "../../src/games";

export const SITE = "https://www.juegachos.com";
const BRAND = "Juegachos";
const MAX_ROOM_PLAYERS = 8; // = src/shared/room/types.ts
const RELATED_COUNT = 5;

interface Roster {
  /** Los del roster visible, en el orden de la landing. */
  games: GameEntry[];
  /** Todas las metas, incluidas las `hidden`. */
  all: Map<string, GameEntry>;
}

export function seoPlugin(root: string): Plugin {
  let roster: Promise<Roster> | null = null;
  const loadRoster = (): Promise<Roster> =>
    (roster ??= runnerImport<{ games: GameEntry[]; allMetas: GameEntry[] }>(
      resolve(root, "scripts/seo/roster.ts"),
      { root, configFile: false, logLevel: "error" },
    ).then(({ module }) => ({
      games: module.games,
      all: new Map(module.allMetas.map((m) => [m.id, m])),
    })));

  const coverExists = (id: string) => existsSync(resolve(root, "public/covers", `${id}.jpg`));

  return {
    name: "juegachos-seo",

    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (file.endsWith("meta.ts")) roster = null;
      });
      server.middlewares.use(async (req, res, next) => {
        const file = rootFiles[req.url ?? ""];
        if (!file) return next();
        res.setHeader("Content-Type", file.type);
        res.end(file.build(await loadRoster()));
      });
    },

    async transformIndexHtml(html, ctx) {
      const page = relative(root, ctx.filename).replace(/\\/g, "/");
      const r = await loadRoster();

      if (page === "index.html") {
        return inject(html, landingHead(r), landingStatic(r));
      }
      const gameId = page.match(/^games\/([^/]+)\/index\.html$/)?.[1];
      if (gameId) {
        const visible = r.games.find((g) => g.id === gameId);
        if (visible) {
          return inject(html, gameHead(visible, coverExists(gameId)), gameStatic(visible, r));
        }
        // Juego oculto o sin meta.ts (monopoly-mundial): la pagina existe pero no
        // esta en el roster, asi que no se indexa.
        const hidden = r.all.get(gameId);
        return inject(html, `${hidden ? basicHead(hidden) : ""}${tag.noindex}`, "");
      }
      // Paginas que no son juegos: ya traen su title / description escritos a mano.
      // La Feria necesita un codigo de sala: su fuente ya trae el noindex.
      if (page === "rooms/lobby/index.html") return html;
      const dir = page.replace(/index\.html$/, "");
      return inject(html, canonical(`/${dir}`), "");
    },

    async generateBundle() {
      const r = await loadRoster();
      for (const [path, file] of Object.entries(rootFiles)) {
        this.emitFile({ type: "asset", fileName: path.slice(1), source: file.build(r) });
      }
    },
  };
}

// ---------- <head> ----------

const tag = {
  noindex: `\n    <meta name="robots" content="noindex" />`,
};

function canonical(path: string): string {
  return `\n    <link rel="canonical" href="${SITE}${path}" />`;
}

function pageTitle(g: GameEntry): string {
  return `${g.seo?.title ?? `${g.title} - juego online gratis`} | ${BRAND}`;
}

function basicHead(g: GameEntry): string {
  return `\n    <title>${esc(pageTitle(g))}</title>
    <meta name="description" content="${esc(g.seo?.description ?? g.description)}" />`;
}

function gameHead(g: GameEntry, hasCover: boolean): string {
  const title = esc(pageTitle(g));
  const desc = esc(g.seo?.description ?? g.description);
  const url = `${SITE}${g.path}`;
  const image = hasCover ? `${SITE}/covers/${g.id}.jpg` : `${SITE}/icono.png`;
  return `${basicHead(g)}${canonical(g.path)}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${BRAND}" />
    <meta property="og:locale" content="es_AR" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:url" content="${url}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${image}" />${jsonLd(videoGame(g, image))}`;
}

function landingHead(r: Roster): string {
  return `${canonical("/")}${jsonLd([
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: BRAND,
      url: `${SITE}/`,
      inLanguage: "es",
      description: siteSummary(r),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Juegos de ${BRAND}`,
      numberOfItems: r.games.length,
      itemListElement: r.games.map((g, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE}${g.path}`,
        name: g.title,
      })),
    },
  ])}`;
}

function videoGame(g: GameEntry, image: string): object {
  const solo = !g.roomsOnly;
  const rooms = !g.roomsHidden;
  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: g.title,
    ...(g.seo?.title ? { alternateName: g.seo.title } : {}),
    description: g.description,
    url: `${SITE}${g.path}`,
    image,
    genre: g.category,
    datePublished: g.added,
    inLanguage: "es",
    gamePlatform: g.mobile ? ["Web browser", "PC", "Mobile"] : ["Web browser", "PC"],
    operatingSystem: "Any",
    applicationCategory: "Game",
    isAccessibleForFree: true,
    playMode: [...(solo ? ["SinglePlayer"] : []), ...(rooms ? ["MultiPlayer"] : [])],
    numberOfPlayers: {
      "@type": "QuantitativeValue",
      minValue: solo ? 1 : 2,
      maxValue: rooms ? MAX_ROOM_PLAYERS : 1,
    },
    publisher: { "@type": "Organization", name: BRAND, url: `${SITE}/` },
  };
}

function jsonLd(data: object): string {
  // `<` escapado: una descripcion con "</script>" no puede cortar el bloque.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `\n    <script type="application/ld+json">${json}</script>`;
}

// ---------- Texto para bots sin JavaScript ----------

/** Se saca antes del primer pintado: lo que se ve es la version de JS (ver arriba). */
const REMOVE_STATIC = `<script>document.getElementById("seo-static").remove()</script>`;

function landingStatic(r: Roster): string {
  const items = r.games
    .map((g) => `<li><a href="${g.path}">${esc(g.title)}</a> (${esc(g.category)}): ${esc(g.description)}</li>`)
    .join("\n        ");
  return `
    <section id="seo-static">
      <h1>${BRAND}: minijuegos gratis para jugar en el navegador</h1>
      <p>${esc(siteSummary(r))}</p>
      <h2>Juegos</h2>
      <ul>
        ${items}
      </ul>
      <p><a href="/rooms/">Jugar con amigos en una sala</a> - <a href="/fame/">Salón de la fama</a></p>
    </section>
    ${REMOVE_STATIC}`;
}

function gameStatic(g: GameEntry, r: Roster): string {
  const how = g.howTo
    ? `<p>${esc(g.howTo.intro)}</p>
      <ul>
        ${g.howTo.actions
          .map((a) => `<li>${esc(a.title)}: ${a.icons.map(iconText).join(" o ")}${a.note ? ` (${esc(a.note)})` : ""}.</li>`)
          .join("\n        ")}
      </ul>`
    : g.controls
      ? `<p>${esc(g.controls)}</p>`
      : "";
  const related = r.games.filter((o) => o.category === g.category && o.id !== g.id).slice(0, RELATED_COUNT);
  return `
    <section id="seo-static">
      <h1>${esc(g.title)}</h1>
      <p>${esc(g.description)}</p>${how ? `\n      <h2>Cómo se juega</h2>\n      ${how}` : ""}
      <p>${playModeText(g)}</p>${
        related.length
          ? `\n      <h2>Más juegos de ${esc(g.category)}</h2>
      <ul>
        ${related.map((o) => `<li><a href="${o.path}">${esc(o.title)}</a></li>`).join("\n        ")}
      </ul>`
          : ""
      }
      <p><a href="/">Todos los juegos de ${BRAND}</a></p>
    </section>
    ${REMOVE_STATIC}`;
}

function playModeText(g: GameEntry): string {
  const where = g.mobile ? "en la computadora o en el celular" : "en la computadora";
  if (g.roomsOnly) {
    return `Se juega solo en salas con amigos, de 2 a ${MAX_ROOM_PLAYERS} jugadores, ${where}. <a href="/rooms/">Armá una sala</a> y compartí el código.`;
  }
  if (g.roomsHidden) return `Gratis y sin descargar, ${where}.`;
  return `Gratis y sin descargar, ${where}. Se juega solo o con amigos en una <a href="/rooms/">sala</a> de hasta ${MAX_ROOM_PLAYERS} jugadores.`;
}

function siteSummary(r: Roster): string {
  return `${r.games.length} minijuegos gratis para jugar en el navegador, sin descargar ni registrarte: arcade, puzzles y juegos de fiesta. Se juegan solos o con amigos en salas de hasta ${MAX_ROOM_PLAYERS} jugadores, desde la computadora o el celular.`;
}

/** El vocabulario de iconos de `src/shared/howto.ts`, en palabras. */
const ICON_TEXT: Record<string, string> = {
  wasd: "WASD",
  arrows: "las flechas",
  ad: "A y D",
  "arrows-lr": "las flechas izquierda y derecha",
  ws: "W y S",
  "arrows-ud": "las flechas arriba y abajo",
  "arrow-up": "la flecha arriba",
  "arrow-down": "la flecha abajo",
  space: "la barra espaciadora",
  enter: "Enter",
  esc: "Esc",
  keyboard: "el teclado",
  click: "clic",
  mouse: "el mouse",
  drag: "arrastrar con el mouse",
  wheel: "la rueda del mouse",
  tap: "tocar la pantalla",
  hold: "mantener apretado",
  swipe: "deslizar el dedo",
  "tap-sides": "tocar un costado de la pantalla",
  joystick: "el joystick en pantalla",
  mic: "la voz (micrófono)",
  headphones: "auriculares",
};

function iconText(icon: string): string {
  if (icon.startsWith("key:")) return `la tecla ${esc(icon.slice(4))}`;
  if (icon.startsWith("keys:")) return `las teclas ${esc(icon.slice(5).split(" ").filter(Boolean).join(", "))}`;
  if (icon.startsWith("btn:")) return `el botón ${esc(icon.slice(4))} en pantalla`;
  return ICON_TEXT[icon] ?? esc(icon);
}

// ---------- Archivos de la raiz ----------

const rootFiles: Record<string, { type: string; build: (r: Roster) => string }> = {
  "/sitemap.xml": { type: "application/xml; charset=utf-8", build: sitemap },
  "/robots.txt": { type: "text/plain; charset=utf-8", build: robots },
  "/llms.txt": { type: "text/plain; charset=utf-8", build: llms },
};

function sitemap(r: Roster): string {
  const latest = r.games.reduce((max, g) => (g.added > max ? g.added : max), "");
  const urls = [
    { loc: "/", lastmod: latest },
    { loc: "/rooms/" },
    { loc: "/fame/" },
    ...r.games.map((g) => ({ loc: g.path, lastmod: g.added })),
  ];
  const body = urls
    .map((u) => `  <url><loc>${SITE}${u.loc}</loc>${"lastmod" in u && u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

// Los bots de IA ya pueden entrar por defecto: nombrarlos deja la decision escrita.
function robots(): string {
  return `User-agent: *
Allow: /

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: PerplexityBot
User-agent: Google-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

function llms(r: Roster): string {
  const line = (g: GameEntry) => `- [${g.title}](${SITE}${g.path}): ${g.description}`;
  const solo = r.games.filter((g) => !g.roomsOnly);
  const rooms = r.games.filter((g) => g.roomsOnly);
  return `# ${BRAND}

> ${siteSummary(r)} En español.

Las salas se arman en ${SITE}/rooms/: uno crea la sala, comparte el código y todos juegan la misma ronda, cada uno en su dispositivo, con un marcador acumulado.

## Juegos para jugar solo o en sala

${solo.map(line).join("\n")}

## Juegos que se juegan solo en salas con amigos

${rooms.map(line).join("\n")}
`;
}

// ---------- Utilidades ----------

function inject(html: string, head: string, body: string): string {
  let out = html.replace("</head>", `${head}\n  </head>`);
  if (body) out = out.replace(/<body[^>]*>/, (m) => `${m}${body}`);
  return out;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
