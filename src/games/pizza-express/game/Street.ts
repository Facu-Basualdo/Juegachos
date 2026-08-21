import * as THREE from "three";
import { toonMat, glowMat } from "./toon";
import {
  ROAD_HALF_WIDTH,
  SHOULDER,
  HOUSE_X,
  SCENERY_SPAN,
  SCENERY_SPACING,
  SCENERY_SPAWN_Z,
  CAMERA_POS,
  COLOR_ASPHALT,
  COLOR_FOLIAGE,
  COLOR_LEAF,
  COLOR_CREAM,
  COLOR_TERRACOTTA,
  COLOR_CRUST,
  COLOR_CARDBOARD,
  COLOR_DIRT,
  COLOR_MOLTEN,
  COLOR_PEPPERONI,
} from "./constants";

const ROAD_TILE = 11; // world length of one road-texture tile
const GRASS_TILE = 22;
// Meadow decor starts at this |x|, past the outer edge of the house/tree
// clusters (~12.5), so the two prop pools never overlap.
const MEADOW_MIN_X = 13;
const GROUND_LENGTH = 260;
const WRAP_AHEAD = SCENERY_SPAN; // how far a passed cluster jumps back

/**
 * The environment: a scrolling road + grass ground (texture-offset scroll for an
 * endless surface), a wrapping pool of roadside props (cottages, trees, hedges,
 * fences, warm lamp posts) on both sides, and a static dusk sky (gradient dome,
 * low sun, drifting clouds). Purely decorative — gameplay props live elsewhere.
 * See DESIGN.md ("Golden Hour Delivery").
 */
export class Street {
  readonly group = new THREE.Group();

