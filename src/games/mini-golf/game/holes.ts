/**
 * The three holes, as data. Coordinates: x = lateral, z = along the course,
 * floor tops at y = 0 unless stated. Each hole has a main route and one
 * risky shortcut (see per-hole notes).
 */

export interface FloorDef {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Top surface height (default 0). */
  y?: number;
  kind?: "fairway" | "green";
}

export interface WallDef {
  x: number;
  z: number;
  w: number;
  d: number;
  h?: number;
  /** Rotation around +Y (angled bank walls, e.g. La Herradura's prow). */
  yaw?: number;
  color?: "wood" | "red";
}

export interface RampDef {
  /** Footprint center. Uphill points toward +Z rotated by `yaw`. */
  x: number;
  z: number;
  w: number;
  /** Horizontal run. */
  len: number;
  rise: number;
  yaw: number;
  /** "shortcut" ramps are sky blue (the risky line); "slope" ramps are grass. */
  kind: "shortcut" | "slope";
}

export interface BarDef {
  x: number;
  z: number;
  len: number;
  /** Angular speed (rad/s) around +Y. */
  speed: number;
}

export interface BumperDef {
  x: number;
  z: number;
  r?: number;
}

export interface DecorDef {
  kind: "lantern" | "barrel" | "windmill";
  x: number;
  z: number;
  /** Rotation around +Y; lantern arms and the mill face +Z at yaw 0. */
  yaw?: number;
  /** Uniform scale (windmills use it to read big against the course). */
  scale?: number;
}

export interface HoleDef {
  name: string;
  par: number;
  tee: { x: number; z: number };
  hole: { x: number; z: number; y?: number };
  /** Initial camera yaw (orbit angle; the camera sits at +yaw behind the ball). */
  camYaw: number;
  floors: FloorDef[];
  walls: WallDef[];
  ramps?: RampDef[];
  bars?: BarDef[];
  bumpers?: BumperDef[];
  /** Garden props (see DESIGN.md). Lanterns and barrels stand on the course
   *  and collide; the windmill floats on its own decorative islet. */
  decor?: DecorDef[];
}

const T = 0.26; // wall thickness
const H = 0.4; // default wall height

/** Axis-aligned wall between two corner points (either x0==x1 or z0==z1). */
function wall(x0: number, z0: number, x1: number, z1: number, h = H): WallDef {
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    w: Math.max(Math.abs(x1 - x0), T),
    d: Math.max(Math.abs(z1 - z0), T),
    h,
  };
}

// Hole 1 — "La Herradura": a true U dogleg (layout designed by the project
// owner in the map editor). The central block seals the direct tee -> hole
// line completely (it meets the near wall), so every shot goes around the
// bend, where a bumper guards each lane. The hole sits partway down the far
// lane: the ace is one strong bank around the whole U, threading both
// bumpers.
const HERRADURA: HoleDef = {
  name: "La Herradura",
  par: 2,
  tee: { x: -2.2, z: 1 },
  hole: { x: 2.1, z: 2.75 },
  camYaw: -Math.PI / 2,
  floors: [{ x: 0, z: 5.5, w: 7, d: 11 }],
  walls: [
    { x: 0, z: 0.05, w: 7, d: 0.26, h: 0.4 },
    { x: 0, z: 11, w: 7, d: 0.26, h: 0.4 },
    { x: -3.5, z: 5.5, w: 0.26, d: 11, h: 0.4 },
    { x: 3.5, z: 5.5, w: 0.26, d: 11, h: 0.4 },
    // Central block, flush against the near wall (front sits 0.03 inside the
    // wall so there is no gap and no visible interpenetration): no straight
    // passage.
    { x: -0.1, z: 3.26, w: 1.6, d: 6.22, h: 0.5 },
  ],
  bumpers: [
    { x: -1.95, z: 8.25 },
    { x: 2.25, z: 8.25 },
  ],
  decor: [
    { kind: "lantern", x: -3.05, z: 0.6, yaw: Math.PI / 4 },
    { kind: "lantern", x: 3.05, z: 10.4, yaw: (-3 * Math.PI) / 4 },
    { kind: "barrel", x: -2.95, z: 10.3 },
  ],
};

