import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Arriba de la plataforma: donde apoya el cohete. */
export const PAD_TOP = 0.3;

const PINK = 0xff3d8b;
const TEAL = 0x2ee6d6;
const BULB = 0xffd36a;

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

/** Ventanas de edificio: grilla con algunas encendidas (calidas), pocas turquesa. */
function windowsTexture(rand: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 128, 256);
  for (let y = 4; y < 256; y += 10) {
    for (let x = 4; x < 128; x += 9) {
      const r = rand();
      if (r < 0.42) continue;
      g.fillStyle = r < 0.47 ? "#7ff3e8" : r < 0.6 ? "#ffcf7a" : r < 0.8 ? "#ffb35c" : "#a06a3a";
      g.globalAlpha = 0.55 + rand() * 0.45;
      g.fillRect(x, y, 5, 6);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Letrero del casino: "EL COHETE" en neon rosa con alma blanca y "CASINO" turquesa. */
function signTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 340;
  const g = c.getContext("2d")!;
  g.fillStyle = "#12061c";
  g.fillRect(0, 0, c.width, c.height);
  // Rayos de estrella atomica a los costados.
  const star = (x: number, y: number, r: number, color: string) => {
    g.save();
    g.translate(x, y);
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath();
      g.moveTo(-r, 0);
      g.lineTo(r, 0);
      g.stroke();
    }
    g.restore();
  };
  star(95, 170, 58, "#ffd36a");
  star(929, 170, 58, "#ffd36a");
  const neon = (text: string, x: number, y: number, size: number, color: string) => {
    g.font = `${size}px Monoton, Righteous, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    // Monoton ya es un tubo de neon dibujado: va relleno, con dos halos y el alma blanca.
    for (const [blur, col] of [
      [46, color],
      [18, color],
      [4, "#fff4f8"],
    ] as const) {
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.fillStyle = col;
      g.fillText(text, x, y);
    }
  };
  neon("CASINO", 512, 66, 54, "#2ee6d6");
  neon("EL COHETE", 512, 196, 150, "#ff3d8b");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Plataforma: anillo de franjas amarillas y negras alrededor de una rejilla. */
function padTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3a44";
  g.fillRect(0, 0, 512, 512);
  g.save();
  g.translate(256, 256);
  for (let i = 0; i < 36; i++) {
    g.fillStyle = i % 2 ? "#141418" : "#f2c230";
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 250, (i / 36) * Math.PI * 2, ((i + 1) / 36) * Math.PI * 2);
    g.closePath();
    g.fill();
  }
  g.fillStyle = "#4a4a56";
  g.beginPath();
  g.arc(0, 0, 200, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#2a2a32";
  g.lineWidth = 4;
  for (let x = -200; x <= 200; x += 24) {
    g.beginPath();
    g.moveTo(x, -200);
    g.lineTo(x, 200);
    g.stroke();
    g.beginPath();
    g.moveTo(-200, x);
    g.lineTo(200, x);
    g.stroke();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Calles vistas desde arriba: grilla de avenidas que brillan, para cuando el cohete sube. */
function streetsTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#050308";
  g.fillRect(0, 0, 512, 512);
  const rand = rng(77);
  // Alfombra de luces: puntitos por todos lados y avenidas tenues e irregulares (una
  // grilla pareja y fuerte se leia como fondo synthwave, no como ciudad).
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = rand() < 0.12 ? "#ff6aa8" : rand() < 0.22 ? "#6ff0e6" : "#ffb35c";
    g.globalAlpha = 0.2 + rand() * 0.6;
    g.fillRect(rand() * 512, rand() * 512, 1.5, 1.5);
  }
  g.globalAlpha = 1;
  for (let k = 0; k < 512; k += 64 + Math.floor(rand() * 40)) {
    g.fillStyle = "rgba(255, 180, 100, 0.32)";
    g.fillRect(k, 0, 2, 512);
  }
  for (let k = 0; k < 512; k += 48 + Math.floor(rand() * 60)) {
    g.fillStyle = "rgba(255, 180, 100, 0.26)";
    g.fillRect(0, k, 512, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.anisotropy = 4;
  return t;
}

/** Cartel del costado del dirigible: "EL COHETE" en neon con una fila de bombitas. */
function blimpSignTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#14081e";
  g.beginPath();
  g.roundRect(4, 4, 504, 120, 26);
  g.fill();
  g.font = "64px Monoton, Righteous, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [blur, col] of [
    [26, "#ff3d8b"],
    [8, "#ff3d8b"],
    [2, "#fff4f8"],
  ] as const) {
    g.shadowColor = "#ff3d8b";
    g.shadowBlur = blur;
    g.fillStyle = col;
    g.fillText("EL COHETE", 256, 66);
  }
  g.shadowBlur = 8;
  g.shadowColor = "#ffd36a";
  g.fillStyle = "#fff1c9";
  for (let x = 24; x < 500; x += 22) {
    g.beginPath();
    g.arc(x, 14, 3.4, 0, Math.PI * 2);
    g.arc(x, 114, 3.4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const BEAM_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uAlpha;
  void main() {
    // Mas fuerte en la base, se desvanece hacia arriba y en los bordes del cono.
    float along = 1.0 - vUv.y;
    float edge = sin(vUv.x * 3.14159 * 2.0) * 0.5 + 0.5;
    gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), uAlpha * pow(along, 1.6) * (0.35 + 0.65 * edge));
  }`;

/**
 * El tejado del casino con la plataforma, la torre de lanzamiento, el letrero con
 * bombitas que corren, la avenida de edificios con neon y los reflectores.
 */
export class City {
  readonly group = new THREE.Group();
  private readonly bulbs: THREE.InstancedMesh;
  private readonly bulbCount: number;
  private readonly bulbColor = new THREE.Color();
  private readonly neons: { mesh: THREE.Mesh; base: THREE.Color; flicker: number }[] = [];
  private readonly beams: { mesh: THREE.Mesh; phase: number; speed: number }[] = [];
  private readonly arm: THREE.Group;
  /** Dirigible con letrero que cruza el cielo detras del casino. */
  private readonly blimp = new THREE.Group();
  private readonly blimpLight: THREE.Mesh;
  private readonly beacon: THREE.Mesh;
  private armOpen = 0;

  constructor() {
    const rand = rng(1957);

    // ---- Casino: el edificio cuyo techo es la plataforma ----
    const facade = new THREE.MeshLambertMaterial({ color: "#1a1222", emissive: "#ffffff", emissiveMap: windowsTexture(rand), emissiveIntensity: 0.9 });
    (facade.emissiveMap as THREE.Texture).repeat.set(3, 6);
    const casino = new THREE.Mesh(new THREE.BoxGeometry(22, 60, 30), facade);
    // La tapa queda 0.2 por debajo del techo: a la misma altura peleaban (z-fighting) y
    // las ventanas se colaban en el techo como baldosas de colores.
    casino.position.set(0, -30.2, 2);
    this.group.add(casino);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(22.2, 0.3, 30.2), new THREE.MeshStandardMaterial({ color: "#221c28", roughness: 0.92 }));
    roof.position.set(0, -0.15, 2);
    this.group.add(roof);
    // Parapeto con filete de neon turquesa.
    const neonMat = (hex: number, k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });
    for (const [w, d, x, z] of [
      [22.2, 0.08, 0, 17.1],
      [22.2, 0.08, 0, -13.1],
      [0.08, 30.2, 11.1, 2],
      [0.08, 30.2, -11.1, 2],
    ]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), neonMat(TEAL, 1.2));
      strip.position.set(x, 0.05, z);
      this.group.add(strip);
    }

    // ---- Plataforma ----
    const padMats = [
      new THREE.MeshStandardMaterial({ color: "#2c2c34", metalness: 0.6, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: padTexture(), metalness: 0.3, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: "#1c1c22" }),
    ];
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, PAD_TOP, 48), padMats);
    pad.position.y = PAD_TOP / 2;
    this.group.add(pad);

    // ---- Torre de lanzamiento: reticulado rojo con brazo que se retira ----
    const red = new THREE.MeshStandardMaterial({ color: "#b8261f", metalness: 0.5, roughness: 0.45 });
    const tower = new THREE.Group();
    const H = 4.6;
    const post = new THREE.CylinderGeometry(0.045, 0.045, H, 6);
    for (const [x, z] of [
      [-0.35, -0.35],
      [0.35, -0.35],
      [-0.35, 0.35],
      [0.35, 0.35],
    ]) {
      const p = new THREE.Mesh(post, red);
      p.position.set(x, H / 2, z);
      tower.add(p);
    }
    const brace = new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5);
    for (let y = 0.3; y < H; y += 0.55) {
      for (let s = 0; s < 4; s++) {
        const b = new THREE.Mesh(brace, red);
        const a = (s * Math.PI) / 2;
        b.position.set(Math.sin(a) * 0.35, y + 0.27, Math.cos(a) * 0.35);
        b.rotation.y = a;
        b.rotation.z = 0.86 * (s % 2 ? 1 : -1);
        tower.add(b);
      }
    }
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), neonMat(0xff2a1a, 3));
    this.beacon.position.y = H + 0.1;
    tower.add(this.beacon);
    this.arm = new THREE.Group();
    const armBar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.1), red);
    armBar.position.x = 0.62;
    this.arm.add(armBar);
    this.arm.position.set(0.35, 2.7, 0);
    tower.add(this.arm);
    tower.position.set(-1.95, PAD_TOP, -0.2);
    this.group.add(tower);

    // ---- Letrero con bombitas ----
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 3.32),
      new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false, color: new THREE.Color(0.95, 0.95, 0.95) }),
    );
    // El cartel entero (marco, patas, bombitas) va en un grupo que mira hacia la camara
    // de apuestas, corrido a la derecha para que el cohete no tape el titulo.
    const board = new THREE.Group();
    board.position.set(2.2, 0, -4.2);
    board.rotation.y = -0.42;
    this.group.add(board);
    sign.position.set(0, 4.1, 0.15);
    board.add(sign);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(10.5, 3.8, 0.25), new THREE.MeshStandardMaterial({ color: "#2a1830", metalness: 0.5, roughness: 0.5 }));
    frame.position.set(0, 4.1, 0);
    board.add(frame);
    for (const x of [-3.8, 3.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.3, 0.18), frame.material);
      leg.position.set(x, 1.1, 0);
      board.add(leg);
    }
    // Bombitas alrededor del cartel (perseguidoras).
    const bulbPos: THREE.Vector3[] = [];
    const bw = 10.2;
    const bh = 3.55;
    const step = 0.36;
    for (let x = -bw / 2; x <= bw / 2; x += step) bulbPos.push(new THREE.Vector3(x, bh / 2, 0));
    for (let y = bh / 2 - step; y >= -bh / 2; y -= step) bulbPos.push(new THREE.Vector3(bw / 2, y, 0));
    for (let x = bw / 2 - step; x >= -bw / 2; x -= step) bulbPos.push(new THREE.Vector3(x, -bh / 2, 0));
    for (let y = -bh / 2 + step; y < bh / 2; y += step) bulbPos.push(new THREE.Vector3(-bw / 2, y, 0));
    this.bulbCount = bulbPos.length;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), this.bulbCount);
    const m4 = new THREE.Matrix4();
    bulbPos.forEach((p, i) => {
      m4.makeTranslation(p.x, p.y + 4.1, 0.2);
      this.bulbs.setMatrixAt(i, m4);
      this.bulbs.setColorAt(i, new THREE.Color(BULB));
    });
    board.add(this.bulbs);

    // ---- La avenida: edificios con ventanas, todos en una sola malla ----
    const geos: THREE.BufferGeometry[] = [];
    const signs: { x: number; y: number; z: number; w: number; h: number; ry: number }[] = [];
    for (let i = 0; i < 170; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = 20 + Math.pow(rand(), 0.7) * 150;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist - 10;
      // Que no tape el tejado visto desde la camara de apuestas (al frente, +z, +x).
      if (z > -16 && Math.abs(x) < 34 && dist < 50) continue;
      const w = 4 + rand() * 9;
      const d = 4 + rand() * 9;
      const top = -26 + rand() * 30 + (dist < 50 ? 4 : 0);
      const h = top + 60;
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      // Escala las UV al tamano real del edificio (que no se estiren las ventanas).
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 4), uv.getY(k) * (h / 8));
      g.translate(x, top - h / 2, z);
      geos.push(g);
      if (rand() < 0.3) signs.push({ x, y: top - 3 - rand() * 6, z, w, h: 2 + rand() * 5, ry: Math.atan2(-x, -z) });
    }
    const towersMat = new THREE.MeshLambertMaterial({ color: "#100a18", emissive: "#ffffff", emissiveMap: windowsTexture(rng(5)), emissiveIntensity: 0.75 });
    this.group.add(new THREE.Mesh(mergeGeometries(geos), towersMat));

    // Letreros de neon en los edificios, mirando al casino.
    const neonColors = [PINK, TEAL, BULB];
    for (const s of signs) {
      const hex = neonColors[Math.floor(rand() * 3)];
      const vertical = rand() < 0.5;
      const geo = vertical ? new THREE.PlaneGeometry(0.9, s.h) : new THREE.PlaneGeometry(Math.min(s.w * 0.8, 6), 0.9);
      const mat = neonMat(hex, 2);
      const mesh = new THREE.Mesh(geo, mat);
      const off = Math.min(s.w, 8) / 2 + 0.6;
      mesh.position.set(s.x + Math.sin(s.ry) * off, s.y, s.z + Math.cos(s.ry) * off);
      mesh.rotation.y = s.ry;
      this.group.add(mesh);
      this.neons.push({ mesh, base: mat.color.clone(), flicker: rand() < 0.2 ? 1 : 0 });
    }

    // ---- Piso de la ciudad (avenidas encendidas, se ven desde la altura) ----
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ map: streetsTexture(), color: new THREE.Color(0.75, 0.75, 0.75) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -60;
    this.group.add(ground);

    this.blimpLight = this.buildBlimp();

    // ---- Reflectores que barren el cielo ----
    for (const [x, z, ph] of [
      [-34, -30, 0],
      [40, -46, 2.1],
      [8, -70, 4.2],
      [-60, -80, 1.3],
    ]) {
      const geo = new THREE.CylinderGeometry(0.4, 6, 160, 24, 1, true);
      geo.translate(0, 80, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0.05 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(geo, mat);
      beam.position.set(x, -20, z);
      this.group.add(beam);
      this.beams.push({ mesh: beam, phase: ph, speed: 0.18 + rand() * 0.12 });
    }
  }

  /** Dirigible plateado, con gondola, aletas y el letrero de neon a los costados. */
  private buildBlimp(): THREE.Mesh {
    const silver = new THREE.MeshLambertMaterial({ color: "#9a96a8", emissive: "#1a1424" });
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), silver);
    hull.scale.set(7, 2.1, 2.1);
    this.blimp.add(hull);
    for (const [y, z, rx] of [
      [1.4, 0, 0],
      [-1.4, 0, 0],
      [0, 1.4, Math.PI / 2],
      [0, -1.4, Math.PI / 2],
    ]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 0.1), silver);
      fin.position.set(-6.2, y, z);
      fin.rotation.x = rx;
      this.blimp.add(fin);
    }
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.8), new THREE.MeshLambertMaterial({ color: "#2a1830", emissive: "#3a2a10" }));
    gondola.position.y = -2.2;
    this.blimp.add(gondola);
    const signMat = new THREE.MeshBasicMaterial({ map: blimpSignTexture(), toneMapped: false, transparent: true });
    for (const side of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), signMat);
      sign.position.set(0, 0, side * 2.12);
      if (side < 0) sign.rotation.y = Math.PI;
      this.blimp.add(sign);
    }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }));
    light.position.set(0, -2.6, 0);
    this.blimp.add(light);
    this.blimp.position.set(-60, 15, -40);
    this.group.add(this.blimp);
    return light;
  }

  /** Brazo de la torre: 0 pegado al cohete, 1 retirado (al despegar). */
  setArm(open: number): void {
    this.armOpen = open;
  }

  update(time: number, dt: number): void {
    // Bombitas: una de cada cuatro apagada, corriendo en ronda.
    const phase = Math.floor(time * 9);
    for (let i = 0; i < this.bulbCount; i++) {
      const on = (i + phase) % 4 !== 0;
      this.bulbColor.setHex(BULB).multiplyScalar(on ? 2.4 : 0.25);
      this.bulbs.setColorAt(i, this.bulbColor);
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    // Neon que parpadea (los viejos).
    for (const n of this.neons) {
      if (!n.flicker) continue;
      const k = Math.sin(time * 23 + n.base.r * 50) > 0.92 || Math.sin(time * 1.3 + n.base.g * 9) > 0.97 ? 0.15 : 1;
      (n.mesh.material as THREE.MeshBasicMaterial).color.copy(n.base).multiplyScalar(k);
    }
    for (const b of this.beams) {
      b.mesh.rotation.z = Math.sin(time * b.speed + b.phase) * 0.45;
      b.mesh.rotation.x = Math.cos(time * b.speed * 0.8 + b.phase) * 0.25 - 0.1;
    }
    this.arm.rotation.y += (-this.armOpen * 1.6 - this.arm.rotation.y) * Math.min(1, dt * 4);
    // El dirigible cruza de izquierda a derecha, despacio, meciendose.
    this.blimp.position.x = -70 + ((time * 1.6) % 140);
    this.blimp.position.y = 15 + Math.sin(time * 0.4) * 0.6;
    this.blimp.rotation.z = Math.sin(time * 0.5) * 0.03;
    (this.blimpLight.material as THREE.MeshBasicMaterial).color.setHex(0xff2a1a).multiplyScalar(Math.sin(time * 3) > 0.6 ? 3 : 0.2);
    (this.beacon.material as THREE.MeshBasicMaterial).color.setHex(0xff2a1a).multiplyScalar(Math.sin(time * 4) > 0 ? 3 : 0.3);
  }
}
