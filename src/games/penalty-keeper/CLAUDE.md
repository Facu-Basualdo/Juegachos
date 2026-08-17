# Keepers!

(Display title "Keepers!"; the id stays `penalty-keeper` everywhere — paths,
storage keys, scoring, cover filename.)

Goalkeeper survival game in **retro HD-2D**: procedural pixel-art sprites
(canvas-drawn, `NearestFilter`) living as lit planes inside a real Three.js
scene — `MeshStandardMaterial` sprites, shadow maps, dynamic lights and a
pixelation + bloom post chain (see the repo's `threejs-*` skills). The camera
stands inside the goal behind the keeper: you see the keeper's back, the
night pitch ahead, and a penalty taker at the spot who runs up and kicks
balls that fly at the camera. Move the keeper left/right (arrows / A-D, or
the mouse, which places him directly under the pointer) and jump (Space /
click) to reach high shots. Every save is +1; every conceded goal adds an X
and three X marks end the run. Score = total saves. The goal frame has posts
and crossbar but **no net** (design decision).

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — scene/camera/renderer + the `EffectComposer`
  (`RenderPixelatedPass` → `UnrealBloomPass` → `OutputPass`), the `ready →
  countdown → playing → dead` state machine, judgment of arrived shots,
  scoring/misses, the pointer→keeper-plane raycast, the dynamic-light updates
  (ball tracking light, save/goal pulses, camera shake on goals) and the room
  mode wiring (`initRoomMode`) like every other game.
- `game/Keeper.ts` / `game/Kicker.ts` — pure logic/animation state in meters
  (no rendering). Keeper: steering, gravity jump, `catches(tx, ty)`. Kicker:
  idle / run-up / kick / recover phases; **the run-up is the telegraph** —
  `ShotField` cues `beginRunup` exactly `RUNUP_TIME` before each kick.
- `game/KeeperView.ts` / `game/KickerView.ts` — map that state onto animated
  sprite planes: frame selection (idle breathing, run cycle mirrored by
  direction, jump/kick poses) via `setSpriteFrame`.
- `game/ShotField.ts` — schedules kicks through the difficulty phases
  (`paramsAt`) and flies real 3D ball meshes (slightly emissive so they pop
  at night) from the spot to their keeper-plane target; reports arrivals and
  exposes `nearestShot()` for the tracking light.
- `game/Stadium.ts` — the world: tiled pixel grass, painted field-line
  overlay, goal frame, ad boards with emissive edges, the animated pixel
  crowd (two postures swapped by `update(dt)`; fans are seated once in
  `buildCrowd` so frames differ only in who bobs), floodlight towers, and
  all base lights plus the `savePulse` / `goalPulse` point lights the Game
  fires. The key light comes from where the towers stand (high, out on the
  pitch) so shadows fall back toward the goal, matching the visible sources.
- `game/SoundEffects.ts` — synthesized PSG-style effects (square/triangle
  voices + filtered-noise crowd, no samples): kick thump, save chirp +
  cheer, conceded-goal buzzer + groan, referee whistle on YA, game-over
  arpeggio. Volume dial: `SOUND_VOLUME` in constants.
- `game/sprites.ts` — every procedural texture: keeper/kicker frame sheets
  (rect-list pixel art), grass/tribune/lines/ball textures, and the
  `makeSpritePlane` helper (alpha-tested `MeshStandardMaterial` **plus a
  matching `customDepthMaterial`** so cast shadows follow the silhouette).
- `game/InputController.ts` — keyboard (arrows/A-D steer, Space jump, Enter
  start) + pointer (move steers — Game raycasts the clientX onto the keeper
  plane — press jumps / starts).
- `game/Hud.ts` — DOM overlay: a top-center scoreboard **island** with both
  counters (ATAJADAS number and GOLES X marks) always readable, plus the
  ATAJADA/GOL popup, start / game-over screens and the leaderboard panel.
- `game/constants.ts` — all tunable values, in **meters** (real goal: 7.32 x
  2.44) plus the retro post settings (`PIXEL_SIZE`, bloom). **Tune here
  first.**

## Difficulty: four hand-designed phases (playtest-tuned)

Difficulty is driven by **elapsed play time plus a kick counter**, resolved
per kick by `ShotField.paramsAt`. The phases were specified directly by
playtesting (an earlier Monte Carlo-tuned smooth ramp was rejected twice for
a too-easy opening — tune these by playing, not by simulation):

- **A. Warmup** — the first `WARMUP_KICKS` (4) shots are gifts: slow (1.4 s),
  low, straight, every 2 s.
- **B. Cadence climb** — until `CADENCE_END_S` (45 s): the kick interval
  falls 1.9 s → 1.15 s while the shots stay tame. The pressure is the rhythm.
- **C. Progressive mix** — until `INFERNO_START_S` (120 s): two threat types
  ramp in together — **curved balls** (slower flight but they bend, chance
  15% → 40%) and **straight-but-fast balls** (flight 1.1 s → 0.8 s). High
  shots climb 10% → 30%; doubles appear in the back half at 10%.
- **D. Inferno** — from 120 s on, blended over `INFERNO_BLEND_S` (10 s) so
  there's no cliff: straight 0.72 s, curved 0.9 s, interval 0.9 s, 40% high,
  40% curved, 25% doubles. Constant from there — the run ends when the
  keeper does.

Curved vs straight is decided per kick; a curved ball always uses the slower
`curvedFlight` so the bend is readable, making the fast straight ball the
punishment for over-watching curves.

**Doubles are constrained to stay fair** (a playtest fix: free targets made
opposite-corner doubles physically unsaveable). The second ball of a double
lands within `DOUBLE_MAX_SPREAD` (2.4 m) of the first — the keeper covers
`KEEPER_SPEED * DOUBLE_DELAY` = 2.8 m between arrivals plus the catch reach —
and is always low and straight so its path is readable. If the first ball was
high (forces a jump), the second waits `DOUBLE_DELAY_AFTER_HIGH` (0.55 s)
instead so the keeper can land first. The cadence pressure is unchanged; the
impossible splits are what got removed.

## Non-obvious decisions

**Judgment is a point-in-box test at the keeper plane.** A shot is a
parametric flight from the spot to `(tx, ty)`, judged when progress hits 1 at
`KEEPER_Z`. The visual arc and the lateral bend of curved shots never change
the target — curve only misleads the eye.

**Jumping is a commitment.** The covered zone is anchored to the feet: a jump
raises the reach above the crossbar but also lifts the floor
(`AIRBORNE_FLOOR_FACTOR`), so ground balls roll under an airborne keeper.

**The bar is taller than a real goal on purpose** (`GOAL_HEIGHT` 2.75 vs the
regulation 2.44): the extra headroom makes the gap between standing reach and
the bar readable, so "this one needs a jump" is obvious at a glance.

**Sprite shadows need a custom depth material.** Alpha-tested sprite planes
only cast silhouette-shaped shadows if `customDepthMaterial` carries the same
map + alphaTest; `setSpriteFrame` must swap the frame on **both** materials
or the shadow lags a frame behind the pose.

**Goal concessions are made unmistakable on purpose** (a playtest complaint):
the conceded ball keeps flying past the keeper toward the camera in real
depth, plus a red `goalPulse` light and a short camera shake. Saves deflect
back out toward the pitch and get the green `savePulse`.

**The kicker's idle spot is offset sideways** (`RUNUP_SIDE`) so the telegraph
is never hidden behind a centered keeper.

**`dt` is clamped** (`MAX_DT`) so a tab-switch can't teleport balls past the
judgment plane.

**Enter-to-start countdown.** Standard repo pattern: 3 / 2 / 1 / YA
(`COUNTDOWN_LABELS`, `COUNTDOWN_STEP` in `Game.ts`), 0.6 s restart guard after
dying, and in room mode there is no retry (single run per round).

## Arranque por toque (movil)

El arranque/reintento entra por el `InputController` montado sobre el container (antes sobre `renderer.domElement`).
**No devolverlo al canvas**: la pantalla de inicio y la de game over son un overlay
que lo tapa, asi que el toque moria ahi y en celular el juego no se podia empezar
(no hay Enter). Es `pointerdown` y no `click` porque el `LeaderboardPanel` compartido
corta la propagacion de los `pointerdown` de su propia UI. Ver el `CLAUDE.md` raiz,
"El toque de arranque no puede colgar del canvas".
