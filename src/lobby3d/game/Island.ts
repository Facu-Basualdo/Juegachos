import * as THREE from "three";
import { coverUrl, type GameEntry } from "../../games";
import {
  FRAME_SIZE,
  FRAME_Y,
  GALLERY_RADIUS,
  GALLERY_SPAN,
  ISLAND_RADIUS,
  PEDESTAL_RADIUS,
  PLAZA_RADIUS,
  PORTAL_RADIUS,
  PORTAL_RADIUS_RING,
  READY_HEIGHT,
  READY_RADIUS,
  READY_X,
  READY_Z,
  WALK_RADIUS,
} from "./constants";
import { crestTexture, labelSprite, plaqueTexture, setSpriteLabel } from "./textures";

/** Circulo que el muñeco no puede atravesar (troncos, marcos, pedestal). */
export interface Collider {
  x: number;
  z: number;
  r: number;
}

/** Candidato encendido en la votacion. */
export interface PortalVote {
  id: string;
  accent: string;
}

const GRASS = ["#8fd18b", "#7cc47a", "#a2dc93", "#86cc84"];
const DIRT = ["#c9a27a", "#b8916c", "#a98262", "#bd9870"];
const ROCK = "#b8b2a8";
const STONE = "#e8e0cf";
const WOOD = "#e7c79a";
const WOOD_DARK = "#c9a577";
const LEAVES = ["#5fae6e", "#7cc47a", "#4f9a64", "#6dbb73"];
const FLOWERS = ["#ffffff", "#ffd43b", "#f783ac", "#b197fc", "#ff8787"];
const READY_OFF = "#e5d7b0";
/**
 * Altura del contador de votos: arriba del techito del marco. Sobre el hexagono
 * (que esta mas cerca del centro) en perspectiva parecia de la portada de al lado.
 */
const COUNT_Y = FRAME_Y + FRAME_SIZE / 2 + 0.95;
const READY_ON = "#ffcf4a";

/** RNG con semilla (la isla es igual en todas las pantallas). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lambert(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/** Pinta cada triangulo de una geometria no indexada con un color de la lista. */
function paintFaces(geo: THREE.BufferGeometry, palette: string[], rand: () => number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i += 3) {
    c.set(palette[Math.floor(rand() * palette.length)]);
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = c.r;
      colors[(i + v) * 3 + 1] = c.g;
      colors[(i + v) * 3 + 2] = c.b;
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function vertexColored(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

/**
 * Una isla flotante: tapa de pasto facetada, un borde de tierra y la panza que se
 * afina hacia abajo. `top` = altura del pasto (0 en la isla principal).
 */
function buildIsland(radius: number, depth: number, seed: number): THREE.Group {
  const rand = rng(seed);
  const group = new THREE.Group();
  const sides = 14;

  // Tapa: un anillo subdividido con alturas apenas movidas para que la luz la facetee.
  const rings = new THREE.RingGeometry(radius * 0.18, radius, sides, 4);
  const pos = rings.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    if (r < radius - 0.01) pos.setZ(i, (rand() - 0.5) * 0.08);
  }
  rings.computeVertexNormals();
  const inner = new THREE.CircleGeometry(radius * 0.18, sides);
  for (const geo of [rings, inner]) {
    const mesh = new THREE.Mesh(paintFaces(geo, GRASS, rand), vertexColored());
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }

  // Borde de tierra.
  const rimH = Math.min(1.1, depth * 0.2);
  const rim = new THREE.CylinderGeometry(radius, radius * 0.93, rimH, sides, 1, true);
  const rimMesh = new THREE.Mesh(paintFaces(rim, DIRT, rand), vertexColored());
  rimMesh.position.y = -rimH / 2 - 0.02;
  group.add(rimMesh);

  // Panza: cono hacia abajo con los anillos del medio corridos al azar.
  const belly = new THREE.ConeGeometry(radius * 0.93, depth, sides, 4, true);
  const bp = belly.getAttribute("position");
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i);
    // Ni la boca (se pega al borde) ni la punta.
    if (y > depth / 2 - 0.01 || y < -depth / 2 + 0.01) continue;
    const k = 1 + (rand() - 0.5) * 0.28;
    bp.setX(i, bp.getX(i) * k);
    bp.setZ(i, bp.getZ(i) * k);
    bp.setY(i, y + (rand() - 0.5) * depth * 0.08);
  }
  const bellyMesh = new THREE.Mesh(paintFaces(belly, [...DIRT, ROCK, "#9d8b78"], rand), vertexColored());
  bellyMesh.rotation.x = Math.PI;
  bellyMesh.position.y = -rimH - depth / 2 + 0.02;
  group.add(bellyMesh);

  // Rocas colgando de la panza.
  const rockMat = lambert(ROCK);
  const rocks = Math.round(radius * 0.5);
  for (let i = 0; i < rocks; i++) {
    const a = rand() * Math.PI * 2;
    const r = radius * (0.35 + rand() * 0.45);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + rand() * radius * 0.06, 0), rockMat);
    rock.position.set(Math.cos(a) * r, -rimH - depth * (0.25 + rand() * 0.35), Math.sin(a) * r);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    group.add(rock);
  }
  return group;
}

