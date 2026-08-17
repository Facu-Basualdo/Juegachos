# Al Centro (`timing-bar`)

Timing / precision minigame. A horizontal ruler has a single marker that sweeps left-right (ping-pong) and **accelerates every round**. The player presses **SPACE** (or clicks / taps) to freeze it; the closer to the dead center of the ruler, the more points. The final score is the **average of 5 rounds** (higher is better).

## Files

- `game/Game.ts` — state machine + fixed-ish `requestAnimationFrame` loop (dt-capped by `MAX_DT`). States: `ready` -> `countdown` -> `playing` -> `roundResult` -> (next round `playing` | `gameOver`). Owns the marker sweep (`pos`, `dir`, `speed`), the round scores, best-average persistence, room mode and the shared countdown.
- `game/Renderer.ts` — draws the ruler and marker on a `<canvas>` (DPR-aware, re-reads its CSS box on `resize`). Pure view: it receives a `RenderState` each frame and never touches game logic.
- `game/Hud.ts` — all DOM chrome: the canvas stage, the top bar (round + running average + 5 dots), the mid-play result banner, the start / game-over overlay, the countdown label, and the shared `LeaderboardPanel`.
- `game/SoundEffects.ts` — Web Audio blips (no assets): countdown tick (shared 750 Hz), a stop blip whose pitch rises with the score, a two-note perfect chime, a finish flourish.
- `game/constants.ts` — tuning knobs (below) plus `scoreForDistance()` and `ratingLabel()`.
- `meta.ts` — registry entry (`order: 65`, category "Reflejos") and `scoring` (`direction: "higher"`, formatted as `N pts`).

## Scoring

`scoreForDistance(dist)` where `dist` is the normalized distance from center in `[0, 1]` (0 = dead center, 1 = an edge). Score = `round(100 * (1 - dist) ^ SCORE_EXP)`, so 100 at the center and 0 at the edges with a `SCORE_EXP`-controlled falloff. The round point value feeds both the HUD dots (tiered great / ok / poor) and the average.

## Tuning knobs (`constants.ts`)

- `TOTAL_ROUNDS` (5) — rounds averaged for the final score.
- `BASE_SPEED` / `SPEED_STEP` — marker speed in "full track widths per second"; round `r` uses `BASE_SPEED + (r-1) * SPEED_STEP`. This is the difficulty ramp.
- `SCORE_EXP` — falloff harshness of the score curve (bigger = center matters more).
- `CENTER_HALF` — half-width of the visual cyan bullseye band (cosmetic only; scoring is continuous, not zone-based).
- `RESULT_HOLD` — seconds the round result stays before the next round auto-starts (no per-round countdown; only the game start has the 3/2/1/YA countdown).

## Conventions honored

- **Enter-to-start 3 / 2 / 1 / YA countdown** (`COUNTDOWN_LABELS` / `COUNTDOWN_STEP`, `beginCountdown()`, `Hud.showCountdown`, `.countdown` CSS + `countdown-pop`), with the shared `SoundEffects.playCountdownTick()` fired once per label via `lastCountdownIndex`. Only at game start; rounds within a game chain automatically.
- **Global ranking**: `hud.showRanking("timing-bar", average)` on game over (solo), gated by `meta.ts` `scoring`.
- **Room mode**: `initRoomMode("timing-bar", { getScore, onStart })`. `getScore` returns the average of completed rounds (timeout partial); `onStart` runs `beginCountdown()` so everyone starts together; on game over it calls `room.reportScore(average)` instead of the global leaderboard, and start/restart input is blocked while `this.room` is set.

## Aesthetic

Cream & ink (see `DESIGN.md`, "Papel y Tinta") — matches the landing page and room overlays. Cyan is the target/accent; coral-red is reserved for the perfect hit; olive is secondary. Nothing glows.

## Arranque por toque (movil)

El arranque/reintento entra por el `pointerdown` del container (antes `mousedown` + `touchstart` sobre el canvas del Hud).
**No devolverlo al canvas**: la pantalla de inicio y la de game over son un overlay
que lo tapa, asi que el toque moria ahi y en celular el juego no se podia empezar
(no hay Enter). Es `pointerdown` y no `click` porque el `LeaderboardPanel` compartido
corta la propagacion de los `pointerdown` de su propia UI. Ver el `CLAUDE.md` raiz,
"El toque de arranque no puede colgar del canvas".
