# One Blade, One Light

A design philosophy for a game that is a held breath. Written as the art direction
for the Three.js scene in `Game.ts`, `Sword.ts` and `Dojo.ts`; every visual decision
answers to it.

The blade is the only thing that is truly lit. This is a game about a single point
of failure — a sword that wants to fall — so the composition refuses to spread its
attention. One warm spotlight falls from above and front, carving a pool on a dark
floor; everything outside that pool is swallowed by fog and near-black. The steel
catches the light and the eye goes straight to it, because the steel is the thing the
player is fighting to keep upright. Light is spent where the tension lives, nowhere
else.

The hand is a silhouette, on purpose. A realistic, brightly lit fist would compete
with the blade and soften the drama; instead the hand and forearm are dark, wrapped
cloth that fall into shadow, read by their edges and a thin cool rim. The player
should feel the sword balanced on the dark, not watch a character. Restraint in the
hand is what lets the blade burn.

Steel is a material, so it must reflect. The blade is polished metal — high metalness,
low roughness — and it is given a real environment to mirror (a procedural room, no
shipped HDR) plus a single bright emissive line down its edge, like a hamon catching
a highlight. That edge line is the one element allowed to glow; the bloom is tuned so
it blooms and little else. A sword that does not reflect reads as grey plastic, and
plastic has no tension.

Two lights, two temperatures. The key is warm — candlelit, dojo at night; the rim is
cool steel-blue from behind. The whole palette lives in that pair: warm pool, cold
edge, and a deep blue-black void between them. No third hue gets a saturated voice.
The HUD borrows the cold end — ice-blue numerals, a tilt meter that runs from calm
green to alarm red only as the blade actually nears the edge, so color is information,
not decoration.

Motion is small until it is final. In balance, everything is micro-correction: the
wrist leans a few degrees, the blade trembles, dust drifts slow in the beam. The
scene stays composed and quiet — and then, the instant the run is lost, it is not:
the blade swings flat, the camera shakes, one heavy clang. The single violent moment
earns its weight precisely because everything before it was restrained.

What remains must feel like a held instrument at 60 frames per second: one blade, one
pool of light, one number climbing, and a lot of deliberate dark around it. Anything
that would pull the eye off the steel — a bright prop, a second light, a textured
background — is the thing that would break the spell. Leave it out.
