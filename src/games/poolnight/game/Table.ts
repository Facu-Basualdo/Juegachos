import * as THREE from "three";
import {
  CORNER_GAP,
  CUSHION_W,
  FACING_K_CORNER,
  FACING_K_SIDE,
  HALF_L,
  HALF_W,
  POCKET_HOLES,
  RAIL_H,
  SIDE_GAP,
  type PocketHole,
} from "./constants";

/**
 * La mesa y el salon a oscuras (DESIGN.md: "Paño y Humo"). Una sola luz grande, la
 * lampara colgada sobre el centro, cae sobre el paño con un charco de penumbra; todo lo
 * demas son brasas lejanas: el neon del nombre, la copa roja y la ciudad azul por el
 * ventanal, siempre fuera de la mesa y mas oscuros de lo que la tentacion pide.
 *
 * Todo se dibuja por codigo (canvas y primitivas), sin assets.
 */

/** Ancho de la madera de la baranda (5 pulgadas, como una mesa de verdad). */
const RAIL_WOOD = 0.13;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Table {
  readonly group = new THREE.Group();
  /** La lampara solo se ve desde las camaras bajas: desde arriba taparia la mesa. */
  private readonly lamp = new THREE.Group();
  readonly spot: THREE.SpotLight;
  private readonly disposables: Array<{ dispose(): void }> = [];
  /** Los materiales que reflejan el entorno (madera y laton); el paño, el piso y las paredes no. */
  private readonly glossy: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene) {
    this.spot = this.buildLights(scene);
    const felt = this.buildCloth();
    this.buildRails(felt);
    this.buildBody();
    this.buildLamp();
    this.buildRoom();
    scene.add(this.group);
  }

  setLampVisible(v: boolean): void {
    this.lamp.visible = v;
  }

  /** Les da a la madera y al laton el entorno para reflejar (lo arma `Game.buildReflections`). */
  setReflections(env: THREE.Texture, intensity: number): void {
    for (const m of this.glossy) {
      m.envMap = env;
      m.envMapIntensity = intensity;
      m.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ materiales

  private mat<T extends THREE.Material>(m: T): T {
    this.disposables.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.disposables.push(g);
    return g;
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, shadow = false): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), material);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.castShadow = shadow;
    this.group.add(m);
    return m;
  }

  // ------------------------------------------------------------ luces

  private buildLights(scene: THREE.Scene): THREE.SpotLight {
    // El resplandor frio de la ciudad entra por arriba. Desde abajo, el verde del paño: en un bar la
    // parte de abajo de las bolas y la cara de los almohadones toman el color de la luz que rebota en
    // el paño (sin esto quedaban negras).
    scene.add(new THREE.HemisphereLight(0x2b4470, 0x174a38, 0.95));

    const spot = new THREE.SpotLight(0xffbe78, 38, 0, 0.9, 0.95, 2);
    spot.position.set(0, 1.55, 0);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.4;
    spot.shadow.camera.far = 4;
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.01;
    scene.add(spot, spot.target);
    return spot;
  }

  // ------------------------------------------------------------ la mesa: geometria comun

  /**
   * El borde que comparten el paño y la madera: el rectangulo de las caras traseras de los
   * almohadones (x = +-A, z = +-B) con un arco en cada tronera. Con `outer` el arco va por el lado
   * de afuera del agujero (es el corte de la madera); sin el, por el de adentro (es donde termina el
   * paño, que entra en la garganta hasta el borde del agujero). Entre los dos arcos queda el agujero.
   * Recorrido antihorario; devuelve tambien los arcos (para los herrajes de laton).
   */
  private pocketLoop(outer: boolean): { pts: THREE.Vector2[]; arcs: Array<{ h: PocketHole; a0: number; sweep: number }> } {
    const A = HALF_L + CUSHION_W;
    const B = HALF_W + CUSHION_W;
    const TWO = Math.PI * 2;
    const mod = (v: number): number => ((v % TWO) + TWO) % TWO;
    const pts: THREE.Vector2[] = [new THREE.Vector2(A, 0)];
    const arcs: Array<{ h: PocketHole; a0: number; sweep: number }> = [];
    const arc = (h: PocketHole, from: [number, number], to: [number, number], outward: number): void => {
      const mid = outer ? outward : outward + Math.PI;
      const a0 = Math.atan2(from[1] - h.z, from[0] - h.x);
      const a1 = Math.atan2(to[1] - h.z, to[0] - h.x);
      const dCcw = mod(a1 - a0);
      const sweep = mod(mid - a0) < dCcw ? dCcw : dCcw - TWO;
      arcs.push({ h, a0, sweep });
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (sweep * i) / steps;
        pts.push(new THREE.Vector2(h.x + h.r * Math.cos(a), h.z + h.r * Math.sin(a)));
      }
    };
    const hole = (x: number, z: number): PocketHole => POCKET_HOLES.find((p) => Math.sign(p.x) === Math.sign(x) && Math.sign(p.z) === Math.sign(z))!;
    // Donde cada agujero corta las rectas x = +-A y z = +-B (es el fondo de los cortes de los almohadones).
    const c = POCKET_HOLES[0];
    const hc = Math.sqrt(c.r * c.r - (A - c.x) ** 2);
    const s = POCKET_HOLES[4];
    const xs = Math.sqrt(s.r * s.r - (B - s.z) ** 2);
    const cz = c.z - hc; // z del corte sobre x = A (esquinas)
    const cx = c.x - hc; // x del corte sobre z = B (esquinas)
    arc(hole(1, 1), [A, cz], [cx, B], Math.atan2(1, 1));
    arc(hole(0, 1), [xs, B], [-xs, B], Math.PI / 2);
    arc(hole(-1, 1), [-cx, B], [-A, cz], Math.atan2(1, -1));
    arc(hole(-1, -1), [-A, -cz], [-cx, -B], Math.atan2(-1, -1));
    arc(hole(0, -1), [-xs, -B], [xs, -B], -Math.PI / 2);
    arc(hole(1, -1), [cx, -B], [A, -cz], Math.atan2(-1, 1));
    return { pts, arcs };
  }

  // ------------------------------------------------------------ paño

  private buildCloth(): THREE.MeshLambertMaterial {
    const noise = canvasTexture(256, 256, (g) => {
      g.fillStyle = "#cfd8d6";
      g.fillRect(0, 0, 256, 256);
      const img = g.getImageData(0, 0, 256, 256);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 44;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
    });
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    // Las UV del paño y de los almohadones estan en metros: una baldosa de ruido cada 25 cm.
    noise.repeat.set(4, 4);
    this.disposables.push(noise);
    // El mismo paño forra los almohadones (como en una mesa de verdad): un solo material.
    // Lambert (difuso puro) y no PBR: el paño es mate (casi sin brillo especular), asi que se ve igual, y
    // es la superficie que llena la pantalla: con PBR era la mayor parte del costo de cada cuadro.
    const felt = this.mat(new THREE.MeshLambertMaterial({ color: 0x0b5e60, map: noise, side: THREE.DoubleSide }));

    // El paño llega hasta las caras traseras de los almohadones y, en cada tronera, entra en la
    // garganta hasta el borde del agujero (el "estante" de la boca). La forma se dibuja en (x, -z)
    // y se acuesta: al rotar -90 grados en x, la -z vuelve a ser z.
    const shape = new THREE.Shape(this.pocketLoop(false).pts.map((p) => new THREE.Vector2(p.x, -p.y)));
    const cloth = new THREE.Mesh(this.geo(new THREE.ShapeGeometry(shape, 8)), felt);
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.y = 0.0045;
    cloth.receiveShadow = true;
    this.group.add(cloth);
    return felt;
  }

  // ------------------------------------------------------------ almohadones, baranda, troneras, diamantes

  /**
   * Un almohadon recto: el perfil de la seccion (distancia hacia atras de la nariz, altura) barrido
   * a lo largo, con cada punta cortada en el angulo de su tronera. `start` es la punta de la nariz
   * donde empieza, `along` la direccion en que corre y `back` hacia la madera.
   */
  private cushion(felt: THREE.Material, start: [number, number], along: [number, number], back: [number, number], len: number, kStart: number, kEnd: number): void {
    // Perfil reglamentario aproximado: la nariz a 36 mm (63.5% de la bola), la cara de abajo hundida
    // hacia atras y la parte de arriba casi al ras de la madera.
    const profile: Array<[number, number]> = [
      [0.006, 0],
      [0, 0.036],
      [0.008, 0.044],
      [CUSHION_W, 0.046],
      [CUSHION_W, 0],
    ];
    const pos: number[] = [];
    const uv: number[] = [];
    const v = (u: number, d: number, y: number): void => {
      pos.push(start[0] + along[0] * u + back[0] * d, y, start[1] + along[1] * u + back[1] * d);
      uv.push(u * 4, (d + y) * 4);
    };
    const uL = (d: number): number => -kStart * d;
    const uR = (d: number): number => len + kEnd * d;
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const [di, yi] = profile[i];
      const [dj, yj] = profile[(i + 1) % n];
      v(uL(di), di, yi);
      v(uR(di), di, yi);
      v(uR(dj), dj, yj);
      v(uL(di), di, yi);
      v(uR(dj), dj, yj);
      v(uL(dj), dj, yj);
    }
    // Las dos tapas (los cortes en angulo), en abanico: el perfil es convexo.
    for (let i = 1; i < n - 1; i++) {
      for (const end of [uL, uR]) {
        const p0 = profile[0];
        const p1 = profile[i];
        const p2 = profile[i + 1];
        v(end(p0[0]), p0[0], p0[1]);
        v(end(p1[0]), p1[0], p1[1]);
        v(end(p2[0]), p2[0], p2[1]);
      }
    }
    const geo = this.geo(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, felt);
    // NO proyecta sombra: con el material de doble cara el mapa de sombras se la come a si misma y el
    // almohadon sale negro (se vio asi en la esquina). Su sombra sobre el paño es casi nula igual.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildRails(felt: THREE.Material): void {
    // Laca comun con reflejo, sin la segunda capa de barniz (clearcoat): la baranda ocupa mucha
    // pantalla en la camara baja y el barniz duplica el costo de cada pixel (ver "Rendimiento").
    const wood = this.mat(new THREE.MeshStandardMaterial({ color: 0x3a2113, roughness: 0.3, metalness: 0 }));
    const brass = this.mat(new THREE.MeshStandardMaterial({ color: 0x9a7a35, roughness: 0.4, metalness: 0.85, side: THREE.DoubleSide }));
    this.glossy.push(wood, brass);
    const leather = this.mat(new THREE.MeshLambertMaterial({ color: 0x0a0807, side: THREE.DoubleSide }));
    const pitch = this.mat(new THREE.MeshBasicMaterial({ color: 0x040302 }));

    // ---- los seis almohadones, forrados con el paño, con los cortes reglamentarios en cada boca ----
    const longLen = HALF_L - CORNER_GAP - SIDE_GAP;
    const shortLen = 2 * (HALF_W - CORNER_GAP);
    for (const sz of [1, -1]) {
      this.cushion(felt, [SIDE_GAP, sz * HALF_W], [1, 0], [0, sz], longLen, FACING_K_SIDE, FACING_K_CORNER);
      this.cushion(felt, [-(HALF_L - CORNER_GAP), sz * HALF_W], [1, 0], [0, sz], longLen, FACING_K_CORNER, FACING_K_SIDE);
    }
    for (const sx of [1, -1]) {
      this.cushion(felt, [sx * HALF_L, -(HALF_W - CORNER_GAP)], [0, 1], [sx, 0], shortLen, FACING_K_CORNER, FACING_K_CORNER);
    }

    // ---- la baranda: una pieza de madera con el canto redondeado y los agujeros cortados ----
    const XO = HALF_L + CUSHION_W + RAIL_WOOD;
    const ZO = HALF_W + CUSHION_W + RAIL_WOOD;
    const loop = this.pocketLoop(true);
    const outline = new THREE.Shape([new THREE.Vector2(-XO, -ZO), new THREE.Vector2(XO, -ZO), new THREE.Vector2(XO, ZO), new THREE.Vector2(-XO, ZO)]);
    outline.holes.push(new THREE.Path(loop.pts));
    const bevel = 0.006;
    const frameGeo = this.geo(
      new THREE.ExtrudeGeometry(outline, {
        depth: RAIL_H - 2 * bevel,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        // El canto redondeado no agranda la pieza: el contorno maximo es el de la forma.
        bevelOffset: -bevel,
        bevelSegments: 3,
        curveSegments: 16,
      }),
    );
    // La forma esta en (x, z) y se extruye hacia arriba (la z del dibujo se invierte; es simetrica).
    frameGeo.rotateX(-Math.PI / 2);
    frameGeo.translate(0, bevel, 0);
    const frame = new THREE.Mesh(frameGeo, wood);
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.group.add(frame);

    // ---- cada tronera: una bolsa de cuero que baja desde el paño, con el fondo negro ----
    const depth = 0.055;
    for (const h of POCKET_HOLES) {
      const tube = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(h.r, h.r * 0.92, depth, 36, 1, true)), leather);
      tube.position.set(h.x, 0.0045 - depth / 2, h.z);
      this.group.add(tube);
      const bottom = new THREE.Mesh(this.geo(new THREE.CircleGeometry(h.r * 0.92, 36)), pitch);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.set(h.x, 0.0045 - depth + 0.001, h.z);
      this.group.add(bottom);
    }
    // El corte de la madera adentro del agujero tambien va forrado (si no, se ve un balde de madera):
    // un tramo de cilindro desde el paño hasta el tope, solo sobre el arco que corta la madera. El
    // theta de CylinderGeometry se mide desde +z (x = sin, z = cos): theta = pi/2 - angulo.
    for (const { h, a0, sweep } of loop.arcs) {
      const hi = sweep > 0 ? a0 + sweep : a0;
      const wall = new THREE.Mesh(
        this.geo(new THREE.CylinderGeometry(h.r - 0.0008, h.r - 0.0008, RAIL_H - 0.0045, 36, 1, true, Math.PI / 2 - hi, Math.abs(sweep))),
        leather,
      );
      wall.position.set(h.x, 0.0045 + (RAIL_H - 0.0045) / 2, h.z);
      this.group.add(wall);
    }
    // El herraje de laton bordea cada agujero sobre la madera (solo el tramo de afuera).
    for (const { h, a0, sweep } of loop.arcs) {
      const ring = new THREE.Mesh(
        this.geo(new THREE.RingGeometry(h.r, h.r + 0.011, 36, 1, -(sweep > 0 ? a0 + sweep : a0), Math.abs(sweep))),
        brass,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(h.x, RAIL_H + 0.0012, h.z);
      this.group.add(ring);
    }

    // Diamantes: incrustaciones al ras de la madera, cada octavo del largo (3 por tramo de baranda).
    const dia = this.geo(new THREE.CircleGeometry(0.0075, 4));
    const place = (x: number, z: number): void => {
      const d = new THREE.Mesh(dia, brass);
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, RAIL_H + 0.0012, z);
      this.group.add(d);
    };
    const railMid = CUSHION_W + RAIL_WOOD / 2;
    for (const sz of [1, -1]) {
      for (const k of [-3, -2, -1, 1, 2, 3]) place((k * HALF_L) / 4, sz * (HALF_W + railMid));
    }
    for (const sx of [1, -1]) {
      for (const k of [-1, 0, 1]) place(sx * (HALF_L + railMid), (k * HALF_W) / 2);
    }
  }

  // ------------------------------------------------------------ el mueble

  private buildBody(): void {
    const wood = this.mat(new THREE.MeshLambertMaterial({ color: 0x2a170c }));
    const XO = HALF_L + CUSHION_W + RAIL_WOOD;
    const ZO = HALF_W + CUSHION_W + RAIL_WOOD;
    // El mueble PROYECTA sombra: si no, la luz de la lampara lo atraviesa y las bolas dibujan su
    // sombra en el piso de abajo (se vio como cinco circulos negros bajo la mesa).
    // La pizarra, debajo del paño y sin meterse en las bolsas de las troneras.
    this.box(2 * (HALF_L - 0.03), 0.05, 2 * (HALF_W - 0.03), 0, -0.03, 0, wood, true);
    // El faldon: un marco que baja desde la baranda, por fuera de las bolsas de las troneras.
    const apron = new THREE.Shape([new THREE.Vector2(-XO, -ZO), new THREE.Vector2(XO, -ZO), new THREE.Vector2(XO, ZO), new THREE.Vector2(-XO, ZO)]);
    const hx = HALF_L + 0.112;
    const hz = HALF_W + 0.163;
    apron.holes.push(new THREE.Path([new THREE.Vector2(-hx, -hz), new THREE.Vector2(-hx, hz), new THREE.Vector2(hx, hz), new THREE.Vector2(hx, -hz)]));
    const apronGeo = this.geo(new THREE.ExtrudeGeometry(apron, { depth: 0.3, bevelEnabled: false }));
    apronGeo.rotateX(-Math.PI / 2);
    apronGeo.translate(0, -0.3, 0);
    const apronMesh = new THREE.Mesh(apronGeo, wood);
    apronMesh.castShadow = true;
    apronMesh.receiveShadow = true;
    this.group.add(apronMesh);
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) this.box(0.18, 0.8, 0.18, sx * (XO - 0.13), -0.7, sz * (ZO - 0.13), wood, true);
    }
  }

  // ------------------------------------------------------------ la lampara

  private buildLamp(): void {
    const shade = this.mat(
      new THREE.MeshStandardMaterial({ color: 0x241f17, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide }),
    );
    const bulb = this.mat(new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }));
    const cone = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.62, 0.26, 4, 1, true)), shade);
    cone.rotation.y = Math.PI / 4;
    cone.scale.set(2.1, 1, 0.78);
    cone.position.y = 1.62;
    const glow = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.7, 0.02, 0.5)), bulb);
    glow.position.y = 1.5;
    const chainGeo = this.geo(new THREE.CylinderGeometry(0.006, 0.006, 2, 6));
    const chainMat = this.mat(new THREE.MeshLambertMaterial({ color: 0x15110c }));
    for (const x of [-0.5, 0.5]) {
      const chain = new THREE.Mesh(chainGeo, chainMat);
      chain.position.set(x, 2.7, 0);
      this.lamp.add(chain);
    }
    this.lamp.add(cone, glow);
    this.group.add(this.lamp);
  }

  // ------------------------------------------------------------ el salon

  private buildRoom(): void {
    // Piso de tablones, casi negro.
    const floorTex = canvasTexture(512, 512, (g) => {
      g.fillStyle = "#1a110b";
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 16; i++) {
        g.fillStyle = `rgba(${26 + Math.random() * 14}, ${16 + Math.random() * 8}, 10, 1)`;
        g.fillRect(0, i * 32, 512, 30);
      }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(6, 6);
    this.disposables.push(floorTex);
    const floor = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(40, 40)),
      this.mat(new THREE.MeshLambertMaterial({ map: floorTex })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.1;
    floor.receiveShadow = true;
    this.group.add(floor);

    // La pared del fondo con el ventanal: una ciudad azul de noche, siempre desenfocada.
    const wall = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(26, 9)),
      this.mat(new THREE.MeshLambertMaterial({ color: 0x120b09 })),
    );
    wall.position.set(0, 3.4, -6);
    this.group.add(wall);

    const cityTex = canvasTexture(512, 192, (g) => {
      const sky = g.createLinearGradient(0, 0, 0, 192);
      sky.addColorStop(0, "#070c22");
      sky.addColorStop(0.7, "#14204a");
      sky.addColorStop(1, "#2a2a55");
      g.fillStyle = sky;
      g.fillRect(0, 0, 512, 192);
      g.filter = "blur(1.2px)";
      for (let x = 0; x < 512; x += 14) {
        const h = 40 + Math.random() * 120;
        g.fillStyle = "#0a0f26";
        g.fillRect(x, 192 - h, 13, h);
        for (let wy = 192 - h + 6; wy < 186; wy += 9) {
          for (let wx = x + 2; wx < x + 11; wx += 4) {
            if (Math.random() < 0.42) {
              g.fillStyle = Math.random() < 0.8 ? "#ffcf6a" : "#ff9d5c";
              g.fillRect(wx, wy, 2, 3);
            }
          }
        }
      }
    });
    const city = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(8.5, 3.2)),
      this.mat(new THREE.MeshBasicMaterial({ map: cityTex, toneMapped: false, color: 0x8a90b8 })),
    );
    city.position.set(2.6, 3, -5.95);
    this.group.add(city);
    const frame = this.mat(new THREE.MeshLambertMaterial({ color: 0x0d0907 }));
    for (const x of [-1.6, 1, 3.6, 6.2]) this.box(0.14, 3.4, 0.1, x, 3, -5.9, frame);
    this.box(8.9, 0.14, 0.1, 2.6, 4.7, -5.9, frame);
    this.box(8.9, 0.14, 0.1, 2.6, 1.3, -5.9, frame);

    // El cartel de neon con el nombre: cursiva ambar con nucleo casi blanco y halo naranja.
    const signTex = canvasTexture(1024, 256, (g) => {
      g.clearRect(0, 0, 1024, 256);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = 'italic 700 170px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive';
      const layers: Array<[string, number, number]> = [
        ["#ff7a1f", 60, 1],
        ["#ff9d2e", 30, 1],
        ["#ffb54a", 12, 1],
        ["#fff1cf", 0, 1],
      ];
      for (const [color, blur] of layers) {
        g.shadowColor = color;
        g.shadowBlur = blur;
        g.fillStyle = color;
        g.fillText("Poolnight", 512, 128);
      }
    });
    const sign = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(4.6, 1.15)),
      this.mat(new THREE.MeshBasicMaterial({ map: signTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
    );
    sign.position.set(-2.4, 4.3, -5.8);
    this.group.add(sign);

    // La copa de martini roja, lejos y chica.
    const martiniTex = canvasTexture(128, 160, (g) => {
      g.clearRect(0, 0, 128, 160);
      g.strokeStyle = "#ff4d6a";
      g.shadowColor = "#ff4d6a";
      g.shadowBlur = 14;
      g.lineWidth = 5;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(14, 24);
      g.lineTo(114, 24);
      g.lineTo(64, 84);
      g.closePath();
      g.moveTo(64, 84);
      g.lineTo(64, 140);
      g.moveTo(34, 142);
      g.lineTo(94, 142);
      g.stroke();
      g.beginPath();
      g.arc(78, 40, 7, 0, Math.PI * 2);
      g.stroke();
    });
    const martini = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(0.8, 1)),
      this.mat(new THREE.MeshBasicMaterial({ map: martiniTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
    );
    martini.position.set(-5.4, 2.7, -5.85);
    this.group.add(martini);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
