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

type Look = "craters" | "bands" | "swirl";

/** Superficie de un planeta pintada por codigo: bandas, crateres o remolinos. */
function surface(look: Look, colors: string[], seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  const rand = rng(seed);
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 512, 256);
  if (look === "bands") {
    let y = 0;
    while (y < 256) {
      const h = 6 + rand() * 26;
      g.fillStyle = colors[Math.floor(rand() * colors.length)];
      g.globalAlpha = 0.55 + rand() * 0.45;
      // Bandas onduladas, como las de un gigante gaseoso.
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + y) * 3);
      for (let x = 512; x >= 0; x -= 16) g.lineTo(x, y + h + Math.sin(x * 0.025 + y * 2) * 3);
      g.fill();
      y += h;
    }
  } else if (look === "craters") {
    for (let i = 0; i < 70; i++) {
      const x = rand() * 512;
      const y = 20 + rand() * 216;
      const r = 3 + Math.pow(rand(), 2) * 26;
      g.globalAlpha = 0.35 + rand() * 0.35;
      g.fillStyle = colors[1 + Math.floor(rand() * (colors.length - 1))];
      g.beginPath();
      g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.25;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1.5;
      g.stroke();
    }
  } else {
    for (let i = 0; i < 40; i++) {
      g.globalAlpha = 0.25 + rand() * 0.4;
      g.fillStyle = colors[Math.floor(rand() * colors.length)];
      const x = rand() * 512;
      const y = rand() * 256;
      g.beginPath();
      g.ellipse(x, y, 20 + rand() * 70, 6 + rand() * 18, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Halo de atmosfera: esfera un poco mas grande, aditiva, que brilla en el borde. */
function atmosphere(radius: number, color: string, strength: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.12, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: strength } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.6); gl_FragColor = vec4(uColor * uK, f); }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

interface PlanetDef {
  /** Multiplicador al que el cohete pasa a su altura (y = 10 * (m - 1)). */
  at: number;
  x: number;
  z: number;
  r: number;
  look: Look;
  colors: string[];
  glow: string;
  ring?: string;
  tilt?: number;
}

/**
 * Lo que el cohete cruza cuando sube mucho: la Luna, Marte, un planeta con anillos, un
 * gigante azul, uno verde y uno de lava, un cinturon de asteroides y polvo que pasa
 * rapido. Estan a la altura de su multiplicador, detras y a los costados del camino,
 * asi la camara (que va pegada al cohete) los ve pasar.
 */
export class Space {
  readonly group = new THREE.Group();
  private readonly planets: THREE.Group[] = [];
  private readonly rocks: THREE.InstancedMesh;
  private readonly rockData: { x: number; y: number; z: number; s: number; rx: number; ry: number; vr: number }[] = [];
  private readonly dust: THREE.Points;
  private readonly dustPos: Float32Array;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor() {
    // Posiciones en coordenadas de la camara de vuelo: va al costado del cohete (+x, +z)
    // mirando hacia el (-x, -z). `d` = distancia a lo largo de la mirada, `l` = corrimiento
    // a la derecha (+) o la izquierda (-). Puestos en x/z del mundo a ojo quedaban afuera
    // del cuadro (la camara mira a la izquierda) o tapando al cohete.
    const view = new THREE.Vector2(-0.45, -0.89).normalize();
    const side = new THREE.Vector2(-view.y, view.x);
    const at = (d: number, l: number) => ({ x: 9 + view.x * d + side.x * l, z: 18 + view.y * d + side.y * l });
    const defs: PlanetDef[] = [
      { at: 5.6, ...at(55, -16), r: 7, look: "craters", colors: ["#d9d2c2", "#a69c8a", "#8a8070", "#c4bba8"], glow: "#fff3d6" },
      { at: 9.4, ...at(65, 18), r: 7, look: "craters", colors: ["#c4552e", "#8a3018", "#e07a48", "#6a2412"], glow: "#ff8a5a" },
      { at: 14, ...at(110, -30), r: 11, look: "bands", colors: ["#e8b56c", "#f4d79c", "#c47e3c", "#f0c47e"], glow: "#ffd9a0", ring: "#f3d6a0", tilt: 0.42 },
      { at: 20, ...at(130, 34), r: 16, look: "bands", colors: ["#2d5fd0", "#5aa0f0", "#1c3a8a", "#8cc8ff"], glow: "#6ab0ff" },
      { at: 27.5, ...at(115, -30), r: 13, look: "swirl", colors: ["#2f8a4a", "#7ae08c", "#1a5a30", "#c4f070"], glow: "#7aff9a", ring: "#9affc4", tilt: -0.3 },
      { at: 36.5, ...at(120, 30), r: 14, look: "swirl", colors: ["#3a124a", "#ff5a2a", "#7a2a8a", "#ffb04a"], glow: "#ff6a8a" },
    ];
    defs.forEach((d, i) => {
      const p = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(d.r, 64, 32),
        new THREE.MeshStandardMaterial({ map: surface(d.look, d.colors, 31 + i * 7), roughness: 0.95, metalness: 0, emissive: new THREE.Color(d.glow), emissiveIntensity: 0.06 }),
      );
      // La Luna no tiene atmosfera: apenas un brillo; los demas, un halo de su color.
      p.add(body, atmosphere(d.r, d.glow, i === 0 ? 0.35 : 0.9));
      if (d.ring) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(d.r * 1.35, d.r * 2, 96),
          new THREE.MeshBasicMaterial({ color: d.ring, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthWrite: false }),
        );
        ring.rotation.x = Math.PI / 2 - 0.35;
        p.add(ring);
      }
      p.rotation.z = d.tilt ?? 0.15;
      p.position.set(d.x, 10 * (d.at - 1), d.z);
      p.userData.spin = 0.03 + i * 0.008;
      this.planets.push(p);
      this.group.add(p);
    });

    // Cinturon de asteroides entre ~x11 y ~x17, alrededor del camino del cohete.
    const rand = rng(7);
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const pos = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.75 + rand() * 0.5;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.8, pos.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
    const n = 90;
    this.rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: "#6a5a66", roughness: 1, flatShading: true }), n);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const dist = 7 + rand() * 40;
      this.rockData.push({
        x: Math.cos(a) * dist,
        y: 100 + rand() * 70,
        z: Math.sin(a) * dist - 10,
        s: 0.3 + Math.pow(rand(), 2) * 2.4,
        rx: rand() * 6,
        ry: rand() * 6,
        vr: (rand() - 0.5) * 1.2,
      });
    }
    this.group.add(this.rocks);

    // Polvo espacial: se recicla alrededor de la camara; cuanto mas rapido, mas se ve.
    const dn = 500;
    this.dustPos = new Float32Array(dn * 3);
    for (let i = 0; i < dn; i++) this.dustPos.set([(rand() - 0.5) * 60, (rand() - 0.5) * 80, (rand() - 0.5) * 60 - 10], i * 3);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: "#cfd8ff", size: 0.12, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /** `camY` = altura de la camara; `speed` = velocidad del cohete (unidades/s). */
  update(time: number, dt: number, camY: number, speed: number): void {
    for (const p of this.planets) {
      p.visible = Math.abs(p.position.y - camY) < 140;
      if (p.visible) p.children[0].rotation.y += dt * p.userData.spin;
    }
    const near = camY > 70 && camY < 200;
    this.rocks.visible = near;
    if (near) {
      for (let i = 0; i < this.rockData.length; i++) {
        const r = this.rockData[i];
        this.e.set(r.rx + time * r.vr, r.ry + time * r.vr * 0.7, 0);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(r.x, r.y, r.z), this.q, this.sc.setScalar(r.s));
        this.rocks.setMatrixAt(i, this.m4);
      }
      this.rocks.instanceMatrix.needsUpdate = true;
    }
    // Polvo: lo que queda abajo de la camara vuelve a aparecer arriba.
    const mat = this.dust.material as THREE.PointsMaterial;
    mat.opacity = Math.min(0.9, Math.max(0, (camY - 30) / 60)) * Math.min(1, speed / 8);
    for (let i = 0; i < this.dustPos.length; i += 3) {
      while (this.dustPos[i + 1] < camY - 40) this.dustPos[i + 1] += 80;
      while (this.dustPos[i + 1] > camY + 40) this.dustPos[i + 1] -= 80;
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
