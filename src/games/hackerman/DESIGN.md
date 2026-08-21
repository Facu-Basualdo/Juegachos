# Phosphor Intrusion

Art direction for Hackerman. Every visual decision — in `style.css` and in the
per-level canvas/DOM rendering — answers to it.

The screen is not a menu, it is a terminal someone broke into. The fantasy is a
1980s phosphor CRT wired to a system it was never meant to touch: cold, technical,
faintly hostile, and moving faster than the operator is comfortable with. The
player should feel like a hand hovering over a keyboard at 3 a.m., not a tourist
clicking buttons. Everything on screen is diagnostic readout — labels in
all-caps, monospaced, spaced wide like a machine printed them — never decoration.

Green is the only voice. A single phosphor green does the talking: the text, the
borders, the fingerprints, the locked components. Depth is built inside that one
hue — a near-black green field, a dim green for structure and inactive elements,
a full-bright green with a soft bloom for whatever the player is acting on right
now. Nothing floats in a uniform glow: light is earned by the element that
matters, and the rest recedes into the dark. Only two colors ever break the
monochrome, and only as events, never as surface: red for rejection (a wrong
component, a failed sequence) and a brief white flash on the exact letter or cell
the player just touched. When everything is green and one thing turns red, the
message is unmissable — that is the whole point of the restraint.

The medium is texture. Scanlines and a vignette sit over the entire screen so it
reads as a scanned tube, not a flat webpage; the phosphor blooms slightly past
its own edges. Pixels are honest: the fingerprints are drawn cell-by-cell with
`image-rendering: pixelated`, never smoothed, because a cloned fingerprint should
look reconstructed from data, not photographed. Corners are barely eased —
hardware, not toy.

Hierarchy is absolute and it serves the clock. This is a race, so the eye must
never hunt: the active slot, cell or reel carries the brightest border and the
tightest bloom; confirmed progress locks into steady green; the target of
comparison (the objective fingerprint, the required code, the access key) is
always present and legible. Motion is minimal and functional — a pop on the
countdown, a shake on rejection, a blink on the prompt — because anything that
draws the eye away from the task is stealing time from the player, and time is
the score.
