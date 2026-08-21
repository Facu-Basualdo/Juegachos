"""
Hanging lantern post for the mini-golf minigame (the key art's warm garden
lamps): weathered wood post + arm, iron cage, and an amber emissive glass
box the game pairs with a small warm PointLight.

    blender --background --factory-startup --python tools/blender/lantern.py -- public/models/mini-golf/lantern.glb
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import (  # noqa: E402
    box,
    export_glb,
    out_path,
    pbr_material,
    reset_scene,
    set_material,
)

POST_H = 1.55
ARM_LEN = 0.42


def main():
    reset_scene()

    wood = pbr_material("postWood", (0.42, 0.29, 0.16), metallic=0.0, roughness=0.85)
    iron = pbr_material("lampIron", (0.16, 0.15, 0.14), metallic=0.6, roughness=0.5)
    glow = pbr_material(
        "lampGlow", (1.0, 0.75, 0.35), metallic=0.0, roughness=0.4,
        emission=(1.0, 0.72, 0.3), emission_strength=3.0,
    )

    post = box(0.13, 0.13, POST_H, location=(0, 0, POST_H / 2), name="post")
    set_material(post, wood)

    arm = box(0.09, ARM_LEN, 0.09, location=(0, -ARM_LEN / 2 + 0.04, POST_H - 0.06), name="arm")
    set_material(arm, wood)

    hang_y = -ARM_LEN + 0.06
    top = box(0.2, 0.2, 0.05, location=(0, hang_y, POST_H - 0.16), name="cap")
    set_material(top, iron)
    glass = box(0.14, 0.14, 0.2, location=(0, hang_y, POST_H - 0.3), name="glass")
    set_material(glass, glow)
    base = box(0.17, 0.17, 0.04, location=(0, hang_y, POST_H - 0.43), name="base")
    set_material(base, iron)

    export_glb(out_path("public/models/mini-golf/lantern.glb"), [post, arm, top, glass, base])


main()
