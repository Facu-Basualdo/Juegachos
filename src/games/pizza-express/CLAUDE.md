# Pizza Express

A Paperboy-style endless delivery runner in **Three.js**, set in a golden-hour
suburb ("Cheesetown"). You ride a red delivery scooter down an endless street:
**steer left/right to dodge road hazards** (instant death on contact) and **throw
pizzas at roadside mailboxes** that have a pending order (marked by a bright
downward **arrow**). A throw is delivered to the customer **on the side of the
street the scooter is on**; a throw with no customer in range on that side is an
**errant pizza** that costs you a token. Throws only connect inside a **timed
window** (`THROW_MIN_Z`..`THROW_RANGE_Z` ahead): too early is out of range and
too close is too late to lob — both are errant. Deliveries score points with a
**combo multiplier**. During the 10-second tutorial a **shield** (shown top-left)
cushions errant throws; once the tutorial ends the shield is gone and you run on
two token pools (both shown top-left, spent ones greyed): **3 pizza tokens** for
errant throws and **5 mailbox tokens** for customers you let pass unserved (each
skip also breaks the combo) — empty either pool and the run ends. It is a single
infinite level whose speed, hazard density and customer pace
**ramp fast** after a 10-second tutorial. It is **PC-oriented** (keyboard; no
touch button). Solo score is total points (higher is better, default board). Art
direction: `DESIGN.md` ("Golden Hour Delivery"), based on the game's cover.

## Coordinate system

The road runs along **Z**. The scooter stays near `z = 0` while the world scrolls
toward the camera (**+Z**); obstacles and mailboxes spawn far ahead (negative Z)
and travel toward `+Z` (same convention as Space Rush / `vector-rush`). Y is up,
the road surface is `y = 0`. The scooter only moves in **X** (steering).

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — orchestrates scene/camera/renderer/composer and the
  `ready → countdown → playing → gameover` loop (`tick`). Owns the warm
  golden-hour lights, the **chase camera** (behind + above, easing its X toward
  the scooter — `applyCamera`), the difficulty ramp (`difficulty()`, stepped),
  scoring + combo, throwing (`handleThrow`) and delivery (`deliver`), and the
  crash juice (dust/tomato particle burst, warm `crashFlash` PointLight, camera
  shake, hidden scooter, game-over overlay **deferred 600 ms**).
- `game/Street.ts` — the environment: the **road + dirt shoulders** scroll their
  canvas-texture UV for an endless surface (the moving dashes are the speed cue),
  while the **grass stays still** (a sliding grass sheet looked cheap — flat green
  detail moving reads as the surface itself sliding). The grass is a **flat solid
  green with no texture at all**: any pattern on it — fine speckle and big soft
  mottling were both tried — has no stable landmark at the grazing camera angle,
  so the surrounding motion perceptually drags it along ("motion capture"
  illusion) and the static grass *looks* like it slides with the road; that
  illusion, not any actual scrolling, was the bug behind "el pasto se mueve".
  Featureless, the surface cannot read as moving, and all motion over it comes
  from **discrete objects passing**: besides the house clusters, `buildMeadow`
  fills the field beyond the house line (`|x| >= MEADOW_MIN_X` = 13, so the two
  pools never overlap) with **little trees + bushes** (shared geometry /
  materials) on their own denser Z grid, pushed into the same wrapping-cluster
  pool so they stream past exactly like the houses (fixed-in-world meadow decor
  was tried too — props frozen mid-field while the town flows past read even
  worse than the sliding-grass illusion). Besides, a broken row of
  raised **bushes** (`buildHedgeBorder`) runs along the road/grass boundary as a
  clear **separation**; being distinct 3-D clumps with gaps, they read as objects
  *passing* as they scroll, and together with the **wrapping pool** of roadside
  props (cottages, trees, hedges, fences, warm lamp posts) they carry the sense of
  motion. Plus a static dusk sky (gradient dome, low sun + halo, drifting clouds, a
  hill silhouette baked into the sky texture). Purely decorative.
