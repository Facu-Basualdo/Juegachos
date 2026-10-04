import * as THREE from "three";

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

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const DOME_FRAG = /* glsl */ `
  uniform float uSpace;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    // Noche de ciudad: resplandor rosado en el horizonte, indigo arriba.
    vec3 zenith = vec3(0.012, 0.011, 0.05);
    vec3 horizon = vec3(0.09, 0.035, 0.16);
    vec3 glow = vec3(1.0, 0.35, 0.54);
    float hz = 1.0 - smoothstep(-0.05, 0.45, h);
    vec3 col = mix(zenith, horizon, hz);
    col += glow * pow(max(0.0, 1.0 - abs(h + 0.02) * 6.0), 3.0) * 0.2 * (1.0 - uSpace * 0.7);
    // Espacio: negro azulado, el resplandor queda abajo como una banda.
    vec3 space = mix(vec3(0.006, 0.008, 0.03), vec3(0.09, 0.04, 0.16), pow(hz, 3.0));
    col = mix(col, space, uSpace);
    gl_FragColor = vec4(col, 1.0);
  }`;

const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute float phase;
  uniform float uTime;
  uniform float uBright;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + phase * 3.0) + phase * 40.0);
    vA = uBright * tw;
    gl_PointSize = size * (0.8 + 0.4 * tw);
    gl_Position = projectionMatrix * mv;
  }`;

const STAR_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float core = 1.0 - smoothstep(0.0, 0.5, d);
    gl_FragColor = vec4(vec3(1.0, 0.96, 0.9), core * core * vA);
  }`;

/** Estrella atomica de cuatro puntas (la de los posters de los 50). */
function burstTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 22);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = grad;
  g.fillRect(-64, -64, 128, 128);
  g.fillStyle = "#fff6e0";
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -60);
    g.quadraticCurveTo(4, -6, 0, 0);
    g.quadraticCurveTo(-4, -6, 0, -60);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bocanada de nube: blanca, suave, con varios lobulos. */
