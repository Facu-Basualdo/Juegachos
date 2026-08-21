# Hole in None (id: mini-golf)

A 3-hole cartoon minigolf in 3D (Three.js), Golf It style: drag back from the
ball to aim and dose the power, release to putt. Each hole has a safe route
and one **risky shortcut**; falling off the course costs +1 stroke and a reset
to the shot origin. **Score is total strokes across the 3 holes — lower is
better** — which is what makes it work both solo (global ranking) and in rooms
(placement by fewest strokes).

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — orchestrates scene/camera/renderer and the `loading → ready →
  countdown → playing → sinking → transition → gameover` loop. Renders through
  an **`OutlineEffect`** (ink outlines) with `NoToneMapping` — the cel-shaded
  look (see `DESIGN.md`, "Storybook Fairway — Golden Hour"). Owns the
  golden-hour lighting (amber key + honeyed hemisphere + warm fog), the
  **skydome** (gradient shader: gold horizon → dusk blue, garden shade below),
  the **foliage ring + forest canopy** around/under the floating islands
  (trees stand on pillow mounds, never floating), the unlit paper clouds —
  which orbit far out at the horizon so they never cross the player's view of
  the course — the cartoon **blob shadow** under the ball
  (raycast down against `Course.floorMeshes`), hole capture / rim assist, the
  fall penalty, and the stroke cap.
- `game/Physics.ts` — purpose-built ball physics: one sphere vs. oriented
  boxes + vertical cylinders, fixed `PHYS_STEP` substeps, two relaxation
  passes. Boxes may spin (`angularVel`, the windmill bar adds its surface
  velocity to the bounce); cylinders are the bumpers (restitution > 1 adds
  energy). No physics engine on purpose — deterministic and fully tunable.
- `game/holes.ts` — the three holes as data (`HoleDef`: floors, walls, ramps,
  bars, bumpers, tee/hole/par/camYaw). See "The holes" below.
- `game/Course.ts` — builds one hole from its def: cel-shaded meshes + the
  matching colliders (walls get a **mossy cap** face), the flag (Blender GLB
  clone, rotated so the flat pennant faces the tee), the **garden decor**
  (`DecorDef`: lantern posts with a warm PointLight, barrels — both are real
  round obstacles with cylinder colliders — and the windmill, scaled per
  `DecorDef.scale`, rotated to face the course, standing on a green pillow
  mound with its blades spun via the GLB's named `rotor` node), rotating bars
  and bumper hit-flashes via `update(dt)`.
- `game/Ball.ts` — physics state + the visual mesh (Blender golf ball GLB,
  toonified; primitive sphere fallback). Rolls the mesh by arc length.
- `game/AimController.ts` — the one-gesture input: pointer-down near the ball
  (screen-space `AIM_PICK_PX`) starts an **aim** (pull back = direction +
  power, arrow preview colored yellow→red); anywhere else **orbits** the
  camera; wheel / two-finger pinch zooms. Also owns the smooth follow camera.
- `game/toon.ts` — cel-shading toolkit (`makeToonGradient`, `toonify`),
  duplicated from Boilerbound per the repo decoupling rule.
- `game/Models.ts` — loads the GLBs with graceful fallback to primitives.
- `game/Hud.ts` — DOM overlay: hole/strokes/total card, banners (hole result,
  penalties), start / scorecard screens, countdown label, leaderboard panel.
- `game/SoundEffects.ts` — synthesized Web Audio (countdown tick, putt, wood
  knock, bumper boing, cup drop, fall, finish arpeggio). No assets.
- `game/constants.ts` — **all tunable values** (physics, shot power, capture,
  camera, palette). Tune here first.
- `game/editor.ts` — **dev-only visual hole editor** (guarded by
  `import.meta.env.DEV`, verified absent from the production bundle). Open
  `/games/mini-golf/?edit=N` (N = 1..3) under `npm run dev`: a panel with a
  piece palette (walls, blocks, ramps, bars, bumpers, decor, floors, tee,
  hole), click-to-select + drag-to-move over the live course (every change
  rebuilds the real `Course`, so physics testing is immediate via the
  "MODO: PROBAR" toggle), keyboard sizing/rotation, localStorage persistence
  per hole (`mg:editor:<i>`), and "Copiar JSON" which exports the working
  `HoleDef` to paste into `holes.ts`. Game exposes `buildEditorApi()` /
  `rebuildCourse()` and gates aiming, cup capture and the fall penalty while
  `editMode` is on.

## The holes

1. **La Herradura** (par 2) — a true U dogleg, layout **designed by the
   project owner in the map editor** (see `game/editor.ts`). The central
   block meets the near wall, sealing the direct tee → hole line completely:
   every shot goes around the bend, where a bumper guards each lane. The
   hole sits partway down the far lane, its flag visible over the block from
   the tee. The ace is one strong bank around the whole U threading both
   bumpers — verified hard (no ace found in a 5-line sweep; best attempts
   end one putt out).
2. **El Molino** (par 3) — a striped bar sweeps the full fairway width (time
   it), then an uphill slope to a raised green. Shortcut: the blue side ramp
   flies over the bar at ~80% power and can land on the green; off-line
   launches clear the low side walls and fall to the void (+1).
3. **La Isla** (par 4) — the green floats across a 3.5-unit void; safe route
   is a narrow side bridge (outer rail only). Shortcut: the blue launch ramp
   dead ahead, and the green's **back edge is open** (no far wall): the
   landing window is ~power 14.0-14.6 (a dead-straight 14.0 can even ace via
   rim assist); full power flies long and rolls off the back (+1), anything
   below ~13.9 drops in the void or skips off the curb (+1). The void width
   is matched to the ramp's **measured** carry (~z 10.5-11.5) — the ramp
   robs far more energy than ballistics suggest (entry impact + climb), and
   past ~14 the ball skips off the ramp and flies flatter, so re-measure with
   a sweep after touching the ramp, gravity or friction.

## Non-obvious decisions

**Gravity is -14, not "realistic".** The shortcut ramps are the game; with
heavier gravity no reachable launch speed crosses La Isla's void. -14 gives
Golf It's floaty, readable flights while grounded putting (unaffected by
gravity) still feels crisp. If you touch `GRAVITY`, re-balance both shortcut
ramps with a power sweep (see the La Isla note above).

