import * as THREE from "three";
import {
  SIDE_X,
  CEIL_Y,
  FLOOR_Y,
  WALL_THICKNESS,
  ROOM_DEPTH,
  FIXED_SPIKE_LEN,
  FIXED_SPIKE_RADIUS,
  FIXED_SPIKE_COUNT,
  COLOR_STONE,
  COLOR_STONE_TRIM,
  COLOR_IRON,
  COLOR_IRON_TIP,
} from "./constants";

/**
 * The iron cell: the stone frame (left/right/ceiling/floor walls, no back wall
 * so the gothic backdrop shows through) plus the fixed forged teeth lining the
 * ceiling and floor. The scenery around it lives in `Environment`.
 */
export class Room {
  readonly object = new THREE.Group();

  private ironMat!: THREE.MeshStandardMaterial;

  constructor() {
    this.buildWalls();
    this.buildFixedSpikes();
  }

  private buildWalls(): void {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: COLOR_STONE,
      roughness: 0.95,
      metalness: 0.05,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: COLOR_STONE_TRIM,
      roughness: 1,
      metalness: 0,
    });

    const roomW = SIDE_X * 2;
    const roomH = CEIL_Y - FLOOR_Y;
    const t = WALL_THICKNESS;
    const outer = 1.4; // how far the wall slabs extend past the arena

    // Left / right walls.
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(t, roomH + t * 2 + outer, ROOM_DEPTH),
        stoneMat
      );
      wall.position.set(sx * (SIDE_X + t / 2), (CEIL_Y + FLOOR_Y) / 2, 0);
      this.object.add(wall);
      // A darker recessed panel to give the stone some depth.
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, roomH - 0.6, ROOM_DEPTH * 0.5), trimMat);
      panel.position.set(sx * (SIDE_X - 0.02), (CEIL_Y + FLOOR_Y) / 2, ROOM_DEPTH * 0.18);
      this.object.add(panel);
    }

    // Ceiling / floor walls.
    for (const sy of [1, -1]) {
      const y = sy > 0 ? CEIL_Y : FLOOR_Y;
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(roomW + t * 2 + outer, t, ROOM_DEPTH),
        stoneMat
      );
      wall.position.set(0, y + sy * (t / 2), 0);
      this.object.add(wall);
    }

    // No back wall: the cell is open front-to-back so the gothic backdrop (the
    // moon and cathedral) shows through behind the bird, as on the key art. The
    // stone frame reads as a thick oubliette window.
  }

  private buildFixedSpikes(): void {
    this.ironMat = new THREE.MeshStandardMaterial({
      color: COLOR_IRON,
      roughness: 0.45,
      metalness: 0.85,
      emissive: new THREE.Color(COLOR_IRON_TIP),
      emissiveIntensity: 0.06,
    });

    const roomW = SIDE_X * 2;
    const step = roomW / FIXED_SPIKE_COUNT;
    for (let i = 0; i < FIXED_SPIKE_COUNT; i++) {
      const x = -SIDE_X + step * (i + 0.5);
      // Ceiling teeth point down (-y).
      this.object.add(this.makeFixedSpike(x, CEIL_Y, -1));
      // Floor teeth point up (+y).
      this.object.add(this.makeFixedSpike(x, FLOOR_Y, 1));
    }
  }

  private makeFixedSpike(x: number, wallY: number, dir: number): THREE.Mesh {
    const geo = new THREE.ConeGeometry(FIXED_SPIKE_RADIUS, FIXED_SPIKE_LEN, 4);
    // Cone apex is +y; for a floor spike (dir=+1) that already points up. For a
    // ceiling spike, flip it to point down.
    const mesh = new THREE.Mesh(geo, this.ironMat);
    if (dir < 0) mesh.rotation.z = Math.PI;
    // Position so the base sits flush against the wall and the tip reaches in.
    mesh.position.set(x, wallY + dir * (FIXED_SPIKE_LEN / 2), 0);
    mesh.rotation.y = Math.PI / 4; // square pyramid reads as a forged tooth
    return mesh;
  }
}
