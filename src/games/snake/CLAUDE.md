# Snake

Classic grid snake. The snake advances one cell per step on a 14x14 grid; eating the food grows it by one segment, speeds it up, and scores +1. Hitting a wall or its own body ends the run. Plain 2D `<canvas>`, no Three.js.

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — orchestrates the canvas, `ready -> countdown -> playing -> dead` state machine, the grid step logic, collisions, scoring, and the `requestAnimationFrame` loop. Owns canvas-to-window letterbox scaling.
- `game/Hud.ts` — DOM overlay (score, start / game-over screens, countdown).
- `game/SoundEffects.ts` — synthesized Web Audio effects (no assets): eat blip, turn tick, countdown tick, lose swoop.
- `game/constants.ts` — all tunable values (grid size, cell size, step timing, colors, countdown timing).

## Non-obvious decisions

**Fixed timestep on a real-time loop.** The rAF loop runs at display rate but the snake only advances when `stepAccum` crosses `stepInterval` (accumulator pattern). `stepInterval` starts at `STEP_INITIAL` and drops by `STEP_DECREMENT` per food down to `STEP_MIN`, so the game speeds up as you grow. `MAX_DT` clamp plus a per-frame step guard (max 4) stop a tab-switch from teleporting the snake.

**Classic Google-Snake look.** Two-tone green checkerboard board, a solid blue snake, and a red apple with a stem and leaf (colors in `constants.ts`). The snake body is drawn as **one continuous rounded tube**: a single thick `stroke()` (round `lineJoin`/`lineCap`) through the interpolated segment centers, plus a slightly larger head circle with big white eyes + forward-looking pupils and two nostrils. Not discrete squares — that's what makes bends read as a smooth connected body. Score and countdown are white (dark text-shadow) for contrast over the light-green board.

**Interpolated rendering.** `cells` (grid coords, head at index 0) is snapshotted into `prevCells` before each step; the renderer lerps each segment between `prevCells[i]` and `cells[i]` by `t = stepAccum / stepInterval`, so motion is smooth instead of one-cell-per-tick jumps. When growing, the new tail segment's `prevCells` entry equals its current cell so it "emerges" in place instead of sliding from nowhere. Outside `playing`, `drawSnake` pins `t = 1`, **not** `0`: a fatal step calls `die()` and returns without applying the move, so `cells`/`prevCells` still straddle the previous step, and drawing at `t = 0` would snap the snake a full cell backwards at the moment of death (it looked like it died before reaching the wall). In `ready`/`countdown` both arrays are equal, so `t = 1` is a no-op there.

**Direction queue.** Turns go into `dirQueue` (max 2 buffered), and one is dequeued at the start of each step. Reversals and duplicates are rejected against the last queued (or current) direction — this prevents the classic "two fast turns into your own neck" instant death.

**Giro sin espera (`TURN_EARLY_FRACTION`).** Una direccion nueva solo se aplica al empezar un paso, asi que apretar la tecla justo despues de un tick la dejaba esperando un `stepInterval` entero (140 ms al principio del run): eso es lo que se siente como delay en los controles, y es peor de arranque que sobre el final, cuando el paso ya bajo a `STEP_MIN`. `queueDir` llama a `tryEarlyStep`, que **adelanta el paso** si el tick actual ya recorrio `TURN_EARLY_FRACTION` (0.5), con lo que la latencia maxima queda en medio paso. Solo se adelanta con la cola en 1 (el giro de este paso; el segundo bufferado sigue perteneciendo al paso siguiente) y `stepAccum` vuelve a 0, que es el valor que minimiza el salto visual: la cabeza se corre hacia adelante lo que le faltaba de la celda en vez de retroceder. No se acelera el juego de forma util — despues del adelanto hay que volver a acumular medio paso, y girar sin parar en Snake se paga solo.

**Self-collision ignores the tail cell** unless eating, because the tail vacates its cell on a normal step (so moving into where the tail is right now is legal).

**Controls.** Arrow keys or WASD to turn. Swipe/drag on the canvas (pointer events): a move past a 24px threshold in the dominant axis queues a turn and re-anchors, so a continuous drag can chain turns (el swipe entra por el mismo `queueDir`, asi que tambien se beneficia del giro adelantado). Enter or tap/click to start and to restart.

**Square view box.** 336x336 (14 cells x 24px). Letterbox scaling handles any screen; the HUD score sits above the board.

**Enter-to-start countdown.** Standard repo pattern: 3 / 2 / 1 / YA (COUNTDOWN_LABELS, COUNTDOWN_STEP in constants.ts), 0.6 s restart guard after dying.

## Scoring

Default board (higher is better, +1 per food) — so `meta.ts` intentionally omits a `scoring` export.

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("snake", { getScore: () => this.score, onStart: () => this.beginCountdown() })` (see root CLAUDE.md, "Salas (multiplayer rooms)"). On game over it reports the score to the room instead of the global leaderboard when in a room.
