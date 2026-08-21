"""
Golf ball for the mini-golf minigame: a unit-radius icosphere with real
dimple geometry (pushed-in vertices around fibonacci-distributed centers).
Exported white PBR; the game cel-shades it at runtime (toonify) so the
dimples read through the toon ramp + ink outline.

    blender --background --factory-startup --python tools/blender/golfball.py -- public/models/mini-golf/golfball.glb
"""

import math
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import (  # noqa: E402
    export_glb,
    out_path,
    pbr_material,
    reset_scene,
    set_material,
    shade_smooth,
    sphere,
)

DIMPLE_COUNT = 160
DIMPLE_ANGLE = 0.115  # angular radius of one dimple (radians)
DIMPLE_DEPTH = 0.030  # how deep a dimple sinks (unit-radius ball)


def fibonacci_dirs(n):
    """N roughly-even unit directions (golden spiral on the sphere)."""
    dirs = []
    phi = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        y = 1.0 - (2.0 * i + 1.0) / n
        r = math.sqrt(max(0.0, 1.0 - y * y))
        a = phi * i
        dirs.append((math.cos(a) * r, y, math.sin(a) * r))
    return dirs


def main():
    reset_scene()

    ball = sphere(1.0, subdiv=5, name="golfball")

    dimples = fibonacci_dirs(DIMPLE_COUNT)
    cos_limit = math.cos(DIMPLE_ANGLE * 2.5)  # cheap pre-filter window

    mesh = ball.data
    for v in mesh.vertices:
        n = v.co.normalized()
        best = -1.0
        for d in dimples:
            c = n.x * d[0] + n.y * d[1] + n.z * d[2]
            if c > best:
                best = c
        if best < cos_limit:
            continue
        ang = math.acos(min(1.0, best))
        if ang >= DIMPLE_ANGLE:
            continue
        t = ang / DIMPLE_ANGLE  # 0 at dimple center, 1 at rim
        depth = DIMPLE_DEPTH * (1.0 - t * t)  # spherical-cap profile
        v.co = n * (1.0 - depth)

    shade_smooth(ball, angle_deg=60.0)
    set_material(ball, pbr_material("ballWhite", (0.94, 0.94, 0.92), metallic=0.0, roughness=0.35))

    export_glb(out_path("public/models/mini-golf/golfball.glb"), [ball])


main()
