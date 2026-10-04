import * as THREE from "three";

/** Colores del juguete (DESIGN.md "Neón Atómico"). */
const TIN = "#d7332b";
const CREAM = "#f3e6c8";
const CHROME = "#c9d1d8";

/** Alto del cohete (de la tobera a la punta). La tobera esta en y = 0. */
export const ROCKET_H = 3.3;
/** Donde sale el fuego (debajo de la tobera). */
export const NOZZLE_Y = -0.02;

/**
 * Textura del casco: hojalata roja con una faja crema, filetes cromados y una hilera
 * de remaches arriba y abajo de la faja. Se pinta una vez; el torno (LatheGeometry)
 * reparte u alrededor y v a lo largo del perfil.
 */
function hullTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = TIN;
  g.fillRect(0, 0, w, h);
  // Veta de laca: lineas verticales apenas mas claras.
  for (let x = 0; x < w; x += 3) {
    g.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.03})`;
    g.fillRect(x, 0, 1, h);
  }
  // Faja crema (v alto = arriba del perfil; el canvas tiene y hacia abajo).
  const band = (v0: number, v1: number) => [h * (1 - v1), h * (1 - v0)] as const;
  const [b0, b1] = band(0.5, 0.62);
  g.fillStyle = CREAM;
  g.fillRect(0, b0, w, b1 - b0);
  g.fillStyle = "#b9a986";
  g.fillRect(0, b1 - 3, w, 3);
  g.fillStyle = "#e9eef2";
  g.fillRect(0, b0 - 5, w, 4);
  g.fillRect(0, b1 + 1, w, 4);
  // Remaches.
  for (const y of [b0 - 14, b1 + 13, h * 0.9]) {
    for (let x = 6; x < w; x += 16) {
      g.fillStyle = "rgba(60, 10, 8, 0.55)";
      g.beginPath();
      g.arc(x + 1, y + 1, 3.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#f2b8a6";
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uRed;
  uniform float uInner;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    // v = 1 en la tobera, 0 en la punta del fuego (en el cono, uv.y vale 1 en la punta).
    float v = 1.0 - vUv.y;
    float n = noise(vec2(vUv.x * 9.0, v * 6.0 - uTime * 14.0));
    float body = smoothstep(0.0, 0.55, v + (n - 0.5) * 0.35);
    vec3 hot = mix(vec3(1.0, 0.97, 0.85), vec3(1.0, 0.85, 0.5), 1.0 - v);
    vec3 warm = mix(vec3(1.0, 0.42, 0.08), vec3(0.95, 0.12, 0.05), 1.0 - v);
    vec3 col = mix(warm, hot, smoothstep(0.55, 1.0, v) * uInner);
    // Tos de verdad: el fuego se pone rojo oscuro.
    col = mix(col, vec3(0.75, 0.08, 0.02), uRed);
    float a = body * uPower * (0.75 + 0.25 * n);
    gl_FragColor = vec4(col * (1.4 + uInner), a);
  }`;

/**
 * El cohete de hojalata. `setEngine` decide como se ve el fuego cada cuadro (potencia
 * y si la tos es la de verdad); `group` se mueve desde el `Stage`.
 */
export class Rocket {
  readonly group = new THREE.Group();
  /** Lo que tiembla (el casco); el grupo de afuera lleva la posicion. */
  readonly body = new THREE.Group();
  readonly light = new THREE.PointLight("#ff8a3a", 0, 9, 1.8);
  private readonly flameOuter: THREE.Mesh;
  private readonly flameInner: THREE.Mesh;
  private readonly flameMats: THREE.ShaderMaterial[] = [];
  /** La laca roja: se pone al rojo vivo cuando la tos es la de verdad. */
  private readonly hot: THREE.MeshStandardMaterial[] = [];
  /** Piezas que salen volando en la explosion (se clonan). */
  readonly parts: THREE.Mesh[] = [];