**Greens are slow and soft** (`GREEN_FRICTION`, `GREEN_REST` — per-collider
overrides on `kind: "green"` floors via `Collider.friction`/`restitution`):
putts on a green brake harder and landings barely bounce. This is both feel
(real minigolf greens) and balance — it is what keeps La Isla's ramp landing
from skipping straight off the open back edge.

**Walls don't protect airborne balls.** Walls are 0.4 high and flights arc
well above them — that's intentional: it's what makes the shortcuts risky
(off-line launches leave the course) while grounded play is fully contained.

**Fall = +1 and back to the shot origin** (not the tee): the penalty stings
without erasing progress. `shotOrigin` is recorded on every shot.

**Hole capture is speed-gated** (`HOLE_CAPTURE_SPEED`): fast balls roll over
the cup. A slow ball near the cup gets a rim-assist pull (`HOLE_PULL`) so
near-misses lip in instead of stalling on the edge, then a `sinking` state
animates the drop before the transition banner.

**Stroke cap per hole** (`MAX_STROKES` = 8): reaching it closes the hole at
the cap (banner "LIMITE DE GOLPES") so a stuck player can't soft-lock a room
round.

**Room-mode live score counts unfinished holes at the cap**: `getScore` =
finished strokes + `MAX_STROKES` per remaining hole. Direction is `"lower"`,
so a timeout partial mid-hole ranks below anyone who finished with real
strokes — reporting raw strokes-so-far would rank the *least progressed*
player first.

**Enter-to-start countdown.** From the start / game-over screen, Enter (or a
tap) enters a `countdown` state showing 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`,
`COUNTDOWN_STEP` s each) with the shared 750 Hz tick before play begins.
Mandatory shared pattern (see root `CLAUDE.md`). In room mode `onStart` may
fire while models still load; `beginCountdown` defers via `pendingStart`.

## 3D models (Blender)

- **Assets:** `public/models/mini-golf/` — `golfball.glb` (unit-radius
  icosphere with real dimple geometry, scaled to `BALL_R` at load),
  `flag.glb` (cup rim + red/white barber-striped pole + pennant),
  `lantern.glb` (post + amber emissive glass), `barrel.glb` and
  `windmill.glb` (tower + named `rotor` node the game spins with
  `rotation.z`; it faces -Y in Blender so the y-up export faces +Z). Loaded
  with `GLTFLoader`, cel-shaded at runtime via `toonify` (which clamps GLB
  emissive intensity so toon glass reads amber, not blown white), graceful
  primitive/skip fallback.
- **Source scripts:** `tools/blender/golfball.py`, `flag.py`, `lantern.py`,
  `barrel.py`, `windmill.py` (shared helpers in `_common.py`). Regenerate with:
  `blender --background --factory-startup --python tools/blender/<name>.py -- public/models/mini-golf/<name>.glb`
- The pennant is a flat triangle extending +X; `Course` rotates each flag
  clone to face the tee so it never reads edge-on from the starting camera.
- Windmill gotcha: blade objects must have their location **baked into the
  mesh** before rotating them around the hub (`bake_location` in
  `windmill.py`), otherwise the four blades pile up at the hub.

## Performance note

Distant vegetation (foliage ring, canopy mounds) carries
`outlineParameters.visible = false` — `OutlineEffect` would double the fill
cost of the largest screen areas for contours the fog erases anyway; the
canopy floor is a single flat disc, not stacked spheres. Headless SwiftShader
benchmark: ~24 fps, vs ~13 fps for Boilerbound (the repo's other full-scene
3D game) under the same conditions — comfortably within budget on real GPUs.

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls
`initRoomMode("mini-golf", { getScore, onStart: () => this.beginCountdown() })`.
With `?room=` in the URL the finished round reports total strokes to the room
instead of the global ranking, and the restart input is blocked (one round per
match). Without the param nothing changes.

**F5 doesn't restart the round.** `completed` (the closed holes) and the strokes
already taken on the hole in progress are persisted to `sessionStorage` via
`src/shared/room/roomRun.ts`; `beginCountdown()` returns early when
`resumeSavedRun()` finds a snapshot. The ball goes back to the **tee** of the
current hole — as it does after a fall into the void — but **the strokes it cost
are kept**: otherwise a reload would be a free mulligan, and `direction` is
`"lower"`. `holeIndex` and `totalStrokes` are **derived** from `completed`, never
stored. `holeComplete` saves with an explicit `strokes = 0` (the strokes already
travelled inside `completed`) rather than zeroing the field, which is still being
compared against `MAX_STROKES` in the same frame. The fall penalty saves too.
`finishRound()` clears the snapshot; if all 3 holes were already in the snapshot
(the round ended during the reload) the resume goes straight to `finishRound()`.

## Scoring

Total strokes across the 3 holes, `direction: "lower"`, formatted as
`N golpes`. Declared in `meta.ts` (`export const scoring`). Room scores are
not sent to the global leaderboard.
