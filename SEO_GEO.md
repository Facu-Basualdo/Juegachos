# SEO y GEO de Juegachos: propuesta

Propuesta para que Juegachos aparezca cuando alguien busca un juego para jugar, en Google
(SEO) y en las respuestas de ChatGPT, Perplexity, Claude o Gemini (GEO). Todavía no está
implementada: falta que Facu la revise y decida los puntos del final.

Este documento vive en la raíz, junto a `SIMULATION_ARCHITECTURE.md`, porque `docs/` está
en el `.gitignore` y ahí no le llegaría a nadie.

## Resumen

1. **Hoy, para un bot que no ejecuta JavaScript, Juegachos es una página en blanco.** La
   landing y cada juego son un `<div id="app">` vacío que llena JavaScript. Google lo
   termina viendo, aunque tarde; la mayoría de los bots de IA no lo ve nunca.
2. **Tampoco hay `robots.txt` ni `sitemap.xml`** (los dos dan 404 en producción).
3. **La oportunidad está en las búsquedas largas de juegos con amigos**, no en "juegos
   gratis". Contra Poki o CrazyGames no se gana, pero "basta online con amigos" o "juego
   del impostor online" tienen poca competencia en español.
4. Se propone en tres fases: **base técnica** (un PR, todo generado en el build),
   **registro en buscadores** (lo tiene que hacer el dueño del dominio) y **presencia afuera
   del sitio**, que es lo que más mueve el GEO.

## Diagnóstico (medido el 2026-10-05)

| Qué | Estado | Cómo se midió |
| --- | --- | --- |
| Título, descripción e imagen para compartir de cada juego | Bien, salvo `monopoly-mundial`, que no tiene el bloque | `scripts/update-seo.mjs` lo genera en el build desde cada `meta.ts` |
| Texto visible para un bot sin JavaScript (landing) | Solo el `<title>` | `curl https://www.juegachos.com/` sin etiquetas: ni un párrafo |
| Links a los juegos en el HTML de la landing | **0** | `curl ... \| grep -c "<a "`: las tarjetas las crea `src/main.ts` |
| Texto en la página de un juego | Solo el título y "← menú" | `curl https://www.juegachos.com/games/basta/` |
| `robots.txt` | 404 | |
| `sitemap.xml` | 404 | |
| URL canónica | No hay `<link rel="canonical">` (el dominio sin www redirige bien con 308) | |
| Datos estructurados (JSON-LD) | No hay | |

Consecuencias concretas:

- **Google** descubre los juegos solo después de ejecutar la landing, en una segunda pasada
  que puede tardar días. Sin sitemap, un juego nuevo depende de eso.
- **Los bots de IA** (GPTBot, ClaudeBot, PerplexityBot) en general no ejecutan JavaScript:
  no saben qué juegos hay ni de qué se trata cada uno. No hay nada de qué citar.
- **Bing** importa más de lo que parece: alimenta la búsqueda de ChatGPT y Copilot.

## Fase 1: base técnica (un PR, todo en el build)

Todo se genera desde los `meta.ts`, como ya hace `scripts/update-seo.mjs`. Agregar un
juego sigue siendo solo agregar su `meta.ts`: el SEO sale solo.

### 1.1 `sitemap.xml` y `robots.txt`

- **`sitemap.xml`:** la landing, `/rooms/`, `/fame/` y cada juego no `hidden`, con
  `lastmod` sacado de `added`. Se genera en `dist/` durante el build.
- **`robots.txt`:** permite todo, apunta al sitemap y nombra explícitamente a los bots de IA.
  No hace falta para que entren (por defecto pueden), pero deja la decisión escrita:

```text
User-agent: *
Allow: /

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: PerplexityBot
User-agent: Google-Extended
Allow: /

Sitemap: https://www.juegachos.com/sitemap.xml
```

### 1.2 Texto real en el HTML (lo que más pesa)

**Landing.** El build escribe en `index.html` la lista de juegos como HTML estático: un
`<h1>`, un párrafo de qué es Juegachos y un `<ul>` con un `<a href="/games/<id>/">` por
juego, con título, categoría y descripción. Cuando carga `src/main.ts`, la reemplaza por
las tarjetas de siempre. El contenido es el mismo en las dos versiones, así que no es
*cloaking* (mostrarle una cosa al bot y otra a la persona, que Google penaliza).

**Cada juego.** El build agrega a `games/<id>/index.html` una sección con:

- el `<h1>` con el nombre del juego;
- la descripción del `meta.ts`;
- el "cómo se juega" en texto, generado desde el `howTo` que ya existe (por ejemplo
  "Movimiento: flechas o WASD. Saltar: espacio.");
- si es de salas: "Se juega en salas con amigos, de 2 a 8 jugadores", con un link a `/rooms/`;
- links a 4 o 5 juegos de la misma categoría. Esto ayuda a que se descubran entre sí y le da
  contexto al buscador.

**Hay que decidir dónde se ve** (ver "Decisiones"). La forma honesta es que sea visible:
debajo del juego, como hacen Poki y CrazyGames. Muchos juegos ocupan toda la pantalla con
`overflow: hidden`, así que hay que probarlo juego por juego. La alternativa es mostrarla en
la pantalla de inicio de cada juego, donde ya están las tarjetas del `howTo`.

