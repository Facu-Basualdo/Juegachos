# Boilerbound

A boss-fight dodge survival set in a closed steampunk boiler room seen head-on
(fixed camera, Three.js). Steam jets erupt from a row of floor vents in
telegraphed **boss patterns**; touching a live jet is instant death. You survive
as long as you can — **score is time survived** (higher is better, shown as a
`m:ss.cc` clock). Inspired by *A Slight Chance of Sawblades* (the vent room),
*Iron Snout* (frantic reads) and Hollow Knight boss precision (fair tells + a
dash with i-frames). Difficulty ramps every 15 s and periodically enters an
**Overload** phase (red emergency light + everything twice as fast for 10 s).

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Models.ts` — preloads the Blender GLB props + the painted `backdrop.jpg` (`loadModels()`), see "3D models" below.
- `game/toon.ts` — the **cel-shading** toolkit: `makeToonGradient` (a hard N-step ramp texture) and `toonify(root, grad)` which swaps every `MeshStandardMaterial` under an object for an equivalent `MeshToonMaterial` (flat banded light/shadow). This is how the props match the hand-painted cartoon background — the look is a *shading* change, not a modelling one. `EmissiveMaterial` is the union type for the pulsed materials (porthole, vent glow).
- `game/Game.ts` — orchestrates scene/camera/renderer and the `loading → ready → countdown → playing → gameover` loop (`tick`). Renders through an **`OutlineEffect`** (`this.outline.render(...)`) which draws inverted-hull **ink outlines** around every mesh — the other half of the cartoon look. `toneMapping = NoToneMapping` for flat, vivid colours; no bloom / env map (the cartoon wants crisp, not glowy). Creates the shared `gradientMap` (`makeToonGradient`) and hands it to Room/Player/VentField so everything is cel-shaded. `init()` awaits `loadModels()` behind a "loading" state, then builds Room/Player/VentField. Owns **all dynamic lighting** (warm gas-lamp key + hemisphere ambient + two lamp `PointLight`s, cross-faded down during overload; a red `emergencyLight` `PointLight` pulsed by overload / the death flash — toon materials still respond to lights via the ramp), the **fixed camera** framed to fit the whole room box (`frameCamera`, recomputed on resize — critical for portrait phones), the collision check (`field.isPlayerHit` unless the player is dashing), and the death juice (steam + ember burst, red flash, camera shake, hidden diver, game-over overlay deferred 550 ms).
- `game/Player.ts` — the dodger (the `diver.glb` model, scaled to PLAYER_HEIGHT; primitive fallback), **cel-shaded** via `toonify` (a `gradientMap` ctor arg). Carries a soft cyan locator `PointLight` so it stays findable in the dark, and pulses its emissive porthole during the dash i-frames (the glow materials are collected *after* toonify so the refs point at the on-screen toon materials). 2D platformer physics in XY (`x` = centre, `y` = feet): run with ground/air accel + friction, **variable-height jump** (release cuts the ascent) with **coyote time + jump buffer** (`COYOTE_TIME` / `JUMP_BUFFER_TIME`) and **split gravity** (heavier `FALL_GRAVITY_MULT` on the way down for a snappy, low-commitment arc + strong `PLAYER_AIR_ACCEL` so you can steer to a safe landing), and a short **i-frame dash** (Shift) whose carried speed is **cut to a walk (or a full stop) the instant it ends**, so it lands at a predictable spot instead of sliding on at `DASH_SPEED`. The side walls are solid boundaries only — no wall cling / wall jump (removed; see "Non-obvious decisions"). `update()` returns a `PlayerEvents` (`jumped`/`dashed`) the `Game` turns into sounds + sparks. `invulnerable` (dash i-frames) is what lets a dash slip through a jet. Exposes `hurtHalfWidth` (`HURTBOX_HALF_WIDTH`, narrower than the visual `halfWidth`) — the box `Game` uses for steam collision. Exposes `visualY` (`y + PLAYER_GRILLE_LIFT`) — the mesh renders at this height (so the diver appears to stand on the grille top, see "Non-obvious decisions") while `y` itself stays the raw physics value; `Game` uses `visualY` too when positioning cosmetic effects (death/dash particle bursts) at the character's feet.
- `game/SteamVent.ts` — one floor vent, a 3-state machine (`warning → active → dissipate`): red grille glow + pulsing `PointLight` + hissing chispas, then a `THREE.Points` jet of **cartoon smoke puffs** (`getPuffTexture`; `alphaTest` + `depthWrite` so front puffs occlude the ones behind and it reads as solid drawn smoke, not see-through rings) that is lethal via `hits()`, then a fading remnant that blocks vision but deals no damage. Owns its **cel-shaded** grille mesh (toonified per-vent so the red warning glow is independent), warn light and jet. Also owns a **danger telegraph** (`setTelegraph`): a floor decal + a translucent red pillar, both exactly the kill width (`KILL_WIDTH = 2·VENT_KILL_HALF`) and the pillar the full `STEAM_KILL_HEIGHT`, so the lethal column is never invisible — the decal brightens through the warning and stays lit while the jet is live; the pillar eases in during the warning (obvious in the last moments) then hands the vertical read to the steam cloud. Both are additive `MeshBasicMaterial` with `outlineParameters.visible = false` so `OutlineEffect` renders them as glows, not ink-outlined props. Calls `onErupt` (steam hiss sound) at eruption.
- `game/VentField.ts` — the **boss-fight director**: owns every `SteamVent` and, on a shrinking timer, launches attack patterns whose mix/speed escalate with the difficulty level. Patterns: `single`, `cluster` (3 adjacent), `wave` (a staggered wall sweeping the room, run the other way) and `cage` (every column but one safe cell). Runs the **Overload** phase (period `OVERLOAD_PERIOD`, first at `OVERLOAD_FIRST_AT`), scaling all vent time by `OVERLOAD_TIME_SCALE`. Staggered wave triggers live in a `queue` advanced on the same scaled dt.
- `game/Particles.ts` — fire-and-forget additive spark pool (warning chispas, dash trail, death embers). Purely cosmetic. Additive material has no per-point alpha, so a spark fades by scaling its displayed colour toward black.
- `game/Room.ts` — the environment. In the cartoon look (default, when `backdrop.jpg` loaded) the **painted background carries the scenery** — arches, gears, pipes, lanterns and crystals are all in the image on a big back plane — so the only live geometry is the cel-shaded **floor** in front of it. The old procedural room (riveted panel + slowly turning bronze gears + gas-lamps) is kept as `buildFallbackRoom` and only appears if the backdrop image is missing. Everything is cel-shaded via `toonify`. Geometry only; Game drives the lighting. (The climbable side walls are gameplay, computed from the player's `x` in `Player`, not from a Room mesh.)
- `game/InputController.ts` — keyboard (A/D + arrows run, Space/W/Up jump, Shift/K dash) with edge-triggered jump/dash, plus the on-screen touch pad (left / right / jump / dash).
- `game/Hud.ts` — DOM overlay: live survival clock, start / game-over screens, countdown label, transient overload banner, leaderboard panel.
- `game/SoundEffects.ts` — synthesized Web Audio (countdown tick, jump, wall jump, dash whoosh, steam hiss, overload alarm, death). No assets.
- `game/dotTexture.ts` — two cached canvas sprites: `getDotTexture` (soft additive glow for the sparks) and `getPuffTexture` (a flat white **cartoon smoke puff** with a dark ink outline + cel-shadow band, used by the steam jets so they match the outlined toon look).
- `game/constants.ts` — **all tunable values** (room bounds, player physics, vent timing, difficulty ramp, overload, palette). Tune here first.

## Art direction: cel-shaded cartoon

Boilerbound uses a **hand-painted cartoon** look (Hollow Knight / Ori), which is
achieved by *shading + rendering*, not by the models themselves:

1. **Painted background** — `backdrop.jpg` is a hand-painted steampunk cavern
   (arches, mossy brass gears, pipes, warm lanterns, teal crystals) made with
   **Krea (img2img)** over a Blender **base-plate** (`tools/blender/baseplate.py`
   renders a clean 16:9 composition guide; source refs in `docs/`). `Room` maps
   it on a big back plane and it **carries the whole scenery** — no live gears.
2. **Cel-shading** — `toon.ts` swaps the props' PBR materials for
   `MeshToonMaterial` with a stepped `gradientMap`, so light falls in flat bands.
3. **Ink outlines** — `Game` renders through `OutlineEffect` (inverted-hull),
   drawing dark contours around every mesh. No bloom, `NoToneMapping`.

The Blender GLB geometry (below) is **reused as-is** under the toon materials —
the pivot from the earlier dark-PBR look was materials + render, not remodelling.

## 3D models (Blender)

The props are still **Blender-authored GLB models** (the procedural primitive
look was too bland), now cel-shaded at runtime.

- **Assets:** `public/models/boilerbound/` — `gear.glb` (fallback back cog),
  `diver.glb` (the player, diving suit w/ glowing cyan porthole), `pipes.glb`
  (fallback pipe/valve/gauge cluster), `vent.glb` (cast-iron steam grille), and
  **`backdrop.jpg`** — the Krea-painted cavern (see above). GLBs load with
  `GLTFLoader`, the backdrop with `TextureLoader`. (`tools/blender/backdrop.py`,
  the old rendered-diorama backdrop, is superseded by the Krea painting but kept
  for reference; `baseplate.py` is what feeds Krea's img2img.)
- **Source scripts:** `tools/blender/` — `_common.py` (helpers: PBR material,
  bmesh primitives, bevel/subsurf, `export_glb` with `export_yup=True`,
  `orient`), one script per model, and `preview.py` (renders a lit PNG/JPG to
  eyeball a model). Regenerate with:
  `blender --background --factory-startup --python tools/blender/<name>.py -- public/models/boilerbound/<name>.glb`
- **Graceful fallback:** every consumer (`Room` gears/pipes, `Player` diver,
  `SteamVent` grille) degrades to a primitive if its GLB is missing (`ModelSet`
  fields are optional) — gameplay never depends on the assets.
- **Orientation:** models face **-Y in Blender** so the y-up export lands them
  **facing the camera** (+Z). The gear is stood up (`orient` rx=90°) so it spins
  with a single `rotation.z`.
- **glTF caveat:** procedural node textures don't survive export — materials use
  solid PBR values; metal richness comes from geometry + the env map.
- Blender at `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`.

## Non-obvious decisions

**`menuVisible` gates the restart during the deferred game-over.** The game-over
overlay is deferred 550 ms so the death (steam + ember burst, red flash, shake)
plays in the clear, and that deferred callback is what calls `reportScore`/
`showRanking` — guarded by a `state === "gameover"` re-check that aborts if the
player restarted mid-window. Without a guard, restarting during that window
silently **dropped the run's leaderboard submission**. `handleActivate` now bails
on `!menuVisible` (true only while the start/game-over overlay is actually shown),
so the score always lands.

**Fair kill box, faithful visuals.** A jet's lethal zone (`VENT_KILL_HALF`, checked in `SteamVent.hits`) is a **straight, constant-width band** capped at `STEAM_KILL_HEIGHT`, and the player is tested against it with a **narrow hurtbox** (`HURTBOX_HALF_WIDTH` ~0.24, well under the visual `PLAYER_HALF_WIDTH` 0.42) so the lethal band sits *inside* the visible steam — clipping the edge of a cloud never kills you (the "invisible hitbox" complaint). The exact lethal column is also drawn on screen every danger state via the vent's telegraph (floor decal + warning pillar, see the `SteamVent` bullet). The steam column is tuned to **track that band closely** — puff centres stay inside it (`sBaseX` spread `* VENT_KILL_HALF * 0.85`), the column runs nearly straight (only a slight sway, not the old fan-out cone), `STEAM_SIZE` (~the kill width) keeps a single puff from being wider than the danger, and `STEAM_VISUAL_HEIGHT` sits just above `STEAM_KILL_HEIGHT`. At the **start of the active phase** the jet gets an `ERUPT_LEAD` (~0.13 s) window where it blasts up (a full-height column is seeded at once, opacity whooshing in) but is **not yet lethal** (`hits` returns false while `eruptLead > 0`) — this closes the old "died in the sparks before the vapour appeared" gap, where the kill zone was live at full height while the puffs were still climbing from the floor. During **dissipate** the jet lifts off the floor (no wrap) — that floating remnant is intentional and non-lethal. `VENT_KILL_HALF` is tuned so two adjacent active vents seal the gap between them (waves/cages are real walls) while a single vent leaves its neighbour cells clearly safe.

**No wall jump / no wall cling.** Removed: the only way to gain height on a wall was chaining wall-jumps (a single ground jump apex is ~2.7 units, far under `STEAM_KILL_HEIGHT` 6.2), and clinging by itself capped fall speed but never got you above the kill height — so without the jump it had zero survival value, just a vestigial "stuck to the wall" feel. The side walls are now plain solid boundaries (stop horizontal motion, no effect on gravity). Escapes during a full `cage` or `wave` are purely floor-based: `cage` always keeps a safe column within reach of the player's position (see `launchCage`), and `wave` is thin enough to dash through to the cleared side (see the `wave` pattern note below).

**Wave pattern is exclusive (no stacking).** A sweeping `wave`'s own overlap is tuned to ~2 simultaneously-lethal columns (`waveActive ≈ step * 2`), but until `VentField` tracked this, the pattern scheduler could launch another pattern (or even a second wave) on top of an in-progress sweep — since the gap between pattern launches (`PATTERN_GAP_*`, down to 0.55 s) is shorter than a wave's full lifetime (several seconds), stacking could push simultaneously-lethal columns past 3, wide enough that no dash could cross it. Fixed with two guards in `VentField`: `waveInProgress()` (true while the wave still has queued columns, or any already-triggered column is still `warning`/`active` — checked via `SteamVent.dangerous`) blocks new pattern launches until the sweep is no longer a real threat (dissipate, being visual-only, doesn't count so the field frees up promptly); and `launchPattern` refuses to start a **new** wave on top of existing danger from another pattern (falls back to `single`/`cluster` instead), so a sweep always starts on a clean field. Together these cap a wave at its own ~2-wide band without slowing the front (`step` is untouched).

**Dash = the panic button.** The dash grants `DASH_IFRAME_TIME` of invulnerability (slightly longer than the dash itself) and floats horizontally with no gravity, so a well-timed dash passes *through* a last-moment jet. It covers a **fixed, predictable distance** (`DASH_SPEED · DASH_TIME`): the carried velocity is cut to a walk (or a stop) the frame it ends, so you always know where it lands instead of sliding on. It has a cooldown so it can't be spammed.

**Standing on the grille (render-only, no walk animation needed).** The vent grilles (`vent.py`'s `H=0.16`; the fallback box is 0.14) tile the floor **edge to edge** (`VENT_COUNT · CELL_WIDTH` == the full room width, no gaps), so their top surface is a *constant* height above `FLOOR_Y` everywhere the player can stand — not per-tile terrain. That let the "the diver looks sunk into the floor instead of standing on the grille" fix be a pure render offset: `Player.visualY` (`y + PLAYER_GRILLE_LIFT`) is what the mesh is positioned at; the logical `y` (gravity, ground/ceiling clamps, the steam-height check, dash/jump math) is untouched, so this carries zero gameplay risk and needs no walk-cycle (there's nothing to bob between — the "step" is the same height everywhere). `Game` uses `visualY` too when placing cosmetic particle bursts (death, dash) at the character's feet, so they don't look detached from the model.

**Jump is a reposition, not a commitment.** A ground jump can't clear the steam (`STEAM_KILL_HEIGHT` 6.2 » the ~2.7-unit apex — that's what makes the walls the real escape) so it exists to *reposition*, and it's tuned to stay responsive: strong `PLAYER_AIR_ACCEL` lets you steer to a safe landing mid-air, `FALL_GRAVITY_MULT` makes the descent snappy (less time helplessly airborne), and `COYOTE_TIME` + `JUMP_BUFFER_TIME` forgive a slightly early/late press. Without these the jump was a "death sentence" — airborne with weak control while a vent lit underneath you.

**Overload speeds everything via scaled dt.** `VentField.update` computes `sdt = dt * (overload ? OVERLOAD_TIME_SCALE : 1)` and advances every vent, the wave queue and the pattern timer on `sdt` — so warnings, jets and wave sweeps all double in tempo at once, and the pattern launches naturally get twice as frequent. The overload scheduler itself runs on real (unscaled) time.

**Camera must fit the room.** The room is a fixed box; `frameCamera()` picks the camera distance as the max of the height-fit and width-fit distances (with `CAMERA_MARGIN` slack) so the whole arena is visible on any aspect ratio — essential for narrow phone screens where the width is the binding constraint. Recomputed on every resize.

**Enter-to-start countdown.** From the start / game-over screen, Enter or a tap enters a `countdown` state showing 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP` s each) with the shared 750 Hz tick before play begins. Mandatory shared pattern (see root `CLAUDE.md`).

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("boilerbound", { getScore: () => this.score, onStart: () => this.beginCountdown() })`. `getScore` is the live centiseconds survived (the timeout partial). With `?room=` in the URL the game-over reports the score to the room instead of the global ranking, the restart input is blocked (one run per round), and `onStart` auto-runs the countdown so everyone starts together. Without the param nothing changes.

## Scoring

Score is **time survived in centiseconds** — `direction: "higher"`, formatted as a `m:ss.cc` clock (`formatClock`). Declared in `meta.ts` (`export const scoring`).
