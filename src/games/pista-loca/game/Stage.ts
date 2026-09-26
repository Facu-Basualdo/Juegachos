import * as THREE from "three";
import { GRID } from "./constants";
import { glintTexture } from "./textures";

const NIGHT = new THREE.Color("#070a1f");
const GLINTS = 26;
/** Altura de la bola por defecto; `setBallHeight` la sube si tapa la pista. */
export const BALL_Y = 15;
/** Radio de la bola mas un margen, para medir si su borde de abajo tapa la pista. */
export const BALL_REACH = 1.8;
const GLINT_COLORS = ["#ff5fa2", "#5fd7ff", "#fff27a", "#9a7bff", "#7dff9a"];

/**
 * Medianoche en una pista suspendida sobre la nada (DESIGN.md "Baile de Bloques").
 *
 * La luz tiene dos modos y el cambio entre ellos es una señal del juego:
 *  - `party` (suena la musica): luz baja y azulada, la bola de espejos gira y reparte
 *    reflejos cuadrados de colores que pasean por la pista, y cuatro haces barren.
 *  - `plain` (se corta la musica): los reflejos y los haces se apagan de golpe y la
 *    pista queda bajo una luz blanca plana, para leer bien los colores.
 */
export class Stage {
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly ball = new THREE.Group();
  private readonly glints: { mesh: THREE.Mesh; radius: number; speed: number; phase: number }[] = [];
  private readonly beams = new THREE.Group();
  private party = true;
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.background = NIGHT;
    this.hemi = new THREE.HemisphereLight("#8fa4ff", "#1a1030", 0.9);
    this.sun = new THREE.DirectionalLight("#ffffff", 1.1);
    this.sun.position.set(6, 30, 12);
    scene.add(this.hemi, this.sun);

    this.buildStars(scene);
    this.buildBall(scene);
    this.buildGlints(scene);
    this.buildBeams(scene);
    this.setMode("party");
  }

  /** Estrellas cuadradas en toda la esfera: tambien abajo, asi caer es caer a la nada. */
  private buildStars(scene: THREE.Scene): void {
    const count = 700;
    const pos = new Float32Array(count * 3);
    let seed = 13;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = 110 + rand() * 40;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(a) * s * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    // Sin `map`, PointsMaterial dibuja cuadrados: justo lo que pide el pixel.
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: "#dfe6ff", size: 1.4, sizeAttenuation: true })));
  }

  /** Bola de espejos hecha de cubitos, colgada arriba del centro. */
  private buildBall(scene: THREE.Scene): void {
    const cube = new THREE.BoxGeometry(0.42, 0.42, 0.42);
    const mirror = new THREE.MeshLambertMaterial({ color: "#c9d2e6", emissive: "#3a4260" });
    const dummy = new THREE.Object3D();
    const points: THREE.Vector3[] = [];
    const r = 1.6;
    for (let lat = -3; lat <= 3; lat++) {
      const phi = (lat / 3.5) * (Math.PI / 2);
      const ring = Math.max(4, Math.round(12 * Math.cos(phi)));
      for (let k = 0; k < ring; k++) {
        const th = (k / ring) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(th) * Math.cos(phi) * r, Math.sin(phi) * r, Math.sin(th) * Math.cos(phi) * r));
      }
    }
    const inst = new THREE.InstancedMesh(cube, mirror, points.length);
    points.forEach((p, i) => {
      dummy.position.copy(p);
      dummy.lookAt(0, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      // Algunos cubitos mas brillantes, para que se lea que refleja.
      inst.setColorAt(i, new THREE.Color(i % 5 === 0 ? "#ffffff" : "#9aa6c4"));
    });
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.08, 30, 0.08), new THREE.MeshBasicMaterial({ color: "#333844" }));
    cable.position.y = 15 + r;
    this.ball.add(inst, cable);
    this.ball.position.set(0, BALL_Y, 0);
    scene.add(this.ball);
  }

  /** Reflejos cuadrados de colores que pasean por la pista mientras suena la musica. */
  private buildGlints(scene: THREE.Scene): void {
    const tex = glintTexture();
    for (let i = 0; i < GLINTS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: GLINT_COLORS[i % GLINT_COLORS.length],
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.03;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.glints.push({
        mesh,
        radius: 1.5 + ((i * 37) % 100) / 100 * (GRID / 2 - 2),
        speed: 0.25 + ((i * 53) % 100) / 100 * 0.35,
        phase: (i / GLINTS) * Math.PI * 2 * 3,
      });
    }
  }

  /** Cuatro haces de luz que salen de la bola y barren la pista. */
  private buildBeams(scene: THREE.Scene): void {
    const geo = new THREE.ConeGeometry(1.5, BALL_Y, 16, 1, true);
    geo.translate(0, -BALL_Y / 2, 0);
    ["#ff5fa2", "#5fd7ff", "#fff27a", "#9a7bff"].forEach((c, i) => {
      const beam = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: c,
          transparent: true,
          // Tenues: son ambiente, no pueden lavar los colores de la lana.
          opacity: 0.05,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      beam.rotation.z = 0.55;
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / 4) * Math.PI * 2;
      pivot.add(beam);
      this.beams.add(pivot);
    });
    this.beams.position.y = BALL_Y;
    scene.add(this.beams);
  }

  /**
   * Cuelga la bola a otra altura (con la camara casi cenital del celu en vertical, a
   * la altura normal queda delante del centro de la pista). Los haces se estiran para
   * seguir llegando al piso.
   */
  setBallHeight(y: number): void {
    this.ball.position.y = y;
    this.beams.position.y = y;
    this.beams.scale.y = y / BALL_Y;
  }

  setMode(mode: "party" | "plain"): void {
    this.party = mode === "party";
    for (const g of this.glints) g.mesh.visible = this.party;
    this.beams.visible = this.party;
    this.hemi.intensity = this.party ? 0.9 : 1.7;
    this.hemi.color.set(this.party ? "#8fa4ff" : "#ffffff");
    this.sun.intensity = this.party ? 1.1 : 1.6;
  }

  /** `solidAt` dice si hay bloque en un punto: un reflejo no puede flotar sobre un agujero. */
  update(dt: number, solidAt: (x: number, z: number) => boolean): void {
    if (!this.party) return;
    this.t += dt;
    this.ball.rotation.y += dt * 0.6;
    this.beams.rotation.y -= dt * 0.8;
    for (const g of this.glints) {
      const a = g.phase + this.t * g.speed;
      g.mesh.position.x = Math.cos(a) * g.radius;
      g.mesh.position.z = Math.sin(a) * g.radius;
      g.mesh.visible = solidAt(g.mesh.position.x, g.mesh.position.z);
    }
  }
}
