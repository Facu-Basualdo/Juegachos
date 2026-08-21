# MiniGames

Monorepo of small browser minigames (Neon Cylinder, Flappy Bird, Stack Tower, Rhythm Tap, Jump Ball, Reaction Time, City Bloxx, Sliding Puzzle, Asteroids, Mini Frogger, Neon Drift, Odd One Out, Dunk Shot, Memoria, Kunai Throw, Keepers!, Western Shoot, Barra Libre, Crono Ciego, El Trile, PONG, Block Paddle, Simon, Topos, Snake, Ta-Te-Ti, Conecta 4, Mecano, Final Sentence, Neon Sawblades, Space Rush, Lights Out, Boilerbound, Timber!, Puerco Araña, Circuit Breaker, Ring Runner, Pulso de Acero, Memoria de Color, Al Centro, Bomba Palabra, Cadena de Palabras, Hole in None, Cannon Dodge, Pizza Express, Danger Wings, Click the Number, Macaco Tilt, Templo Rodante, Basta, Impostor and Manchon), each independently playable — except Bomba Palabra, Cadena de Palabras, Basta, Impostor and Manchon, which are **rooms-only** (they need a multiplayer room and the game server; see "Game server" below) — plus a landing page to pick one. (Rocket SpaceX / `rocket-arena` and Telefono Cortado / `telefono-cortado` still live in the repo but are hidden from the roster via `hidden: true` in their `meta.ts`: rocket-arena due to errors, Telefono Cortado because it was pulled from the roster. Telefono Cortado is also rooms-only and server-backed; their code and their game-server sims stay in place.) Stack: Vite + TypeScript, no framework. Deployed as a static site (Vercel), plus a separate Node game server (`server/`) on Railway for the real-time / server-authoritative games.

## Conventions (must follow)

