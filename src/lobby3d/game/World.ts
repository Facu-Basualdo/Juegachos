import * as THREE from "three";
import { coverUrl, type GameEntry } from "../../games";
import {
  FENCE_RADIUS,
  FRAME_SIZE,
  FRAME_Y,
  GALLERY_RADIUS,
  GALLERY_SPAN,
  GROUND_RADIUS,
  PORTAL_RADIUS,
  PORTAL_RADIUS_RING,
  READY_HALF,
  READY_HEIGHT,
  READY_X,
  READY_Z,
  TOWER_X,
  TOWER_Z,
  TV_RADIUS,
} from "./constants";
import { CollisionWorld, makeBox, toLocal, type Box } from "./Physics";
import { decal, psxBasic, psxLambert } from "./retro";
import {
  barkTexture,
  groundTexture,
  labelSprite,
  plaqueTexture,
  posterTexture,
  rng,
  rustTexture,
  setSpriteLabel,
  signTexture,
  woodTexture,
} from "./textures";
import { Tower } from "./Tower";

/** Candidato encendido en la votacion. */
export interface PortalVote {
  id: string;
  accent: string;
}

interface Portal {
  game: GameEntry;
  x: number;
  z: number;
  /** Donde cuelga su foco (arriba del afiche). */
  lx: number;
  lz: number;
  frameMat: THREE.MeshLambertMaterial;
  posterMat: THREE.MeshBasicMaterial;
  plateMat: THREE.MeshLambertMaterial;
  bulbMat: THREE.MeshBasicMaterial;
  count: THREE.Sprite;
  countText: string;
  active: boolean;
  mine: boolean;
}

interface Bulb {
  mat: THREE.MeshBasicMaterial;
  /** Umbral de la noche a partir del cual se quema (0..1). */
  dieAt: number;
  seed: number;
}

/** Pantalla del televisor, en pixeles (con menos no se reconoce el juego de la ronda). */
const TV_W = 192;
const TV_H = 144;
/**
 * Cartel de un afiche votado: cuantos y quienes ("2 - Ana, Beto"). Con muchos votos
 * se abrevia ("4 - Ana, Beto +2") para no tapar la cartelera.
 */
function voteLabel(n: number, names: string[]): string {
  if (names.length === 0) return n === 1 ? "1 voto" : `${n} votos`;
  const shown = names.slice(0, 2).join(", ");
  const rest = names.length > 2 ? ` +${names.length - 2}` : "";
  return `${n} - ${shown}${rest}`;
}

/** Alto del contador de votos en pantalla (sprite sin atenuacion por distancia). */
const COUNT_SCREEN_H = 0.045;
/** Cuantos focos de votacion hay: van a los afiches mas votados. */
const VOTE_LIGHTS = 5;
const BULB_ON = new THREE.Color("#ffb35c");
const BULB_BAD = new THREE.Color("#ff5a36");
const BULB_RED = new THREE.Color("#c0392b");
const BULB_OFF = new THREE.Color("#1a1410");

/** Caja con UV en metros. */
function boxGeometry(w: number, h: number, d: number, tile = 1): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute("uv");
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return geo;
}

/**
 * El claro de La Feria (DESIGN.md, "Cinta Gastada") y todo lo que tiene: piso de
 * tierra, alambrado, bosque, carteleras con los afiches y sus chapas de votacion, el
 * televisor del centro, el escenario LISTO, guirnaldas de lamparitas, trastos y La
 * Torre. Tambien arma el mundo de colisiones (`world`).
 */
export class World {
  readonly group = new THREE.Group();
  readonly world = new CollisionWorld();
  readonly tower: Tower;
  readonly readyBox: Box;
  private readonly portals: Portal[] = [];
  private readonly pickables: THREE.Object3D[] = [];
  private readonly voteLights: THREE.PointLight[] = [];
  private readonly bulbs: Bulb[] = [];
  private readonly poleLights: THREE.PointLight[] = [];
  private readonly readyMat: THREE.MeshLambertMaterial;
  private readonly readyLight: THREE.PointLight;
  private readyActive = false;
  private readonly tv = new THREE.Group();
  private readonly tvBox: Box;
  private readonly tvCanvas: HTMLCanvasElement;
  private readonly tvCtx: CanvasRenderingContext2D;
  private readonly tvTex: THREE.CanvasTexture;
  private readonly tvLight: THREE.PointLight;
  private tvImage: HTMLImageElement | null = null;
  private tvKey = "";
  private tvTitle = "";
  private tvTimer = 0;
  private dread = 0;
  private time = 0;

