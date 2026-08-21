# Consecrated Iron

The art direction for Danger Wings. Every visual decision in the Three.js scene answers to it. The reference is the game's key art (`public/covers/danger-wings.jpg`): a small black crow with furious bone-white eyes flying through a chained iron oubliette under a bruised moon, ringed by gothic spires whose windows glow like coals.

**The room is a reliquary, not a level.** Don't Touch the Spikes is a box you bounce inside; here that box is a consecrated iron cell — cold stone, forged spikes, chains that have held something for a long time. The chamber is claustrophobic on purpose: the walls press in, the light is scarce, and the only warm thing in the frame is the reward you are risking your life for. The player should feel watched.

**Darkness is the material, light is rationed.** The palette is three stops darker than it wants to be. Near-black indigo stone, gunmetal iron, feathers that are almost the same black as the void behind them — the crow survives as a silhouette and two burning eyes, exactly as on the cover. Light exists only where it is earned: a pale bone moon behind the cell, embered red windows in the far spires, the cold specular line down a spike's edge, the ruby glow of the relic. Bloom is applied to those few sources and nowhere else. Nothing floats in a uniform haze; a glow exists because a bright core justifies it.

**A fixed, funereal vocabulary of colour.** Bone-white (moon, eyes, the highlight on iron) is the light of judgement. Gold (the beak, the cracked title lettering) is old, tarnished, liturgical — never bright, always aged. Blood-ruby is the threat-that-tempts: the relic you collect burns the same red as the distant windows, so the eye reads reward and danger as the same colour. Iron grey is the true enemy — the spikes are not decorative, they are the most carefully lit objects in the room, because they are what kills you. No hue outside this set gets a saturated voice.

**Iron is forged, not extruded.** A spike is a hammered blade with a hot specular edge and a darker root where it meets the stone, not a smooth party-hat cone. Repetition is deliberate — the fixed teeth line the ceiling and floor in an even, indexed row, and the side spikes emerge on the same rhythm every time — because exact cadence reads as a mechanism built to kill, and wobble reads as accident. Chains, stone joints and the pitted metal accumulate in small strokes; each is almost invisible, together they are why the cell looks old and used.

**The tonal shift is a slow dread, not a reward.** The original brightens pastel by pastel to congratulate you. This room does the opposite in the same gesture: every ten points the ambient tint slides — indigo, to old-blood maroon, to a drowned teal, to deep violgrave — always within the near-black register, so the reward for surviving is that the cell grows *colder and stranger*, never lighter. If it ever reads as cheerful, it is wrong; pull it back toward the grave.

**The composition is read at speed.** Hierarchy is absolute and it inverts the usual kindness: the spikes burn coldest-brightest because they are the information that matters, the relic glows warmest because it is the temptation, the crow is a dark shape you track by its eyes, and the cathedral world recedes into calibrated black. Ornament that competes with the spikes or the bird is removed, however beautiful.

---

## The backdrop (Krea)

The cell is open front-to-back so the gothic world shows *through* it behind the crow (see the key art). By default the scene builds a procedural gothic canvas (moon + corona, layered cathedral spires with ember windows, rose window, bats, ground haze, central vignette) on the backdrop plane. For the richest look, drop an AI-painted image at **`public/models/danger-wings/backdrop.jpg`** — `Environment.loadBackdrop()` swaps it in, and its absence is a silent no-op (the procedural canvas stays). Same pattern as boilerbound's `backdrop.jpg`.

**Krea prompt** (landscape, ~1400x900, to sit *behind* the cell — must stay dark in the centre so the play area reads):

> Gothic horror night sky matte painting, a pale bone-white full moon high behind a bruised indigo-black sky, silhouettes of towering ruined cathedral spires and buttresses receding into fog, dim ember-red glowing windows scattered in the far towers, a faint red rose window, hanging iron chains, drifting embers and mist, painterly, desaturated, moonlit, ominous, very dark, high contrast, empty dark centre, no characters, no text, cinematic wide shot

Keep it **dark and empty in the middle** (the iron cell and the crow sit in front of that region) and let the light collect at the top (moon) and edges (spire windows). No text, no bird — those live in the 3D scene.