- `game/Scooter.ts` — the player: a primitive red scooter + rider (red cap,
  delivery box on the rear rack) cel-shaded; X steering with velocity smoothing,
  lean + yaw into turns, engine idle bob, spinning wheels, a headlight. Exposes
  `throwOrigin()` (world point a pizza launches from).
- `game/Obstacle.ts` + `game/ObstacleField.ts` — road hazards (cone, pothole,
  trashcan, crate, **car** = a car parked parallel to the road (long in Z: it is
  the only kind with a `halfLength`, so collision keeps testing while it
  straddles the scooter's plane, nose to tail, instead of the usual single
  centre-crossing frame), and the **dog** = the one *dynamic*
  hazard), all **instant-death**. `ObstacleField` spawns gap-based rows that always
  leave a **guaranteed clear gap** the scooter can reach (see "Fairness" below);
  static obstacles go *outside* the gap. A dog instead spawns as its own **patrol
  row** (`spawnDog`): a lone dog that trots across the whole street, reversing at
  the verges (`Obstacle.setPatrol`), dodged by **timing** rather than by a gap.
- `game/Mailbox.ts` + `game/MailboxField.ts` — customers. A `Mailbox` floats a
  bright bouncing **down-arrow** over it while `pending` (clearer than the old
  pizza icon); delivery flips its flag up. It carries a `reserved` flag set when a
  pizza is in flight toward it, so it is **not** counted as a miss mid-flight. The
  field spawns them along the verges, tracks pending ones, reports **misses**
  (passed unserved), and exposes `nearestPendingTarget(side)` — the closest
  pending, unreserved customer **on that side** inside the timed throw window
  `[THROW_MIN_Z, THROW_RANGE_Z]` ahead, or null (an errant throw — including at a
  box that is still pending but already too close to lob at).
- `game/Pizza.ts` — `PizzaThrower`: a pool of pizzas that **lob on a parabola**
  from the scooter toward the assigned pending mailbox (**homing** on the moving
  box), delivering on arrival via an `onDeliver` callback. A throw with no valid
  customer arcs to the verge and fizzles.
- `game/Particles.ts` — one additive point-cloud pool for cosmetic bursts (crash
  dust + delivery cheese-gold sparkle). Gravity + drag + colour fade.
- `game/InputController.ts` — steering (`dirX`, -1..1) from A/D + arrows or a
  pointer drag, plus **throw** edge-events from Space/W/Up/J/K and a quick tap on
  the canvas (a tap = throw, a drag = steer).
- `game/Hud.ts` — DOM overlay: score + **combo** + best, the **miss-token strip**
  (a cool inline-SVG shield + 3 warm pizza tokens + 5 mailbox tokens behind a
  divider, spent ones greyed), the tutorial
  **thought bubble** (above the character, with a down-tail), start/game-over
  screens (two titles: crash vs "perdiste muchos pedidos"), countdown label, and
  the leaderboard panel. No throw button (PC-oriented).
- `game/SoundEffects.ts` — synthesized Web Audio (countdown tick, throw whoosh,
  delivery ding whose pitch rises with the combo, miss blip, crash), no assets.
  Plus the **2-stroke moped engine loop**: a persistent node graph tuned as a
  high MOSQUITO whine, not a low drone (idle ~95 Hz, flat out ~235 Hz — a first
  52-128 Hz version read as a small plane): two detuned saws at the firing rate
  + an octave-up "whine" saw + a highpass stripping the boomy lows + band-passed
  exhaust noise amplitude-chopped at the firing rate + a slow LFO putter.
  Started by `startEngine()` in `startGame`,
  revved via `setEngineSpeed(t)` each playing tick (t = normalized travel speed,
  so the pitch climbs with the ramp), and cut by `stopEngine()` in `endGame`
  (both the crash and the out-of-pizzas endings) and in `beginCountdown` (safety
  for room-mode round restarts). `setEngineSpeed` skips sub-1.5% changes so the
  per-frame calls don't flood the automation timeline.
