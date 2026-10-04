import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { City, PAD_TOP } from "./City";
import { Parachute } from "./Parachute";
import { Particles } from "./Particles";
import { NOZZLE_Y, Rocket } from "./Rocket";
import { Sky } from "./Sky";
import { SoundEffects } from "./SoundEffects";
import { Space } from "./Space";

/** Altura por unidad de multiplicador: y = ALT_K * (m - 1). Acelera con el multiplicador. */
const ALT_K = 10;
/** El cohete apoya en las aletas: base del grupo sobre la plataforma. */
const REST_Y = PAD_TOP + 0.22;
const FOV = 42;

export type StagePhase = "pad" | "flight" | "boom";

export interface StageView {
  phase: StagePhase;
  /** Multiplicador actual (en vuelo) o el de la explosion. */
  mult: number;
  /** 0-1 de encendido en la plataforma (el motor calienta antes de despegar). */
  ignite: number;
}

/**
 * La escena de El Cohete (DESIGN.md "Neón Atómico"): el casino, el cielo, el cohete
 * y todo lo que el juego le pide mostrar. El juego le dice en que fase esta y cuanto
 * marca el multiplicador; el Stage decide la camara, el humo y el fuego.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 4000);
  private readonly city = new City();
  private readonly sky = new Sky();
  private readonly space = new Space();
  private readonly rocket = new Rocket();
  private readonly fire = new Particles(1400, true);
  private readonly smoke = new Particles(2200, false);
  private readonly debris: { mesh: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private readonly chutes: Parachute[] = [];
  private readonly shock: THREE.Mesh;
  private readonly camPos = new THREE.Vector3(5.8, 2.4, 9.5);
  private readonly camLook = new THREE.Vector3(0.2, 2.4, -1);
  /** En vuelo la camara va pegada al cohete: se suaviza el encuadre, no la altura. */
  private readonly camOff = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private phase: StagePhase = "pad";
  private shake = 0;
  private shockT = 1;
  private smokeAcc = 0;
  private lastY = REST_Y;
  private padTime = 0;
  private flashT = 1;
  /** Proximo fuego artificial sobre el casino (solo en la plataforma). */
  private fireworkIn = 1.5;
  private speed = 0;
  /** Altura del cohete (para la HUD: "x de altura"). */
  rocketY = REST_Y;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "game-canvas";
    container.append(this.canvas);

    // Reflejos SOLO en lo metalico (cohete, Sputnik), y de una noche de neon propia: el
    // entorno de estudio de three tiene paneles blancos que en el cromo se volvian
    // manchas quemadas, y puesto en toda la escena lavaba el techo y la plataforma.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(neonEnvironment(), 0.03).texture;
    pmrem.dispose();
    for (const g of [this.rocket.group, this.sky.group, this.space.group]) {
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.isMeshStandardMaterial) m.envMap = env;
      });
    }

    this.scene.add(new THREE.HemisphereLight("#4a3c88", "#ff4a8a", 0.35));
    const moon = new THREE.DirectionalLight("#b9c4ff", 0.75);
    moon.position.set(-6, 10, 6);
    this.scene.add(moon);
    // El letrero tiñe de rosa el cohete por detras.
    const signGlow = new THREE.PointLight("#ff3d8b", 5, 12, 1.4);
    signGlow.position.set(1.6, 4.2, -3.2);
    this.scene.add(signGlow);

    this.scene.add(this.sky.group, this.space.group, this.city.group, this.rocket.group, this.smoke.points, this.fire.points);
    this.rocket.group.position.y = REST_Y;

    // Onda expansiva: anillo que mira a la camara.
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.75, 0.3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.scene.add(this.shock);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Umbral alto: florecen el neon, el fuego y las bombitas (pintados por encima de 1),
    // no la laca ni la faja crema iluminadas.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.94);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const coarse = matchMedia("(pointer: coarse)").matches;
    const pr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // En vertical (celu) se abre el campo para que entren el cohete y el letrero.
    this.camera.fov = w < h ? FOV * 1.45 : FOV;
    this.camera.updateProjectionMatrix();
    this.fire.setScale(h * pr, this.camera.fov);
    this.smoke.setScale(h * pr, this.camera.fov);
  }

  /** Cohete nuevo en la plataforma (antes de cada vuelo). */
  resetPad(): void {
    this.phase = "pad";
    this.rocket.group.visible = true;
    this.rocket.group.position.set(0, REST_Y, 0);
    this.rocket.body.position.set(0, 0, 0);
    this.rocket.body.rotation.set(0, 0, 0);
    this.rocketY = REST_Y;
    this.lastY = REST_Y;
    this.padTime = 0;
    this.city.setArm(0);
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris.length = 0;
    this.shake = 0;
  }

  /** Despegue: nube de humo en la plataforma y el brazo de la torre se retira. */
  launch(): void {
    this.phase = "flight";
    this.camOff.copy(this.camPos).sub(this.rocket.group.position);
    this.city.setArm(1);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 4;
      this.smoke.emit(Math.cos(a) * 0.6, PAD_TOP + 0.1, Math.sin(a) * 0.6, Math.cos(a) * v, 0.3 + Math.random() * 1.2, Math.sin(a) * v, 2.4 + Math.random(), 0x8a7f92, 0x3a3046, 0.6, 3.0, 0.6, 1.1);
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      this.fire.emit(0, PAD_TOP, 0, Math.cos(a) * 5, Math.random() * 1.5, Math.sin(a) * 5, 0.4 + Math.random() * 0.3, 0xffd27a, 0xff4a10, 0.35, 0.05, 0.9, 2);
    }
  }

  /** La explosion: fogonazo, bola de fuego, humo, chispas, piezas y onda expansiva. */
  explode(): void {
    this.phase = "boom";
    const p = this.rocket.group.position;
    const cy = p.y + 1.6;
    this.rocket.group.visible = false;
    this.flashT = 0;
    this.shake = 1.2;
    for (let i = 0; i < 4; i++) this.fire.emit(p.x, cy, p.z, 0, 0, 0, 0.18, 0xffe2b0, 0xff8a30, 1.6 + Math.random(), 3.2, 0.7, 0);
    // Pocas y medio transparentes: aditivas y amontonadas saturaban a un disco blanco.
    for (let i = 0; i < 48; i++) {
      const d = randDir(this.tmp).multiplyScalar(2 + Math.random() * 7);
      this.fire.emit(p.x, cy, p.z, d.x, d.y, d.z, 0.6 + Math.random() * 0.7, 0xffa040, 0x6a1404, 0.8 + Math.random() * 0.7, 2.4, 0.55, 2.6);
    }
    for (let i = 0; i < 110; i++) {
      const d = randDir(this.tmp).multiplyScalar(5 + Math.random() * 14);
      this.fire.emit(p.x, cy, p.z, d.x, d.y, d.z, 0.7 + Math.random() * 0.9, 0xfff0b0, 0xff3a10, 0.14, 0.02, 1, 1.4, 9);
    }
    for (let i = 0; i < 80; i++) {
      const d = randDir(this.tmp).multiplyScalar(1 + Math.random() * 4);
      const c = Math.random() < 0.5 ? 0x1a1414 : 0x2e2626;
      this.smoke.emit(p.x, cy, p.z, d.x, d.y + 0.6, d.z, 2.2 + Math.random() * 1.6, c, 0x3a3236, 1.1, 4.2, 0.9, 0.9);
    }
    // Piezas: copias de las aletas, la nariz y la tobera, girando.
    for (const part of this.rocket.parts) {
      const m = part.clone();
      part.getWorldPosition(this.tmp);
      m.position.copy(this.tmp);
      m.quaternion.copy(part.getWorldQuaternion(new THREE.Quaternion()));
      this.scene.add(m);
      const v = randDir(new THREE.Vector3()).multiplyScalar(4 + Math.random() * 5);
      v.y = Math.abs(v.y) + 3;
      this.debris.push({ mesh: m, v, spin: randDir(new THREE.Vector3()).multiplyScalar(6 + Math.random() * 8) });
    }
    this.shock.position.set(p.x, cy, p.z);
    this.shockT = 0;
  }

  /** Alguien se bajo: salta del cohete con paracaidas. */
  jump(seat: number, text: string): void {
    const p = this.rocket.group.position;
    const dir = this.chutes.length % 2 ? -1 : 1;
    const c = new Parachute(seat, text, p.x + dir * 0.6, p.y + 1.7, p.z + 0.5, dir);
    this.chutes.push(c);
    this.scene.add(c.group);
  }

  update(dt: number, time: number, view: StageView): void {
    this.phase = view.phase === "boom" && this.phase !== "boom" ? this.phase : view.phase;
    const r = this.rocket;
    let power = 0;

    if (view.phase === "pad") {
      this.padTime += dt;
      power = view.ignite * (0.35 + 0.15 * Math.sin(time * 30));
      r.group.position.y = REST_Y;
      this.speed = 0;
      if (view.ignite > 0.05) this.puffPad(dt, view.ignite);
      this.fireworkIn -= dt;
      if (this.fireworkIn <= 0) {
        this.fireworkIn = 1.2 + Math.random() * 2.2;
        this.firework();
      }
    } else if (view.phase === "flight") {
      const y = REST_Y + ALT_K * (view.mult - 1);
      r.group.position.y = y;
      const speed = (y - this.lastY) / Math.max(1e-4, dt);
      this.lastY = y;
      this.speed = speed;
      power = 1;
      const shakeAmp = 0.01 + Math.min(0.03, speed * 0.0008);
      r.body.position.set((Math.random() - 0.5) * shakeAmp, 0, (Math.random() - 0.5) * shakeAmp);
      r.body.rotation.z = Math.sin(time * 1.3) * 0.02;
      this.trail(dt, speed);
    }
    this.rocketY = r.group.position.y;
    r.setEngine(time, power, 1 + Math.min(0.9, view.phase === "flight" ? (view.mult - 1) * 0.1 : 0));

    // Piezas de la explosion.
    for (const d of this.debris) {
      d.v.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (Math.random() < dt * 30) this.smoke.emit(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z, 0, 0.4, 0, 1.2, 0x2a2224, 0x4a4044, 0.25, 0.9, 0.7, 1);
    }
    for (let i = this.chutes.length - 1; i >= 0; i--) {
      if (!this.chutes[i].update(dt, time)) {
        this.scene.remove(this.chutes[i].group);
        this.chutes[i].dispose();
        this.chutes.splice(i, 1);
      }
    }
    // Onda expansiva.
    if (this.shockT < 1) {
      this.shockT = Math.min(1, this.shockT + dt / 0.55);
      const k = 1 - Math.pow(1 - this.shockT, 3);
      this.shock.scale.setScalar(0.5 + k * 9);
      (this.shock.material as THREE.MeshBasicMaterial).opacity = (1 - this.shockT) * 0.4;
      this.shock.lookAt(this.camera.position);
    }

    this.fire.update(dt);
    this.smoke.update(dt);
    this.city.update(time, dt);
    this.updateCamera(dt, time, view);
    this.sky.update(time, this.camera.position.y, this.camera.position);
    this.space.update(time, dt, this.camera.position.y, this.speed);

    // Fogonazo: el bloom se dispara un instante.
    this.flashT = Math.min(1, this.flashT + dt / 0.5);
    this.bloom.strength = 0.7 + (1 - this.flashT) * 1.1 + (view.phase === "flight" ? Math.min(0.4, (view.mult - 1) * 0.05) : 0);
    this.composer.render(dt);
  }

  private updateCamera(dt: number, time: number, view: StageView): void {
    const ry = this.rocket.group.position.y;
    if (view.phase === "pad") {
      // Plano del tejado: el cohete delante del letrero, con un vaiven lento.
      const sway = Math.sin(time * 0.25) * 0.8;
      this.tmp.set(5.6 + sway, 2.2 + Math.sin(time * 0.18) * 0.2, 9.6);
      this.camPos.lerp(this.tmp, 1 - Math.exp(-dt * 2.5));
      this.camLook.lerp(this.tmp.set(0.3, 2.5, -1), 1 - Math.exp(-dt * 2.5));
    } else if (view.phase === "flight") {
      // Sigue al cohete de costado y un poco abajo, alejandose con la velocidad. Lo que
      // se interpola es el desplazamiento respecto del cohete, no la posicion: a x30 el
      // cohete sube a ~35 unidades por segundo y una camara que lo "persigue" se queda
      // atras mirando solo el fuego.
      const fast = Math.min(1, (view.mult - 1) / 6);
      this.tmp.set(6.2 + fast * 3, -0.4 - fast * 2.5, 11 + fast * 7);
      this.camOff.lerp(this.tmp, 1 - Math.exp(-dt * 2.2));
      this.camPos.copy(this.rocket.group.position).add(this.camOff);
      this.camLook.lerp(this.tmp.set(0, ry + 1.7, 0), 1 - Math.exp(-dt * 10));
      this.camLook.y = ry + 1.7;
    }
    // En "boom" la camara se queda donde estaba.
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake * 0.5;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * s, this.camPos.y + (Math.random() - 0.5) * s, this.camPos.z);
    this.camera.lookAt(this.camLook);
  }

  /** Fuego artificial lejos, sobre la avenida: el casino festeja mientras se apuesta. */
  private firework(): void {
    const colors = [0xff3d8b, 0x2ee6d6, 0xffd36a, 0xfff4e0];
    const c = colors[Math.floor(Math.random() * colors.length)];
    const x = (Math.random() - 0.5) * 70;
    const y = 16 + Math.random() * 12;
    const z = -45 - Math.random() * 30;
    for (let i = 0; i < 70; i++) {
      const d = randDir(this.tmp).multiplyScalar(6 + Math.random() * 3);
      this.fire.emit(x, y, z, d.x, d.y, d.z, 1.2 + Math.random() * 0.5, c, 0x5a1a30, 0.55, 0.1, 1, 1.3, 2.5);
    }
    this.fire.emit(x, y, z, 0, 0, 0, 0.25, 0xffffff, c, 3, 6, 0.6, 0);
    SoundEffects.firework();
  }

  /** Humo de calentamiento en la plataforma antes de despegar. */
  private puffPad(dt: number, k: number): void {
    this.smokeAcc += dt * 40 * k;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const v = 0.8 + Math.random() * 1.6;
      this.smoke.emit(Math.cos(a) * 0.4, PAD_TOP + 0.05, Math.sin(a) * 0.4, Math.cos(a) * v, 0.2 + Math.random() * 0.4, Math.sin(a) * v, 1.8, 0x9a90a2, 0x403650, 0.4, 1.8, 0.5, 0.8);
    }
  }

  /** Estela del escape: humo que queda en el aire y chispas del fuego. */
  private trail(dt: number, speed: number): void {
    const p = this.rocket.group.position;
    this.smokeAcc += dt * (30 + Math.min(40, speed * 1.5));
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const y = p.y + NOZZLE_Y - 0.4 - Math.random() * 1.2;
      this.smoke.emit(p.x + (Math.random() - 0.5) * 0.3, y, p.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, -1 - Math.random(), (Math.random() - 0.5) * 0.6, 3.0, 0x8e8296, 0x362c42, 0.35, 2.0, 0.45, 0.9);
      if (Math.random() < 0.5) {
        this.fire.emit(p.x + (Math.random() - 0.5) * 0.2, p.y - 0.3, p.z, (Math.random() - 0.5) * 1.5, -4 - Math.random() * 3, (Math.random() - 0.5) * 1.5, 0.35, 0xffc070, 0xff3a10, 0.12, 0.02, 1, 1.5);
      }
    }
  }

}