function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const rand = rng(11);
  for (let i = 0; i < 14; i++) {
    const x = 50 + rand() * 156;
    const y = 54 + (rand() - 0.5) * 30;
    const r = 22 + rand() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Luna de poster: crema con crateres suaves y un halo. */
function moonTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const halo = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  halo.addColorStop(0, "rgba(255,236,200,0.35)");
  halo.addColorStop(1, "rgba(255,236,200,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#f4e6c4";
  g.beginPath();
  g.arc(128, 128, 64, 0, Math.PI * 2);
  g.fill();
  const rand = rng(3);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(190, 160, 120, ${0.25 + rand() * 0.25})`;
    g.beginPath();
    g.arc(90 + rand() * 76, 90 + rand() * 76, 5 + rand() * 12, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bandas del planeta con anillos. */
function planetTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  const cols = ["#e8a35c", "#f3cf8e", "#c7713c", "#f0b978", "#d98a4a", "#f7dca6"];
  for (let y = 0; y < 256; y += 8) {
    g.fillStyle = cols[(y / 8 + (y % 24 === 0 ? 1 : 0)) % cols.length];
    g.fillRect(0, y, 64, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * El cielo cuenta la altura: noche de ciudad abajo, nubes violetas, y arriba el
 * espacio de los posters atomicos con estrellas de cuatro puntas, el Sputnik y un
 * planeta con anillos. `update` recibe la altura de la camara.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly bursts: THREE.Sprite[] = [];
  private readonly clouds: { s: THREE.Sprite; base: number }[] = [];
  private readonly sputnik = new THREE.Group();
  private readonly planet = new THREE.Group();
  private readonly moon: THREE.Sprite;

  constructor() {
    const rand = rng(42);
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({ uniforms: { uSpace: { value: 0 } }, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Estrellas en una cascara: se mueven con la camara (estan "en el infinito").
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.02;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * 1200, y * 1200, Math.sin(th) * r * 1200], i * 3);
      size[i] = 1.2 + Math.pow(rand(), 6) * 4.5;
      phase[i] = rand();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("size", new THREE.BufferAttribute(size, 1));
    sg.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    this.stars = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uBright: { value: 0.5 } },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    // Estrellas atomicas: pocas, grandes, mas presentes cuanto mas alto.
    const bt = burstTexture();
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      const th = rand() * Math.PI * 2;
      const y = 0.15 + rand() * 0.8;
      s.position.set(Math.cos(th) * 900, y * 900, Math.sin(th) * 900 - 200);
      const k = 18 + rand() * 30;
      s.scale.set(k, k, 1);
      s.userData.phase = rand() * 10;
      s.userData.min = y;
      this.bursts.push(s);
      this.group.add(s);
    }

    // Luna: siempre en el fondo, arriba a la izquierda.
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false }));
    this.moon.scale.set(110, 110, 1);
    this.moon.position.set(-420, 330, -700);
    this.group.add(this.moon);

    // Nubes bajas: en la banda que atraviesa el cohete entre ~x2.4 y ~x5.5.
    const ct = cloudTexture();
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, color: new THREE.Color("#5a4278"), opacity: 0.5 }));
      const y = 14 + rand() * 34;
      s.position.set((rand() - 0.5) * 90, y, -10 - rand() * 70);
      const k = 16 + rand() * 26;
      s.scale.set(k, k * 0.5, 1);
      this.clouds.push({ s, base: s.position.x });
      this.group.add(s);
    }

    // Sputnik: bola cromada con cuatro antenas, cruza cerca de x8.
    const chrome = new THREE.MeshStandardMaterial({ color: "#d9dee3", metalness: 1, roughness: 0.18 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), chrome);
    this.sputnik.add(ball);
    for (let i = 0; i < 4; i++) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3.4, 4), chrome);
      ant.position.set(Math.cos(i * 1.57) * 0.5 - 1.4, Math.sin(i * 1.57) * 0.4, 0);
      ant.rotation.z = Math.PI / 2 + (i - 1.5) * 0.12;
      this.sputnik.add(ant);
    }
    this.sputnik.position.set(30, 72, -26);
    this.group.add(this.sputnik);

    // Planeta con anillos, lejos, aparece en las alturas.
    const ball2 = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 32), new THREE.MeshBasicMaterial({ map: planetTexture() }));
    const ringGeo = new THREE.RingGeometry(52, 82, 96);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: "#f3d6a0", side: THREE.DoubleSide, transparent: true, opacity: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2.25;
    this.planet.add(ball2, ring);
    this.planet.rotation.z = 0.35;
    // Sobre la linea de mirada de la camara de vuelo (que mira hacia -z y un poco a -x),
    // y alto: a ~700 de distancia la camara ve hasta ~30 grados arriba, asi que a 480 de
    // altura queda afuera hasta ~x12 y a x30 ya esta en el medio. Es un premio de altura.
    this.planet.position.set(-300, 480, -620);
    this.group.add(this.planet);
  }

  /** `alt` = altura de la camara; `time` = reloj. */
  update(time: number, alt: number, camPos: THREE.Vector3): void {
    // El domo y las estrellas siguen a la camara: estan en el infinito.
    this.dome.position.copy(camPos);
    this.stars.position.copy(camPos);
    const space = Math.min(1, Math.max(0, (alt - 40) / 120));
    (this.dome.material as THREE.ShaderMaterial).uniforms.uSpace.value = space;
    const sm = this.stars.material as THREE.ShaderMaterial;
    sm.uniforms.uTime.value = time;
    sm.uniforms.uBright.value = 0.45 + space * 0.75;
    for (const b of this.bursts) {
      const m = b.material as THREE.SpriteMaterial;
      const tw = 0.6 + 0.4 * Math.sin(time * 1.7 + b.userData.phase);
      m.opacity = (0.25 + space * 0.75) * tw;
    }
    for (const c of this.clouds) c.s.position.x = c.base + Math.sin(time * 0.05 + c.base) * 3;
    this.sputnik.position.x = 30 - ((time * 3) % 80);
    this.sputnik.rotation.y = time * 0.6;
    this.planet.rotation.y = time * 0.02;
  }
}
