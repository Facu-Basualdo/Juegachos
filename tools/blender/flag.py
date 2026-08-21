"""
Hole flag for the mini-golf minigame: white cup rim + red/white striped
pole (the key art's barber-pole marker) + red triangular pennant, authored
at game scale (pole ~1.4 units tall, cup rim matching HOLE_R ~0.32).
Cel-shaded at runtime by the game.

    blender --background --factory-startup --python tools/blender/flag.py -- public/models/mini-golf/flag.glb
"""

import bmesh
import bpy
import math
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import (  # noqa: E402
    add_bevel,
    apply_modifiers,
    cylinder,
    export_glb,
    obj_from_bmesh,
    out_path,
    pbr_material,
    reset_scene,
    set_material,
    shade_smooth,
    sphere,
    torus,
)

CUP_R = 0.32
POLE_H = 1.42
POLE_R = 0.024


def pennant():
    """Thin triangular flag sticking out of the pole top (+X)."""
    bm = bmesh.new()
    a = bm.verts.new((POLE_R, 0.0, POLE_H - 0.06))
    b = bm.verts.new((POLE_R, 0.0, POLE_H - 0.40))
    c = bm.verts.new((POLE_R + 0.52, 0.0, POLE_H - 0.23))
    bm.faces.new((a, b, c))
    obj = obj_from_bmesh(bm, "pennant")
    mod = obj.modifiers.new("Solid", "SOLIDIFY")
    mod.thickness = 0.02
    mod.offset = 0.0
    apply_modifiers(obj)
    return obj


def main():
    reset_scene()

    white = pbr_material("cupWhite", (0.93, 0.93, 0.9), metallic=0.0, roughness=0.5)
    red = pbr_material("flagRed", (0.86, 0.2, 0.16), metallic=0.0, roughness=0.6)

    rim = torus(CUP_R, 0.035, major_seg=40, minor_seg=10, location=(0, 0, 0.02), name="cupRim")
    set_material(rim, white)
    shade_smooth(rim)

    # Barber-striped pole: alternating red/white segments.
    segs = 6
    seg_h = POLE_H / segs
    pole_parts = []
    for i in range(segs):
        part = cylinder(POLE_R, seg_h, verts=20, location=(0, 0, seg_h * (i + 0.5)), name=f"poleSeg{i}")
        set_material(part, red if i % 2 == 0 else white)
        shade_smooth(part)
        pole_parts.append(part)

    knob = sphere(0.045, subdiv=2, location=(0, 0, POLE_H), name="knob")
    set_material(knob, white)
    shade_smooth(knob)

    flag = pennant()
    add_bevel(flag, 0.004, segments=1)
    apply_modifiers(flag)
    set_material(flag, red)

    export_glb(out_path("public/models/mini-golf/flag.glb"), [rim, *pole_parts, knob, flag])


main()
