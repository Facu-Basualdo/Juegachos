import * as THREE from "three";
import {
  FINISH_Z,
  HALF_WIDTH,
  START_Z,
  TREE_Z,
  WALL_BACK_Z,
  WALL_FRONT_Z,
  WALL_HEIGHT,
  WALL_X,
} from "./constants";
import { maskTexture, muralTexture, sandTexture } from "./textures";

const SKY = new THREE.Color("#8fcaf0");

/**
 * El galpon (DESIGN.md "Patio Pintado"): cuatro paredes con el cielo pintado, la
 * cancha de arena, las dos lineas, el arbol pelado detras de la muñeca y los
 * guardias de rosa a los costados. Todo estatico; lo unico que se mueve con
 * intencion es la muñeca.
 */
export class Stage {
  constructor(scene: THREE.Scene) {
    scene.background = SKY;
    scene.fog = new THREE.Fog(SKY, 70, 150);

    scene.add(new THREE.HemisphereLight("#eef7ff", "#c9ab7c", 1.5));
    const sun = new THREE.DirectionalLight("#fff3dc", 1.5);
    sun.position.set(10, 30, 22);
    scene.add(sun);

    this.buildFloor(scene);
    this.buildWalls(scene);
    this.buildLines(scene);
    this.buildTree(scene);
    this.buildGuards(scene);
  }

  private buildFloor(scene: THREE.Scene): void {
    const width = WALL_X * 2;
    const depth = WALL_FRONT_Z - WALL_BACK_Z;
    const tex = sandTexture();
    tex.repeat.set(width / 6, depth / 6);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, (WALL_FRONT_Z + WALL_BACK_Z) / 2);
    scene.add(floor);
  }

  /** Las paredes son MeshBasic: el cielo esta pintado y no recibe luz (se nota falso a proposito). */
  private buildWalls(scene: THREE.Scene): void {
    const depth = WALL_FRONT_Z - WALL_BACK_Z;
    const width = WALL_X * 2;
    const wall = (length: number, x: number, z: number, rotY: number) => {
      const tex = muralTexture();
      tex.repeat.set(length / (WALL_HEIGHT * 2), 1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(length, WALL_HEIGHT),
        new THREE.MeshBasicMaterial({ map: tex, fog: false }),
      );
      mesh.position.set(x, WALL_HEIGHT / 2, z);
      mesh.rotation.y = rotY;
      scene.add(mesh);
    };
    wall(depth, -WALL_X, (WALL_FRONT_Z + WALL_BACK_Z) / 2, Math.PI / 2);
    wall(depth, WALL_X, (WALL_FRONT_Z + WALL_BACK_Z) / 2, -Math.PI / 2);
    wall(width, 0, WALL_BACK_Z, 0);
    wall(width, 0, WALL_FRONT_Z, Math.PI);
  }

  /** Largada blanca, llegada roja al pie de la muñeca. */
  private buildLines(scene: THREE.Scene): void {
    const line = (z: number, color: string) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(HALF_WIDTH * 2 + 2, 0.45),
        new THREE.MeshLambertMaterial({ color }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.012, z);
      scene.add(mesh);
    };
    line(START_Z, "#f7f5ee");
    line(FINISH_Z, "#d0232b");
  }

  /** Arbol pelado de ramas finas: casi un dibujo, marca el fondo y la escala. */
  private buildTree(scene: THREE.Scene): void {
    const bark = new THREE.MeshLambertMaterial({ color: "#6b4a32" });
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 9, 12), bark);
    trunk.position.y = 4.5;
    tree.add(trunk);
    // Ramas abiertas en abanico (casi horizontales) con ramitas en la punta: la copa
    // pelada tiene que leerse como arbol por detras de la cabeza de la muñeca.
    const branches: [number, number, number, number, number][] = [
      // altura, largo, giro en Y, inclinacion desde la vertical, grosor
      [6.2, 5.2, 0.4, 1.15, 0.22],
      [6.8, 4.8, 2.5, 1.05, 0.2],
      [7.4, 4.6, 4.3, 1.1, 0.19],
      [7.9, 4.2, 1.4, 0.95, 0.17],
      [5.6, 4.4, 5.5, 1.25, 0.18],
      [8.4, 3.6, 3.4, 0.8, 0.15],
      [8.8, 3.0, 5.0, 0.6, 0.13],
    ];
    const addBranch = (parent: THREE.Object3D, len: number, rotY: number, tilt: number, r: number, depth: number) => {
      const pivot = new THREE.Group();
      pivot.rotation.y = rotY;
      const arm = new THREE.Group();
      arm.rotation.z = tilt;
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, len, 7), bark);
      branch.position.y = len / 2;
      arm.add(branch);
      pivot.add(arm);
      parent.add(pivot);
      if (depth > 0) {
        // Dos ramitas desde la punta, que se abren hacia arriba.
        for (const side of [-1, 1]) {
          const tip = new THREE.Group();
          tip.position.y = len * 0.92;
          arm.add(tip);
          addBranch(tip, len * 0.5, side * 0.9, side * 0.55, r * 0.55, depth - 1);
        }
      }
    };
    for (const [h, len, rotY, tilt, r] of branches) {
      const base = new THREE.Group();
      base.position.y = h;
      tree.add(base);
      addBranch(base, len, rotY, tilt, r, 1);
    }
    tree.position.set(0, 0, TREE_Z);
    // Mas alto que la muñeca: la copa pelada tiene que asomar por encima de ella.
    tree.scale.setScalar(1.8);
    scene.add(tree);
  }

  /** Guardias de mameluco rosa con su mascara de figura, quietos contra las paredes. */
  private buildGuards(scene: THREE.Scene): void {
    const pink = new THREE.MeshLambertMaterial({ color: "#e0457b" });
    const masks = ([0, 1, 2] as const).map(
      (shape) => new THREE.MeshLambertMaterial({ map: maskTexture(shape) }),
    );
    const spots: [number, number][] = [];
    for (const z of [20, 2, -16]) {
      spots.push([-(WALL_X - 1.2), z], [WALL_X - 1.2, z]);
    }
    spots.push([-5, FINISH_Z - 5], [5, FINISH_Z - 5]);
    const black = new THREE.MeshLambertMaterial({ color: "#1a1a1a" });
    spots.forEach(([x, z], i) => {
      const g = new THREE.Group();
      // Mameluco: piernas, torso, brazos a los costados y capucha, todo rosa.
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.62, 4, 8), pink);
        leg.position.set(side * 0.17, 0.46, 0);
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.34), black);
        boot.position.set(side * 0.17, 0.07, 0.04);
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.6, 4, 8), pink);
        arm.position.set(side * 0.43, 1.28, 0);
        g.add(leg, boot, arm);
      }
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.55, 4, 10), pink);
      torso.position.y = 1.34;
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 14), black);
      belt.position.y = 1.02;
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), pink);
      hood.position.y = 2.1;
      const mask = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), masks[i % 3]);
      mask.position.set(0, 2.08, 0.27);
      g.add(torso, belt, hood, mask);
      g.position.set(x, 0, z);
      // Miran hacia el medio de la cancha.
      g.rotation.y = Math.atan2(-x, (START_Z + FINISH_Z) / 2 - z);
      scene.add(g);
    });
  }
}
