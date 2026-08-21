import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { toon, emissiveToon, outlined } from "./materials";
import { FLOOR_W, FLOOR_H, FLOOR_D, WINDOW_COLS, WINDOW_W } from "./constants";

/**
 * Builds the visible meshes for floors, roofs and the foundation — the "Ciudad
 * de Juguete" toy blocks (see DESIGN.md): fat rounded enamel bodies with an ink
 * outline and a tidy grid of warm lit windows so each floor reads as inhabited.
 */

/** Candy enamel palettes, one per building so the tower reads as stacked plans. */
export const BUILDING_COLORS = [
  0xef7d6a, // coral
  0x6fc3a0, // mint
  0xf2c46b, // butter
  0x7fb3e6, // sky
  0xb79ae0, // lilac
  0xe89ac0, // rose
];

const WINDOW_LIT = 0xffe08a;
const WINDOW_DARK = 0x3a3350;
const bodyGeo = new RoundedBoxGeometry(FLOOR_W, FLOOR_H, FLOOR_D, 3, 0.12);
const windowGeo = new THREE.BoxGeometry(WINDOW_W, 0.26, 0.05);

/** Color for building index `i` (cycles through the palette). */
export function buildingColor(i: number): number {
  return BUILDING_COLORS[i % BUILDING_COLORS.length];
}

/** Deterministic 0..1 from a seed so a floor's window pattern is stable. */
function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Sticks a grid of lit/dark windows onto the given face (WINDOW_COLS x 2). */
function addWindows(group: THREE.Group, seed: number, faceZ: number): void {
  const cols = WINDOW_COLS;
  const rows = 2;
  const xStep = FLOOR_W / (cols + 1);
  const yStep = FLOOR_H / (rows + 1);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = rand(seed + k * 7.13) > 0.4;
      k++;
      const mat = lit ? emissiveToon(WINDOW_LIT, 1.1) : toon(WINDOW_DARK);
      const win = new THREE.Mesh(windowGeo, mat);
      win.position.set(-FLOOR_W / 2 + (c + 1) * xStep, -FLOOR_H / 2 + (r + 1) * yStep, faceZ);
      group.add(win);
    }
  }
}

/** One apartment floor: rounded enamel body + lit windows + ink outline. */
export function buildFloor(color: number, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.add(outlined(bodyGeo, toon(color)));
  // Front (+Z) faces the camera; +X catches the slight 3/4 angle.
  addWindows(group, seed, FLOOR_D / 2 + 0.01);
  addWindows(group, seed + 3.3, -FLOOR_D / 2 - 0.01);
  return group;
}

/** Wide base slab the tower is built on, over a strip of pavement. */
export function buildFoundation(): THREE.Group {
  const group = new THREE.Group();
  // The load-bearing slab is exactly a floor's WIDTH (X): the first floor is
  // supported by a floor-width footprint just like every floor above, so the
  // strict landing rule reads exactly and a missed/toppled block falls off the
  // side instead of clipping through a base wider than the tower. Depth (Z) is
  // padded for a foundation look since Z is not the play axis.
  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(FLOOR_W, 0.9, FLOOR_D * 1.35, 3, 0.1),
    toon(0x9aa0ad),
  );
  slab.position.y = -0.45;
  slab.receiveShadow = true;
  slab.castShadow = true;
  group.add(slab);
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 0.6, 40),
    toon(0x6fae5b),
  );
  ground.position.y = -1.2;
  ground.receiveShadow = true;
  group.add(ground);
  return group;
}
