"""
Weathered barrel for the mini-golf minigame (the key art's garden clutter):
bulged wooden body + two iron hoops. Doubles as a round obstacle in-game
(cylinder collider).

    blender --background --factory-startup --python tools/blender/barrel.py -- public/models/mini-golf/barrel.glb
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import (  # noqa: E402
    cone,
    export_glb,
    out_path,
    pbr_material,
    reset_scene,
    set_material,
    shade_smooth,
    torus,
)

R_MID = 0.34
R_END = 0.27
H = 0.78


def main():
    reset_scene()

    wood = pbr_material("barrelWood", (0.5, 0.34, 0.18), metallic=0.0, roughness=0.85)
    iron = pbr_material("barrelIron", (0.2, 0.19, 0.18), metallic=0.6, roughness=0.5)

    lower = cone(R_END, R_MID, H / 2, verts=16, location=(0, 0, H / 4), name="lower")
    set_material(lower, wood)
    shade_smooth(lower, angle_deg=40)
    upper = cone(R_MID, R_END, H / 2, verts=16, location=(0, 0, 3 * H / 4), name="upper")
    set_material(upper, wood)
    shade_smooth(upper, angle_deg=40)

    hoop1 = torus(R_MID * 0.94, 0.028, major_seg=20, minor_seg=8, location=(0, 0, H * 0.3), name="hoop1")
    set_material(hoop1, iron)
    hoop2 = torus(R_MID * 0.94, 0.028, major_seg=20, minor_seg=8, location=(0, 0, H * 0.7), name="hoop2")
    set_material(hoop2, iron)

    export_glb(out_path("public/models/mini-golf/barrel.glb"), [lower, upper, hoop1, hoop2])


main()
