# Cannon Dodge

Survival dodger on a round tropical pirate island seen top-down. Cannons pop up
at random points on the island rim, telegraph their aim, then fire cannonballs in
**straight lines across the island** (they are NOT aimed at the player — each
picks a chord through the island's middle). You move freely on the sand and dodge;
**one touch ends the run**. The score is **time survived in seconds** (`direction:
"higher"`, formatted `N.N s` in `meta.ts`). Difficulty ramps continuously with
survival time. Plain 2D `<canvas>`, no Three.js.

## Module layout

- `main.ts` — entry point, mounts `Game` into `#app`.
- `game/Game.ts` — orchestrates the canvas, the `ready → countdown → playing →
  dead` state machine, the survival clock (the score), the `requestAnimationFrame`
  loop, death screen-shake, and the fixed-view→window letterbox scaling.
- `game/Player.ts` — the pirate: analog 8-direction movement with a little
  acceleration, confined to the sandy play circle (`maxDist`), sliding along the
  shore instead of sticking. `radius` is the collision radius.
- `game/CannonField.ts` — owns every live `Cannon` and `Cannonball`, the spawn
  ramp, and the collision test. `update(dt, player)` returns a `FieldResult`
  (`spawned` / `fired` / `died`) the `Game` turns into sound + particles. The pure
  `difficulty(t)` function eases spawn interval, ball speed, telegraph time and
  burst count from their START to their MIN/MAX over `RAMP_SECONDS`.
- `game/Cannon.ts` — one rim cannon: `telegraph` phase (draws the warning) then
  `fired` (spawns 1..`burst` balls fanned by `BURST_SPREAD`, then lingers as smoke
  before removal). Its aim is a chord toward a random point within `AIM_SPREAD` of
  the centre — never the player.
- `game/Cannonball.ts` — a ball travelling straight; keeps a short position
  `trail` for the streak, culls itself once `offMap`, and `hits()` tests the
  player circle.
- `game/DodgeChannel.ts` — room-mode only: an ephemeral Supabase broadcast
  channel (`dodge:<code>:<round>`, no DB) that streams each pirate's position
  ~11x/s so players see each other live. Same pattern as Neon Drift's
  `RaceChannel` (duplicated, not shared, per the decoupling rule).
- `game/Renderer.ts` — all 2D drawing. Bakes the static island (sea gradient, foam
  rings, sand + speckle, seeded palms/rocks, a lighter centre clearing) once into
  an offscreen canvas; each frame draws that, then telegraph lines, cannons, balls
  (+ shadow/specular so the black ball reads on any sand), the pirate, particles.
- `game/Particles.ts` — tiny pool for muzzle `smoke` and the death `burst`.
- `game/InputController.ts` — WASD/arrows (digital) exposed as `vecX`/`vecY`, plus
  a floating analog touch **joystick** spawned under the finger; `onAction`
  (Enter/Space/tap) starts and restarts.
- `game/Hud.ts` — DOM overlay (live time, best, start / game-over screens,
  countdown label, leaderboard panel).
- `game/SoundEffects.ts` — synthesized Web Audio (countdown tick, cannon "appear"
  clack, fire boom = sweep + noise crack, death hit), no assets.
- `game/constants.ts` — all tunable values. **Tune here first.**
- `DESIGN.md` — art direction ("Sunlit Cove").

## Non-obvious decisions

**Fixed square view, scaled to fit.** Authored against `VIEW_SIZE`×`VIEW_SIZE`
(720²) so the island stays circular and physics feel identical at any window size;
`Game.render()` letterboxes it with `ctx.scale()`/`translate()` (dpr folded in),
clipped to the view rect. The death shake jitters the world inside that clip.

**Shots cross the island, they don't chase you.** By design (the programmer chose
"straight shots that cross the island" over aimed shots). Each cannon aims at a
random point within `AIM_SPREAD` (130px) of the centre, so balls sweep chords
through the middle at varied offsets. Edge-camping isn't safe (chords reach the
rim at both ends) but gives you less room to escape — the intended risk/reward.