// Hole 2 — "El Molino": straight fairway, a striped bar sweeps the full
// width mid-way (time it), then an uphill slope to a raised green. The
// shortcut is a blue side ramp: at full power the ball flies over the bar
// and can land on the green — but off-line launches clear the low side
// walls and fall to the void (+1).
const MOLINO: HoleDef = {
  name: "El Molino",
  par: 3,
  tee: { x: 0, z: 1.2 },
  hole: { x: 0, z: 12.7, y: 0.35 },
  camYaw: Math.PI,
  floors: [
    { x: 0, z: 5, w: 4, d: 10 },
    { x: 0, z: 12.5, w: 4, d: 3, y: 0.35, kind: "green" },
  ],
  walls: [
    wall(-2, 0, 2, 0),
    wall(-2, 0, -2, 10),
    wall(2, 0, 2, 10),
    wall(-2, 10, -2, 14, 0.8),
    wall(2, 10, 2, 14, 0.8),
    wall(-2, 14, 2, 14, 0.8),
  ],
  ramps: [
    { x: 0, z: 10.5, w: 4.5, len: 1, rise: 0.35, yaw: 0, kind: "slope" },
    { x: 1.35, z: 4.6, w: 1.1, len: 1.5, rise: 0.62, yaw: 0, kind: "shortcut" },
  ],
  bars: [{ x: 0, z: 6.5, len: 3.6, speed: 1.5 }],
  decor: [
    // Facing the course (toward ~(0, 7)) so the rotor reads from the tee.
    { kind: "windmill", x: -4.6, z: 12.3, yaw: 2.43, scale: 1.5 },
    { kind: "lantern", x: 1.7, z: 0.55, yaw: (-3 * Math.PI) / 4 },
    { kind: "barrel", x: -1.55, z: 8.9 },
  ],
};

// Hole 3 — "La Isla": the green floats across a void. Safe route: a narrow
// side bridge (outer rail only). Shortcut: the blue launch ramp aimed dead
// at the island — full power carries the void, anything soft drops in (+1).
const ISLA: HoleDef = {
  name: "La Isla",
  par: 4,
  tee: { x: 0, z: 1.2 },
  hole: { x: 0, z: 13.3 },
  camYaw: Math.PI,
  floors: [
    { x: 0, z: 3.5, w: 7.6, d: 7 },
    { x: 3.15, z: 8.75, w: 1.1, d: 3.5 },
    // Void gap 3.5 (z 7..10.5): matched to the ramp's real carry (~z 10.5-11.5)
    // so a narrow landing power window exists — measure, don't eyeball.
    { x: 0.6, z: 12.75, w: 6.2, d: 4.5, kind: "green" },
  ],
  walls: [
    wall(-3.8, 0, 3.8, 0),
    wall(-3.8, 0, -3.8, 7),
    wall(3.8, 0, 3.8, 7),
    wall(-3.8, 7, 2.6, 7),
    // Bridge outer rail; the inner edge is open to the void.
    wall(3.7, 7, 3.7, 10.5, 0.35),
    wall(-2.5, 10.5, -2.5, 15),
    // No back wall: the green's far edge (z 15) is open to the void, so
    // overshooting the ramp shot rolls off (+1). Power must be exact.
    wall(3.7, 10.5, 3.7, 15),
    // Low curb on the void side (leaves the bridge mouth open).
    wall(-2.5, 10.5, 2.6, 10.5, 0.28),
  ],
  ramps: [{ x: 0, z: 5.9, w: 1.3, len: 1.5, rise: 0.68, yaw: 0, kind: "shortcut" }],
  bumpers: [
    { x: -1.8, z: 4.6 },
    { x: 1.8, z: 4.6 },
    { x: -0.9, z: 12.1 },
    { x: 1.6, z: 13.9 },
  ],
  decor: [
    { kind: "lantern", x: -3.45, z: 0.6, yaw: Math.PI / 4 },
    { kind: "lantern", x: 2.9, z: 14.4, yaw: Math.PI },
    // On the approach to the bridge, not in its mouth (must stay passable).
    { kind: "barrel", x: 3.3, z: 5.4 },
    // Big, facing the player (toward ~(0, 8)) on its green pillow.
    { kind: "windmill", x: -5.6, z: 13.2, yaw: 2.48, scale: 2.0 },
  ],
};

export const HOLE_DEFS: HoleDef[] = [HERRADURA, MOLINO, ISLA];