- `game/toon.ts` — cel-shading helpers: a cached stepped `gradientMap`, `toonMat`
  (a `MeshToonMaterial` factory) and `glowMat` (unlit / additive glow for
  markers, sun, sparks).
- `game/dotTexture.ts` — cached soft round sprite for the particles.
- `game/constants.ts` — **all tunable values** (road/field, speeds, difficulty
  ramp, `TUTORIAL_SECONDS`, `MISS_PIZZAS`, `MISS_CUSTOMERS`, obstacle pacing +
  gap, mailbox pacing, throwing, scoring, palette). Tune here first.

## Core loop

- **Dodge:** the scooter (X only) must avoid every hazard. A single touch ends the
  run (instant death, like Space Rush / Cannon Dodge).
- **Deliver:** press throw (Space / W / ↑, or a canvas tap) and a pizza auto-lobs
  to the closest pending mailbox **on the side the scooter is on** (`scooter.x`
  sign) inside the **timed window** `[THROW_MIN_Z, THROW_RANGE_Z]` ahead — beyond
  it is out of range and closer than `THROW_MIN_Z` is too late to lob, so each
  delivery is an exact timing call (the window used to be 0.5..18, which let you
  hold the throw until fully alongside and never miss). Delivery =
  `DELIVERY_BASE_POINTS × combo`; the combo climbs (capped at `COMBO_MAX`) with
  each delivery. Throw has a `THROW_COOLDOWN`. So positioning matters: to serve a
  left customer, be on the left half — this is what the second tutorial hint
  teaches.
- **Errant throw = the token cost.** A throw with **no deliverable customer on the
  scooter's side in range** is wasted: it **resets the combo to 0 and spends a
  token** (decided at throw time in `handleThrow` → `onErrantPizza`, so spamming is
  punished). The **shield** (`shieldActive`) is a *tutorial-only* cushion that
  absorbs the first errant throw and **disappears when the tutorial ends**
  (`updateTutorial`); errant throws are otherwise **free during the tutorial**. In
  the real game each errant throw costs a pizza (`pizzasLeft`, from `MISS_PIZZAS`)
  and running out ends the run (game over, "misses" reason).
- **Skipped customer = the mailbox cost.** A customer that passes unserved
  (`onCustomerMissed`) breaks the combo and, after the tutorial, also spends one
  of the **5 mailbox tokens** (`customersLeft`, from `MISS_CUSTOMERS`); an empty
  pool ends the run just like wasting the pizzas does (it used to cost nothing
  but the combo, which made skipping customers free). So besides crashing there
  are two miss-based failure modes, one per pool. **The pools never double-charge
  one mistake**: an errant throw at a customer already in the too-late band
  (`MailboxField.dismissLateTarget`, called from `handleThrow`) marks that box
  missed on the spot — the wasted pizza *was* the attempt, so its passing does
  not also charge a mailbox token. A skip only costs when you never threw.
- **Tutorial (first `TUTORIAL_SECONDS`):** a gentle intro — **no lethal
  obstacles**, two thought-bubble hints (throw controls, then "position yourself on
  the side you want to throw to"), and errant throws are **free** (only the shield
  can be spent, never a pizza, and it can't end the run). When the tutorial ends the
  shield vanishes and the speed + difficulty ramp start (`playT = elapsed −
  TUTORIAL_SECONDS`).
- **Score** = total points (deliveries × combo). Higher is better, default board.

## Non-obvious decisions

**`menuVisible` gates the restart during the deferred game-over.** The game-over
overlay is deferred (600 ms after a crash, 250 ms otherwise) so the crash plays in
the clear, and that deferred callback is what calls `reportScore`/`showRanking` —
guarded by a `state === "gameover"` re-check that aborts if the player restarted
mid-window. Without a guard, restarting during that window silently **dropped the
run's leaderboard submission**. `handleActivate` now bails on `!menuVisible` (true
only while the start/game-over overlay is actually shown), so the score always
lands.