### 1.3 Datos estructurados (JSON-LD)

- **Landing:** `WebSite` y un `ItemList` con los juegos.
- **Cada juego:** `VideoGame` con `name`, `description`, `image` (la portada), `url`,
  `genre` (la categoría), `gamePlatform: "Web browser"`, `operatingSystem: "Any"`,
  `isAccessibleForFree: true`, `inLanguage: "es"`, `playMode` (`SinglePlayer` o
  `MultiPlayer`) y `numberOfPlayers`.

Para ser honestos: Google casi no muestra resultados enriquecidos para `VideoGame`. Esto
sirve más para que los buscadores y las IA entiendan qué es cada página que para cambiar
cómo se ve en Google.

### 1.4 Títulos que coincidan con lo que la gente busca

Hoy el título es `Basta - JUEGACHOS`. Nadie busca "Basta - JUEGACHOS"; buscan "basta
online", "tutti frutti online con amigos" o "stop online". Propuesta:

| Juego | Hoy | Propuesto |
| --- | --- | --- |
| Basta | Basta - JUEGACHOS | Basta (Tutti Frutti) online con amigos, gratis \| Juegachos |
| Impostor | Impostor - JUEGACHOS | Juego del impostor online con amigos \| Juegachos |
| Teléfono Cortado | Telefono Cortado - JUEGACHOS | Teléfono descompuesto online con dibujos \| Juegachos |
| Bomba Palabra | Bomba Palabra - JUEGACHOS | Bomba de palabras online con amigos \| Juegachos |
| Snake | Snake - JUEGACHOS | Snake online gratis, sin descargar \| Juegachos |

Necesita un campo opcional en el `meta.ts` (por ejemplo `seo?: { title?: string }`) para
los juegos que tienen un nombre "de búsqueda" distinto; el resto sigue usando el título.
Eso toca el tipo `GameEntry` de `src/games.ts`, que está "cerrado" para el registro de
juegos (ver "Decisiones").

### 1.5 Detalles menores

- `<link rel="canonical">` en cada página, con `https://www.juegachos.com/...`.
- **`llms.txt`** en la raíz: la lista de juegos con una línea y su URL, pensado para las IA.
  Es barato, pero ningún buscador grande confirmó que lo use: va como apuesta chica.
- Agregar el bloque que le falta a `monopoly-mundial`.
- Las páginas de los juegos de salas, entradas directo desde Google, tienen que explicar
  que hay que armar una sala y llevar a `/rooms/` con un botón. Si no, el que llega desde
  una búsqueda se va.

## Fase 2: registro en buscadores (lo tiene que hacer el dueño del dominio)

Necesita acceso al DNS del dominio o al proyecto de Vercel, así que no se puede hacer
desde el código:

1. **Google Search Console:** verificar `juegachos.com` como propiedad de dominio y subir el
   sitemap.
2. **Bing Webmaster Tools:** se puede importar directo desde Search Console, y también
   subir el sitemap. De acá se alimenta la búsqueda de ChatGPT.
3. Revisar en las dos, a las pocas semanas, qué búsquedas traen gente y qué páginas no se
   indexaron.

## Fase 3: afuera del sitio (lo que más mueve el GEO)

Las IA recomiendan lo que ven nombrado en otros lados, y Google premia los links de sitios
reales. Ninguna etiqueta reemplaza esto:

- **itch.io:** una página para Juegachos y para los juegos más fuertes, con link al sitio.
- **Reddit:** r/argentina, r/WebGames y subreddits de juegos de mesa o fiestas, mostrando
  un juego concreto ("hicimos un Basta online para jugar con amigos").
- **Listas** de "juegos para jugar con amigos online" en blogs en español: escribirles para
  que lo sumen.
- **Videos cortos** (TikTok, Reels, Shorts) de una partida en sala. Además de traer gente,
  hacen que el nombre aparezca en búsquedas.

## Cómo medirlo

- Search Console y Bing Webmaster: impresiones y clics por búsqueda y por página.
- Visitas que vienen de las IA: ChatGPT agrega `utm_source=chatgpt.com` a sus links, y
  Perplexity aparece como sitio de origen. Se ven en Vercel Analytics, si se activa.
- La tabla `game_plays` (las partidas por juego que ya se cuentan) para ver si los juegos
  que se trabajen suben.

Ojo con las expectativas: el SEO tarda semanas o meses en notarse y el GEO todavía es
bastante difuso. Igual, la fase 1 es barata y sin ella las otras dos no sirven.

## Decisiones para Facu

1. **¿Dónde se ve el texto de cada juego?** Debajo del juego (lo más honesto, pero hay que
   probarlo en los juegos de pantalla completa) o en su pantalla de inicio.
2. **¿Agregamos `seo.title` opcional al `meta.ts`?** Implica tocar el tipo `GameEntry` en
   `src/games.ts`. No cambia cómo se descubren los juegos, solo suma un campo opcional.
3. **¿Quién da de alta Search Console y Bing?** Necesita acceso al dominio.
4. **¿Hacemos la fase 3?** Cuentas en itch.io y Reddit a nombre de quién, y con qué juegos
   arrancar. Los de salas (Basta, Impostor, Teléfono Cortado, Bomba Palabra) son los que
   tienen menos competencia.