  private readonly roadTex: THREE.CanvasTexture;
  private readonly dirtTex: THREE.CanvasTexture;
  private readonly clusters: THREE.Group[] = [];
  private readonly clouds: { sprite: THREE.Mesh; speed: number }[] = [];
  // Shared assets for the bush border + static meadow decor (one geom set, few mats).
  private readonly bushGeo = new THREE.IcosahedronGeometry(0.42, 0);
  private readonly bushMat = toonMat(COLOR_FOLIAGE, {});
  private readonly bushMatDark = toonMat(COLOR_LEAF, {});
  private readonly trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.2, 7);
  private readonly trunkMat = toonMat(COLOR_CRUST, {});

  constructor() {
    this.roadTex = makeRoadTexture();
    this.dirtTex = makeDirtTexture();
    this.buildGround();
    this.buildScenery();
    this.buildMeadow();
    this.buildSky();
  }

  // --- Ground: static grass + scrolling road strip + dirt shoulders. Only the
  //     road/dirt scroll their UV; the grass stays still (see `scroll`). The
  //     grass is a deliberately FLAT solid green: any texture on it (fine noise
  //     and big soft mottling were both tried) gets perceptually dragged along
  //     by the motion around it and reads as the sheet itself sliding.
  //     Featureless, it cannot look like it moves — motion over the grass comes
  //     only from discrete objects passing (clusters + meadow props). ---
  private buildGround(): void {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(140, GROUND_LENGTH),
      toonMat(COLOR_FOLIAGE, {}),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.06, -GROUND_LENGTH / 2 + CAMERA_POS.z);
    this.group.add(grass);

    for (const side of [-1, 1]) {
      const dirt = new THREE.Mesh(
        new THREE.PlaneGeometry(SHOULDER, GROUND_LENGTH),
        toonMat(COLOR_DIRT, {}),
      );
      (dirt.material as THREE.MeshToonMaterial).map = this.dirtTex;
      dirt.rotation.x = -Math.PI / 2;
      dirt.position.set(side * (ROAD_HALF_WIDTH + SHOULDER / 2), -0.02, -GROUND_LENGTH / 2 + CAMERA_POS.z);
      this.group.add(dirt);
    }

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, GROUND_LENGTH),
      toonMat(COLOR_ASPHALT, {}),
    );
    (road.material as THREE.MeshToonMaterial).map = this.roadTex;
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -GROUND_LENGTH / 2 + CAMERA_POS.z);
    this.group.add(road);
  }

  // --- Roadside props, pooled and wrapped along Z on both sides. ---
  private buildScenery(): void {
    const count = Math.ceil(SCENERY_SPAN / SCENERY_SPACING);
    for (let i = 0; i < count; i++) {
      const z = SCENERY_SPAWN_Z + i * SCENERY_SPACING;
      for (const side of [-1, 1]) {
        const cluster = this.buildCluster(side, i * 2 + (side > 0 ? 1 : 0));
        cluster.position.set(0, 0, z);
        this.clusters.push(cluster);
        this.group.add(cluster);
      }
    }
  }

  /** One roadside cluster: a fence run plus a randomly chosen prop set. */
  private buildCluster(side: number, seed: number): THREE.Group {
    const g = new THREE.Group();
    g.add(this.buildFence(side));
    g.add(this.buildHedgeBorder(side, seed));

    const pick = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    if (pick < 0.5) g.add(this.buildHouse(side, seed));
    else if (pick < 0.78) g.add(this.buildTreeClump(side, seed));
    else g.add(this.buildHedgeAndLamp(side, seed));
    return g;
  }

  /** A broken row of raised bushes right at the road/grass boundary — the visual
   *  **separation** between the (scrolling) road corridor and the (static) grass.
   *  Being distinct 3-D clumps with gaps, they read as objects *passing by* as
   *  they scroll, not as the grass surface sliding (which flat tufts did). */
  private buildHedgeBorder(side: number, seed: number): THREE.Group {
    const g = new THREE.Group();
    const rnd = (n: number) => Math.abs(Math.sin((seed + n) * 91.7) * 4771.31) % 1;
    const edgeX = ROAD_HALF_WIDTH + SHOULDER + 0.5;
    for (let i = 0; i < 4; i++) {
      // Spread along the cluster with a gap so the hedge reads as separate bushes.
      const z = -SCENERY_SPACING / 2 + (i + 0.2 + rnd(i) * 0.5) * (SCENERY_SPACING / 4);
      const s = 0.85 + rnd(i + 20) * 0.7;
      const bush = new THREE.Mesh(this.bushGeo, rnd(i + 40) < 0.4 ? this.bushMatDark : this.bushMat);
      bush.position.set(side * (edgeX + rnd(i + 60) * 0.35), 0.16 * s, z);
      bush.scale.set(s, s * 0.8, s);
      bush.rotation.y = rnd(i + 80) * Math.PI;
      g.add(bush);
    }
    return g;
  }

  private buildFence(side: number): THREE.Group {
    const g = new THREE.Group();
    const railMat = toonMat(COLOR_CREAM, {});
    const postMat = toonMat(COLOR_CARDBOARD, {});
    const x = ROAD_HALF_WIDTH + SHOULDER + 0.15;
    // Two horizontal rails.
    for (const ry of [0.42, 0.18]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, SCENERY_SPACING), railMat);
      rail.position.set(side * x, ry, 0);
      g.add(rail);
    }
    // Pickets.
    const pickets = 6;
    for (let i = 0; i < pickets; i++) {
      const pz = -SCENERY_SPACING / 2 + (i + 0.5) * (SCENERY_SPACING / pickets);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.08), postMat);
      p.position.set(side * x, 0.28, pz);
      g.add(p);
    }
    return g;
  }

  private buildHouse(side: number, seed: number): THREE.Group {
    const g = new THREE.Group();
    const rnd = (n: number) => Math.abs(Math.sin((seed + n) * 78.233) * 43758.5) % 1;
    const wallColors = [COLOR_CREAM, 0xe9c98f, 0xdcb9a0, 0xf0d9a0];
    const wall = toonMat(wallColors[Math.floor(rnd(1) * wallColors.length)], {});
    const roofMat = toonMat(rnd(2) < 0.5 ? COLOR_TERRACOTTA : COLOR_PEPPERONI, {});

    const w = 3 + rnd(3) * 1.6;
    const h = 2 + rnd(4) * 1.1;
    const d = 3.2 + rnd(5) * 1.4;
    const x = side * (HOUSE_X + rnd(6) * 1.5);

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
    body.position.set(x, h / 2, 0);
    g.add(body);

    // Prism roof (a triangular extrusion approximated by a rotated box ridge).
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, w * 0.78, h * 0.6, 4, 1), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(x, h + h * 0.28, 0);
    roof.scale.z = d / w * 1.05;
    g.add(roof);

    // Door + a couple of warm-lit windows on the +Z face so they read from the road.
    const doorMat = toonMat(COLOR_CRUST, {});
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.1), doorMat);
    door.position.set(x, 0.55, d / 2 + 0.03);
    g.add(door);
    const winMat = glowMat(COLOR_MOLTEN, 0.9);
    for (const wx of [-w * 0.28, w * 0.28]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), winMat);
      win.position.set(x + wx, h * 0.6, d / 2 + 0.03);
      g.add(win);
    }
    return g;
  }

  private buildTreeClump(side: number, seed: number): THREE.Group {
    const g = new THREE.Group();
    const rnd = (n: number) => Math.abs(Math.sin((seed + n) * 51.17) * 24634.6) % 1;
    const n = 1 + Math.floor(rnd(1) * 2);
    for (let i = 0; i < n; i++) {
      g.add(this.buildTree(side * (HOUSE_X - 0.5 + rnd(i + 2) * 3), -1.5 + rnd(i + 5) * 3, 1 + rnd(i + 7) * 0.7));
    }
    return g;
  }

  private buildTree(x: number, z: number, scale: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.2, 7), toonMat(COLOR_CRUST, {}));
    trunk.position.set(x, 0.6 * scale, z);
    trunk.scale.setScalar(scale);
    g.add(trunk);
    const leafMat = toonMat(COLOR_FOLIAGE, {});
    const leafDark = toonMat(COLOR_LEAF, {});
    for (const [dx, dy, dz, r, dark] of [
      [0, 1.5, 0, 1.0, false],
      [-0.5, 1.2, 0.3, 0.72, true],
      [0.55, 1.25, -0.2, 0.72, false],
      [0.1, 1.95, 0.1, 0.66, true],
    ] as const) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), dark ? leafDark : leafMat);
      blob.position.set(x + dx * scale, (dy + 0.3) * scale, z + dz * scale);
      blob.scale.setScalar(scale);
      g.add(blob);
    }
    return g;
  }

  private buildHedgeAndLamp(side: number, seed: number): THREE.Group {
    const g = new THREE.Group();
    const rnd = (n: number) => Math.abs(Math.sin((seed + n) * 33.7) * 9631.4) % 1;
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 3 + rnd(1) * 2), toonMat(COLOR_LEAF, {}));
    hedge.position.set(side * (HOUSE_X - 1.5), 0.45, rnd(2) * 2 - 1);
    g.add(hedge);
    // Warm lamp post — a rare point of glow along the street.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), toonMat(COLOR_CRUST, {}));
    const px = side * (ROAD_HALF_WIDTH + SHOULDER + 0.4);
    pole.position.set(px, 1.2, 1.5);
    g.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glowMat(COLOR_MOLTEN, 1));
    lamp.position.set(px, 2.5, 1.5);
    g.add(lamp);
    return g;
  }

  /** Little trees + bushes filling the meadow beyond the house line, on their
   *  own (denser) Z grid. They join `this.clusters`, so they scroll and wrap
   *  exactly like the houses — everything on the grass streams past together;
   *  only the featureless grass sheet itself stands still. All beyond
   *  `MEADOW_MIN_X` so they never overlap the house/tree clusters. */
  private buildMeadow(): void {
    const rnd = (n: number) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
    let i = 0;
    for (const side of [-1, 1]) {
      for (let z = SCENERY_SPAWN_Z; z < SCENERY_SPAWN_Z + SCENERY_SPAN; z += 4.2 + rnd(i) * 3.8, i++) {
        const g = new THREE.Group();
        g.position.set(0, 0, z + rnd(i + 0.7) * 3);
        // Quadratic bias keeps most props near the visible inner meadow band.
        const x = side * (MEADOW_MIN_X + Math.pow(rnd(i + 0.3), 2) * 26);
        if (rnd(i + 0.5) < 0.45) {
          g.add(this.buildMeadowTree(x, 0, 0.85 + rnd(i + 0.9) * 0.6));
        } else {
          const s = 1.1 + rnd(i + 1.3) * 1.3;
          const bush = new THREE.Mesh(this.bushGeo, rnd(i + 1.7) < 0.35 ? this.bushMatDark : this.bushMat);
          bush.position.set(x, 0.16 * s, 0);
          bush.scale.set(s, s * 0.85, s);
          bush.rotation.y = rnd(i + 2.1) * Math.PI;
          g.add(bush);
        }
        this.clusters.push(g);
        this.group.add(g);
      }
    }
  }

  /** A lighter tree than `buildTree` (shared geometry + materials) for the
   *  meadow scatter, which places a few dozen of them. */
  private buildMeadowTree(x: number, z: number, scale: number): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(this.trunkGeo, this.trunkMat);
    trunk.position.set(x, 0.6 * scale, z);
    trunk.scale.setScalar(scale);
    g.add(trunk);
    for (const [dx, dy, r, dark] of [
      [0, 1.55, 2.2, false],
      [-0.45, 1.15, 1.6, true],
      [0.5, 1.25, 1.5, false],
    ] as const) {
      const blob = new THREE.Mesh(this.bushGeo, dark ? this.bushMatDark : this.bushMat);
      blob.position.set(x + dx * scale, dy * scale, z);
      blob.scale.setScalar(r * scale);
      g.add(blob);
    }
    return g;
  }

  private buildSky(): void {
    const skyTex = makeSkyTexture();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 32, 24),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.group.add(sky);

    // Low sun: a bright disc + soft halo, sitting where the key light comes from.
    const sunPos = new THREE.Vector3(-34, 16, -150);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(11, 40), glowMat(0xfff1c0, 1));
    (sun.material as THREE.MeshBasicMaterial).fog = false;
    sun.position.copy(sunPos);
    sun.lookAt(0, 4, CAMERA_POS.z);
    this.group.add(sun);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(24, 40), glowMat(COLOR_MOLTEN, 0.35, true));
    (halo.material as THREE.MeshBasicMaterial).fog = false;
    halo.position.copy(sunPos).setZ(sunPos.z - 1);
    halo.lookAt(0, 4, CAMERA_POS.z);
    this.group.add(halo);

    // Drifting warm clouds.
    const cloudTex = makeCloudTexture();
    for (let i = 0; i < 7; i++) {
      const s = 14 + Math.random() * 20;
      const cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(s, s * 0.5),
        new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.65, depthWrite: false, fog: false }),
      );
      cloud.position.set((Math.random() * 2 - 1) * 120, 26 + Math.random() * 26, -120 - Math.random() * 90);
      this.clouds.push({ sprite: cloud, speed: 0.6 + Math.random() * 1.2 });
      this.group.add(cloud);
    }
  }

  /** Scrolls the ground textures, wraps the roadside props toward the camera, and
   *  drifts the clouds. `dz` is the world distance travelled this frame. */
  scroll(dz: number, dt: number): void {
    // Only the road surface scrolls its texture (the moving dashes are the clean
    // speed cue). The grass stays STILL — a sliding grass sheet looked cheap — and
    // its motion instead comes from the tufts + props scrolling past it (below).
    this.roadTex.offset.y -= dz / ROAD_TILE;
    this.dirtTex.offset.y -= dz / GRASS_TILE;

    for (const cluster of this.clusters) {
      cluster.position.z += dz;
      if (cluster.position.z > CAMERA_POS.z + 6) cluster.position.z -= WRAP_AHEAD;
    }

    for (const { sprite, speed } of this.clouds) {
      sprite.position.x += speed * dt;
      if (sprite.position.x > 140) sprite.position.x = -140;
    }
  }
}