**Fairness is the telegraph.** Cannons always play a `telegraph` phase (dashed
amber→red line + growing muzzle glow) before firing. `TELEGRAPH_MIN` is a floor so
even at max difficulty a shot is dodgeable. Balls spawn at the muzzle (radius just
outside the player's play circle) travelling inward, so they never appear on top
of the player.

**Difficulty is a pure function of time, stepped every 2 s.** `difficulty(t)` in
`CannonField.ts` quantizes elapsed time into discrete levels (`level =
floor(t / STEP_SECONDS)`, `STEP_SECONDS = 2`) so the game clearly steps up every
2 s instead of ramping frame-by-frame. Each level tightens the spawn interval,
ball speed and telegraph by an even (linear) amount, reaching the hardest values
at `RAMP_SECONDS` (100 s = 50 levels) and then holding. Balls per cannon (`burst`)
gains +1 every `BURST_STEP_LEVELS` (17) levels — i.e. at ~34 s and ~68 s — up to
`BURST_MAX`. To rebalance, edit the START/MIN/MAX constants, `STEP_SECONDS` (how
often it steps) and `RAMP_SECONDS` (when it caps).

**Enter-to-start countdown.** From the start / game-over screen, Enter or a tap
enters a `countdown` state showing 3 / 2 / 1 / YA (`COUNTDOWN_LABELS`,
`COUNTDOWN_STEP` s each) with the shared 750 Hz tick before play begins. Mandatory
shared pattern (see root `CLAUDE.md`).

## Room mode (multiplayer)

Wired to the shared party mode: the constructor calls `initRoomMode("cannon-dodge",
{ getScore, onStart, onReportedWaiting })`. `getScore` is the live survival time so
a timeout-cut round still reports the seconds survived. With `?room=` in the URL the
game-over reports the score to the room instead of the global ranking, the restart
input is blocked (one run per round), and the round auto-starts via `onStart`.
Whoever survives longest wins the round. Without the param nothing changes.

**Muerto = espectador.** In room mode `die()` does not show the game-over overlay:
it shows a bottom banner (`Hud.showSpectate`) with the final time and returns `true`
from `onReportedWaiting`, which tells `RoomMode` to hide the generic "esperando a
los demas" screen. The `dead` branch of `update()` keeps calling `stepField(dt)`, so
the cannons and balls go on firing — being the same seeded world the survivors are
playing, the pirates you watch are dodging exactly the shots you see. The collision
result is ignored (we're already sunk) and the score clock is frozen at death. The
banner is cleared in `beginCountdown()`; when the round closes, `RoomOverlay`'s
results screen covers everything as usual.

**Live view of the other players (Neon Drift model).** In room mode you don't
dodge alone — you see every other player's pirate moving on the *same* island in
real time. Two pieces make this work, mirroring `car-race`:

1. **Seeded shared world.** `setupRoom()` fetches the round and derives a seed
   `hashStr("<code>:<round>")`; `beginCountdown()` passes it to
   `CannonField.reset(seed)`, which drives a `mulberry32` RNG for every random
   choice (spawn jitter, rim angle, aim chord). Because all clients share the seed
   and auto-start together (`onStart`), everyone simulates the *same* cannons and
   balls, so the remote pirates you see are dodging the exact shots you are. Solo
   passes a random seed, so each run differs.
2. **Ephemeral position broadcast.** `DodgeChannel` streams our `{x, y, facing,
   alive}`; incoming snapshots fill a `remotes` map that `updateRemotes()` eases
   toward its targets (and purges after `REMOTE_STALE_MS`, 6 s — long enough that
   a network hiccup freezes a rival in place instead of deleting him). We broadcast
   from the countdown on, so everyone is on screen before the first shot, and while
   dead we keep emitting `alive:false` so our pirate lingers faded as a wreck. This
   is pure Supabase broadcast — it does **not** use the Node game server.

   **Gotcha — the channel dies and nobody notices.** `subscribe()` used to be
   called with no status callback, so a `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`
   was silent: from then on nothing arrived, every remote went stale, and you
   finished the round alone on the island (and your own `send()`s fell back to
   `realtime-js`'s REST path — one HTTP POST per heartbeat — so the others lost
   you too). `DodgeChannel` now tracks the status, gates `send()` on a joined
   channel, and rebuilds it with backoff. What knocks the socket down is volume:
   Realtime caps messages per second per channel (~100 by default) and a full room
   is `players x (1000 / NET_SEND_MS)`. Hence `NET_SEND_MS` is 100 (not 90) and
   `emitPos` drops to a `NET_IDLE_MS` keepalive when the pirate hasn't moved —
   which matters now that the sunk ones stay watching instead of leaving. If you
   ever raise the send rate, do the multiplication for 8 players first.

   **Gotcha — the heartbeat runs off `setInterval`, not the animation frame.**
   `netTimer` fires `heartbeat()` every `NET_SEND_MS`. This is deliberate:
   browsers throttle/pause `requestAnimationFrame` in unfocused or background
   tabs, so an earlier version that emitted from the rAF `update()` loop made a
   *still* player stop broadcasting and vanish from everyone else after the stale
   timeout (Neon Drift never hit this because its cars are always moving and
   testing is usually single-window). A background tab still fires `setInterval`
   ~1x/s, which stays inside `REMOTE_STALE_MS` (6 s). Keep the heartbeat off the
   frame loop.

**Bandana colours.** Every player gets a distinct bandana colour by *seat order*
in the room (`BANDANA_COLORS` indexed by the player's position in `players()`, so
all clients agree), falling back to a hash if the nick isn't in the list. Solo is
the classic red (`BANDANA_COLORS[0]`). The renderer draws each remote pirate with
its colour and a name tag, and rings the local pirate in white so you can find
yourself. Note the simulations can drift slightly (each client runs its own clock
from its own countdown), so a remote pirate may occasionally clip a ball on your
screen — accepted, same trade-off as Neon Drift's interpolated remote cars.
