# Lights Out

Puzzle clasico: una grilla de luces donde presionar una celda invierte esa celda y sus cuatro vecinas ortogonales. El objetivo es apagar todas las luces en el menor tiempo posible (los movimientos desempatan).

## Module Layout

- `main.ts` - Entry point, mounts the `Game` instance to `#app`.
- `game/Game.ts` - Board logic, solvable scramble, keyboard cursor (WASD / flechas + Espacio/Enter), state machine, score logic.
- `game/Hud.ts` - DOM manager: start overlay with size selector (3x3, 4x4, 5x5), countdown, stats bar (moves, timer), grid rendering via CSS classes, victory overlay.
- `game/constants.ts` - Countdown config, localStorage keys, scramble tuning (`SCRAMBLE_PRESSES`, `MIN_LIT_RATIO`).
- `game/SoundEffects.ts` - Web Audio API synthesized sounds (countdown tick, toggle click with pitch up/down segun enciende/apaga, victory arpeggio).
- `style.css` - Warm amber theme (`#ffd23f`); lit cells glow via radial gradient + box-shadow, keyboard cursor is an outline.

## How it works

**Toggle rule**: `toggleAt(r, c)` flips the pressed cell plus its orthogonal neighbors (cross pattern), clipped at board edges.

**Solvability scrambling**: pressing a cell twice cancels out, so the scramble applies `SCRAMBLE_PRESSES[size]` presses on *distinct* random cells starting from the all-off board — the puzzle is always solvable by re-pressing those same cells. If fewer than `MIN_LIT_RATIO` of the cells end up lit (trivial board), it rerolls (max 20 attempts).

**Input**: click/tap on a cell presses it directly; keyboard moves a cursor (highlighted with `.is-cursor`) and Espacio/Enter presses the cursor cell. Enter only restarts from `ready`/`victory`; during `playing` it presses.

## State Machine

`ready` -> `countdown` (3/2/1/YA compartido) -> `playing` -> `victory`.

## Global ranking (per size, fastest time wins)

Same scheme as Numerix (sliding-puzzle): `meta.ts` declares `direction: "lower"`, `variants: ["3", "4", "5"]` and `format: formatTimeMoves`. `handleVictory()` submits `encodeTimeMoves(elapsedTime, moves)` so the board sorts by time with moves as tiebreak. Personal bests (moves y tiempo por tamano) en localStorage con prefijo `lights_out_best_`.

## Room mode (multiplayer)

`initRoomMode("lights-out", { getScore, onStart })`. With `?room=` the size is fixed by `ROOM_VARIANTS["lights-out"]` ("5") and the selector is hidden; victory reports the encoded time+moves to the room instead of the global ranking, and Enter-to-retry is blocked (one run per round). Timeout partials are non-comparable with solved boards (`direction: "lower"`, handled by `points.ts`), y la ronda tiene un tope de 90 s (`roomTimeLimitSec` en `meta.ts`).

**F5 no reinicia la partida.** En sala el tablero, los movimientos y el arranque del cronometro se persisten en `sessionStorage` via `src/shared/room/roomRun.ts` (clave por sala+ronda+juego). `beginCountdown()` corta temprano si `resumeSavedRun()` encuentra un snapshot: retoma el mismo tablero sin countdown. El tiempo **no** se guarda acumulado sino como `startedAt` epoch, y `update()` lo recalcula con `elapsedSince()` mientras haya sala — asi recargar no reinicia ni pausa el reloj (sin sala se sigue sumando `dt` como siempre). `handleVictory()` limpia el snapshot.

## Arranque por toque (movil)

El arranque/reintento entra por un `pointerdown` en el container, con **los botones de tamano (3x3 / 4x4 / 5x5)
exentos** (`e.target.closest(".overlay__size-selector")` devuelve temprano): tocar una opcion la
elige y muestra su record, y el toque en cualquier otro lado arranca.

Antes el unico arranque era `Enter`, porque el handler del selector solo guardaba
la opcion y no empezaba nada: en el telefono se podia elegir el tamano y despues
no habia forma de jugar. Por eso el hint dice "toca la pantalla o presiona ENTER"
— un toque que arranca desde todos lados menos los botones no se adivina solo.
Ver el `CLAUDE.md` raiz, "El toque de arranque no puede colgar del canvas".
