# Stack Tower

Block-stacking game: a block slides horizontally above the tower; each drop
(space / click / tap) lands it on the block below. Any overhang past the block
beneath is sliced off (tumbles away) and the block shrinks to the overlap — so
sloppy drops shave the tower narrower until a drop misses entirely and the run
ends. A near-perfect drop keeps the full width. Plain 2D `<canvas>`, no Three.js.

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — orchestrates the canvas, the `ready → playing → dead` state machine and the `requestAnimationFrame` loop. Also owns the canvas→window scaling (letterbox fit).
- `game/Tower.ts` — the simulation: placed blocks, the sliding block, falling slivers, perfect flashes, the follow camera, and the drop/slice/miss logic. Score is `blocks.length - 1`.
- `game/Renderer.ts` — all canvas drawing (background, rounded blocks, slivers, perfect flash), in view units.
- `game/InputController.ts` — keyboard + pointer → a single `onDrop` callback.
- `game/Hud.ts` — DOM overlay (live score, start / game-over screens).
- `game/SoundEffects.ts` — synthesized Web Audio effects: a thunk on each placed block (pitch rises with height), a bright chime on a perfect drop, and a low crumble on a miss. No assets.
- `game/constants.ts` — all tunable values (block size, speeds, perfect epsilon, camera, colors). **Tune here first.**

## Non-obvious decisions

**Fixed view box, scaled to fit.** Everything is authored against a fixed `VIEW_WIDTH`×`VIEW_HEIGHT` (480×720 portrait) space so speeds/sizes have a stable feel; `Game.render()` applies `ctx.scale()` + `ctx.translate()` (with `devicePixelRatio` folded into the scale) to letterbox that box into the window, painting side bars on wide screens.

**Tower-world Y vs screen Y.** Blocks store `y` as their top in tower-world units (y grows downward, base bottom at `VIEW_HEIGHT`). Rendering adds `tower.cameraOffset` to every `y`. The camera eases so the active row sits near `CAMERA_TARGET_Y` once the tower is tall enough, and is clamped to `>= 0` so it never scrolls below the base while the tower is short.

**Drop resolves against the top block only.** Overlap = intersection of the moving block and the block directly below. `overlap <= 0` is a miss (whole block becomes a sliver, game over). Within `PERFECT_EPS` of alignment it snaps to a perfect placement (full width kept, no sliver, white flash). Otherwise the block shrinks to the overlap and the overhang on the stuck-out side spawns a falling `Sliver`.

**Enter-to-start countdown.** From the start or game-over screen, Enter (or a tap / space) enters a `countdown` state that shows 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP` seconds each, in `Game.ts`) before play begins. The block keeps sliding during the countdown (visual only) but drops are ignored until it finishes — so, unlike before, the first input no longer drops the first block, it only starts the countdown. `Hud.showCountdown(text | null)` renders the big centered label (styled by `.countdown` in `style.css`).

**Restart guard.** After a miss there's a short `deadFor` delay before a drop can restart, so the tap that ended the run doesn't instantly begin a new one.

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("stack-tower", { getScore: () => this.tower.score })` (see root `CLAUDE.md`, "Salas (multiplayer rooms)"). With `?room=` in the URL the game-over reports the score to the room instead of the global ranking, and the restart input is blocked (one run per round). Without the param nothing changes.

## Arranque por toque (movil)

El arranque/reintento entra por el `InputController` montado sobre el container (antes sobre el canvas).
**No devolverlo al canvas**: la pantalla de inicio y la de game over son un overlay
que lo tapa, asi que el toque moria ahi y en celular el juego no se podia empezar
(no hay Enter). Es `pointerdown` y no `click` porque el `LeaderboardPanel` compartido
corta la propagacion de los `pointerdown` de su propia UI. Ver el `CLAUDE.md` raiz,
"El toque de arranque no puede colgar del canvas".