  constructor(games: GameEntry[]) {
    const rand = rng(20260930);
    this.world.boundary = FENCE_RADIUS;
    const wood = psxLambert({ map: woodTexture() });
    const woodDark = psxLambert({ map: woodTexture("#46382a") });
    const rust = psxLambert({ map: rustTexture() });

    // Piso: un plano subdividido (el mapeo afin deforma poco en cuadros chicos).
    const groundGeo = new THREE.PlaneGeometry(GROUND_RADIUS * 2, GROUND_RADIUS * 2, 34, 34);
    const guv = groundGeo.getAttribute("uv");
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * GROUND_RADIUS, guv.getY(i) * GROUND_RADIUS);
    const ground = new THREE.Mesh(groundGeo, psxLambert({ map: groundTexture() }));
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);

    this.buildFence(rand, rust);
    this.buildForest(rand);
    this.buildGallery(games, woodDark);

    // Televisor sobre un cajon, mirando al sur (a la entrada).
    const crate = new THREE.Mesh(boxGeometry(1.2, 0.9, 1.0, 1), wood);
    crate.position.y = 0.45;
    const body = new THREE.Mesh(boxGeometry(1.3, 1.0, 1.0), psxLambert({ color: "#2b2a28" }));
    body.position.y = 1.4;
    this.tvCanvas = document.createElement("canvas");
    this.tvCanvas.width = TV_W;
    this.tvCanvas.height = TV_H;
    this.tvCtx = this.tvCanvas.getContext("2d")!;
    this.tvTex = new THREE.CanvasTexture(this.tvCanvas);
    this.tvTex.colorSpace = THREE.SRGBColorSpace;
    this.tvTex.magFilter = THREE.LinearFilter;
    this.tvTex.minFilter = THREE.LinearFilter;
    this.tvTex.generateMipmaps = false;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.78), decal(psxBasic({ map: this.tvTex })));
    screen.position.set(0, 1.42, 0.53);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 3), rust);
    antenna.position.set(0.25, 2.2, 0);
    antenna.rotation.z = -0.5;
    this.tv.add(crate, body, screen, antenna);
    this.tvLight = new THREE.PointLight("#9fc4ff", 6, 9, 1.8);
    this.tvLight.position.set(0, 1.4, 1.3);
    this.tv.add(this.tvLight);
    this.group.add(this.tv);
    this.tvBox = makeBox(0, 0.9, 0, TV_RADIUS, 0.9, TV_RADIUS * 0.8);
    this.world.boxes.push(this.tvBox);
    this.setFeatured(null, "");

    // Escenario LISTO.
    this.readyMat = psxLambert({ map: woodTexture("#5f4a34") });
    const stage = new THREE.Mesh(boxGeometry(READY_HALF * 2, READY_HEIGHT, READY_HALF * 2), this.readyMat);
    stage.position.set(READY_X, READY_HEIGHT / 2, READY_Z);
    stage.userData.ready = true;
    this.pickables.push(stage);
    this.group.add(stage);
    const painted = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.65),
      decal(psxBasic({ map: signTexture("LISTO", { fg: "#d6c9a8", w: 64, h: 16 }), transparent: true, alphaTest: 0.5 })),
    );
    painted.rotation.x = -Math.PI / 2;
    painted.position.set(READY_X, READY_HEIGHT + 0.02, READY_Z);
    this.group.add(painted);
    this.readyBox = makeBox(READY_X, READY_HEIGHT / 2, READY_Z, READY_HALF, READY_HEIGHT / 2, READY_HALF);
    this.world.boxes.push(this.readyBox);
    this.readyLight = new THREE.PointLight("#ffcf7a", 0, 7, 1.6);
    this.readyLight.position.set(READY_X, 3.2, READY_Z);
    this.group.add(this.readyLight);

    this.buildLights(rand, woodDark);
    this.buildJunk(rand, wood, rust);

    this.tower = new Tower(this.world);
    this.group.add(this.tower.group);
  }

  private buildFence(rand: () => number, rust: THREE.Material): void {
    // Alambre romboidal: una textura con agujeros (alphaTest) sobre un cilindro abierto.
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#6d6f70";
    for (let i = 0; i < 16; i++) {
      ctx.fillRect(i, i, 1, 1);
      ctx.fillRect(15 - i, i, 1, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(FENCE_RADIUS * 2 * Math.PI * 2, 5);
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(FENCE_RADIUS, FENCE_RADIUS, 2.4, 64, 1, true),
      psxLambert({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    );
    wire.position.y = 1.2;
    this.group.add(wire);
    const posts = 40;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      const post = new THREE.Mesh(boxGeometry(0.1, 2.6, 0.1), rust);
      post.position.set(Math.cos(a) * FENCE_RADIUS, 1.3, Math.sin(a) * FENCE_RADIUS);
      post.rotation.z = (rand() - 0.5) * 0.12;
      this.group.add(post);
    }
  }

  private buildForest(rand: () => number): void {
    const count = 150;
    const needle = psxLambert({ color: "#131a14" });
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 5, 6), needle, count);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5), psxLambert({ map: barkTexture() }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = FENCE_RADIUS + 2.5 + rand() * 14;
      const k = 0.8 + rand() * 1.1;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6);
      p.set(x, 1.1 * k, z);
      s.set(k, k, k);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      p.set(x, (2.2 + 2.3) * k, z);
      m.compose(p, q, s);
      cones.setMatrixAt(i, m);
    }
    this.group.add(cones, trunks);
  }

  private buildGallery(games: GameEntry[], woodDark: THREE.Material): void {
    const n = games.length;
    const bulbGeo = new THREE.IcosahedronGeometry(0.1, 0);
    games.forEach((game, i) => {
      const theta = n === 1 ? 0 : -GALLERY_SPAN / 2 + (GALLERY_SPAN * i) / (n - 1);
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);

      const frame = new THREE.Group();
      frame.position.set(sin * GALLERY_RADIUS, 0, -cos * GALLERY_RADIUS);
      frame.rotation.y = -theta;
      const postH = FRAME_Y + FRAME_SIZE / 2 + 0.5;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(boxGeometry(0.16, postH, 0.16), woodDark);
        post.position.set(side * (FRAME_SIZE / 2 + 0.22), postH / 2, 0);
        post.rotation.z = side * 0.02;
        frame.add(post);
      }
      const frameMat = psxLambert({ map: woodTexture() });
      const board = new THREE.Mesh(boxGeometry(FRAME_SIZE + 0.3, FRAME_SIZE + 0.3, 0.12), frameMat);
      board.position.y = FRAME_Y;
      frame.add(board);
      // Sin niebla: el afiche se tiene que reconocer desde la otra punta del claro.
      const posterMat = decal(psxBasic({ map: posterTexture(coverUrl(game.id), 300 + i), fog: false }));
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(FRAME_SIZE, FRAME_SIZE), posterMat);
      poster.position.set(0, FRAME_Y, 0.1);
      poster.rotation.z = (i % 3 - 1) * 0.03;
      frame.add(poster);

      // Titulo pintado debajo, y el foco que cuelga arriba (se prende si es candidato).
      const title = new THREE.Mesh(
        new THREE.PlaneGeometry(FRAME_SIZE, FRAME_SIZE / 8),
        decal(psxBasic({ map: signTexture(game.title.toUpperCase(), { bg: "#2a2118", fg: "#cfc5ae", w: 96, h: 12 }), fog: false })),
      );
      title.position.set(0, FRAME_Y - FRAME_SIZE / 2 - 0.3, 0.1);
      frame.add(title);
      const arm = new THREE.Mesh(boxGeometry(0.06, 0.06, 0.7), woodDark);
      arm.position.set(0, postH - 0.1, 0.35);
      const bulbMat = psxBasic({ color: BULB_OFF });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(0, postH - 0.28, 0.7);
      frame.add(arm, bulb);
      frame.userData.portal = game.id;
      this.pickables.push(frame);
      this.group.add(frame);

      // Colision de la cartelera (una caja fina girada).
      this.world.boxes.push(
        makeBox(frame.position.x, postH / 2, frame.position.z, FRAME_SIZE / 2 + 0.3, postH / 2, 0.15, -theta),
      );

      // Chapa en el piso, delante del afiche.
      const px = sin * PORTAL_RADIUS_RING;
      const pz = -cos * PORTAL_RADIUS_RING;
      const plateMat = psxLambert({ map: rustTexture() });
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_RADIUS, PORTAL_RADIUS + 0.05, 0.06, 6), plateMat);
      plate.position.set(px, 0.03, pz);
      plate.rotation.y = -theta;
      plate.userData.portal = game.id;
      this.pickables.push(plate);
      this.group.add(plate);

      // Contador de votos a tamaño fijo en pantalla: a 12 m, 36 cm eran tres pixeles.
      const count = labelSprite(plaqueTexture("0"), COUNT_SCREEN_H);
      count.material.sizeAttenuation = false;
      count.position.set(frame.position.x, postH + 0.55, frame.position.z);
      count.visible = false;
      this.group.add(count);

      // Punto de luz del foco: 0.7 m hacia adelante del afiche (hacia el centro).
      this.portals.push({
        game,
        x: px,
        z: pz,
        lx: frame.position.x - sin * 0.7,
        lz: frame.position.z + cos * 0.7,
        frameMat,
        posterMat,
        plateMat,
        bulbMat,
        count,
        countText: "0",
        active: false,
        mine: false,
      });
    });

    // Luces de los candidatos: un grupo fijo que se reparte entre los encendidos.
    for (let i = 0; i < VOTE_LIGHTS; i++) {
      const l = new THREE.PointLight("#ffb35c", 0, 7, 1.5);
      this.voteLights.push(l);
      this.group.add(l);
    }
  }

  /** Postes con guirnaldas de lamparitas alrededor de la plaza. */
  private buildLights(rand: () => number, woodDark: THREE.Material): void {
    const poles = 6;
    const r = 8;
    const tops: THREE.Vector3[] = [];
    for (let i = 0; i < poles; i++) {
      const a = (i / poles) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const pole = new THREE.Mesh(boxGeometry(0.16, 4.4, 0.16), woodDark);
      pole.position.set(x, 2.2, z);
      pole.rotation.z = (rand() - 0.5) * 0.08;
      this.group.add(pole);
      this.world.circles.push({ x, z, r: 0.12, top: 4.4 });
      tops.push(new THREE.Vector3(x, 4.3, z));
      if (i % 2 === 0) {
        const l = new THREE.PointLight("#ffb35c", 16, 15, 1.3);
        l.position.set(x, 3.8, z);
        this.poleLights.push(l);
        this.group.add(l);
      }
    }
    // Cables con lamparitas que cuelgan en curva entre poste y poste.
    const wireMat = new THREE.LineBasicMaterial({ color: "#4a443b" });
    const bulbGeo = new THREE.IcosahedronGeometry(0.07, 0);
    for (let i = 0; i < poles; i++) {
      const a = tops[i];
      const b = tops[(i + 1) % poles];
      const pts: THREE.Vector3[] = [];
      const segs = 10;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * 0.9;
        pts.push(p);
        if (k > 0 && k < segs) {
          const mat = psxBasic({ color: BULB_ON });
          const bulb = new THREE.Mesh(bulbGeo, mat);
          bulb.position.copy(p).add(new THREE.Vector3(0, -0.1, 0));
          this.group.add(bulb);
          this.bulbs.push({ mat, dieAt: rand(), seed: rand() * 100 });
        }
      }
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
    }
  }

  /** Cajones y tambores tirados (chocan). */
  private buildJunk(rand: () => number, wood: THREE.Material, rust: THREE.Material): void {
    const spots: Array<[number, number]> = [
      [6.5, -3],
      [-6.2, -2.4],
      [7.2, 3.8],
      [4.4, 13],
      [-3.8, 14.5],
      [9.8, 9.5],
      [15, -1],
      [-15.5, 0.5],
    ];
    for (const [x, z] of spots) {
      // Lejos de la torre y de las chapas de votacion.
      if (Math.hypot(x - TOWER_X, z - TOWER_Z) < 7.5) continue;
      if (rand() < 0.5) {
        const s = 0.7 + rand() * 0.4;
        const crate = new THREE.Mesh(boxGeometry(s, s, s, 1), wood);
        const yaw = rand() * 1.5;
        crate.position.set(x, s / 2, z);
        crate.rotation.y = yaw;
        this.group.add(crate);
        this.world.boxes.push(makeBox(x, s / 2, z, s / 2, s / 2, s / 2, yaw));
      } else {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.05, 8), rust);
        barrel.position.set(x, 0.52, z);
        this.group.add(barrel);
        this.world.circles.push({ x, z, r: 0.4, top: 1.05 });
      }
    }
  }

  // ---------- Consultas ----------

  /** Altura del apoyo debajo de (x, z) a la altura `y` (sombras de contacto). */
  supportAt(x: number, y: number, z: number): number {
    let best = 0;
    for (const b of this.world.boxes) {
      if (!b.active) continue;
      const top = b.y + b.hy;
      if (top > y + 0.05 || top <= best) continue;
      const { lx, lz } = toLocal(b, x, z);
      if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) best = top;
    }
    return best;
  }

  /** Chapa encendida bajo (x, z), o null. */
  portalAt(x: number, z: number): string | null {
    for (const p of this.portals) {
      if (p.active && Math.hypot(p.x - x, p.z - z) < PORTAL_RADIUS * 0.92) return p.game.id;
    }
    return null;
  }

  /**
   * Lo que hay en la mira: una cartelera o chapa encendida, o el escenario LISTO
   * encendido, dentro de `range` metros.
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

  // ---------- Estado de la sala ----------

  /**
   * Votacion: en una sala 3D se vota entre todos los afiches, asi que "encendido" ya
   * no distingue nada. Lo que se lee de lejos son los VOTOS: la chapa de cada afiche
   * votado brilla, su foco se prende (el que va ganando, mas fuerte) y arriba sale el
   * contador. Hay `VOTE_LIGHTS` focos: van a los mas votados.
   */
  setVoting(
    options: PortalVote[] | null,
    counts: Record<string, number>,
    mine: string | null,
    voters: Record<string, string[]> = {},
  ): void {
    const ids = new Set(options?.map((o) => o.id) ?? []);
    const max = Math.max(0, ...Object.values(counts));
    for (const p of this.portals) {
      const active = ids.has(p.game.id);
      const n = active ? (counts[p.game.id] ?? 0) : 0;
      p.active = active;
      p.mine = active && mine === p.game.id;
      const accent = new THREE.Color(p.game.accent ?? "#ff3b30");
      const glow = !active ? 0 : p.mine ? 0.9 : n > 0 ? 0.55 : 0.18;
      p.plateMat.emissive.copy(accent).multiplyScalar(glow);
      p.frameMat.emissive.set(n > 0 || p.mine ? "#8e1f18" : "#000000").multiplyScalar(p.mine ? 1 : 0.6);
      // Solo se apagan los que no se pueden votar (en una sala comun, los no sorteados).
      p.posterMat.color.set(options && !active ? "#4a4a4a" : "#ffffff");
      p.bulbMat.color.copy(n > 0 || p.mine ? BULB_ON : BULB_OFF);
      // Contador solo en los votados: trece carteles de "0 votos" tapaban las carteleras.
      p.count.visible = active && (n > 0 || p.mine);
      if (p.count.visible) {
        // El que va ganando, en dorado; el propio, en rojo.
        const lead = n === max && n > 0;
        const text = voteLabel(n, voters[p.game.id] ?? []);
        const key = `${text}:${p.mine}:${lead}`;
        if (key !== p.countText) {
          p.countText = key;
          const bg = p.mine ? "rgba(120, 20, 14, 0.9)" : lead ? "rgba(110, 82, 12, 0.9)" : undefined;
          setSpriteLabel(p.count, plaqueTexture(text, bg ? { bg } : {}), COUNT_SCREEN_H);
        }
      }
    }

    // Focos: a los mas votados (y al propio), el lider mas fuerte.
    const lit = this.portals
      .filter((p) => p.active && ((counts[p.game.id] ?? 0) > 0 || p.mine))
      .sort((a, b) => (counts[b.game.id] ?? 0) - (counts[a.game.id] ?? 0) || Number(b.mine) - Number(a.mine))
      .slice(0, this.voteLights.length);
    this.voteLights.forEach((l, k) => {
      const p = lit[k];
      if (!p) {
        l.userData.base = 0;
        l.intensity = 0;
        return;
      }
      const n = counts[p.game.id] ?? 0;
      l.position.set(p.lx, FRAME_Y + FRAME_SIZE / 2 + 0.2, p.lz);
      l.userData.base = n === max && n > 0 ? 16 : p.mine ? 11 : 8;
      l.intensity = l.userData.base as number;
    });
  }

  setReady(active: boolean, mine: boolean): void {
    this.readyActive = active;
    this.readyMat.emissive.set(active ? (mine ? "#1f4a18" : "#3a2608") : "#000000");
    this.readyLight.intensity = active ? (mine ? 10 : 7) : 0;
    this.readyLight.color.set(mine ? "#b8ff9a" : "#ffcf7a");
  }

  /** Esta parado sobre el escenario (y encendido). */
  onReadyPad(standingOn: Box | null): boolean {
    return this.readyActive && standingOn === this.readyBox;
  }

  /** Pantalla del televisor: el afiche del juego de la ronda, o estatica con un titulo. */
  setFeatured(gameId: string | null, title: string): void {
    const key = gameId ?? `static:${title}`;
    if (key === this.tvKey) return;
    this.tvKey = key;
    this.tvTitle = title;
    this.tvImage = null;
    if (gameId) {
      const img = new Image();
      img.onload = () => {
        if (this.tvKey === key) this.tvImage = img;
      };
      img.src = coverUrl(gameId);
    }
  }

  /** 0 = televisor arriba, 1 = hundido bajo el piso (le deja lugar al marcador). */
  setTvSink(k: number): void {
    this.tv.position.y = -3 * k;
    this.tv.visible = k < 0.99;
    this.tvBox.active = k < 0.5;
  }

  /** Cuanto empeoro la noche (0..1): se queman lamparitas y las que quedan se ponen rojas. */
  setDread(d: number): void {
    this.dread = d;
  }

  private drawTv(): void {
    const ctx = this.tvCtx;
    if (this.tvImage) {
      ctx.drawImage(this.tvImage, 0, 0, TV_W, TV_H);
      // Lineas de barrido y un poco de nieve.
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      for (let y = 0; y < TV_H; y += 3) ctx.fillRect(0, y, TV_W, 1);
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? "#000" : "#ddd";
        ctx.fillRect(Math.floor(Math.random() * TV_W), Math.floor(Math.random() * TV_H), 2, 2);
      }
      if (Math.random() < 0.08) {
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(0, Math.floor(Math.random() * TV_H), TV_W, 5);
      }
    } else {
      // Estatica en bloques de 3 px (la pantalla es grande; pixel a pixel se ve gris).
      for (let y = 0; y < TV_H; y += 3) {
        for (let x = 0; x < TV_W; x += 3) {
          const v = Math.floor(Math.random() * 200);
          ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
          ctx.fillRect(x, y, 3, 3);
        }
      }
      if (this.tvTitle) {
        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.fillRect(0, TV_H / 2 - 22, TV_W, 44);
        ctx.fillStyle = "#e8e4d8";
        ctx.font = "34px 'VT323', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.tvTitle, TV_W / 2, TV_H / 2 + 2);
      }
    }
    this.tvTex.needsUpdate = true;
  }

  update(dt: number, t: number): void {
    this.time += dt;
    this.tvTimer -= dt;
    if (this.tvTimer <= 0) {
      this.tvTimer = 0.08;
      this.drawTv();
    }
    this.tvLight.intensity = 5 + Math.random() * 2;

    // Lamparitas: cada una se quema cuando la noche pasa su umbral; antes, titila de vez en cuando.
    const final = this.dread >= 0.99;
    for (const b of this.bulbs) {
      if (b.dieAt < this.dread * 0.75 && !final) {
        b.mat.color.copy(BULB_OFF);
        continue;
      }
      const flick = Math.sin(this.time * (7 + b.seed) + b.seed * 3) > 0.96 - this.dread * 0.2;
      b.mat.color.copy(final ? BULB_RED : flick ? BULB_OFF : b.dieAt < this.dread ? BULB_BAD : BULB_ON);
    }
    for (let i = 0; i < this.poleLights.length; i++) {
      const l = this.poleLights[i];
      const flick = Math.sin(this.time * (5 + i * 2.3)) > 0.97 ? 0.2 : 1;
      l.intensity = (final ? 16 : 16 * (1 - this.dread * 0.5)) * flick;
      l.color.copy(final ? BULB_RED : BULB_ON.clone().lerp(BULB_BAD, this.dread));
    }
    // Los focos de los candidatos titilan un poco.
    for (const l of this.voteLights) {
      const base = (l.userData.base as number | undefined) ?? 0;
      l.intensity = base * (0.88 + Math.random() * 0.14);
    }
    this.tower.update(dt, t);
  }
}
