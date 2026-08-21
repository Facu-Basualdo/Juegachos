# Space Rush

(Display title "Space Rush"; the id stays `vector-rush` everywhere — folder,
paths, storage key `vector-rush-best`, scoring, room id.)

A 2.5D space ship-runner. The player pilots a star fighter through a wide open flight corridor in deep space, steering **left / right / up / down** to weave through fields of drifting space debris. Obstacles travel toward the ship along -Z and everything speeds up over time. Visual style is **space**: a deep parallax starfield, a huge close **ringed Saturn** (only partly in frame, banded rings sweeping across — modeled on a real Cassini-style close-up) plus a distant moon, faint rectangular corridor outlines marking the flight lane, lit tumbling debris, a white engine particle trail, a **fixed camera looking straight down the corridor axis**, and a **crash fireball** (particles + red flash + camera shake). `UnrealBloomPass` gives the glow.

Controls: arrows or WASD move in all four directions; on touch, dragging steers the ship analogically toward the pointer relative to screen center. There is no flip/dash — pure 2D steering within the (large) field bounds.

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — orchestrates scene/camera/renderer/composer + the game loop (`tick`). Owns the scene lights, the **fixed axial camera** (`(0,0,CAMERA_Z)` looking down -Z), and the crash effects: it fires the `Explosion`, spikes the red `crashFlash` PointLight, runs the decaying camera shake (`applyShake`), hides the ship, and **delays the game-over overlay 550 ms** so the fireball plays in the clear first.
- `game/Player.ts` — the ship: a composite star fighter (pointed fuselage, swept wings, wingtip cannons, twin white-hot engines, green canopy) from primitives, `MeshStandardMaterial` (lit) hull, plus a forward **PointLight headlight** and a small dim rear engine light (deliberately kept low — it read too bright). Velocity-smoothed x/y steering clamped to the field, bank/pitch tilt. `enginePorts()` returns the world-space exhaust positions for the trail.
- `game/EngineTrail.ts` — additive **white** point-cloud exhaust streaming behind the engines (world-space, since the ship stays at z=0 while the world scrolls). Per-vertex color fade, soft round sprite.
- `game/Explosion.ts` — a one-shot additive particle **fireball** for the crash (radial burst, white-hot cooling to ember, drag + fade). Persistent point cloud reset on each run.
- `game/Space.ts` — the backdrop: a wrapping parallax **starfield** (`THREE.Points`, soft dot sprite), a pool of scrolling **rectangular corridor outlines** that mark the flight-lane cross-section, and a static far **vista** (`buildVista`): a huge close Saturn (banded `MeshStandardMaterial` globe + additive atmosphere rim + ~22 concentric ring annuli with a Cassini gap) and a small cratered moon. Ring annuli depth-test against the opaque globe, so the far arc is naturally occluded behind the planet.
- `game/dotTexture.ts` — cached soft radial-gradient sprite shared by the starfield, trail and explosion (round glows, not squares).
- `game/Obstacle.ts` + `game/ObstacleSpawner.ts` — debris-field obstacles (see below): spawn, recycle, collision.
- `game/InputController.ts` — keyboard (arrows/WASD) + analog pointer steering (`dirX` / `dirY`, each -1..1).
- `game/Hud.ts` — DOM overlay (score, start/game-over screens, leaderboard, countdown).
- `game/SoundEffects.ts` — synthesized Web Audio effects: a chip blip per field cleared, a crash on hit, the shared countdown tick. No assets.
- `game/constants.ts` — all tunable values (field size, ship speed, travel speed ramp, obstacle pacing, clear-lane sizes, debris counts, colors). **Tune here first.**
- `game/mathUtils.ts` — `clamp` helper.

## Obstacles: debris fields (`Obstacle.ts`)

Each obstacle is an **invisible barrier across the whole corridor cross-section with one rectangular clear lane** — the only way through — dressed with a **sparse scatter of tumbling space objects** that telegraphs it. Collision is the **lane test** (`isSafe` = the whole ship footprint, `PLAYER_HALF_WIDTH/HEIGHT`, sits inside the lane rect with `COLLISION_TOLERANCE` slack): anywhere outside the lane is a crash, so you can't slip through a corner or drag along the floor. The debris is deliberately **sparse** (it is decoration, not the collider) so a field never obscures the next one; the four **amber lane markers**, not the debris, are what tell the player where the safe hole is. Three visual kinds, chosen at random per spawn (`ObstacleSpawner`, equal weight):