**Fairness — the gap is always reachable.** `ObstacleField.spawnRow` picks a safe
gap `[gapX ± gapHalf]` whose centre drifts from the previous row by at most the
scooter's reachable travel (`SCOOTER_MOVE_SPEED × spacing/speed ×
GAP_REACH_FACTOR`), and shrinks with difficulty. Obstacles are placed **only
outside** that gap (`place()` confines each prop's full width to a blocked side
region), so the clear path is never blocked and never jumps farther than you can
steer — hard but never luck. A row adds a second obstacle on the other side with
growing odds (`DOUBLE_OBSTACLE_CHANCE_MAX`), and cars only spawn in regions wide
enough to fit one with margin (the `pickKind` gate).

**The dog is the dynamic obstacle.** Every other hazard is static and placed
outside the row's clear gap; the dog instead trots across the full road width
(`DOG_SPEED_*`, growing with `d`) as the *only* hazard in its row. It stays fair
because collision is only tested the single frame it reaches the scooter's Z, its
band is narrow (`HALF_WIDTH.dog`), and its patrol speed is far below the scooter's
— so from anywhere you only need to sidestep its band as it arrives. Dog rows
don't touch `prevGapX`, so gap continuity for the surrounding static rows is
preserved, and the small sidestep keeps you near that gap line. `DOG_ROW_CHANCE_*`
tunes how often they appear.

**Difficulty is a stepped function of play time.** `Game.difficulty(playT)`
quantizes **post-tutorial** play time into levels (`DIFFICULTY_STEP_SECONDS`) so
the game visibly steps up, reaching its hardest values at `DIFFICULTY_RAMP_SECONDS`
(~60 s) then holding. It drives obstacle spacing, gap width, double-obstacle odds
and mailbox spacing. The travel **speed** ramps continuously (`BASE_SPEED →
MAX_SPEED`) off the same `playT`, and is held at `BASE_SPEED` during the tutorial.

**Throwing is a timed lob, not a snipe.** The throw window is bounded on both
ends: `THROW_RANGE_Z` is deliberately short so you deliver as a customer
approaches (Paperboy timing), and `THROW_MIN_Z` cuts off the last stretch so
holding the throw until the box is alongside no longer works — the drop must be
timed inside the band. The pizza homes on the mailbox's *current* position each
frame so a throw made inside the window always lands even though the box is
moving toward you.

**Delivery vs errant is decided at throw time.** `handleThrow` picks the target on
the scooter's side; if one exists it is `reserved` (so it can't be marked missed
mid-flight) and the pizza delivers on arrival; if none, the throw is errant and
`onErrantPizza` runs immediately (token cost + combo break), while the pizza just
flops to the verge for show — and if a pending customer sat in the too-late band,
`dismissLateTarget` burns it right there so it can't charge a skip on top of the
wasted pizza. Deciding at throw time avoids a mid-flight target passing you and
double-counting as both a miss and an errant.

**Auto-start / idle drift.** On the menus and during the countdown the street
keeps scrolling (idle `street.scroll`) so the town is never frozen; obstacles run
with an off-road scooter X (`999`) so nothing "collides" while idle.

**Enter-to-start countdown.** From the start / game-over screen, Enter / Space or
a tap enters a `countdown` state showing 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`,
`COUNTDOWN_STEP` s each) with the shared 750 Hz tick before play begins. Space
serves double duty: on the menus it starts (via `Hud`'s activate); while playing
`Game.handleActivate` ignores it (already playing) and it throws instead (via
`InputController`). Mandatory shared pattern (see root `CLAUDE.md`).

**Warm-only rendering.** `MeshToonMaterial` (cel bands) for props, `ACESFilmic`
tone mapping, and **gentle high-threshold bloom** so only the sun, order markers
and pizzas glow — not the whole warm scene. Fog is a peachy haze. No cold colours
anywhere (see DESIGN.md).

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("pizza-express",
{ getScore: () => this.score, onStart: () => this.beginCountdown() })`. `getScore`
is the live points for the timeout partial. With `?room=` in the URL the game-over
reports the score to the room instead of the global ranking, the restart input is
blocked (one run per round), and `onStart` auto-runs the countdown so everyone
starts together. Whoever scores the most points wins the round. Without the param
nothing changes.
