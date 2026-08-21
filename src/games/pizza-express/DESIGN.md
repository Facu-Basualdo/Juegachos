# Pizza Express — Art Direction: "Golden Hour Delivery"

The whole game is one endless dusk in **Cheesetown**: a sun-drenched hillside
suburb the moment before the light goes. It should feel like the game's cover —
a painted, comic-book adventure poster — turned into a road you can never stop
riding down. Warm, fast, a little chaotic, and greasy in the best way.

## The one feeling

**"Hot & fast."** Every frame should read like the split-second in an action
cartoon right after the hero guns the throttle: warm light streaking past, a
town blurring by, a pizza already in the air. If a decision makes the scene
calmer, slower, or cooler in temperature, it is wrong.

## Principles

1. **Everything is warm.** The sun is low and the whole world is dipped in it.
   The palette lives on the warm half of the wheel — tomato reds, molten cheese
   golds, cardboard browns, terracotta roofs — with green foliage as the only
   cool relief. There is **no** neon, no pure blue, no clinical grey. Even the
   shadows are warm (deep amber-brown, never black). When in doubt, push it
   warmer and more saturated, like late-afternoon film.

2. **Painted, not plastic.** The cover is illustrated, so the 3D answers with
   **cel/toon shading** (flat banded light, `MeshToonMaterial`) instead of glossy
   PBR. Big readable shapes, chunky proportions, storybook cottages — a diorama
   of a town, not an architectural model. Slightly exaggerated everything: fat
   tires, tall chimneys, oversized mailboxes.

3. **The road is the stage, the town is the set.** Gameplay reads on the road:
   the asphalt strip down the middle is where obstacles and the scooter live, lit
   and clear. The town (houses, hedges, fences, trees) frames it on both sides,
   rich but never competing for attention — it's scenery streaming past to sell
   speed, not something to study.

4. **Speed you can feel.** Motion is the core aesthetic. The ground rushes, props
   wrap past, dust kicks off the tires, the world tightens as it ramps. Stillness
   is failure. The camera rides close behind the scooter so the town flies at the
   player, not away from them.

5. **Deliveries are the payoff — make them pop.** A pending order is the one
   thing allowed to glow (a warm emissive marker floating over a mailbox). A
   successful delivery is a little firework of cheese-gold sparks and a satisfying
   flag-flip. The bloom budget is spent here, on the sun, and nowhere else.

## Palette

| Role | Colour | Use |
| --- | --- | --- |
| Tomato red | `#d83a2b` | scooter body, mailbox flags, order markers, title |
| Pepperoni red | `#a8281c` | deep shade of the reds, roof ridges |
| Cheese gold | `#f2b134` | pizza, delivery sparks, order glow, sun |
| Molten cheese | `#ffd36b` | highlights, headlight, warm rim light |
| Cardboard | `#c9995a` | pizza boxes, dirt, wood, fence posts |
| Crust brown | `#8a5a2b` | roofs shade, tree trunks, deep wood |
| Cream stucco | `#f2e4c4` | house walls, road markings |
| Foliage green | `#4f8a3a` | grass, hedges, trees (the only cool note) |
| Deep leaf | `#356026` | foliage shade |
| Terracotta | `#c65a34` | roof tiles |
| Asphalt | `#4a4038` | road surface (warm brown-grey, never neutral) |
| Peach sky | `#ffcf9a` | horizon glow |
| Dusk sky | `#e8935a` → `#7a6bbf` | sky gradient, horizon to zenith |

Warm directional **key light** (`#ffd9a0`) raking low from the sun; a warm
**hemisphere fill** (sky peach over ground amber) so nothing goes cold or black.
Fog is a **warm haze** (peachy), fading the town into the sunset, not a grey mist.

## Anti-goals

- No cold colours, no neon glow lines, no chrome/gloss PBR, no dark/night mood.
- No realistic lighting or physically-correct materials — this is a cartoon.
- No busy background that steals reads from the road.
- No calm. If it feels like a peaceful drive, it has failed.