- **`meteor`** — lumpy grey faceted rocks.
- **`ice`** — elongated pale-blue crystal shards (faintly emissive).
- **`debris`** — metallic boxes and cylinders (ship wreckage).

Debris density is set by `DEBRIS_CELL` (bigger = fewer objects), `DEBRIS_KEEP_CHANCE` (random thinning for fine control) + `DEBRIS_OBJ_MIN/MAX_RADIUS`; the clear lane shrinks with score (`LANE_*`). Each field exposes its clear-lane center (`centerX/Y`) for reachability chaining (see below). Because the barrier is a hard wall, **reachability is critical** — an unreachable lane is an unavoidable crash — so keep an eye on `GAP_REACH_FACTOR` when tuning speed/spacing.

## Non-obvious gotchas

**Reachability keeps it fair:** `ObstacleSpawner` caps how far each field's clear-lane center may drift from the previous one to `PLAYER_MOVE_SPEED * (spacing / speed) * GAP_REACH_FACTOR` (clamped to keep the lane in-field). Without this, the safe lane could jump farther than the ship can travel before the next field arrives — luck, not skill — and it gets impossible as speed ramps. Tune `GAP_REACH_FACTOR` (slack for smoothing) if the game feels too tight or too loose.

**Lit vs unlit materials:** the ship hull, debris objects and the Saturn globe/moon use `MeshStandardMaterial` (shaded by the scene `DirectionalLight`/`HemisphereLight` and the ship's headlight `PointLight`) — this is what gives the debris its 3D form and Saturn its terminator/depth. The starfield, corridor outlines, ring annuli, atmosphere rim, engine trail and explosion use unlit `MeshBasicMaterial`/`PointsMaterial`. The planet vista sets `fog: false` on its materials so it stays crisp beyond the fog that fades the debris/stars.

**Crash juice (`endGame`):** the hit fires an `Explosion.burst` at the ship, spikes a red `crashFlash` PointLight (decayed in `tick`), starts a decaying camera shake (`applyShake` jitters the otherwise-fixed camera, then snaps it back to `(0,0,CAMERA_Z)`), and hides the ship. The game-over overlay is deferred 550 ms via `setTimeout` (guarded by a `state === "gameover"` re-check) so the fireball is visible before the dark overlay covers it. These run in every tick state, so they play over game-over. Ported in spirit from the event pulses + camera shake in `penalty-keeper` / `barra-libre`.

**`menuVisible` gates the restart during that 550 ms.** The deferred overlay is what calls `reportScore`/`showRanking`, and its `state === "gameover"` re-check aborts if the player restarted mid-window — so without a guard, restarting during the explosion silently **dropped the run's leaderboard submission**. `handleActivate` now bails on `!menuVisible` (true only while the start/game-over overlay is actually shown), so the score always lands.

**Fixed axial camera:** the camera is fixed at `(0,0,CAMERA_Z)` looking straight down the corridor axis (-Z). Because the field is large, the ship (which moves freely in x/y) can sit anywhere on screen, seen tail-on. `CAMERA_Z` must stay far enough back that the whole field cross-section fits in the vertical FOV.

**Despawn point:** debris despawns shortly after passing the *ship* (`OBSTACLE_DESPAWN_MARGIN` from `playerZ`), not the camera, so an object never balloons across the screen and blows out the bloom.

**Enter-to-start countdown:** from the start or game-over screen, Enter / Space (wired in `Hud`) or a pointer tap enters a `countdown` state that shows 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`, `COUNTDOWN_STEP` seconds each, in `Game.ts`) before play begins; the starfield keeps scrolling during the countdown and steering input is ignored until it finishes. Each label plays `SoundEffects.playCountdownTick()` once (guarded by `lastCountdownIndex`).

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("vector-rush", { getScore: () => this.score, onStart: () => this.beginCountdown() })` (see root `CLAUDE.md`, "Salas"). With `?room=` in the URL the game-over reports the score to the room instead of the global ranking, the restart input is blocked (one run per round), and `onStart` auto-runs the countdown so everyone starts together. Without the param nothing changes. Scoring is the default higher-is-better board (fields cleared), so `meta.ts` omits `scoring`.
