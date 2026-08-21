import * as THREE from "three";
import { toon } from "./materials";
import { ZONE_CLOUDS_Y, ZONE_STRATO_Y, ZONE_SPACE_Y } from "./constants";

/** Sky color stops keyed to the tower-top height (world Y). */
const SKY_STOPS: { y: number; c: THREE.Color }[] = [
  { y: 0, c: new THREE.Color(0xbfe3f5) }, // street level, pastel morning
  { y: ZONE_CLOUDS_Y, c: new THREE.Color(0x8fc4ea) }, // up among the clouds
  { y: ZONE_STRATO_Y, c: new THREE.Color(0x2c3f7a) }, // cold stratosphere
  { y: ZONE_SPACE_Y, c: new THREE.Color(0x05060f) }, // outer space
];

interface Cloud {
  mesh: THREE.Object3D;
  speed: number;
}

/**
 * Module 3 (backdrop half) — the world that answers the climb: the sky color
 * lerps from street level through clouds and stratosphere to black space as the
 * tower rises, stars fade in up high, toy houses sit at the base and low clouds
 * drift past. Pure eye-candy; nothing here touches gameplay.
 */
export class Environment {
  readonly group = new THREE.Group();

  private readonly scene: THREE.Scene;
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.PointsMaterial;
  private readonly clouds: Cloud[] = [];
  private readonly skyColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.background = this.skyColor.copy(SKY_STOPS[0].c);
    scene.fog = new THREE.Fog(this.skyColor.clone(), 26, 72);

    this.group.add(makeHouses());

    // Drifting low-poly clouds spread up the first stretch of the climb.
    for (let i = 0; i < 14; i++) {
      const mesh = makeCloud();
      mesh.position.set(
        (Math.random() - 0.5) * 26,
        4 + Math.random() * 46,
        -6 - Math.random() * 10,
      );
      this.group.add(mesh);
      this.clouds.push({ mesh, speed: 0.3 + Math.random() * 0.5 });
    }

    // Starfield that only shows up high.
    const N = 320;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = ZONE_STRATO_Y + Math.random() * 90;
      pos[i * 3 + 2] = -14 - Math.random() * 22;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.32,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.group.add(this.stars);
  }

  /** Interpolates the sky color for a given tower-top height. */
  private skyAt(y: number, out: THREE.Color): void {
    if (y <= SKY_STOPS[0].y) {
      out.copy(SKY_STOPS[0].c);
      return;
    }
    for (let i = 1; i < SKY_STOPS.length; i++) {
      if (y <= SKY_STOPS[i].y) {
        const a = SKY_STOPS[i - 1];
        const b = SKY_STOPS[i];
        out.copy(a.c).lerp(b.c, (y - a.y) / (b.y - a.y));
        return;
      }
    }
    out.copy(SKY_STOPS[SKY_STOPS.length - 1].c);
  }

  /**
   * @param topY  world Y of the current tower top (drives the sky/stars).
   */
  update(dt: number, topY: number): void {
    this.skyAt(topY, this.skyColor);
    (this.scene.fog as THREE.Fog).color.copy(this.skyColor);

    // Stars fade in across the stratosphere -> space band.
    const t = (topY - ZONE_STRATO_Y) / (ZONE_SPACE_Y - ZONE_STRATO_Y);
    this.starMat.opacity = Math.max(0, Math.min(1, t));

    for (const cloud of this.clouds) {
      cloud.mesh.position.x += cloud.speed * dt;
      if (cloud.mesh.position.x > 15) cloud.mesh.position.x = -15;
    }
  }
}

/** A ring of tiny toy houses around the construction site. */
function makeHouses(): THREE.Group {
  const group = new THREE.Group();
  const colors = [0xe6b566, 0xd98a6a, 0x8fbf8f, 0xd7cf8f];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = 5.5 + Math.random() * 2.5;
    const house = new THREE.Group();
    const w = 0.9 + Math.random() * 0.5;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.7, w),
      toon(colors[i % colors.length]),
    );
    body.position.y = -1.2 + 0.35;
    body.castShadow = true;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.8, 0.5, 4),
      toon(0xb5533f),
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = -1.2 + 0.95;
    house.add(body, roof);
    house.position.set(Math.cos(a) * r, 0, Math.sin(a) * r - 3);
    group.add(house);
  }
  return group;
}

/** A puffy low-poly cloud from a few clustered spheres. */
function makeCloud(): THREE.Object3D {
  const cloud = new THREE.Group();
  const mat = toon(0xffffff);
  const puffs = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < puffs; i++) {
    const r = 0.6 + Math.random() * 0.5;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    puff.position.set((i - puffs / 2) * 0.7, (Math.random() - 0.5) * 0.3, 0);
    puff.scale.y = 0.7;
    cloud.add(puff);
  }
  return cloud;
}