function buildTree(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.1, 6), lambert("#9b7653"));
  trunk.position.y = 0.55;
  g.add(trunk);
  const leaf = lambert(LEAVES[Math.floor(rand() * LEAVES.length)]);
  if (rand() < 0.5) {
    // Pino: dos conos apilados.
    const a = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.5, 7), leaf);
    a.position.y = 1.55;
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.2, 7), leaf);
    b.position.y = 2.35;
    g.add(a, b);
  } else {
    // Copa redonda: un icosaedro aplastado.
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), leaf);
    c.scale.set(1, 0.9, 1);
    c.position.y = 1.85;
    c.rotation.y = rand() * 3;
    g.add(c);
  }
  const s = 0.8 + rand() * 0.45;
  g.scale.setScalar(s);
  return g;
}

interface Portal {
  game: GameEntry;
  x: number;
  z: number;
  frameMat: THREE.MeshLambertMaterial;
  coverMat: THREE.MeshBasicMaterial;
  pad: THREE.Mesh;
  padMat: THREE.MeshLambertMaterial;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  count: THREE.Sprite;
  countText: string;
  active: boolean;
  mine: boolean;
}

/**
 * La isla principal y todo lo que tiene arriba: plaza con pedestal, galeria de
 * portadas con sus portales, plataforma LISTO, arboles y flores. Tambien responde
 * la fisica del lugar: la altura del piso y los colliders.
 */
export class Island {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private readonly portals: Portal[] = [];
  private readonly readyMat: THREE.MeshLambertMaterial;
  private readonly readyDecal: THREE.Mesh;
  private readyActive = false;
  private readonly featured = new THREE.Group();
  private readonly featuredFront: THREE.MeshBasicMaterial;
  private readonly featuredBack: THREE.MeshBasicMaterial;
  private featuredKey = "";
  private readonly covers = new Map<string, THREE.Texture>();
  private readonly loader = new THREE.TextureLoader();
  private readonly islets: THREE.Group[] = [];
  /** Lo que se puede apuntar y tocar en primera persona (marcos, portales, plataforma). */
  private readonly pickables: THREE.Object3D[] = [];
  private time = 0;

