"""
Decorative windmill for the mini-golf minigame (the key art's mossy mill):
tapered stone tower, dark timber roof, and a 4-blade timber rotor exported
as a named node ("rotor") so the game can spin it. Faces -Y in Blender so
the y-up export lands it facing the camera (+Z); the rotor then spins with
a single rotation.z in Three.

    blender --background --factory-startup --python tools/blender/windmill.py -- public/models/mini-golf/windmill.glb
"""

import bpy
import math
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import (  # noqa: E402
    box,
    cone,
    cylinder,
    export_glb,
    join,
    orient,
    out_path,
    pbr_material,
    reset_scene,
    set_material,
    shade_smooth,
)

TOWER_H = 2.5
HUB_Y = -1.05  # well forward of the tower wall (Blender -Y = game +Z)
HUB_Z = 2.05


def bake_location(obj) -> None:
    """Folds the object's location into its mesh so later rotations pivot on the hub."""
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def blade(mat, angle: float):
    """One timber blade: spar + offset sail panel, rotated around the hub axis."""
    spar = box(0.05, 0.04, 1.15, location=(0, 0, 0.62), name="spar")
    sail = box(0.16, 0.02, 0.95, location=(0.115, 0, 0.78), name="sail")
    b = join([spar, sail], "blade")
    bake_location(b)
    set_material(b, mat)
    orient(b, ry=angle)
    return b


def main():
    reset_scene()

    stone = pbr_material("millStone", (0.82, 0.78, 0.66), metallic=0.0, roughness=0.85)
    timber = pbr_material("millTimber", (0.38, 0.26, 0.14), metallic=0.0, roughness=0.8)
    moss = pbr_material("millMoss", (0.32, 0.45, 0.18), metallic=0.0, roughness=0.9)

    tower = cone(0.85, 0.6, TOWER_H, verts=14, location=(0, 0, TOWER_H / 2), name="tower")
    set_material(tower, stone)
    shade_smooth(tower, angle_deg=40)

    roof = cone(0.72, 0.06, 0.75, verts=14, location=(0, 0, TOWER_H + 0.34), name="roof")
    set_material(roof, moss)
    shade_smooth(roof, angle_deg=40)

    door = box(0.34, 0.1, 0.55, location=(0, -0.78, 0.28), name="door")
    set_material(door, timber)

    axle = cylinder(0.07, 0.75, verts=10, location=(0, HUB_Y + 0.34, HUB_Z), name="axle")
    orient(axle, rx=math.radians(90))
    set_material(axle, timber)

    blades = [blade(timber, i * math.pi / 2) for i in range(4)]
    hub = cylinder(0.12, 0.12, verts=10, location=(0, 0, 0), name="hubcap")
    orient(hub, rx=math.radians(90))
    set_material(hub, timber)
    rotor = join(blades + [hub], "rotor")
    rotor.location = (0, HUB_Y, HUB_Z)

    export_glb(out_path("public/models/mini-golf/windmill.glb"), [tower, roof, door, axle, rotor])


main()