- **Never use emojis** anywhere — not in code, UI, comments, commit messages, or docs.
- **Keep `CLAUDE.md` files up to date with every change.** When structure, commands, conventions, or the game roster change, update the relevant `CLAUDE.md` (this root file and/or the per-game one) in the same change.
- **Never add yourself (Claude) as a co-author on commits.** Do not append `Co-Authored-By` trailers or any AI attribution to commit messages.
- **Use the installed `threejs-*` skills when building 3D games.** For any game using Three.js (scenes, cameras, geometry, materials, lighting, textures, animation, model loaders, shaders, postprocessing, raycasting/interaction), consult the matching `threejs-*` skill for accurate APIs and patterns instead of relying on memory.
- **Every game gets a `DESIGN.md` (art direction) next to its `CLAUDE.md`.** Before building or reworking a game's visuals, write that game's design philosophy there and make every visual decision answer to it — see `src/games/neon-sawblades/DESIGN.md` ("Machined Light") for the reference format. The principles are medium-agnostic (they apply to plain canvas and to Three.js games alike); the concrete palette and vocabulary are per-game. **If the programmer has not specified the aesthetic direction (palette, mood, references, how the game should feel), ask for those details before inventing them.** When the `canvas-design` skill is installed, invoke it to generate the philosophy (`npx skills add https://github.com/anthropics/skills --skill canvas-design`); when it is not, write the `DESIGN.md` by hand following the reference format anyway — the committed document is the requirement, not the tool. Like the `threejs-*` skills it is installed locally per collaborator (`.claude`/`.agents` are gitignored).
- Every game must have the Enter-to-start 3 / 2 / 1 / YA countdown. No game may jump straight from the start / game-over screen into play — it must go through the shared countdown described below. New games are required to implement it.
- **Always add credits for new games in `README.md`.** When a new game is registered, append it to the games table in the root-level [README.md](file:///c:/ReposGit/Game/README.md) with its title, category, description (adapted to localized Spanish "voseo" style), and the creator's GitHub profile link.

## Structure

- `index.html`, `src/main.ts`, `src/style.css` — the landing page. Renders a card per game from the `games` array in `src/games.ts`, plus a "Jugar con amigos" link to `/rooms/` (only when Supabase credentials exist).
- `src/games.ts` — the `GameEntry` type (`id`, `title`, `description`, `path`, optional `accent`, optional `controls`, `category`, optional `order`, `added`, `mobile`, optional `hidden`, optional `roomsHidden`, optional `roomTimeLimitSec`) plus `coverUrl`. `roomTimeLimitSec` is the round's time limit **in rooms only**, in seconds (see "Salas"); omit it and the round is untimed. `added` is the ISO `YYYY-MM-DD` date the game entered the roster and is **required**: `order` is curated by hand and does not track when a game was added, so the landing's default "Nuevos" sort reads `added` instead. `mobile` (boolean) is whether the game can be played on a phone and is **also required** — deliberately not optional, so a new game can't default into being advertised as mobile-ready without anyone having tried it on a phone (see "Jugable en celular" below for what earns a `true`). The landing shows **platform chips** next to the category chip on each card (the row sits at the **bottom** of the cover: the top corners are taken by the favorite heart on the left and the "Ranking" button on the right): a monitor icon on **every** card (the whole roster plays on a computer) plus a phone icon on the games that declare `mobile: true`. They are icons and not the words "PC" / "Móvil" because next to the category chip two text chips read as two categories. Both SVGs are inline in `src/main.ts` (`PC_BADGE` / `MOBILE_BADGE`, no loose assets) and take their color from `currentColor`, so the accent lives in one CSS rule: the PC one stays in the chip's base cream and only the phone is cyan (`.game-card__tag--mobile`), since that is the one carrying information — the pair reads "también en el celu". Shared icon-chip styling is `.game-card__tag--icon`. The row is `.game-card__tags`. Accessibility: the `<svg>` is `aria-hidden` and the `aria-label` lives on the wrapping span, otherwise the chip would be invisible to a screen reader. `controls` is a one-line "how to play" string shown in the room-mode briefing before each round (see "Salas"); omit it and the briefing just skips the controls block. `roomsHidden` drops a game from rooms only (kept on the landing) — the file also exports `roomGames` (= `games` minus `roomsHidden`) for the room selection/vote/random/picker paths. It does **not** list the games by hand: it auto-discovers them with `import.meta.glob("./games/*/meta.ts", { eager: true })`, filters out `hidden` ones, and sorts by `order` (ascending; entries without `order` fall to the end, then alphabetical by title). **This file is closed for modification** — adding a game means adding its `meta.ts`, never editing `games.ts` (this is what stops the registry from producing merge conflicts on every new game).
- `src/games/<id>/meta.ts` — that game's registry entry: `export const meta: GameEntry = { ... }`. **Every game needs this file** (it is what the landing page, rooms, and random-game picker read). Set `order` to place the card (existing games use multiples of 10). Set `hidden: true` to pull a game from the roster without deleting it (`rocket-arena`, hidden due to errors; `telefono-cortado`, pulled from the roster) — its code stays in the repo and it just disappears from the landing and the rooms voting / random pool. Set `roomsHidden: true` to exclude a game from **rooms only** (host picker, vote pool, random and playlist) while keeping it on the landing (no game currently uses it — Pong used to, before it gained its server-authoritative room mode); `src/games.ts` derives `roomGames` (= `games` minus `roomsHidden`) for that, and the room code uses `roomGames` for selection but still looks games up by id in `games` so an in-flight round resolves its title/URL.
- `games/<id>/index.html` — one Vite HTML entry point per game (root-level `games/`, not under `src/`), giving each game a clean URL `/games/<id>/`.
- `src/games/<id>/` — that game's source (`main.ts`, `style.css`, plus its own submodules, e.g. `game/`).
- `src/shared/` — cross-cutting leaderboard infra shared by every game and the landing page (see "Global rankings" below), plus `src/shared/room/` (multiplayer rooms, see "Salas" below). This is the **one** sanctioned shared module; it is not game-engine code.
- `rooms/index.html` + `src/rooms/` — the multiplayer rooms page (create / join / lobby) at `/rooms/`. Not a game, so it lives outside `games/`.
- `fame/index.html` + `src/fame/` — the **Salón de la fama** page at `/fame/` (podium of the players who lead the global ranking of the most games; see "Global rankings" > `leaders.ts`). Not a game either; reuses the landing's `src/style.css`.
- `vite.config.ts` — auto-discovers every `games/*/index.html` via `node:fs` at config-load time and feeds them into `build.rollupOptions.input`. New games are picked up automatically; **no edit needed here** when adding a game. The only hand-registered extra entries are `rooms/index.html` and `fame/index.html`.
- `public/` — static assets shared across all games (favicon, icons).
- Each game folder under `src/games/<id>/` has its own `CLAUDE.md` with game-specific context (mechanics, gotchas, tuning knobs) and its `DESIGN.md` with the art direction (see Conventions).

## Commands

- `npm run dev` — Vite dev server (each game reachable at `/games/<id>/`, landing page at `/`).
- `npm run build` — `tsc` type-check then `vite build`; verify by checking the output for a `dist/games/<id>/index.html` line per game.
- `npm run preview` — serve the production build locally.

## Adding a new minigame

1. Create `src/games/<id>/` with `main.ts`, `style.css`, and any submodules.
2. Create `games/<id>/index.html` mirroring `games/neon-cylinder/index.html` (script `src="/src/games/<id>/main.ts"`; optional `.back-link` anchor to `/` to return to the landing page).
3. Create `src/games/<id>/meta.ts` exporting `const meta: GameEntry` (see `src/games/blind-time/meta.ts`). Give it an `order` (multiples of 10) to place its card, an `added` with today's date (`YYYY-MM-DD`, required — it drives the landing's default "Nuevos" sort) and a `mobile` boolean (also required — **probalo en un celular antes de poner `true`**, ver el paso 6). **Do not touch `src/games.ts`** — the glob picks the new `meta.ts` up automatically.
4. Add a `CLAUDE.md` inside `src/games/<id>/` documenting that game's mechanics and any non-obvious decisions.
5. Add a `DESIGN.md` inside `src/games/<id>/` with the game's art direction (see the Conventions rule above) — asking the programmer for the aesthetic direction first if they did not specify it.
6. Implement the mandatory Enter-to-start 3 / 2 / 1 / YA countdown (see "Shared UX pattern" below). **El arranque tambien tiene que entrar por un toque**, y el listener va sobre el `container` o el overlay — nunca sobre el canvas, que la pantalla de inicio tapa (ver "El toque de arranque no puede colgar del canvas"). Eso mas el gameplay sin teclado fisico es lo que decide el `mobile` del paso 3.
7. Wire the global ranking (see "Global rankings" below): if the game's scoring is non-default, add `export const scoring: GameScoring` to its `meta.ts` (omit it for a plain `{ direction: "higher" }` board); then call `hud.showRanking(...)` on game over.
8. Wire the multiplayer room mode (see "Salas (multiplayer rooms)" below): `initRoomMode(<id>, { getScore })` in the constructor, block the restart input on game over when `this.room` is set, and call `this.room.reportScore(score)` instead of `hud.showRanking(...)`. **Then answer one question: left completely untouched, does the run reach game over on its own?** If not, the game must declare `roomTimeLimitSec` in its `meta.ts` (or unblock itself like `connect-four`'s `AFK_MOVE_MS`) — otherwise one idle player hangs the round forever. And if the game is `direction: "lower"`, wire `roomRun.ts` so a reload can't restart its clock (see "Sobrevivir un F5").
9. If the game shows the other players live (streaming positions over its own broadcast channel), read "Canales efimeros de alta frecuencia" below **first** and copy `cannon-dodge`'s `DodgeChannel.ts`: there is a message-per-second budget you will blow with a full room, and a bare `subscribe()` fails silently.
10. Run `npm run build` to confirm the new entry is discovered.
11. Add the game and its author/credits to the games table in the root-level [README.md](file:///c:/ReposGit/Game/README.md).

Games are intentionally decoupled — no shared game-engine code between them. Don't introduce a shared abstraction across games unless a second game actually needs it. The lone exception is `src/shared/` (global rankings), which is deliberately cross-cutting infra, not gameplay logic.

## Global rankings

Every game reports its final score to a shared global leaderboard backed by **Supabase** (Postgres + client SDK called straight from the browser with the anon key and Row Level Security — no server code). Lives in `src/shared/`:

- `supabase.ts` — lazy client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; `getSupabase()` returns `null` when unset. `isLeaderboardEnabled()` gates optional UI.
- `scoring-core.ts` — leaf module (no imports): the `Direction` / `GameScoring` types and the pure helpers `encodeTimeMoves` / `formatTimeMoves` (pack completion time + moves into one score — time orders, moves tiebreak — for the sliding-puzzle and memory-match solo boards) and `formatClock`. A game's `meta.ts` imports its `GameScoring` type (and these helpers when it needs them) from here. It is separate from `scoring.ts` on purpose: `scoring.ts` globs the `meta.ts` files, so if the helpers lived there the glob would create a runtime import cycle.
- `scoring.ts` — builds `GAME_SCORING[gameId]` by auto-discovering each game's `export const scoring: GameScoring` via `import.meta.glob("../games/*/meta.ts", { eager: true })` (same Open/Closed pattern as `src/games.ts` — **do not edit this file to add a game**), and exposes the accessors `getScoring` / `getDirection` / `formatScore`. It also re-exports everything from `scoring-core.ts` so existing `import { ... } from ".../shared/scoring"` keep working. A `GameScoring` has `direction` (`"higher"` = bigger is better, default; `"lower"` for reaction-time, blind-time, sliding-puzzle, car-race), optional `format`, optional `variants` (independent boards, e.g. sliding-puzzle sizes), and optional per-variant overrides `variantDirection` / `variantFormat` (used when one variant sorts/formats differently from the base — e.g. memory-match is `"higher"` for room-mode pairs but its solo `"solo"` board is `"lower"`). A game whose scoring is exactly the default `{ direction: "higher" }` **omits** `scoring` from its `meta.ts` (the `getScoring` default covers it); every game with non-default scoring must declare it there.
- `nickname.ts` — anonymous player name in `localStorage` (`mg:nickname`, 1-12 chars).
- `plays.ts` — game popularity: `recordPlay(gameId)` (fire-and-forget `fetch` with `keepalive` to the `increment_game_plays` RPC, so the POST survives the navigation to the game page) and `fetchPlayCounts()` / `cachedPlayCounts()` (read the per-game counts, cached in `localStorage` `mg:play-counts`). Backed by the `game_plays` table + `increment_game_plays` RPC in `schema.sql`. The click on a card calls `recordPlay`. The landing has a sort control (`.filters-bar` groups the category filters on the left and the `.sort` custom dropdown on the right, on the same row — a themed button + menu, not a native `<select>` whose popup can't be styled) with three modes persisted in `localStorage` `mg:sort`: `"recent"` (default; last added first, by the `added` date of each `meta.ts` — the sort is stable, so games added the same day keep the curated `order`), `"popular"` (by play count, most-played first — starts from the cached counts to avoid a flash and re-orders once Supabase responds), and `"alpha"` (by title). Switching a mode re-appends the existing card nodes; without credentials `"popular"` just falls back to the manual `order`. The old `"featured"` mode (plain manual `order`) was replaced by `"recent"`; a `mg:sort` value saved from that version falls back to the default.
- **Favoritos** (landing only, no Supabase): a heart button on the top-left corner of each cover (`.game-card__fav`) pins that game to the head of the grid. Stored in `localStorage` `mg:favorites` as an id array ordered **most recently marked first**, which is the order they show in — marking a game puts it above the previously marked ones. No cap on how many. They are pinned in **every** sort mode (`orderedGames()` = favorites first, then `sortedGames()` for the rest) on purpose: a fourth "Favoritos" entry inside the sort dropdown would go unnoticed. Read back through a whitelist against the current roster, so a favorite of a game that was removed or turned `hidden` is dropped instead of lingering. Two gotchas baked into the code: (a) the card is an `<a>`, so the heart's click **must** `preventDefault` + `stopPropagation` like the "Ranking" button does — otherwise marking a favorite would open the game *and* add a play to the "Populares" count; (b) the heart is always visible, never revealed on `:hover` (on a phone there is no hover and it would be unreachable). It is a `<button>` with `aria-pressed`, not a decorative icon.
- **La grilla se "asienta" al primer reordenamiento (`grid.is-settled`).** Reordering re-inserts the card nodes, which restarts each card's `rise` entry animation — with its `--i` stagger that is several seconds of the whole grid fading back in. Harmless when it only happened on a sort change, unacceptable now that a heart click reorders. So `applyOrder()` adds `is-settled` to the grid, whose CSS rule kills the animation; the entry animation belongs to the page load and nothing else.
- `leaderboard.ts` — `submitScore(gameId, score, { variant })` and `fetchTop(gameId, { variant, limit })`.
- `LeaderboardPanel.ts` — self-contained DOM component (injects its own CSS once). On game over, if the score qualifies for the Top 10: when a nickname is already saved (`getNickname()`), the score is **submitted automatically without prompting**; only the first time (no saved name yet) does it show the name form and submit after the player confirms. Then shows the Top 10 and highlights the player's row. Reused by each game's game-over overlay and by the landing modal. The name itself can be set/edited on the landing (a "Tu nombre" field in the hero, between the title and the search box).
- `leaders.ts` — **Salón de la fama**: a ranking of the players who lead (are #1 in) the global leaderboard of the **most games**. It is **derived live** from the `scores` table — **no dedicated table, no persistence, nothing to do with rooms**. `fetchGameLeaders()` reads all scores (paginated past Supabase's 1000-row cap), and for each game in the roster picks its current leader on the representative board (variant `variants[0]`, direction-aware — exactly the board each landing card shows as its champion) and tallies how many games each player leads; it returns `{ ranking: {player, games}[], totalGames }` where `totalGames` is how many games currently have a leader. Degrades with the rest: no credentials -> empty. **UI:** the podium lives on its own page `/fame/` (`fame/index.html` + `src/fame/main.ts`, a non-game entry like `/rooms/`, registered in `vite.config.ts`): topbar + a dark gold-accented `.fame` plaque (a stats row `N juegos con líder / M líderes`, podium for the top 3 with the leader centered + elevated, ranked list for 4th onward, empty state when there are no scores) + footer, reusing the landing's `src/style.css`. The landing (`src/main.ts`) only shows a compact `.fame-banner` (styled like the Salas banner, gold accent, with a mini top-3 preview of initials) that links to `/fame/`; both appear only when the leaderboard is enabled.

(`src/shared/` also holds `server-status.ts`, which has nothing to do with the leaderboard: it is the landing's game-server health check — see "Game server" below.)

Config & degradation:
- Credentials go in `.env` (gitignored; see `.env.example`) and in Vercel's env vars. The DB schema is `supabase/schema.sql`.
- **Degrades gracefully:** with no credentials the games play normally, local bests still persist, and the ranking UI just doesn't appear. Never make gameplay depend on the leaderboard.
- Security note: scores are inserted client-side with the anon key, so they are spoofable — acceptable for minijuegos; move the insert behind a serverless function if it ever matters.

Per-game wiring: each `Game.ts` calls `this.hud.showRanking(<id>, score[, size])` right after saving the local best in its game-over handler; each `Hud` mounts a `LeaderboardPanel` in its overlay, exposes `showRanking(...)`, and calls `leaderboard.clear()` in `showStart`. Landing (`src/main.ts`) adds a per-card "Ranking" button that opens a read-only modal (with a variant selector for games that declare `variants`).

## Salas (multiplayer rooms)

Party mode: a host creates a room (short shareable code), friends join, and everyone plays the same minigame simultaneously on their own device; each round awards points by placement (1st of N players gets N points, direction-aware via `GAME_SCORING`), with a cumulative scoreboard and a winner at the end. Room settings (host): a number of games (`TOTAL_ROUNDS_OPTIONS` = 3 / 5 / 7 / 10 / 15 / 20 in `types.ts`; the count caps playlist selection). The long options are safe on both paths: a playlist can never exceed the roster (the grid disables further picks at the cap), and without a playlist the vote always has candidates because repeats are allowed. **There is no room-level time limit** — the host does not choose one and there is no time vote (both were removed). A round runs untimed and closes when every player finishes their run (or when only absent players remain, guarded by a locally tracked round-start grace in `roomMode.ts` since there is no deadline to derive it from). **The exception is per-game:** a game whose run would otherwise never end (or drag on) declares `roomTimeLimitSec` (seconds) in its `meta.ts`.

**Which games need one, and why it is not optional.** With no room-level clock, a player who is *present but idle* stalls the round forever: `maybeCloseRound` only closes early when the missing players are **disconnected** (presence), and an AFK player with the tab open is present. So **every game that cannot reach game over without player input must declare `roomTimeLimitSec`.** This was measured, not guessed: each game was started in solo mode and left untouched for 25s to see whether it ended on its own. The games that end by themselves (you die: Flappy, Snake, Neon Cylinder, Timberman, Cannon Dodge, Templo Rodante — whose first beam kills an idle player at ~2.2s — …) don't need it. The ones that unblock themselves through their own mechanic don't either: `connect-four` / `tic-tac-toe` (`AFK_MOVE_MS`), `memory-match` (`AFK_SKIP_MS`), `shell-game` (`ROOM_SELECT_TIME_LIMIT_SEC`), and the server-arbitrated `pong` / `word-bomb` / `word-chain` / `basta` / `impostor` / `telefono-cortado` / `paint-turf` (Basta arbitrates every phase — fill / basta / vote / reveal — with its own `setTimeout`, so it reaches game over even if everyone is idle; Telefono Cortado does the same with writing / drawing / guessing / reveal). Everything else has a limit. Note that a timed cut is fair rather than punitive, because `rankRound` puts a `"higher"` partial in the same tier as the finished runs — everyone is cut at the same instant. `roomTimeLimitFor(gameId)` in `roomMode.ts` reads it off the roster (default `NO_TIME_LIMIT = 0`) and `computeRoundDeadline` turns it into the round's `deadline` (plus `NAV_GRACE_SEC` = 10s for navigation + the 3/2/1/YA countdown), or `null` when there is no limit. When the clock runs out each player reports the partial score its `getScore` hook returns (`finished: false`) and the host closes the round. **Partials are ranked by `direction`** (`rankRound` in `points.ts`): in a `"higher"` game the partial is the points the player had when the clock cut them off, exactly as comparable as the score of someone who died at second 30 — so it sits in the **same tier** as the finished runs (a separate, lower tier used to reward dying early: 500 points dead beat 3000 points alive). In a `"lower"` game the partial means nothing (fewer moves without solving would "win"), so all partials tie behind everyone who finished, and the results row shows **"sin terminar"** instead of formatting the number — formatting it printed fantasy values like `9999 ms` or `3 mov` for a player who never solved the board. The briefing shows the limit ("Tiempo de la ronda") for the games that have one. The field only affects rooms; solo play is untouched. In the lobby's "Ajustes" panel the host can hand-pick up to that many games (an explicit ordered playlist) — all the slots must be filled or the list left empty; a partial list is rejected on "Empezar". The game grid in `buildSettingsForm` has a search box (`.playlist-search`) plus category filter pills (`.playlist-cats`, reusing the `.choice` pills and the same `category` set as the landing) that only show/hide the `.playlist__item` buttons — already-picked games stay in the playlist even while a filter hides them. Empty means no playlist: the **first** game is voted too (in the lobby, see below) and after each round players vote the next game among `VOTE_OPTION_COUNT` (5) random candidates drawn by `pickVoteOptions` from the whole `roomGames` roster. **Already-played games stay in the draw**, so a room can repeat a game — even the one it just finished — if the vote lands there; only the 5 candidates of a single vote are distinct from each other. (It used to exclude played games and offer 3, with a fallback that recycled the pool once the roster ran out; that fallback is gone because there is nothing left to exhaust.) The game-vote box (`RoomOverlay.showVoting`) shows each candidate's cover thumbnail (`coverUrl(id)`, via the optional `VoteOption.cover`) next to its title. **Briefing (pre-round read).** Before **every** round (including the first) the room enters a `"briefing"` status: a full-screen `RoomOverlay.showBriefing` card with the game's title, `description` and one-line `controls` (both from its `meta.ts`), a `"Listo"` button, and a `BRIEFING_SECONDS` (10s) countdown. Each player marks ready by writing a `room_votes` row with `game_id = "ready"` (`READY_VOTE`) and `round_no` = the round about to play (optimistic highlight, then DB-confirmed like the vote box; `showBriefing` is idempotent per `round` + game, refreshing only the button and the `"n/m listos"` counter). The host closes it via `maybeFinishBriefing` — when the 10s tope expires **or** when every *present* registered player is ready (absent players aren't waited for) — and `finishBriefing` then goes straight to `playing` with `computeRoundDeadline(roomTimeLimitFor(gameId))`. Because the play clock is only set at `finishBriefing`, the reading pause never eats into the round's time. Briefing is a stable phase for host takeover. **Que la partida no arranque antes que la ronda.** Cada juego escucha su "toca para empezar" en `window` y no sabe nada de la sala, asi que la ronda tiene que blindarse desde el modulo compartido — hay tres candados, y los tres hacen falta (el bug era que la partida empezaba sola durante el briefing, corriendo detras del cartel de "listos"): (1) mientras cualquier vista del `RoomOverlay` esta visible (conectando, briefing, waiting, voting, results, final) se **corta toda tecla** en fase de captura sobre `window` — toda, no solo `Enter`/`Space`, porque cada juego elige con que arranca — y **tambien cuando el foco esta adentro del overlay**: un boton que queda enfocado tras el clic (las opciones de votacion, la accion del host) dejaba pasar el Enter siguiente hasta el juego. Se usa `stopPropagation` (que no cancela la accion por defecto, asi el boton enfocado se sigue activando con teclado) y se reserva `preventDefault` para el scroll del espacio fuera del overlay; los equivalentes de puntero/click/touch ya se `stopPropagation`aban en la raiz del overlay. (2) `RoomOverlay.showConnecting()` se monta **antes del primer `await` de `boot()`**: entre que carga la pagina del juego y que llega el estado de la sala hay unos cientos de ms en los que el juego ya muestra y escucha su "presiona ENTER para jugar", y ahi no habia ningun overlay que tapara el input (en celular alcanzaba un toque). (3) `submitScore` descarta el puntaje cuando **la ronda propia** todavia esta en `briefing` (comparando `current_round` con `myRound`, para no invalidar el parcial de la ronda que esta cerrando mientras se anuncia la siguiente): asi una partida que igual se largo antes de tiempo no ensucia la ronda, y como no se latchea `reported`, al pasar a `playing` el jugador la juega de verdad (`onStart` reinicia) en vez de quedar esperando con un cero. Entry points: with a playlist the lobby's "Empezar" and `startNextRound` both call `startBriefing` (game fixed, `deadline` = now + 10s, `vote_options` null); **without a playlist "Empezar" instead opens the first-game vote** (`openVote` with `pickVoteOptions`) which runs inside the lobby (`renderLobby` mounts its own `RoomOverlay` and drives the countdown/close since there is no game page yet: `current_game` stays null so nobody navigates; the host closes on the deadline or once every present player voted, picks the winner majority/ties-random, then `startBriefing`s round 1 and everyone navigates). So the game vote precedes the briefing on round 1 just like `closeVoting -> startNextRound -> startBriefing` does on later rounds. Requires the DB to allow the `briefing` status (idempotent `alter ... status_ok` migration in `supabase/rooms.sql`). `showVoting` is **idempotent / updates in place** — it is re-called on every sync/vote/poll, so it keys off a signature (`round` + option ids + kicker/title, which the lobby's first-game vote overrides) and, when unchanged, only refreshes vote counts and the `--mine` highlight instead of rebuilding the box (rebuilding made the modal flicker and blanked the countdown until the next 500 ms tick). Clicking a vote highlights the choice **optimistically** (`voteOptimisticMine`) before the DB round-trip, and the count shows +1 until the refresh confirms it. (A `"time_voting"` phase used to sit between the briefing and `playing`, where players voted the round's time limit; it is gone along with the host's fixed time setting. The status string is still allowed by the `status_ok` CHECK so the idempotent migration can't fail against a room left parked in it, but nothing writes it.) The `/rooms/` flow is a single screen before the lobby: the home (name + join-by-code + a "Crear sala" button). "Crear sala" creates the room immediately with the default settings and drops the host straight into the lobby — there is **no** intermediate settings screen (it was removed: it duplicated the lobby's own "Ajustes" panel and forced a scroll past the whole game grid to reach its create button). The settings form (`buildSettingsForm` in `src/rooms/main.ts`) is therefore mounted only in the lobby. The lobby is a two-column layout for the host (`.lobby__columns`; the page widens via `rooms--wide`): the editable settings form ("Ajustes" panel) on the left, and the room code + player list on the right. The host can re-pick games / rounds before starting — every change is saved on the fly via `updateSettings` + `ping`. Non-host players see a single column with only the code and player list (no settings panel or summary). This is what lets the host reconfigure the room after "Volver a la sala" (see below). Playlist completeness is validated again on "Empezar" (fill all slots or leave empty). The room survives the final board: **every** player gets a "Volver a la sala" button (`returnToLobby` -> `resetRoom`), not just the host — so a guest can go back and set up the next game without waiting for the leader to return. Whoever clicks it wipes rounds/scores/votes and puts the room back in the lobby with the same players and settings, and is navigated straight to the lobby. The others are **not** yanked off the final board when someone resets — they keep viewing the cached results and get their own "Volver a la sala" button (plus an always-present "Salir" to the landing) to return whenever they want (or they're pulled in automatically once the host actually starts the next round). Spectators get no reset button (they are not players). **Kick:** in the lobby the host sees an "Expulsar" button on every non-host player row (`kickPlayer` -> `removePlayerRows` deletes that player's `room_players` row plus their scores/votes, then `ping`s). The kicked player detects it on the next refresh (no longer in `state.players`), tears down its channel/poll/heartbeat and returns to the `/rooms/` home with a notice — and its `?code=` is stripped from the URL (`prefillCode = null` + `replaceState`) so a reload doesn't `autoJoin` it straight back into the room it was just thrown out of. Kick is not a ban — the player can rejoin from the lobby if they still have the link. `removePlayerRows` deletes with `.select("player")` and treats "zero rows returned" as failure, so the UI can say "No se pudo expulsar": **this is what made kick silently do nothing** before — `room_players` had no `delete` RLS policy, so Postgres filtered the delete out (0 rows, *no error*) and `kickPlayer` reported success while the player stayed put. The `room_players_delete_public` (and `rooms_delete_public`) policies in `supabase/rooms.sql` are what actually fix it; re-run that file after pulling.

**Salas públicas / privadas.** `rooms.visibility` (`"public" | "private"`, its own column and not part of the `settings` jsonb, because the listing query filters on it) is picked when creating the room on the `/rooms/` home and is editable afterwards in the lobby's "Ajustes" panel (`setVisibility`). Public rooms are listed on the home by `buildBrowsePanel` (`fetchPublicRooms`, re-listed every `BROWSE_REFRESH_MS` = 8s): rooms that are `visibility='public'`, `status='lobby'`, have at least one registered player, and whose `last_active` is within `ROOM_STALE_MS`. Each row joins through the same `joinFlow` as a hand-typed code; a room at `MAX_ROOM_PLAYERS` renders as a disabled "Llena". Private rooms never appear — they're reachable only by code or link.

**Vida y muerte de una sala.** `rooms.last_active` is a heartbeat: every client *inside* a room touches it every `HEARTBEAT_MS` (15s) — from the lobby (`renderLobby`) and from the game pages (`RoomMode.boot`, skipped for spectators, since a spectator isn't "gente" and shouldn't keep a room alive). Rooms die three ways: (1) the lobby's "Salir de la sala" button calls `leaveRoom`, which drops the player's row, hands the host role to the oldest remaining player if the host left, and **deletes the room when it was the last player**; (2) `purgeStaleRooms()` runs whenever anyone opens `/rooms/` and deletes every room whose `last_active` is older than `ROOM_STALE_MS` (60s) — that covers closed tabs and dead browsers with no cron and no server; (3) `deleteRoom` directly. `ROOM_STALE_MS` is deliberately 4x `HEARTBEAT_MS` to tolerate sleeping tabs and slow round-trips. A client whose room vanished (`fetchRoomState` -> null) tears down and returns home with "La sala ya no existe." `RoomOverlay`'s final board is rendered once and the cached totals survive the reset (which empties the DB scores). Registered players can rejoin even a finished room, only brand-new players are rejected until it returns to the lobby. **Player cap:** a room holds at most `MAX_ROOM_PLAYERS` (8) registered players — `joinFlow` rejects a *new* player once `state.players.length` reaches the cap, but already-registered players always rejoin (the cap counts durable `room_players` rows, which is what bounds the overlay lists and the per-round refetch fan-out; there is no "leave" that frees a slot). **Spectators:** a *new* player can only be registered while the room is in the lobby. Once the match started, `joinRoom` returns `"spectator"` for an unregistered nick (it is **not** inserted into `room_players`, so it never stalls round-closing nor counts in scores) and the game page opens in spectator mode: `RoomMode` detects it (not in `state.players` while `status` is neither `lobby` nor `finished`, sets `this.spectator`), never plays/reports/votes/takes over (all those paths are guarded), follows the current game page and shows `RoomOverlay.showSpectator()` while the match runs, shows the read-only final board when it finishes, and bounces to `/rooms/` (to register) once the room returns to the lobby. Already-registered players still rejoin the live round as before. **Vote auto-compress:** once every *present* registered player has voted, the host adelanta the deadline to `VOTE_GRACE_MS` (3s) via `updateDeadline` instead of waiting the full `VOTE_SECONDS` — no point leaving the clock running when nobody is left to vote (absent players are not waited for). Votes close exactly at the deadline (no `CLOSE_LAG_MS` — there are no partial scores to collect), so the compressed 3s window is what everyone sees before navigating. Design doc: `docs/salas-plan.md`.

Architecture (Supabase, no server code):
- **Postgres is the source of truth** — tables `rooms`, `room_players`, `room_rounds`, `room_round_scores`, `room_votes` in `supabase/rooms.sql` (run it in the SQL Editor besides `schema.sql`). Durable state is what makes rejoin and page navigation work: every game is its own HTML entry, so navigating drops the Realtime channel and each page reconnects + refetches.
- **Realtime channel per room** (`room:<CODE>`) with presence (key = nickname) and a single broadcast event `sync` meaning "re-read the DB" (write -> ping -> refetch, plus a 5 s poll fallback). No `postgres_changes`.
- **Host-authoritative**: only the host writes phase transitions (start/close round, open vote, finish); players write only their own rows. Points are computed client-side by the pure functions in `points.ts`. If the host disappears, another player takes over **automatically** — see "Que un jugador se desconecte no puede trabar la sala" below.
- Same spoofable trust level as `scores` (anon key + open RLS policies) — accepted and documented in the SQL.

Files in `src/shared/room/`: `types.ts` (types + settings constants), `api.ts` (CRUD, no-op without credentials), `channel.ts` (`RoomChannel`), `points.ts` (`rankRound` / `computeTotals`, pure), `RoomOverlay.ts` (self-contained fixed full-screen DOM overlay: waiting / results / voting / final + top strip; styled to match the landing — cream card, ink borders, pill buttons — with the palette hardcoded since it injects into each game page. The top strip (`setStrip(text, lights)`) shows the room code / round / clock plus a row of player lights — one dot per registered player, **green** alive, **red** dead/finished, **gray** disconnected; `roomMode.stripLights()` derives them each tick from `presentPlayers()` + the round's reported scores, own dot ringed), `roomMode.ts` (orchestrator + the per-game contract), `matchState.ts` (generic shared-board match state, see below), `roomRun.ts` (see "Sobrevivir un F5" below).

**Que un jugador se desconecte no puede trabar la sala.** La sala es host-autoritativa, asi que **el que se va importa muchisimo si era el host**: nadie mas escribe las transiciones de fase (cerrar la ronda, cerrar el briefing, cerrar la votacion) ni destraba los tableros compartidos, y la sala queda congelada para todos. Tres candados, y los tres hacen falta:

1. **Migracion de host automatica (`roomMode.maybeTakeOverHost`).** Si el host no aparece en `presentPlayers()` durante `HOST_ABSENT_MS` (20s) seguidos, otro jugador toma el control **solo**, sin que nadie apriete nada, en **cualquier** fase (incluida `playing`). Antes esto era un boton manual (`RoomOverlay.offerTakeover`, ya eliminado) y **no servia**: solo se ofrecia en fases "estables" — durante `playing` exigia haber reportado el puntaje — y ademas `offerTakeover` no dibuja nada con el overlay oculto, que es exactamente como esta la pantalla mientras se juega. O sea que en el caso mas comun (el host se va en plena ronda) el boton no llegaba a existir y la sala se moria ahi. El candidato es **deterministico**: el primero de `presentPlayers()` (orden `joined_at`) que no sea el host ausente, con un escalonado de `TAKEOVER_STAGGER_MS` (5s) por posicion — asi dos no escriben a la vez y, si el primero tiene la pestana en segundo plano (el navegador le estrangula los timers), sigue el segundo. Con la lista de presentes vacia (canal recien suscripto, o caido) **nadie** se autoproclama: la condicion pide estar uno mismo en la lista.
2. **El tablero compartido no lo crea solo el host (`CREATE_FALLBACK_MS`, en `matchState.ts`).** Los cinco juegos que crean una fila en `room_match_state` (Memoria, Conecta 4, Ta-Te-Ti, El Trile y la votacion de discos de Hanoi) la creaban **solo** el host: si el host se desconectaba antes de cargar la pagina de la ronda, todos se quedaban mirando "Preparando el tablero..." / "Esperando un rival..." hasta que la migracion de host apareciera. Ahora, pasados 6s sin fila, la crea cualquier jugador; el insert ya era idempotente por PK (gana el primero, el resto relee), asi que la carrera estaba contemplada de antes. En El Trile eso ademas obligo a agregar un reintento (`waitForRoomState`): su `syncRoomState` se disparaba **solo** con el broadcast "sync", que en ese caso no llegaba nunca.
3. **Al desconectado no se le espera el turno (`presentPlayers()` en el contrato de `RoomMode`).** En los juegos por turnos el jugador que se fue sigue en el orden de turnos (su fila de `room_players` es durable a proposito, para que pueda volver), asi que le tocaba jugar y frenaba a todos hasta que venciera la ventana AFK — 20-25s **por vuelta de turnos**, que con dos caidos deja el tablero practicamente parado (este es el sintoma que se reporto en Memoria). `RoomMode` expone ahora `presentPlayers()` (los registrados conectados, en el orden de `players()`, igual para todos los clientes) y cada juego por turnos usa una ventana corta cuando el de turno esta **desconectado**: `AFK_ABSENT_SKIP_MS` (3s) en Memoria, que ademas saltea de una a todos los ausentes seguidos en una sola escritura, y `AFK_ABSENT_MOVE_MS` (5s) en Conecta 4 / Ta-Te-Ti. Ojo con la lista vacia: si `presentPlayers()` no tiene a nadie (canal aun sin sincronizar) **no** se asume que se fueron todos, se cae a la ventana AFK de siempre.

Ademas, en Conecta 4 y Ta-Te-Ti el destrabe de turno dejo de ser exclusivo del host: **tambien lo hace el rival del jugador parado en su propio tablero** (nunca el propio turno, salvo el host). Eran los dos juegos donde un host caido congelaba duelos que no lo involucraban, porque los tableros ajenos los administra el host con instancias `passive` que se crean al arrancar la ronda — un host nuevo que toma el control a mitad de ronda no las tiene.

Lo que **no** cubre nada de esto: un jugador presente pero inactivo (pestana abierta y sin tocar nada) no es un desconectado — para eso esta `roomTimeLimitSec` y las ventanas AFK normales.

**Sobrevivir un F5 (`roomRun.ts`).** A reload during a round is not a fresh start: `RoomMode` still sees the round in `playing`, so it fires `onStart` again and a game that rebuilds its run from scratch resets its board, its move count and — worst of all — its clock. In a `direction: "lower"` game that is not just annoying, it is an exploit: the reloader's time is measured from the reload and beats everyone who played the whole round. `roomRun.ts` is the shared fix: `saveRoomRun` / `loadRoomRun` / `clearRoomRun` persist an arbitrary JSON snapshot in **`sessionStorage`** (survives F5, doesn't leak to another tab or session) under a key that includes the room code, the **round** and the game id, so the next round starts clean by itself. The clock is stored as `startedAt` (epoch ms), never as an accumulated total, and `elapsedSince(startedAt)` recomputes it against the wall clock — so reloading can't pause the timer either. A game opts in by (1) returning early from its `beginCountdown()` when a saved run restores (skipping the countdown and the board regeneration), (2) calling its `saveRun()` whenever a fact worth keeping is recorded (a move, a finished sub-round, a level cleared), and (3) `clearRoomRun` when the run ends.

**Never store a cursor you can derive.** Each wired game re-derives the "where was I" value from the durable data instead of snapshotting it: `sliding-puzzle` finds the empty cell by scanning the grid, `reaction-time` / `blind-time` compute the round to play as `completedRounds + 1` (a foul repeats a round without recording a result, so a separately-stored counter would drift and let a scored round be replayed). `circuit-breaker` is the exception that proves it: it must save the **next** level when it clears one, because the "NIVEL N" banner is a state where the level index no longer matches the level already written into `levelScores`.

`RoomMode` calls **`clearRoomRuns(code)`** whenever it sees the room in `lobby` or `finished`. This is not optional: `resetRoom` ("Volver a la sala") wipes the rounds and the rematch renumbers from round 1, so without the purge the key `code:1:game` would find the previous match's snapshot and resume a run from half an hour ago. As a second net, `loadRoomRun` also rejects any envelope older than `MAX_RUN_AGE_MS` (30 min).

**Reloading must never be free.** Where the run has a position (a level, a hole, a lap), the resume puts the player back at its start — which is what a crash / a fall / the grid already does — but the *cost already paid* is preserved: `circuit-breaker` keeps its clock and crashes, `mini-golf` keeps the strokes already taken on the hole in progress, `car-race` keeps the lap and rewinds `startTime` by the real time elapsed. Anything time-based stores an **epoch** (`startedAt` / `savedAt` / `startEpoch`), never an accumulated total, so the seconds spent reloading are charged to the player.

Wired in every `direction: "lower"` room game, which is where reloading would otherwise *improve* the reported score: `lights-out`, `sliding-puzzle` (Numerix), `tower-of-hanoi`, `circuit-breaker`, `reaction-time`, `blind-time`, `mini-golf` and `car-race`. Games with `direction: "higher"` don't need it: reloading just throws away the score you had, which is a penalty, not an exploit.

**Shared-board games** (all players see and act on the same board, e.g. Memoria): durable per-round game state lives in `room_match_state` (one jsonb row per room+round+**board**, `supabase/rooms.sql`), accessed via `matchState.ts` (`fetchMatchState` / `createMatchState` / `updateMatchState` with an optimistic `version` column: writes carry the version they read; on conflict the caller refetches). The `board` column (a trailing `board = 0` param on each `matchState.ts` function) lets a single round hold **multiple simultaneous boards**: single-board games (Memoria, Topos) omit it and always use `0`; **Conecta 4 and Ta-Te-Ti use it to pair every player into 1v1 duels** (one board per pair, all played at the same time, and the odd one out plays a local AI board — see their `CLAUDE.md`). Every `matchState.ts` call from a multi-board game must pass its `boardNo` — omitting it on `updateMatchState` silently writes board 1's moves against board 0 and wedges the match. Same write -> ping -> refetch pattern as everything else — good enough for turn-based games (~200-400 ms per move), not for real-time ones. For these games `RoomMode` exposes extra context (`code`, `me`, `round()`, `players()` — ordered by `joined_at`, so every client derives the same pairing without storing it, `presentPlayers()` — los de `players()` que estan conectados ahora, para no esperarle el turno al que se fue, `isHost()`, `ping()`, `onSync()`, `deadline()` — the round end derived from the game's `roomTimeLimitSec`, or null when the game declares none; whack-a-mole uses it to run its own timer off its 120s limit); the host creates the initial board(s) and unblocks AFK turns (for Conecta 4 and Ta-Te-Ti it also drives every human board it isn't playing, via a `passive` match instance), the turn player writes moves (single atomic UPDATE resolving the whole attempt), and page reloads re-attach by refetching. `resetRoom` also wipes `room_match_state`.

Per-game wiring (the only game-side code, ~4 lines in each `Game.ts`, `Hud.ts` untouched):
- `private readonly room = initRoomMode("<id>", { getScore: () => this.score, onStart: () => this.beginCountdown() });` in the constructor. Returns `null` without `?room=` in the URL or without Supabase — zero impact outside room mode.
- In the game-over restart input path: `if (this.room) return;` (one run per round; the overlay covers the game's own game-over screen).
- In the game-over handler: `if (this.room) this.room.reportScore(score); else this.hud.showRanking(...)`. Room scores are **not** sent to the global leaderboard (timeout-cut runs would pollute it).
- `getScore` is the live score for the timeout partial. Special cases: reaction-time reports the average of completed rounds; sliding-puzzle is fixed to 3x3 in room mode (`ROOM_VARIANTS`) and hides its size selector; memory-match swaps its solo time-attack for a shared turn-based board (see its `CLAUDE.md`) and scores "own pairs".
- `onStart` (optional) is fired **once** by `RoomMode` when the round becomes `playing`, so every player's run auto-starts together instead of each one pressing Enter — normally `() => this.beginCountdown()` (mini-frogger used to be the exception with no countdown and passed `() => this.start()`; it has the countdown now, so there is no exception left). Games that drive their own room start (car-race calls `beginCountdown()` in its `boot()`; rocket-arena is real-time) don't pass it.
- `onReportedWaiting` (optional) lets a game replace the generic "esperando a los demas" screen after it has reported its own score while the round is still `playing`. `RoomMode` calls it on each state apply; return `true` to have the waiting overlay hidden (the game shows its own view), `false`/absent for the usual waiting screen. **Conecta 4** and **Ta-Te-Ti** use it: with simultaneous 1v1 boards, finishing your duel switches you to spectate another still-running board of the round. **Cannon Dodge** uses it too: once sunk you keep watching the island (its seeded cannons keep firing locally) and the other pirates dodging, until the round ends.

Setup note: the rooms schema (including `room_match_state`) is `supabase/rooms.sql`; re-run it in the Supabase SQL Editor after pulling changes that touch it (statements are idempotent). If the `visibility` / `last_active` columns are missing, `api.ts` detects the `42703` (undefined_column) error, flips a module-level `legacySchema` flag through `markLegacySchema()` (which warns **once**, telling you to run the migration), and from then on skips the columns on insert and turns `fetchPublicRooms` / `touchRoom` / `purgeStaleRooms` / `setVisibility` into no-ops. Rooms stay creatable and playable; only public listing, auto-purge and kick need the migration. Do not "fix" a silent public-room list without first checking the console for that one warning.

Degradation matches the leaderboard: without credentials the landing button and `/rooms/` UI don't function and every game behaves exactly as before.

### Canales efimeros de alta frecuencia (ver a los otros jugadores en vivo)

Some room games stream each player's live position over their own **ephemeral broadcast channel** — no DB, one channel per room+round, separate from the `RoomChannel` so the high-frequency traffic doesn't mix with the room sync. Each game owns its copy (per the decoupling rule): `car-race`'s `RaceChannel`, `cannon-dodge`'s `DodgeChannel`, `templo-rodante`'s `TempleChannel`, `rocket-arena`'s `ArenaChannel`, `typing-race`'s `TypingChannel`, `monopoly-mundial`'s `MonopolyChannel`. Copy `DodgeChannel.ts` when you add another one — it, `templo-rodante`'s `TempleChannel` and `car-race`'s `RaceChannel` are the only ones that get the two rules below right.

**Antes de elegir la cadencia, preguntate si hace falta mandar POSICIONES.** `templo-rodante` es el caso testigo: en vez del snapshot de cada cuadro manda el **evento de pose** (`jump` / `duck` / `stand` / `dead`) y el receptor corre la misma parabola con las mismas constantes de su `Runner`, que es la misma clase que usa el jugador local. La animacion sale identica y el trafico baja de 10/s por jugador a ~3/s. Cuando el estado del rival se puede **derivar** de un evento discreto, mandarlo entero cuadro a cuadro es tirar presupuesto de canal a la basura. Dos reglas que trae aparejadas: el keepalive **no** puede reenviar el evento que arranca una animacion (reenviar `jump` reiniciaria el salto del rival, por eso solo reafirma `stand`/`duck`/`dead`), y el receptor no puede dejar que un keepalive corte una animacion en curso (un `stand` que llega a mitad del salto se aplica al aterrizar).

**Antes que nada: ¿este juego va en un canal o en el game server?** Medir, no adivinar — el criterio es `jugadores x envios/s` con la sala llena (8), contra el tope de ~100 msg/s por canal:

| Juego | Trafico con 8 jugadores | Veredicto |
| --- | --- | --- |
| `car-race` | 8 x 10/s = **80/s** | **Migrado al server** (`/carrace`). Rozaba el tope: el socket moria y desaparecian todos. |
| `cannon-dodge` | 8 x 10/s = **80/s** | **Mismo perfil que car-race: el candidato obvio si vuelve a pasar.** Hoy aguanta por el canal resiliente + el keepalive de `NET_IDLE_MS`, pero el techo es el mismo. |
| `paint-turf` | 8 x 20/s = **160/s** | **Nacio en el server**, no en un canal: a esa cadencia Supabase lo mata. Es un tercio de lo que ya mueve PONG. |
| `rocket-arena` | 8 x 12.5/s = **100/s** | **Pasado de tope** (`NET_SEND_MS` 80). Deuda conocida; esta `hidden` igual. Si se revive, va al server. |
| `templo-rodante` | 8 x ~3/s = **24/s** | **No califica.** Manda eventos de pose, no posiciones: el rival se anima solo. |
| `typing-race` | 8 x ~0.5/s = **4/s** | **No califica.** Emite al completar frase / morir / heartbeat de 2s. Lejisimos del tope. |
| `monopoly-mundial` | <1/s (solo el host, cada 3s) | **No califica.** Poco volumen; el payload es grande pero eso es otro limite (tamano, 256KB). |

O sea: el motivo para mudarse al server es **volumen**, no "estar en un canal". Los dos ultimos no ganan nada con el server — su exposicion real es el `subscribe()` pelado de la regla 2, que se arregla copiando `DodgeChannel`, no cambiando de transporte.

**1. Presupuesto de mensajes: Realtime tiene un tope y se pasa solo.** Supabase Realtime rate-limits broadcasts per channel (`max_events_per_second`, ~100 by default, a per-project setting). Do **not** assume the `realtime: { params: { eventsPerSecond: 40 } }` in `src/shared/supabase.ts` lifts it: the installed `realtime-js` doesn't even read that key (grep it in `node_modules`), and its comment about a 10 events/s client throttle is stale. The traffic in one of these channels is **`players x (1000 / NET_SEND_MS)`**, and a room holds up to `MAX_ROOM_PLAYERS` (8). So do the multiplication for 8 players before you pick a send rate: at 90 ms that is ~88 msg/s and the socket starts getting dropped mid-round; at 100 ms it is 80. **`NET_SEND_MS >= 100` (10/s) is the house limit** for a per-player broadcast **sobre Supabase**, and it's what `cannon-dodge` and `car-race`'s Supabase fallback use (`rocket-arena` sits at 80 ms, which is over budget for a full room — known debt, it's `hidden` anyway). El tope es del canal de Realtime, no del juego: sobre el game server no existe, y por eso `car-race` emite a 60 ms (`NET_SEND_SERVER_MS`) cuando el enlace es el server y a 100 ms cuando cae a Supabase. Two things buy headroom without lowering the rate: send **only when the snapshot changed**, dropping to a ~1 s keepalive while a player is still or dead (`NET_IDLE_MS` in `cannon-dodge`; note that a dead player who stays watching keeps emitting), and round the payload numbers so identical frames compare equal.

**2. `subscribe()` sin callback de estado es un bug.** A bare `channel.subscribe()` never tells you that the channel died (`CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`), and nothing re-subscribes it. The failure is silent and total: no snapshot ever arrives again, every remote goes stale and gets purged, and the player finishes the round alone thinking the others vanished. Worse, `RealtimeChannel.send()` on a channel that can't push **silently falls back to a REST POST per message**, so a game heartbeating at 10/s starts hammering the broadcast endpoint. So: pass the status callback, keep a `ready` flag, **gate `send()` on it**, and rebuild the channel with backoff when it drops (see `DodgeChannel.open` / `scheduleReopen`). Pair it with a generous `REMOTE_STALE_MS` (6 s, not 2.5) so a normal network hiccup freezes a rival in place instead of deleting him.

Also: drive the heartbeat off `setInterval`, never off the `requestAnimationFrame` loop — browsers pause rAF in background tabs, so a still player would stop broadcasting and disappear for everyone else. `rocket-arena`, `typing-race` and `monopoly-mundial` still call `subscribe()` bare; they predate this and haven't been migrated (`car-race`'s `RaceChannel` was migrated: status callback + `ready`-gated `send()` + reopen with backoff, plus its heartbeat moved off the rAF loop onto a `setInterval` with an idle keepalive).

## Game server (tiempo real / autoritativo)

Servidor Node separado en `server/` (socket.io, deploy en Railway) para los
juegos de sala que necesitan un **arbitro autoritativo** que Supabase no puede
dar bien: tiempo real (PONG; rocket-arena a futuro) o validacion server-side no
spoofeable. **Complementa** la infra de salas de Supabase, no la reemplaza:
Supabase sigue siendo la fuente de verdad de lobby / marcador / rejoin; el server
solo maneja el **estado en-ronda en memoria** y **no toca la DB**. Plan de fondo:
`docs/server-realtime-plan.md`. **En uso: Bomba Palabra** (`word-bomb`, validacion
por turnos), **Cadena de Palabras** (`word-chain`, fork de Bomba con otra mecanica),
**PONG** (`pong`, fisica de tiempo real / PvP 1v1), **Basta** (`basta`, Tutti Frutti
por votacion, sin diccionario), **Impostor** (`impostor`, deduccion social: roles privados,
pistas por turno y votacion, sin diccionario), **Telefono Cortado** (`telefono-cortado`,
telefono descompuesto con dibujos: el server guarda las frases secretas y valida las
adivinanzas), **Manchon** (`paint-turf`, captura de territorio en tiempo real: el tablero es
estado compartido y lo arbitra el server) **y Neon Drift** (`car-race`, **relay** de
posiciones — el unico que no usa el server para arbitrar nada, ver abajo).

**El server tambien sirve de relay, no solo de arbitro.** Neon Drift es el primer caso:
no necesita arbitro (cada cliente corre su propia carrera sobre un seed compartido), pero
el broadcast de Supabase le quedaba chico — topea ~100 mensajes/s por canal y una sala
llena lo rozaba (8 jugadores x 10/s = 80/s), con lo cual Realtime cerraba el socket y
**todos los rivales desaparecian de la pantalla**. Un relay en el server saca ese techo,
trae reconexion de socket.io de fabrica y permite subir la cadencia. Si otro juego de
canal efimero sufre lo mismo, este es el molde (`server/src/games/carrace.ts` es el sim
mas corto del server). Ojo: **es un motivo de volumen, no de "esta en un canal"** — ver
"Canales efimeros" abajo para cuales juegos califican y cuales no.

Estructura de `server/` (paquete propio, aislado del build de Vite, con su propio
`package.json` / `tsconfig.json` / `node_modules`, gitignoreado):
- `src/index.ts` — crea `io` + health check HTTP (`/health`, devuelve `{ ok: true }`,
  el tamano del diccionario y `clients` = sockets conectados ahora mismo, que es lo que
  usa el auto-update de la maquina self-hosted para no reiniciar con gente jugando; ver
  `docs/self-host.md`) + registra los namespaces de cada juego. Escucha en
  `PORT` (Railway lo inyecta), CORS a `ALLOWED_ORIGINS` (coma-separado; `*` en dev).
  El `/health` **manda sus propias cabeceras CORS** (echo del `Origin` si esta en
  `ALLOWED_ORIGINS`, `*` sin la lista): el `cors` del `Server` de socket.io solo cubre
  el handshake, no este handler HTTP, y la landing lo consulta desde el navegador
  (ver `src/shared/server-status.ts`). Si se le saca esa cabecera, el indicador de la
  landing pasa a decir "caido" con el server perfectamente vivo.
- `src/rooms.ts` — infra generica reutilizable: `GameRoom` (un socket.io room por
  `(namespace, code)`, mapeo nickname<->socket, broadcast) + `registerGame(io,
  namespace, joinEvent, parseJoin, makeSim)` que crea/descarta rooms y reenvia
  los eventos al `RoomSim` del juego (contrato `join` / `leave` / `message` /
  `dispose`). Para agregar otro juego server-side se implementa un `RoomSim` y se
  llama `registerGame` en su propio namespace. `join(nickname, roster, meta?)`
  recibe en `meta` el payload crudo del join, para el sim que necesite algo mas que
  nickname + roster (hoy solo Neon Drift, que lee la `round` de ahi); el que no lo
  usa declara `join(nickname, roster)` y listo.
- `src/protocol.ts` — tipos de mensajes (por juego: `wb:*` de Bomba Palabra,
  `wc:*` de Cadena de Palabras, `pg:*` de PONG, `bt:*` de Basta, `im:*` de Impostor,
  `tc:*` de Telefono Cortado). **Se duplican en el cliente**
  (p.ej. `src/games/word-bomb/game/WordBombTransport.ts`,
  `src/games/word-chain/game/WordChainTransport.ts` y
  `src/games/pong/game/PongProtocol.ts`) por la regla de decoupling (no se
  comparte modulo entre `src/` y `server/`); si cambia el protocolo, tocar ambos
  lados.
- `src/dictionary.ts` — diccionario de espanol embebido
  (`an-array-of-spanish-words`, ~637k palabras) mas `src/extra-words.ts`,
  compartido por los dos juegos de palabras: normaliza (conserva la ñ, saca
  acentos) y precomputa **los fragmentos jugables** (`randomFragment`, para Bomba
  Palabra: subcadenas de 2-3 letras con >= 500 palabras) y **las letras iniciales
  sorteables** (`randomInitial` / `hasInitial`, para Cadena de Palabras: letras con
  >= 1000 palabras, o sea 22 — quedan afuera x, ñ e y). Vive solo en el server
  (validacion no spoofeable, sin peso en el bundle del front).
- `src/extra-words.ts` — array `EXTRA_WORDS` editable a mano: palabras que el
  diccionario base no trae (jerga, regionalismos). Se suman al set igual que el
  resto; requiere redeploy del server. Para agregar palabras se toca solo este
  archivo.
- `src/words-impostor.ts` — array `WORD_CATEGORIES`: banco de palabras secretas de Impostor,
  agrupadas por categoria (Comida, Animal, Lugar, ...). Palabras concretas y adivinables; la
  categoria es una pista deliberada, asi que las de una categoria se distinguen entre si.
  `pickWord(exclude)` sortea sin repetir en el partido. Vive solo en el server (no pesa en el
  bundle) y **no** usa el diccionario; requiere redeploy al editarlo.
- `src/places.ts` — array `PLACES`: paises, capitales, provincias argentinas y
  ciudades conocidas (~600). El corpus base es de lexico comun y aceptaba los
  toponimos que **por casualidad** son palabra comun (`chile` el aji, `lima` la
  fruta, `salta` y `quito` verbos, `argentina` adjetivo) y rechazaba el resto
  (`mexico`, `uruguay`, `madrid`), lo que en la mesa es indistinguible de un bug.
  Los nombres compuestos se **concatenan** al normalizar (`buenos aires` ->
  `buenosaires`), asi que se aciertan con o sin espacio. Nada de `ã` ni letras que
  la normalizacion borre (dejarian la palabra mutilada). Se ingiere junto con
  `EXTRA_WORDS`; requiere redeploy.
- `src/games/wordbomb.ts` — `WordBombSim`: turnos, mecha (deadline absoluto),
  vidas, palabras usadas, validacion y orden de eliminacion. Difunde `wb:state`
  en cada cambio; el cliente anima la mecha localmente entre snapshots. Ademas
  retransmite las **reacciones** (`wb:emote`): puro relay validado contra un
  allowlist de ids, con cooldown por jugador, que **no** viaja en `wb:state` (es
  efimera). Ver el `CLAUDE.md` de `word-bomb` para el detalle del flujo y el tuning.
- `src/games/wordchain.ts` — `WordChainSim`: **fork de Bomba Palabra** con otra
  mecanica. El reto es una **letra** y la palabra tiene que **empezar** con ella; su
  ultima letra es el reto del siguiente ("tronco" -> "o"). **Una sola vida**: el
  timeout elimina en el acto, y el que sigue hereda la misma letra (la cadena no
  avanzo). El reloj arranca en 12s y se acorta 200ms por eslabon, con piso de 5s.
  Las letras pobres se juegan igual (`fax` -> te toca la X); solo se sortea otra si
  la letra no tiene **ninguna** palabra detras. Difunde `wc:state`; mismas reacciones
  y tipeo que Bomba. Ver el `CLAUDE.md` de `word-chain`.
- `src/games/pong.ts` — `PongSim`: empareja la sala de a dos (un `Match` por par;
  el impar juega vs IA del server), corre la fisica de la pelota / colisiones /
  rampa / puntaje a ~60 fps y emite `pg:state` a cada jugador con su lado. La
  pelota queda congelada un `PREROLL_MS` (3s) para coincidir con el countdown del
  cliente. Las constantes de fisica estan duplicadas de `constants.ts` del juego.
  **Corre con paso FIJO** (`STEP_DT` + acumulador) y manda su reloj de simulacion en
  `pg:state.t`: ver "Interpolar sobre el reloj del server" abajo. Ver el `CLAUDE.md`
  de `pong` para el detalle.
- `src/games/basta.ts` — `BastaSim`: Basta / Tutti Frutti. Sortea una **letra** (de un
  set propio, **no** usa el diccionario), corre las fases (llenado -> alguien grita BASTA
  -> gracia -> votacion -> reveal) con `setTimeout` propio, guarda las respuestas de cada
  jugador (`bt:fill`) sin revelarlas en el llenado, recolecta los votos de rechazo
  (`bt:vote`: la hoja de tachados entera, mandada de una sola vez al confirmar, una por
  letra; tumba con mayoria de los demas) y computa el puntaje (unica 100 / repetida
  50 / vacia, tumbada o de una sola letra 0 — `MIN_ANSWER_LEN`, que ademas impide gritar
  BASTA con la letra suelta en las 7 celdas). La votacion **cierra apenas confirmaron todos los conectados**;
  su `VOTE_MS` (2 min) es solo un tope. Los votos crudos se difunden recien en el reveal (durante
  la votacion lo unico publico es el `voted` de cada jugador). Difunde `bt:state`; devuelve la hoja propia con `bt:you` al
  reconectar (F5 en el llenado). Un partido son 3 letras. Ver el `CLAUDE.md` de `basta`.
- `src/games/impostor.ts` — `ImpostorSim`: deduccion social. Sortea categoria + palabra
  (`words-impostor.ts`), reparte roles (2 impostores con 7+ jugadores, si no 1) y corre las fases
  (`reveal` -> `clues` por turnos -> `voting` -> `guess` condicional -> `result`) con `setTimeout`
  propio. El rol (palabra / impostor) viaja SOLO por el evento dirigido `im:you`, nunca en el
  broadcast `im:state` (no espiable); tambien se reenvia al reconectar (F5). Recolecta pistas
  (`im:clue`), votos (`im:vote`) y la adivinanza del acusado (`im:guess`), y computa el puntaje por
  equipo (impostor gana 3, inocente 2). Un partido son 3 rondas. Ver el `CLAUDE.md` de `impostor`.
- `src/games/telefonocortado.ts` — `TelefonoCortadoSim`: telefono descompuesto con dibujos.
  Corre las fases (`writing` -> `drawing` -> `guessing` -> `reveal`) con `setTimeout` propio,
  reparte las cadenas rotando los asientos (dibujas la frase del anterior, adivinas el dibujo
  del de dos atras, asi con 3+ jugadores nunca te toca lo tuyo) y **valida las adivinanzas
  server-side**: la frase a adivinar viaja SOLO por el evento dirigido `tc:you` (con la pista
  tipo ahorcado, letras ocultas como "_"), nunca en el broadcast `tc:state`, porque en el
  state se leeria desde las devtools. Las cadenas del reveal se difunden **de a una**
  (`tc:chain`): juntar 8 dibujos en un mensaje se acerca al `maxHttpBufferSize` de socket.io.
  Un partido es una vuelta completa. Ver el `CLAUDE.md` de `telefono-cortado`.
- `src/games/paintturf.ts` — `PaintTurfSim`: Manchon. Captura de territorio en
  tiempo real sobre una grilla de 35x23. Corre la simulacion con **paso fijo** a 40 Hz
  (acumulador + `STEP_DT`, y su `simTime` viaja en `pt:state.t`: ver "Interpolar
  sobre el reloj del server") y difunde a 20 Hz. Es autoritativo **porque la grilla
  es estado compartido**: si cada cliente simulara lo suyo, el orden de llegada de
  los mensajes decidiria quien se quedo con cada celda y cada pantalla tendria otro
  ganador. El cliente manda **input** (una direccion que el server normaliza), nunca
  su posicion — declararla, como hace la paleta de PONG, dejaria teletransportarse y
  pintar todo el tablero desde las devtools. La grilla entera viaja solo en el
  `pt:init` del join/reconexion (un caracter por celda); los snapshots llevan
  unicamente las celdas cambiadas. Estado scopeado por **ronda** (`round` en el
  `pt:join`), igual que Neon Drift. Ver el `CLAUDE.md` de `paint-turf`.
- `src/games/carrace.ts` — `CarRaceSim`: **relay puro**, el sim mas corto del server y el
  unico que no simula nada. Reenvia el snapshot de posicion de cada auto (`cr:pos`) al
  resto de la sala y estampa el nickname del socket emisor (asi nadie mueve el auto ajeno,
  cosa que el broadcast de Supabase no podia). Lo unico que recuerda es la **votacion de
  circuito de la ronda**: el `cr:map` ya anunciado se le reenvia a quien se conecte despues,
  que arregla el gotcha viejo del que entraba tarde y caia al circuito por seed en vez del
  votado. El estado esta scopeado por **ronda** (`round` viene en el `cr:join`): entre
  rondas los clientes navegan de una pagina a la otra y no todos a la vez, asi que el
  `GameRoom` puede sobrevivir con los votos de la ronda anterior adentro. Ver el `CLAUDE.md`
  de `car-race`.

### Interpolar sobre el reloj del server (no sobre la hora de llegada)

Regla para cualquier juego **de tiempo real arbitrado por el server** (hoy PONG y
Manchon; aplica al que venga, p.ej. rocket-arena si se retoma). Si el cliente dibuja entidades
interpolando snapshots, **el snapshot tiene que traer el reloj de la simulacion del
server** y la interpolacion tiene que correr sobre esa linea de tiempo, nunca sobre la
hora de llegada del paquete. Dos mitades, las dos obligatorias:

1. **Server: paso fijo + timestamp.** Nada de integrar la fisica con el tiempo real
   medido entre despertares del `setInterval`: el timer de Node no es preciso (en
   Windows la resolucion es de ~15.6 ms, asi que un `setInterval(16)` cae a 15.6 /
   31.2 ms de forma despareja) y ese jitter entra directo en la velocidad de las
   entidades. Acumulador + pasos de `STEP_DT` exactos, un reloj `simTime` que avanza
   en escalones, y ese `simTime` viaja en el snapshot (`pg:state.t` en PONG).
2. **Cliente: offset de reloj.** Fechar cada snapshot con `t + clockOffset`, donde
   `clockOffset` se estima con el **minimo** de `(llegada - t)` visto (la muestra que
   menos jitter comio), corregido lento hacia arriba por la deriva entre relojes.
   Descartar los que llegan fuera de orden.

Fechar el buffer con `performance.now()` de la llegada — como hacia PONG antes — mete
el jitter de entrega en la interpolacion: dos snapshots que llegan pegados describen un
tick entero de movimiento en un `span` de 2 ms, asi que la pelota se dibuja pegando un
salto y despues frenando. **Se ve como lag y no lo es**: mover el server a localhost no
lo arregla, solo lo arregla la linea de tiempo. Beneficio de yapa: el retraso de
interpolacion (`BALL_INTERP_DELAY`) deja de tener que cubrir la latencia (la absorbe el
offset) y solo cubre el espaciado de snapshots + jitter, asi que se puede bajar.

Ojo: esto **no** aplica a los juegos de canal efimero (car-race, cannon-dodge,
typing-race, monopoly-mundial, rocket-arena entre pares), que no tienen simulacion
autoritativa y suavizan a los rivales con un ease exponencial hacia el ultimo snapshot
(`x += (tx - x) * k`). Ese modelo es un filtro, no una interpolacion temporal: el jitter
de llegada no lo deforma, solo lo atrasa un poco. No hay nada que portar ahi.

Cliente: env `VITE_GAME_SERVER_URL` (documentada en `.env.example`). El juego
carga `socket.io-client` con **import dinamico** (no pesa en los juegos que no lo
usan). **Degradacion:** depende del juego. PONG degrada con gracia: sin
`VITE_GAME_SERVER_URL` la sala cae a un partido local vs IA por jugador (y solo
sigue siendo 1 jugador en la landing). Neon Drift tambien: sin server el enlace de sala
cae al broadcast de Supabase de siempre (`RaceChannel`), con su tope de mensajes y su
cadencia mas baja, pero la carrera es identica. Bomba Palabra, Cadena de Palabras, Basta,
Impostor, Telefono Cortado y Manchon **no** pueden: existen por el server (en Bomba/Cadena porque el
diccionario vive ahi; en Basta e Impostor porque el server arbitra las fases, los votos y el
puntaje —y en Impostor tambien reparte los roles privados; en Telefono Cortado porque es el
unico que conoce las frases secretas y valida las adivinanzas; en Manchon porque el
tablero es estado compartido y sin arbitro cada pantalla tendria otro ganador), asi
que sin `VITE_GAME_SERVER_URL` muestran "no disponible" (excepcion deliberada y documentada a la
regla de degradacion del repo).

**Elegir transporte se hace por CONFIGURACION, nunca en runtime.** Neon Drift es el unico
que tiene dos enlaces posibles, y decide mirando `isGameServerConfigured()`. La tentacion
es caer al otro transporte cuando la conexion falla (como hace PONG con su IA local), pero
aca seria un bug mudo: la env es la misma para todos los clientes del deploy, asi que si
uno solo cae a Supabase mientras el resto sigue en el server, la sala queda partida en dos
grupos que corren la misma carrera **sin verse**. Con el server configurado pero caido no
se ven los rivales y la carrera sigue igual (la votacion cae al `tallyWinner` determinista,
que da el mismo circuito en todos los clientes). Es el mismo riesgo de desacuerdo que ya
esta documentado para el par de URLs principal/respaldo.

**URL del server, respaldo y estado (`src/shared/server-status.ts`).** Modulo unico que
resuelve **a que server conectarse** y **si esta vivo**. Hay dos URLs: la principal
(`VITE_GAME_SERVER_URL`) y una de respaldo opcional (`VITE_GAME_SERVER_FALLBACK_URL`,
pensada para el par dominio propio / URL cruda de Railway). Se prueban **en orden**
contra el `/health` y gana la primera que contesta.

- `isGameServerConfigured()` — si hay al menos una URL. Es lo que usan los juegos para
  el cartel de "no disponible" (antes cada uno leia la env en su `constants.ts`), y lo que
  usa Neon Drift para elegir enlace de sala (server vs Supabase).
- `resolveGameServerUrl()` — la URL a la que conectarse, con caida al respaldo. **La
  llaman los ocho juegos server-side** en su `connect()` (`word-bomb`, `word-chain`,
  `basta`, `impostor`, `telefono-cortado`, `pong`, `car-race`, `paint-turf`), que por eso es `async` y
  tiene un flag `connecting`
  contra la doble conexion en la ventana del `await`. Si el resolver viviera solo en la
  landing el respaldo seria decorativo: el chip diria "en linea" y los juegos seguirian
  pegandole al server muerto. **Con una sola URL configurada no chequea nada** (devuelve
  esa y que el socket falle como siempre): el health check extra solo se paga cuando hay
  respaldo. El resultado se cachea en `sessionStorage` (`mg:game-server-url`) para que un
  jugador no salte de server a mitad de partido.
- `checkGameServer()` — `{ status, url, pingMs, fallback }` para la UI. Cualquier falla
  (red, CORS, timeout de 8s) es `"offline"`: para el jugador es lo mismo. El timeout es
  generoso a proposito porque Railway duerme los servicios free y el primer request lo
  despierta.

**El `pingMs` descarta la primera medicion (`PING_SAMPLES`).** El primer fetch de la
pagina paga DNS + TCP + handshake TLS y da como el doble de lo real (medido contra
game.juegachos.com: 114 ms el primero, ~73 ms con la conexion abierta; el chip llegaba a
mostrar 183 ms). Ese numero no es la latencia del server sino la de **abrir la conexion**,
que es justo lo que el jugador no paga: el socket del juego se abre una vez y queda
abierto. Asi que la primera respuesta es calentamiento y se reportan las siguientes,
quedandose con el **minimo** (la muestra que menos jitter y menos slow-start de TCP comio,
o sea la latencia de la red y no la del navegador). Son 3 requests por chequeo, cada 60s.
**Las mediciones son solo para la pastilla**: `resolveGameServerUrl` (el camino de los
juegos) usa `firstLive()`, que solo busca cual contesta — no hay que encarecer el connect
de una ronda para pintar un numero.

**Las URLs se normalizan (`normalize`)**: se les completa el esquema si falta
(`game.juegachos.com` -> `https://game.juegachos.com`). Sin eso un host pelado en la env
se toma como URL **relativa** y el fetch termina en `<origen>/game.juegachos.com/health`,
o sea el server se ve caido estando vivo. No romper esto "simplificando" el trim.

**UI**: `src/main.ts` monta una pastilla en la barra de navegacion, a la izquierda del
campo del nombre (`.topbar__server`): punto verde "Servidor" + el **ping** (round-trip
del `/health`), ambar "Servidor de respaldo" cuando contesta el secundario, rojo
titilante "Servidor caido"; la URL y el ping van en el `title` y a menos de 640px queda
solo el punto. Se re-chequea cada 60s. **Solo aparece con al menos una URL configurada**
(si no, el estado es `"unknown"` y no se pinta nada: misma degradacion que el resto).

**Ojo con el respaldo**: la sala entera tiene que terminar en el **mismo** server o los
jugadores quedan en partidas separadas sin verse. Con la principal caida para todos,
todos caen al respaldo y coinciden; el riesgo es el desacuerdo transitorio (a uno le
falla el chequeo y a otro no), acotado por el cache de sesion. Y si las dos URLs apuntan
al **mismo deploy** (dominio propio + URL de Railway), el respaldo cubre una caida de la
capa de dominio/DNS, **no** que se caiga Railway.

Comandos del server (dentro de `server/`): `npm run dev` (tsx watch),
`npm run build` (tsc -> `dist/`), `npm start` (`node dist/index.js`). Deploy
Railway: root del servicio = `server/`, build `npm ci && npm run build`, start
`node dist/index.js`, setear `ALLOWED_ORIGINS` con el origin de Vercel.

Seguridad / trust: mismo nivel spoofeable ya aceptado en el repo (el cliente
declara su `code`/`nickname`); el server no escribe en Supabase y los puntajes se
siguen reportando por cada cliente a la DB como en el resto de las salas.

## Shared UX pattern: Enter-to-start countdown

Every game starts the same way: from the start / game-over screen, Enter (or a tap) enters a `countdown` state that shows 3 / 2 / 1 / YA before play begins, then the run starts. The pattern is duplicated per game (not shared code, per the decoupling rule): each `Game.ts` has a `countdown` state plus `COUNTDOWN_LABELS` / `COUNTDOWN_STEP` constants and a `beginCountdown()`; each `Hud` has `showCountdown(text | null)`; each `style.css` has the `.countdown` label styling and `countdown-pop` keyframes. This is mandatory — every game must implement this pattern (see the Conventions rule above); new games are not complete without it.

In room mode there is no per-player Enter: `RoomMode` fires the game's `onStart` hook (see "Salas") the moment the round becomes `playing`, so `beginCountdown()` runs automatically and everyone starts together.

**Countdown sound.** Each of the 3 / 2 / 1 / YA labels plays a short 750 Hz sine blip (`SoundEffects.playCountdownTick()`, first defined in shell-game / El Trile and duplicated into every game's `SoundEffects.ts`). It fires once per label change, guarded by a `lastCountdownIndex` field that's reset to `-1` in `beginCountdown()`. New games should include it.

### El toque de arranque no puede colgar del canvas (el bug del overlay)

La otra mitad del patron: **el arranque tiene que entrar tambien por un toque**, porque en un celular no hay Enter. Y el gotcha es siempre el mismo, medido en 14 juegos (`block-paddle`, `circuit-breaker`, `penalty-keeper`, `reaction-time`, `rhythm-tap`, `shell-game`, `snake`, `stack-tower`, `timing-bar`, `wordle`, mas `click-the-number`, `sliding-puzzle`, `lights-out` y `tower-of-hanoi`, que ademas tienen un selector: ver abajo): el `pointerdown` estaba registrado **sobre el canvas**, y la pantalla de inicio / game over es un **overlay que lo tapa**. En desktop no se nota (arrancas con Enter y listo), pero en el telefono el toque moria en el overlay y el juego **no tenia forma de empezar** — quedaba invariablemente en la pantalla de inicio. Varios de esos `CLAUDE.md` ya prometian "Enter or tap to start": el listener existia, simplemente nunca recibia el evento.

Asi que el listener de arranque va **sobre el `container`** (que contiene al overlay; es lo que hacen `flappy-bird` y `stack-tower`) o **directo sobre el overlay** (`timberman`, `memory-match` con su `onOverlayTap`). Nunca sobre `this.canvas` ni sobre `renderer.domElement`.

Dos detalles que hacen que colgarlo del container sea seguro:

- **Usar `pointerdown`, no `click` ni `touchstart`.** El `LeaderboardPanel` compartido hace `stopPropagation` de **`pointerdown`** sobre su raiz (`src/shared/LeaderboardPanel.ts`), asi que tocar el campo del nombre o el boton de enviar no dispara el arranque. Con `click` no estas cubierto por esa proteccion, y con `mousedown` + `touchstart` juntos te comes el doble disparo en movil que obliga a andar con `preventDefault`.
- **El handler tiene que filtrar por estado.** Como ahora el listener ve los toques de toda la pantalla (incluidos los del gameplay: las teclas de `wordle`, los vasos de `shell-game`), la accion de arranque solo puede correr en los estados de menu (`ready` / `dead` / `gameOver` / `roundEnd`). Todos los juegos ya tenian ese `switch`; es lo que hace el cambio inofensivo.

**Jugable en celular (`mobile` en el `meta.ts`).** Para declarar `mobile: true` hacen falta las dos mitades: que se pueda **arrancar** con un toque (lo de arriba) y que se pueda **jugar** sin teclado fisico (puntero/tactil, botones en pantalla, o un teclado propio en pantalla como el de `wordle`). Los unicos tres `false` de hoy son `mecano`, `typing-race` y `hackerman`: escuchan `window keydown` sin ningun `<input>` en el DOM, asi que en un telefono el teclado virtual no aparece nunca y no hay con que jugarlos — eso no se arregla con un listener, pide rediseñar el input.

Como se verifica (es lo que se uso para auditar el roster): Playwright con `hasTouch: true` a 390x844, `page.touchscreen.tap()` en el medio de la pantalla, y mirar si aparece el `.countdown`. Si el tap no arranca pero `Enter` si, el juego tiene este bug. **Tocar en un solo punto fijo no alcanza**: ese punto puede caer justo sobre un control propio de la pantalla de inicio (el selector de circuitos de `car-race`) o sobre el panel de ranking, que corta la propagacion a proposito, y el juego se reporta roto estando sano. Probar varias alturas y dar por bueno el juego si arranca en alguna, que es lo que hace una persona con el dedo.

**Los juegos con selector (tamano / discos) son un caso aparte, y son los que se escapan de la auditoria.** `click-the-number`, `sliding-puzzle`, `lights-out` y `tower-of-hanoi` muestran botones de opcion (1-9 / 3x3 / 3 discos) en la pantalla de inicio, pero su handler **solo guarda la opcion** (`handleSelectSize` / `handleSelectDiscs` hacen `this.size = size` y nada mas): el unico arranque era `Enter`. En el telefono se podia elegir el tamano y despues no habia como empezar. El toque va sobre el container como en el resto, pero **exento el selector** (`e.target.closest(".overlay__size-selector")` / `".overlay__disc-selector"` devuelve temprano), asi tocar una opcion la elige y deja ver su record, y el toque en cualquier otro lado arranca. El hint de la pantalla de inicio tiene que decirlo ("toca la pantalla o presiona ENTER"): un toque que arranca desde cualquier lado menos los botones no se adivina.

**Al verificar, la senal tiene que ser el `.countdown`, nunca "cambio el texto de la pantalla".** Es el error que dejo pasar esos cuatro: tocar `1-9` marca el boton como activo y repinta el record de ese tamano, con lo cual el `innerText` cambia y una heuristica de "cambio algo" lo cuenta como arranque. Lo mismo pasa al reves con los overlays que se ocultan con `opacity: 0` en vez de `display: none` (`mini-frogger`): `innerText` sigue leyendo el cartel transparente, y un juego que arranco perfecto se reporta como roto. Medir el `.countdown` (o, en los que no lo tienen, el estado real del overlay) es lo unico que no miente.