  constructor(games: GameEntry[]) {
    const rand = rng(20260929);
    this.group.add(buildIsland(ISLAND_RADIUS, 11, 7));

    // Plaza y pedestal.
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS + 0.1, 0.06, 16), lambert(STONE));
    plaza.position.y = 0.03;
    this.group.add(plaza);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(PEDESTAL_RADIUS, PEDESTAL_RADIUS + 0.15, 0.9, 8), lambert(STONE));
    pedestal.position.y = 0.45;
    this.group.add(pedestal);
    this.colliders.push({ x: 0, z: 0, r: PEDESTAL_RADIUS + 0.15 });

    // Cartel giratorio del pedestal: la portada del juego elegido (o el escudo de la sala).
    this.featuredFront = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.featuredBack = new THREE.MeshBasicMaterial({ toneMapped: false });
    const fBoard = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.3, 0.12), lambert(WOOD));
    const fFront = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), this.featuredFront);
    fFront.position.z = 0.07;
    const fBack = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), this.featuredBack);
    fBack.position.z = -0.07;
    fBack.rotation.y = Math.PI;
    this.featured.add(fBoard, fFront, fBack);
    this.featured.position.y = 2.6;
    this.group.add(this.featured);
    this.setFeatured(null, "LA ISLA", "");

    // Senderos de piedra: del sur a la plaza y de la plaza a la galeria.
    const stepMat = lambert(STONE);
    const stepGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.05, 6);
    const addStep = (x: number, z: number): void => {
      const s = new THREE.Mesh(stepGeo, stepMat);
      s.position.set(x + (rand() - 0.5) * 0.2, 0.025, z);
      s.rotation.y = rand();
      this.group.add(s);
    };
    for (let z = 9.2; z <= 14.5; z += 1.1) addStep(0, z);
    for (let z = -4.2; z >= -8.6; z -= 1.1) addStep(0, z);

    this.buildGallery(games);
    this.buildReadyPad();
    this.readyMat = (this.group.getObjectByName("ready-pad") as THREE.Mesh).material as THREE.MeshLambertMaterial;
    this.readyDecal = this.group.getObjectByName("ready-decal") as THREE.Mesh;

    // Arboles al sur y en los extremos de la galeria (nunca en la linea camara-jugador).
    for (let deg = 118; deg <= 242; deg += 14) {
      if (deg > 160 && deg < 200) continue;
      const a = (deg * Math.PI) / 180;
      const r = 14.6 + rand() * 1.2;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      const tree = buildTree(rand);
      tree.position.set(x, 0, z);
      this.group.add(tree);
      // Ancho de la copa, no del tronco: en primera persona la camara se metia en las hojas.
      this.colliders.push({ x, z, r: 0.85 });
    }

    // Rocas y arbustos sueltos por el borde.
    const bushMat = lambert("#6dbb73");
    for (let i = 0; i < 10; i++) {
      const a = rand() * Math.PI * 2;
      const r = 15.3 + rand() * 0.8;
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + rand() * 0.25, 0), rand() < 0.5 ? bushMat : lambert(ROCK));
      bush.position.set(Math.sin(a) * r, 0.2, -Math.cos(a) * r);
      bush.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      this.group.add(bush);
    }

    // Flores: una sola InstancedMesh, colores por instancia.
    const flowerCount = 90;
    const flowers = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.07, 0),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      flowerCount,
    );
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < flowerCount; i++) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 8; tries++) {
        const a = rand() * Math.PI * 2;
        const r = PLAZA_RADIUS + 0.6 + rand() * (WALK_RADIUS - PLAZA_RADIUS - 0.8);
        x = Math.sin(a) * r;
        z = -Math.cos(a) * r;
        if (!this.nearPortal(x, z) && Math.hypot(x - READY_X, z - READY_Z) > READY_RADIUS + 0.4) break;
      }
      m.makeTranslation(x, 0.08, z);
      flowers.setMatrixAt(i, m);
      flowers.setColorAt(i, c.set(FLOWERS[Math.floor(rand() * FLOWERS.length)]));
    }
    this.group.add(flowers);

    // Islotes lejanos (decorado; se mecen solos).
    const isletSpots = [
      [-42, 4, -38, 4.5],
      [48, -6, -30, 3.5],
      [-60, -2, 12, 5.5],
      [58, 8, 20, 3],
      [8, -10, -70, 6],
      [-24, 12, -80, 3.2],
    ];
    isletSpots.forEach(([x, y, z, r], i) => {
      const islet = buildIsland(r, r * 1.6, 100 + i);
      if (r > 4) {
        const t = buildTree(rand);
        t.position.set(r * 0.2, 0, -r * 0.1);
        islet.add(t);
      }
      islet.position.set(x, y, z);
      islet.userData.baseY = y;
      this.islets.push(islet);
      this.group.add(islet);
    });
  }

  private nearPortal(x: number, z: number): boolean {
    return this.portals.some((p) => Math.hypot(p.x - x, p.z - z) < PORTAL_RADIUS + 0.4);
  }

  private buildGallery(games: GameEntry[]): void {
    const n = games.length;
    const woodMat = lambert(WOOD_DARK);
    games.forEach((game, i) => {
      const theta = n === 1 ? 0 : -GALLERY_SPAN / 2 + (GALLERY_SPAN * i) / (n - 1);
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);

      // Marco con la portada, de cara al centro.
      const frame = new THREE.Group();
      frame.position.set(sin * GALLERY_RADIUS, 0, -cos * GALLERY_RADIUS);
      frame.rotation.y = -theta;
      const postH = FRAME_Y + FRAME_SIZE / 2 + 0.3;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, postH, 0.16), woodMat);
        post.position.set(side * (FRAME_SIZE / 2 + 0.22), postH / 2, 0);
        frame.add(post);
      }
      const frameMat = lambert(WOOD);
      const board = new THREE.Mesh(new THREE.BoxGeometry(FRAME_SIZE + 0.3, FRAME_SIZE + 0.3, 0.14), frameMat);
      board.position.y = FRAME_Y;
      frame.add(board);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, FRAME_SIZE + 0.8, 3), woodMat);
      // Prisma triangular acostado a lo ancho, con la cumbrera hacia arriba.
      roof.rotation.z = Math.PI / 2;
      roof.rotation.x = -Math.PI / 2;
      roof.position.y = FRAME_Y + FRAME_SIZE / 2 + 0.34;
      frame.add(roof);

      const coverMat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
      coverMat.map = this.cover(game.id);
      const cover = new THREE.Mesh(new THREE.PlaneGeometry(FRAME_SIZE, FRAME_SIZE), coverMat);
      cover.position.set(0, FRAME_Y, 0.08);
      frame.add(cover);

      const plaque = plaqueTexture(game.title, { size: 34 });
      const plaqueH = 0.56;
      const plaqueMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(plaqueH * plaque.aspect, plaqueH),
        new THREE.MeshBasicMaterial({ map: plaque.texture, transparent: true, toneMapped: false }),
      );
      plaqueMesh.position.set(0, FRAME_Y - FRAME_SIZE / 2 - 0.45, 0.09);
      frame.add(plaqueMesh);
      frame.userData.portal = game.id;
      this.pickables.push(frame);
      this.group.add(frame);

      // Colliders a lo ancho del marco (se puede pasar por detras, no a traves).
      for (const off of [-0.9, 0, 0.9]) {
        this.colliders.push({
          x: frame.position.x + cos * off,
          z: frame.position.z + sin * off,
          r: 0.5,
        });
      }

      // Portal en el piso, entre la portada y la plaza.
      const px = sin * PORTAL_RADIUS_RING;
      const pz = -cos * PORTAL_RADIUS_RING;
      const padMat = lambert("#efe6d2");
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_RADIUS, PORTAL_RADIUS + 0.06, 0.1, 6), padMat);
      pad.position.set(px, 0.05, pz);
      pad.rotation.y = -theta;
      pad.userData.portal = game.id;
      this.pickables.push(pad);
      this.group.add(pad);

      const accent = game.accent ?? "#4dabf7";
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(PORTAL_RADIUS - 0.2, 0.07, 4, 6),
        new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(px, 0.16, pz);
      ring.visible = false;
      this.group.add(ring);

      const beamMat = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_RADIUS - 0.15, PORTAL_RADIUS, 4.4, 6, 1, true), beamMat);
      beam.position.set(px, 2.2, pz);
      beam.visible = false;
      this.group.add(beam);

      const count = labelSprite(plaqueTexture("0"), 0.42);
      count.position.set(frame.position.x, COUNT_Y, frame.position.z);
      count.visible = false;
      this.group.add(count);

      this.portals.push({
        game,
        x: px,
        z: pz,
        frameMat,
        coverMat,
        pad,
        padMat,
        ring,
        beam,
        beamMat,
        count,
        countText: "0",
        active: false,
        mine: false,
      });
    });
  }

  private buildReadyPad(): void {
    const mat = lambert(READY_OFF);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(READY_RADIUS, READY_RADIUS + 0.12, READY_HEIGHT, 12), mat);
    pad.name = "ready-pad";
    pad.userData.ready = true;
    this.pickables.push(pad);
    pad.position.set(READY_X, READY_HEIGHT / 2, READY_Z);
    this.group.add(pad);

    const label = plaqueTexture("LISTO", { size: 56, bg: "rgba(0,0,0,0)" });
    const w = 2.2;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / label.aspect),
      new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthWrite: false }),
    );
    decal.name = "ready-decal";
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(READY_X, READY_HEIGHT + 0.01, READY_Z);
    this.group.add(decal);
  }

  private cover(id: string): THREE.Texture {
    let tex = this.covers.get(id);
    if (!tex) {
      tex = this.loader.load(coverUrl(id));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.covers.set(id, tex);
    }
    return tex;
  }

  // ---------- Fisica del lugar ----------

  /** Altura del piso en (x, z), o -Infinity fuera de la isla. */
  groundAt(x: number, z: number): number {
    if (Math.hypot(x - READY_X, z - READY_Z) < READY_RADIUS) return READY_HEIGHT;
    if (Math.hypot(x, z) < WALK_RADIUS) return 0;
    return -Infinity;
  }

  /** Portal encendido bajo (x, z), o null. */
  portalAt(x: number, z: number): string | null {
    for (const p of this.portals) {
      if (p.active && Math.hypot(p.x - x, p.z - z) < PORTAL_RADIUS * 0.92) return p.game.id;
    }
    return null;
  }

  /** Parado arriba de la plataforma LISTO (y encendida). */
  onReadyPad(x: number, y: number, z: number): boolean {
    return (
      this.readyActive &&
      y >= READY_HEIGHT - 0.05 &&
      y < READY_HEIGHT + 0.2 &&
      Math.hypot(x - READY_X, z - READY_Z) < READY_RADIUS - 0.15
    );
  }

  /**
   * Lo que hay en la mira (primera persona): un portal encendido (su marco o su
   * hexagono) o la plataforma LISTO encendida, dentro de `range` metros.
   */
  pick(ray: THREE.Raycaster, range: number): { portal: string } | { ready: true } | null {
    ray.far = range;
    for (const hit of ray.intersectObjects(this.pickables, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.portal === undefined && !o.userData.ready) o = o.parent;
      if (!o) continue;
      if (o.userData.ready) return this.readyActive ? { ready: true } : null;
      const id = o.userData.portal as string;
      return this.portals.some((p) => p.active && p.game.id === id) ? { portal: id } : null;
    }
    return null;
  }

  /** Centro del portal de un juego (para la flecha del HUD / la camara). */
  portalCenter(id: string): { x: number; z: number } | null {
    const p = this.portals.find((q) => q.game.id === id);
    return p ? { x: p.x, z: p.z } : null;
  }

  // ---------- Estado de la sala ----------

  /**
   * Enciende los candidatos de la votacion (null = sin votacion). Los demas
   * marcos se apagan un poco para que los encendidos se lean de lejos.
   */
  setVoting(options: PortalVote[] | null, counts: Record<string, number>, mine: string | null): void {
    const ids = new Set(options?.map((o) => o.id) ?? []);
    for (const p of this.portals) {
      const active = ids.has(p.game.id);
      p.active = active;
      p.mine = active && mine === p.game.id;
      p.ring.visible = active;
      p.beam.visible = active;
      p.count.visible = active;
      const accent = p.game.accent ?? "#4dabf7";
      p.padMat.color.set(active ? accent : "#efe6d2");
      p.padMat.emissive.set(active ? accent : "#000000");
      p.padMat.emissiveIntensity = active ? 0.35 : 0;
      p.coverMat.color.set(options && !active ? "#8a8a8a" : "#ffffff");
      p.frameMat.color.set(active ? accent : WOOD);
      (p.ring.material as THREE.MeshBasicMaterial).color.set(p.mine ? "#ffffff" : accent);
      if (active) {
        const n = counts[p.game.id] ?? 0;
        const text = n === 1 ? "1 voto" : `${n} votos`;
        if (text !== p.countText) {
          p.countText = text;
          setSpriteLabel(p.count, plaqueTexture(text, { bg: p.mine ? "#ffcf4a" : undefined }), 0.42);
        }
      }
    }
  }

  setReady(active: boolean, mine: boolean): void {
    this.readyActive = active;
    this.readyMat.color.set(active ? (mine ? "#8fe38a" : READY_ON) : READY_OFF);
    this.readyMat.emissive.set(active ? "#6b4a00" : "#000000");
    this.readyDecal.visible = active;
  }

  /** Portada del pedestal: el juego de la ronda, o el escudo con el codigo de la sala. */
  setFeatured(gameId: string | null, title: string, subtitle: string): void {
    const key = gameId ?? `crest:${title}:${subtitle}`;
    if (key === this.featuredKey) return;
    this.featuredKey = key;
    const map = gameId ? this.cover(gameId) : crestTexture(title, subtitle);
    for (const m of [this.featuredFront, this.featuredBack]) {
      m.map = map;
      m.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    // Mira a la camara (que nunca gira) y apenas se mece: girando entero se leia de canto.
    this.featured.rotation.y = Math.sin(t * 0.5) * 0.3;
    this.featured.position.y = 2.6 + Math.sin(t * 1.3) * 0.08;
    for (const p of this.portals) {
      if (!p.active) continue;
      p.ring.rotation.z += dt * (p.mine ? 2.4 : 0.9);
      p.ring.position.y = 0.16 + Math.sin(t * 3 + p.x) * 0.05;
      p.beamMat.opacity = (p.mine ? 0.34 : 0.18) + Math.sin(t * 2.2 + p.z) * 0.05;
      p.count.position.y = COUNT_Y + Math.sin(t * 1.6 + p.x) * 0.05;
    }
    if (this.readyActive) this.readyMat.emissiveIntensity = 0.25 + Math.sin(t * 4) * 0.15;
    for (let i = 0; i < this.islets.length; i++) {
      const islet = this.islets[i];
      islet.position.y = (islet.userData.baseY as number) + Math.sin(t * 0.4 + i * 1.7) * 0.6;
    }
  }
}