// --- Canvas textures (warm, painterly, cheap) ---

function makeRoadTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#4a4038";
  ctx.fillRect(0, 0, w, h);
  // Warm asphalt speckle.
  for (let i = 0; i < 900; i++) {
    const shade = 60 + Math.random() * 40;
    ctx.fillStyle = `rgba(${shade + 20},${shade + 6},${shade - 8},${0.14 + Math.random() * 0.16})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
  // Cream edge lines.
  ctx.fillStyle = "rgba(242,228,196,0.7)";
  ctx.fillRect(6, 0, 4, h);
  ctx.fillRect(w - 10, 0, 4, h);
  // Dashed centre line.
  ctx.fillStyle = "rgba(242,228,196,0.85)";
  const dash = 46;
  for (let y = 0; y < h; y += dash * 1.6) {
    ctx.fillRect(w / 2 - 3, y, 6, dash);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, GROUND_LENGTH / ROAD_TILE);
  return tex;
}

function makeDirtTexture(): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#9a7040";
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 500; i++) {
    const d = Math.random() < 0.5;
    ctx.fillStyle = d ? "rgba(120,86,46,0.5)" : "rgba(190,150,100,0.4)";
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, GROUND_LENGTH / GRASS_TILE);
  return tex;
}

function makeSkyTexture(): THREE.CanvasTexture {
  const w = 16;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // v=0 is the top of the sphere (zenith) → dusk violet-blue; equator ~0.5 →
  // warm orange horizon; below → deep peach ground haze.
  g.addColorStop(0.0, "#5b5aa8");
  g.addColorStop(0.28, "#8a6fb0");
  g.addColorStop(0.44, "#e0865a");
  g.addColorStop(0.52, "#ffcf9a");
  g.addColorStop(0.6, "#ffd9a8");
  g.addColorStop(1.0, "#e8b57a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A soft hill silhouette band just below the horizon.
  ctx.fillStyle = "rgba(150,96,60,0.55)";
  const hy = h * 0.56;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    ctx.lineTo(x, hy + Math.sin(x * 0.9) * 4);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCloudTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, s, s);
  for (let i = 0; i < 14; i++) {
    const cx = s * (0.25 + Math.random() * 0.5);
    const cy = s * (0.4 + Math.random() * 0.35);
    const r = s * (0.1 + Math.random() * 0.16);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,240,220,0.9)");
    g.addColorStop(1, "rgba(255,220,190,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