/**
 * Entorno para los reflejos: cielo indigo, horizonte rosado y una corona de tubos de
 * neon (rosa, turquesa, dorado de bombita) a la altura de los ojos. Es lo que el cromo
 * de la nariz y la tobera "ve" de la ciudad.
 */
function neonEnvironment(): THREE.Scene {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){
        float h = vP.y;
        vec3 c = mix(vec3(0.16, 0.06, 0.22), vec3(0.03, 0.03, 0.10), smoothstep(0.0, 0.7, h));
        c = mix(c, vec3(0.05, 0.02, 0.05), smoothstep(0.0, -0.4, h));
        c += vec3(0.9, 0.25, 0.45) * pow(max(0.0, 1.0 - abs(h) * 5.0), 3.0) * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  scene.add(sky);
  const tubes: [number, number, number][] = [
    [0xff3d8b, 0.2, 0],
    [0x2ee6d6, -0.1, 1.9],
    [0xffd36a, 0.05, 3.4],
    [0xff3d8b, -0.25, 4.6],
    [0x2ee6d6, 0.3, 5.5],
  ];
  for (const [hex, y, ang] of tubes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(3) }));
    m.position.set(Math.sin(ang) * 8, y * 8, Math.cos(ang) * 8);
    m.lookAt(0, m.position.y, 0);
    scene.add(m);
  }
  return scene;
}

function randDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(th), u, r * Math.sin(th));
}