  constructor() {
    const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture(), metalness: 0.3, roughness: 0.34, envMapIntensity: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: CHROME, metalness: 1, roughness: 0.2, envMapIntensity: 0.75 });
    const cream = new THREE.MeshStandardMaterial({ color: CREAM, metalness: 0.2, roughness: 0.4, envMapIntensity: 0.7 });
    const finMat = new THREE.MeshStandardMaterial({ color: TIN, metalness: 0.3, roughness: 0.32, envMapIntensity: 0.55 });

    // Casco: perfil torneado de la tobera a la base de la nariz.
    const hull = [
      [0.3, 0.32],
      [0.46, 0.36],
      [0.54, 0.6],
      [0.57, 1.0],
      [0.57, 1.7],
      [0.53, 2.2],
      [0.43, 2.62],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const hullMesh = new THREE.Mesh(new THREE.LatheGeometry(hull, 64), hullMat);
    this.body.add(hullMesh);

    // Nariz cromada en ojiva.
    const nosePts: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      nosePts.push(new THREE.Vector2(0.43 * Math.cos((t * Math.PI) / 2) ** 0.8, 2.62 + 0.68 * Math.sin((t * Math.PI) / 2)));
    }
    const nose = new THREE.Mesh(new THREE.LatheGeometry(nosePts, 64), chrome);
    this.body.add(nose);
    // Collarin crema donde la nariz se encastra en el casco.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.435, 0.028, 10, 64), cream);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 2.62;
    this.body.add(collar);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), chrome);
    tip.position.y = ROCKET_H;
    this.body.add(tip);

    // Tobera: campana cromada abierta con el interior oscuro.
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.36, 0.34, 40, 1, true), chrome);
    bell.position.y = 0.17;
    const throat = new THREE.Mesh(
      new THREE.CircleGeometry(0.27, 32),
      new THREE.MeshBasicMaterial({ color: "#1a0c06" }),
    );
    throat.rotation.x = Math.PI / 2;
    throat.position.y = 0.3;
    this.body.add(bell, throat);

    // Ojo de buey: aro cromado y vidrio verdoso que refleja.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 12, 40), chrome);
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 32),
      new THREE.MeshStandardMaterial({ color: "#2b6b6a", metalness: 0.6, roughness: 0.05, emissive: "#0b3b3a", envMapIntensity: 1.6 }),
    );
    const port = new THREE.Group();
    port.add(ring, glass);
    glass.position.z = -0.01;
    port.position.set(0, 1.95, 0.535);
    port.rotation.x = -0.07;
    this.body.add(port);

    // Aletas en flecha, como las de un auto del 57.
    const fin = new THREE.Shape();
    fin.moveTo(0, 1.05);
    fin.bezierCurveTo(0.25, 0.75, 0.55, 0.35, 0.7, -0.22);
    fin.lineTo(0.45, -0.22);
    fin.bezierCurveTo(0.3, 0.05, 0.12, 0.18, 0, 0.18);
    fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 16 });
    finGeo.translate(0, 0, -0.025);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(finGeo, finMat);
      // Una aleta hacia atras (lejos de la camara) y dos a los costados: ninguna queda de canto.
      const a = (i / 3) * Math.PI * 2 + 0.53 + Math.PI;
      f.position.set(Math.sin(a) * 0.5, 0.3, Math.cos(a) * 0.5);
      f.rotation.y = a - Math.PI / 2;
      // Canto cromado de la aleta.
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), chrome);
      edge.position.set(0.58, -0.08, 0);
      f.add(edge);
      this.body.add(f);
      this.parts.push(f);
    }
    this.parts.push(nose, bell);
    this.hot.push(hullMat, finMat);
    for (const m of this.hot) m.emissive.set("#ff2a0a");

    // Fuego: dos conos aditivos (afuera naranja, adentro blanco caliente).
    const mk = (radius: number, len: number, inner: number) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uRed: { value: 0 }, uInner: { value: inner } },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.flameMats.push(mat);
      const geo = new THREE.ConeGeometry(radius, len, 32, 1, true);
      // Punta para abajo y la base pegada a la tobera.
      geo.rotateX(Math.PI);
      geo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = NOZZLE_Y;
      m.renderOrder = 4;
      return m;
    };
    this.flameOuter = mk(0.3, 1.6, 0);
    this.flameInner = mk(0.16, 0.95, 1);
    // Debajo de la tobera: alumbra el humo y apenas el culo del cohete (si sube, lava la laca a blanco).
    this.light.position.y = -1.3;
    this.body.add(this.flameOuter, this.flameInner, this.light);

    this.group.add(this.body);
  }

  /**
   * Estado del motor en el cuadro: `power` 0-1 (apagado a pleno), `red` 0-1 (la tos de
   * verdad), `stretch` alarga el fuego con la velocidad.
   */
  setEngine(time: number, power: number, red: number, stretch: number): void {
    for (const m of this.flameMats) {
      m.uniforms.uTime.value = time;
      m.uniforms.uPower.value = power;
      m.uniforms.uRed.value = red;
    }
    const flick = 1 + Math.sin(time * 47) * 0.06 + Math.sin(time * 31) * 0.05;
    const len = Math.max(0.001, power) * stretch * flick;
    this.flameOuter.scale.set(1 + power * 0.1, len, 1 + power * 0.1);
    this.flameInner.scale.set(1, len * (0.9 + 0.1 * Math.sin(time * 23)), 1);
    this.flameOuter.visible = this.flameInner.visible = power > 0.01;
    this.light.intensity = power * (6 + Math.sin(time * 37) * 1) * (1 - red * 0.4);
    this.light.color.set(red > 0.2 ? "#ff3a1a" : "#ff8a3a");
    // El casco al rojo vivo, a los tirones: es la senal de "se viene" que se lee aunque
    // el humo negro se pierda contra el cielo de noche.
    const glow = red * (0.35 + 0.65 * Math.abs(Math.sin(time * 19)));
    for (const m of this.hot) m.emissiveIntensity = glow * 1.6;
  }
}
