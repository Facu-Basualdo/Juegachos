import * as THREE from "three";
import {
  CAM_DISTANCE,
  CAM_FOV,
  CAM_HEIGHT,
  CAM_LERP,
  CAM_LOOK_AHEAD,
  CAM_LOOK_Y,
  CAM_SIDE_Z,
  FOG_COLOR,
  FOG_DENSITY,
  GROUND_COLOR,
  SKY_BOTTOM,
  SKY_TOP,
} from "./constants";

/** Degrade de cielo como fondo de escena: el amanecer, en dos paradas. */
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, `#${SKY_TOP.toString(16).padStart(6, "0")}`);
  grad.addColorStop(0.62, "#e6c6c8");
  grad.addColorStop(1, `#${SKY_BOTTOM.toString(16).padStart(6, "0")}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Escena, luces y camara. La camara es en perspectiva (2.5D, no ortografica):
 * el bicho corre en el plano XY y la profundidad existe para que la luz rasante
 * del amanecer tenga adonde tirar la sombra.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly sun: THREE.DirectionalLight;
  private readonly sunTarget = new THREE.Object3D();
  private readonly look = new THREE.Vector3();
  private shake = 0;

  constructor(container: HTMLElement) {
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(
      CAM_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      320,
    );
    this.camera.position.set(0, CAM_HEIGHT, CAM_DISTANCE);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    // `PCFSoftShadowMap` esta deprecado desde three r18x y el renderer avisa por
    // consola que igual usa PCF; se pide PCF directo y la blandura se consigue
    // con el radio de la sombra.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    container.appendChild(this.renderer.domElement);

    // Luz de cielo lavanda + rebote de arena: es lo que mantiene todo mate.
    this.scene.add(new THREE.HemisphereLight(SKY_TOP, GROUND_COLOR, 1.25));

    // Sol bajo del amanecer: sombras largas, calidas y blandas.
    this.sun = new THREE.DirectionalLight(0xffe3c2, 2.1);
    this.sun.castShadow = true;
    // 1024 alcanza: la caja de sombra es chica y sigue al bicho. Con 2048 el
    // costo de sombreado se nota en GPU floja (medido headless: 23 vs 31 fps).
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 72;
    // La caja de sombra sigue al bicho y tiene que sobrarle: ajustada al pelo,
    // su borde se ve como una linea diagonal cruzando la arena.
    this.sun.shadow.camera.left = -21;
    this.sun.shadow.camera.right = 21;
    this.sun.shadow.camera.top = 21;
    this.sun.shadow.camera.bottom = -21;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);

    window.addEventListener("resize", this.onResize);
  }

  /** Sacudon corto de camara (caida, record). */
  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /**
   * Seguimiento suave del torso. `snap` coloca la camara sin interpolar.
   *
   * La distancia y el adelanto se corrigen por relacion de aspecto: el `fov`
   * de Three es VERTICAL, asi que en un celular en vertical el encuadre se
   * angosta muchisimo y con los valores de escritorio la criatura queda medio
   * afuera del cuadro, contra el borde izquierdo.
   */
  follow(x: number, y: number, dt: number, snap = false): void {
    const wide = THREE.MathUtils.clamp(1.7 / Math.max(0.3, this.camera.aspect), 1, 2.1);
    const dist = CAM_DISTANCE * wide;
    const ahead = CAM_LOOK_AHEAD / wide;
    const targetX = x;
    const targetY = THREE.MathUtils.clamp(y * 0.4 + CAM_HEIGHT * 0.55, 1.9, CAM_HEIGHT + 1.2);
    const k = snap ? 1 : 1 - Math.exp(-CAM_LERP * dt);

    this.camera.position.x += (targetX - this.camera.position.x) * k;
    this.camera.position.y += (targetY - this.camera.position.y) * k;
    this.camera.position.z = dist;

    if (this.shake > 0.0001) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    this.look.set(this.camera.position.x + ahead, CAM_LOOK_Y, CAM_SIDE_Z);
    this.camera.lookAt(this.look);

    // El sol viaja con el bicho: la caja de sombra es chica a proposito.
    this.sunTarget.position.set(x, 1.6, 0);
    this.sun.position.set(x - 11, 8.5, 8);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
  }
}
