import * as THREE from "three";
import { DOLL_Z } from "./constants";

/** Velocidad del giro de la cabeza (rad/s): media vuelta en ~0.35 s. */
const TURN_SPEED = Math.PI / 0.35;
/** Angulo del amague: la cabeza arranca a girar y vuelve. */
const TEASE_ANGLE = 1.1;
const TEASE_OUT = 0.22;
const TEASE_BACK = 0.3;
/** El modelo esta hecho a ~9 de alto; se agranda a ~14. */
const DOLL_SCALE = 1.5;

/**
 * La muñeca gigante (DESIGN.md: jumper naranja, remera amarilla de mangas globo,
 * pelo negro con flequillo y dos colitas). Hecha con primitivas; la cabeza cuelga
 * de un pivote en el cuello para dar media vuelta.
 *
 * Como en la serie, el CUERPO le da la espalda a la cancha (mira al arbol) y lo
 * unico que gira es la cabeza: media vuelta sobre el cuello para mirar a los
 * jugadores con el cuerpo quieto. Angulo de la cabeza (local): 0 = hacia el arbol,
 * PI = hacia la cancha.
 */
export class Doll {
  readonly root = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly eyeMat: THREE.MeshLambertMaterial;
  private angle = 0;
  private target = 0;
  private teaseT = -1;
  private sway = 0;

  constructor(scene: THREE.Scene) {
    const skin = new THREE.MeshLambertMaterial({ color: "#f4d6bd" });
    const orange = new THREE.MeshLambertMaterial({ color: "#ef7a1f" });
    const yellow = new THREE.MeshLambertMaterial({ color: "#f6cb3a" });
    const black = new THREE.MeshLambertMaterial({ color: "#161311" });
    const white = new THREE.MeshLambertMaterial({ color: "#f5f3ee" });
    this.eyeMat = new THREE.MeshLambertMaterial({ color: "#1b1512", emissive: "#000000" });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.root) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };

    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.85, 0.5, 1.35), black, side * 0.62, 0.25, 0.15);
      add(new THREE.CylinderGeometry(0.34, 0.32, 1.3, 16), white, side * 0.62, 1.15, 0);
      add(new THREE.CylinderGeometry(0.3, 0.33, 1.1, 16), skin, side * 0.62, 2.3, 0);
    }
    // Falda del jumper, ensanchada abajo.
    add(new THREE.CylinderGeometry(1.25, 1.95, 2.1, 24), orange, 0, 3.35, 0);
    // Remera y el peto del jumper con sus tiradores.
    add(new THREE.CylinderGeometry(1.0, 1.2, 1.95, 24), yellow, 0, 5.3, 0);
    add(new THREE.BoxGeometry(1.35, 1.5, 0.12), orange, 0, 5.05, 1.08);
    for (const side of [-1, 1]) {
      const strap = add(new THREE.BoxGeometry(0.22, 1.9, 0.14), orange, side * 0.52, 5.4, 0.02);
      strap.rotation.x = 0.08;
      // Manga globo y brazo que cuelga.
      add(new THREE.SphereGeometry(0.58, 18, 14), yellow, side * 1.28, 5.85, 0);
      const arm = add(new THREE.CylinderGeometry(0.21, 0.24, 1.9, 12), skin, side * 1.48, 4.65, 0.05);
      arm.rotation.z = side * 0.12;
      add(new THREE.SphereGeometry(0.28, 12, 10), skin, side * 1.6, 3.65, 0.08);
    }
    add(new THREE.CylinderGeometry(0.34, 0.38, 0.5, 14), skin, 0, 6.45, 0);

    // ---- Cabeza (pivote en el cuello) ----
    this.head.position.set(0, 6.6, 0);
    this.root.add(this.head);
    add(new THREE.SphereGeometry(1.3, 32, 24), skin, 0, 1.25, 0, this.head);
    // Pelo: la mitad de atras entera y el casquete de arriba.
    add(
      new THREE.SphereGeometry(1.37, 32, 24, Math.PI, Math.PI, 0, Math.PI * 0.86),
      black,
      0,
      1.25,
      0,
      this.head,
    );
    add(new THREE.SphereGeometry(1.36, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.3), black, 0, 1.27, 0, this.head);
    // Flequillo recto.
    add(new THREE.BoxGeometry(1.9, 0.5, 0.5), black, 0, 2.05, 0.95, this.head);
    // Colitas con su gomita.
    for (const side of [-1, 1]) {
      add(new THREE.SphereGeometry(0.5, 16, 12), black, side * 1.42, 1.75, -0.35, this.head);
      add(new THREE.SphereGeometry(0.2, 10, 8), orange, side * 1.15, 1.85, -0.25, this.head);
      // Ojos grandes (son los que se prenden) con su brillito.
      add(new THREE.SphereGeometry(0.22, 16, 12), this.eyeMat, side * 0.45, 1.3, 1.16, this.head);
      add(new THREE.SphereGeometry(0.07, 8, 6), white, side * 0.45 + 0.07, 1.37, 1.36, this.head);
      // Cachetes.
      const cheek = add(
        new THREE.SphereGeometry(0.2, 12, 8),
        new THREE.MeshLambertMaterial({ color: "#f0a3a0" }),
        side * 0.72,
        0.92,
        1.05,
        this.head,
      );
      cheek.scale.z = 0.3;
    }
    const mouth = add(
      new THREE.SphereGeometry(0.12, 12, 8),
      new THREE.MeshLambertMaterial({ color: "#c2434a" }),
      0,
      0.68,
      1.25,
      this.head,
    );
    mouth.scale.set(1.3, 0.6, 0.4);

    this.root.position.set(0, 0, DOLL_Z);
    // Gigante: unas ocho personas de alto, para que se lea desde la largada.
    this.root.scale.setScalar(DOLL_SCALE);
    // De espaldas a la cancha: el frente del cuerpo (+Z local) mira al arbol (-Z).
    this.root.rotation.y = Math.PI;
    this.head.rotation.y = this.angle;
    scene.add(this.root);
  }

  /** Luz verde: se da vuelta hacia el arbol. Roja: gira hacia la cancha. */
  face(players: boolean): void {
    this.target = players ? Math.PI : 0;
    this.teaseT = -1;
  }

  /** Amague: arranca a girar y vuelve, sin cambiar la luz. */
  tease(): void {
    if (this.target === 0) this.teaseT = 0;
  }

  /** Ojos: el brillo rojo es la señal de "te estoy mirando". */
  setEyes(on: boolean): void {
    this.eyeMat.emissive.set(on ? "#ff1a14" : "#000000");
    this.eyeMat.color.set(on ? "#ff4a3a" : "#1b1512");
  }

  update(dt: number, singing: boolean): void {
    let goal = this.target;
    if (this.teaseT >= 0) {
      this.teaseT += dt;
      if (this.teaseT < TEASE_OUT) goal = TEASE_ANGLE;
      else if (this.teaseT > TEASE_OUT + TEASE_BACK) this.teaseT = -1;
    }
    const diff = goal - this.angle;
    const step = TURN_SPEED * dt;
    this.angle += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    this.head.rotation.y = this.angle;

    // Mientras canta se hamaca apenas; quieta cuando mira.
    this.sway += dt * (singing ? 3 : 0);
    this.root.rotation.z = singing ? Math.sin(this.sway) * 0.025 : this.root.rotation.z * 0.85;
  }

  /** La cabeza ya termino de girar hacia la cancha. */
  get facingPlayers(): boolean {
    return Math.abs(this.angle - Math.PI) < 0.05;
  }
}
