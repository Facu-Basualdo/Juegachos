# Block Paddle

Single-player paddle-and-ball survival game. The player controls a paddle at the bottom of the screen, moving left and right to keep a ball bouncing. Each paddle hit increments the score, speeds up the ball (BALL_SPEED_INCREMENT per hit, capped at BALL_SPEED_MAX) and shrinks the paddle (PADDLE_SHRINK_PER_HIT, floored at PADDLE_WIDTH_MIN). Missing the ball ends the run. Plain 2D `<canvas>`, no Three.js.

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — orchestrates the canvas, `ready -> countdown -> playing -> dead` state machine, collision detection, scoring, and the `requestAnimationFrame` loop. Owns canvas-to-window letterbox scaling. Includes mouse and touch input for paddle movement.
- `game/Hud.ts` — DOM overlay (score, start / game-over screens, countdown).
- `game/SoundEffects.ts` — synthesized Web Audio effects (no assets): paddle hit blip, wall bounce tick, countdown tick, lose swoop.
- `game/constants.ts` — all tunable values (speeds, sizes, acceleration, countdown timing).

## Non-obvious decisions

**Single paddle at bottom.** Unlike classic Pong, there is no AI opponent. The paddle stays at the bottom, the ball bounces off all walls, and the fail condition is the ball passing the paddle.

**Portrait view box.** 480x720 (portrait) since the paddle is at the bottom and the ball travels vertically more than horizontally. Letterbox scaling handles any screen.

**One life, score by returns.** The player has exactly one life. Each successful paddle hit increments the score. Speed ramps up with every hit until BALL_SPEED_MAX.

**Difficulty ramps on two axes.** Ball speed grows and the paddle narrows with every hit (`paddleWidth`, a runtime field — `PADDLE_WIDTH` is only its starting value). The paddle shrinks around its own center and is re-clamped, so it never pops outside the walls. Everything that used to read the constant (pointer tracking, collision, bounce angle, clamp, render) must read the field.

**Ball is sub-stepped.** At BALL_SPEED_MAX a single MAX_DT frame moves the ball further than the paddle's collision band is tall, so it would tunnel straight through. `updatePlaying` moves the paddle once, then integrates the ball in sub-steps of at most MAX_SUBSTEP_DIST px (`stepBall`), bailing out of the loop as soon as the state leaves `"playing"` (i.e. the ball was missed). Raising BALL_SPEED_MAX is safe because of this; lowering MAX_SUBSTEP_DIST below BALL_RADIUS is what would cost frames for nothing.

**Bounce angle from paddle position.** Where the ball hits the paddle determines the outgoing angle: center hits go nearly straight up, edge hits go steep. Formula: `relX * 0.7` radians offset from straight up (-PI/2).

**`dt` is clamped** (MAX_DT) so a tab-switch or hitch can't integrate one giant step and teleport the ball through the paddle.

**Mouse and touch input.** The paddle follows the cursor/finger position directly on the x-axis. Arrow keys (or A/D) also work for keyboard control. Enter or tap to start.

**Enter-to-start countdown.** Standard repo pattern: 3 / 2 / 1 / YA (COUNTDOWN_LABELS, COUNTDOWN_STEP in constants.ts), 0.6 s restart guard after dying.

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("block-paddle", { getScore: () => this.score, onStart: () => this.beginCountdown() })` (see root CLAUDE.md, "Salas (multiplayer rooms)").

## Arranque por toque (movil)

El arranque/reintento entra por el `pointerdown` del container (antes eran `click` + `touchstart` sobre el canvas).
**No devolverlo al canvas**: la pantalla de inicio y la de game over son un overlay
que lo tapa, asi que el toque moria ahi y en celular el juego no se podia empezar
(no hay Enter). Es `pointerdown` y no `click` porque el `LeaderboardPanel` compartido
corta la propagacion de los `pointerdown` de su propia UI. Ver el `CLAUDE.md` raiz,
"El toque de arranque no puede colgar del canvas".
